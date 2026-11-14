'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../src/security/centralMigrationManifest');
const { entry, PACKAGE_ID, CENTRAL_BASELINE } = require('../src/security/emailTemplateMigrationPackage');
const pdf = require('../src/security/billingPdfMigrationPackage').entry;
const ledger = require('../src/opportunities/catalogRead/ledgerContract');
const admission = require('../src/security/memberEmailAdmission');

const row = item => ({ version: item.version, checksum_sha256: manifest.migrationSql(item.version, 'up').checksum, irreversible: item.irreversible });

test('email template package is the last known migration and builds on billing PDFs', () => {
  assert.equal(PACKAGE_ID, 'email-templates-v1');
  assert.equal(CENTRAL_BASELINE, '050_billing_private_documents');
  assert.equal(manifest.knownManifest.at(-1), entry);
  assert.equal(manifest.knownManifest.at(-2), pdf);
  assert.equal(entry.requiresPreflightVersion, pdf.version);
  assert.equal(entry.irreversible, true);
  assert.equal(manifest.migrationSql(entry.version, 'up').checksum, entry.upChecksum);
  assert.throws(() => manifest.migrationSql(entry.version, 'down'), /irreversible/);
});

test('the billing PDF package keeps its own boundary and does not include email templates', () => {
  assert.equal(manifest.billingPdfManifest.at(-1), pdf);
  assert.equal(manifest.billingPdfManifest.includes(entry), false);
  assert.equal(manifest.billingPdfManifest.length + 1, manifest.knownManifest.length);
});

test('a database at 050 or at 051 is a supported state, and nothing in between', () => {
  assert.equal(manifest.supportsCentralVersion('050_billing_private_documents', '050_billing_private_documents'), true);
  assert.equal(manifest.supportsCentralVersion('051_email_templates', '050_billing_private_documents'), true);
  assert.equal(manifest.supportsCentralVersion('051_email_templates', '051_email_templates'), true);
  assert.equal(manifest.supportsCentralVersion('050_billing_private_documents', '051_email_templates'), false);
});

test('the catalog ledger accepts 050 and 051 and refuses 051 without its predecessor', () => {
  const at051 = manifest.knownManifest.map(row);
  ledger.assertLedgerRows(at051);
  ledger.assertLedgerRows(manifest.billingPdfManifest.map(row));
  assert.throws(() => ledger.assertLedgerRows(at051.filter(item => item.version !== pdf.version)), /DRIFT/);
  assert.throws(() => ledger.assertLedgerRows(at051.map(item => item.version === entry.version ? { ...item, checksum_sha256: 'f'.repeat(64) } : item)), /DRIFT/);
});

test('the member-email variant of 051 is admitted only by its exact fingerprints', () => {
  assert.equal(admission.admits(entry.version, 'schema', 'b78f8ea62dd7a7e5cf4a213f89c9ee57d6f72dae1e7d577bd04c7416c9824415'), true);
  assert.equal(admission.admits(entry.version, 'authority', '89a20e2c69f4d9f4ba57351b3c1fac15ca7b9030ffa645c6c7e4f0157db3fa7c'), true);
  assert.equal(admission.admits(entry.version, 'schema', entry.schemaFingerprint), false);
  assert.equal(admission.admits(pdf.version, 'schema', 'b78f8ea62dd7a7e5cf4a213f89c9ee57d6f72dae1e7d577bd04c7416c9824415'), false);
  assert.equal(admission.admits(entry.version, 'schema', 'a'.repeat(64)), false);
});

test('the installer refuses any other package name', async () => {
  const runner = require('../scripts/runCentralMigrations');
  await assert.rejects(() => runner.applyRegisteredEmailTemplatesPackage({}, 'billing-private-documents-v1'), /EMAIL_TEMPLATES_PACKAGE_NOT_REGISTERED/);
});
