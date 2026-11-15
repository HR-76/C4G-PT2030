'use strict';

// Context: context/features/opportunity-description-presentation.md (Central 053). The package is explicit, additive,
// pinned to its exact bytes and applied only after 052.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PACKAGE_ID, CENTRAL_BASELINE, entry } = require('../src/security/opportunityComplementMigrationPackage');
const manifest = require('../src/security/centralMigrationManifest');
const staging = require('../src/security/stagingCentralRuntimeAdmission');

const sql = fs.readFileSync(path.join(__dirname, '../database/central/candidates/opportunity_complement.up.sql'), 'utf8');

test('053 is pinned to its SQL bytes, after 052 and irreversible', () => {
  assert.equal(PACKAGE_ID, 'opportunity-complement-v1');
  assert.equal(entry.version, '053_opportunity_complement');
  assert.equal(CENTRAL_BASELINE, '052_central_runtime_read');
  assert.equal(entry.requiresPreflightVersion, '052_central_runtime_read');
  assert.equal(entry.irreversible, true);
  assert.equal(manifest.migrationSql(entry.version, 'up').checksum, entry.upChecksum);
  assert.throws(() => manifest.migrationSql(entry.version, 'down'), /irreversible/);
  assert.match(entry.schemaFingerprint, /^[0-9a-f]{64}$/);
  assert.match(entry.authoritySecurityFingerprint, /^[0-9a-f]{64}$/);
  assert.notEqual(entry.schemaFingerprint, require('../src/security/centralRuntimeReadPackage').entry.schemaFingerprint);
});

test('earlier chains never end at 053, and 053 is the last step of its own chain', () => {
  assert.equal(manifest.knownManifest.at(-1).version, '051_email_templates');
  assert.equal(manifest.centralRuntimeReadManifest.at(-1).version, '052_central_runtime_read');
  assert.equal(manifest.opportunityComplementManifest.at(-1), entry);
  assert.equal(manifest.opportunityComplementManifest.at(-2).version, '052_central_runtime_read');
  assert.ok(manifest.allKnownMigrations.includes(entry));
  assert.equal(manifest.supportsCentralVersion(entry.version, '052_central_runtime_read'), true);
  assert.equal(manifest.supportsCentralVersion(entry.version, '015_funding_tenders_central'), true);
  assert.equal(manifest.supportsCentralVersion('052_central_runtime_read', entry.version), false);
});

test('the SQL leaves the catalog schema alone and gives the runtime role no direct write', () => {
  assert.doesNotMatch(sql, /opportunity_catalog\./);
  assert.doesNotMatch(sql, /c4g_catalog_reader/);
  assert.doesNotMatch(sql, /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im);
  assert.doesNotMatch(sql, /GRANT (?:ALL|INSERT|UPDATE|DELETE|TRUNCATE)[^;]*TO c4g_central_runtime/i);
  assert.match(sql, /GRANT SELECT ON public\.opportunity_complement_version TO c4g_central_runtime;/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.opportunity_complement_version/);
  assert.match(sql, /BEFORE TRUNCATE ON public\.opportunity_complement_version/);
});

test('the explicit entrypoint refuses any other package id', async () => {
  const runner = require('../scripts/runCentralMigrations');
  await assert.rejects(() => runner.applyRegisteredOpportunityComplementPackage({}, 'central-runtime-read-v1'), /OPPORTUNITY_COMPLEMENT_PACKAGE_NOT_REGISTERED/);
});

// The lists that stopped at 051 are what kept the staging API restarting once the ledger reached 052.
test('runtime admission accepts registered 053 and keeps schema/ledger validation mandatory', async t => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  for (const file of ['src/security/catalogReaderSchema.js', 'src/security/catalogReaderSecurity.js', 'src/customerBilling/pdfRuntime.js']) {
    assert.ok(read(file).includes(`'${entry.version}'`), `${file} does not admit ${entry.version}`);
  }
  const { assertImportAvailability, assertCatalogLedger, assertOpportunityPreflight } = require('./support/centralRuntimeAdmissionAssertions');
  await assertImportAvailability(t, entry.version);
  assertCatalogLedger(manifest.opportunityComplementManifest);
  await assertOpportunityPreflight(manifest.opportunityComplementManifest);
  assert.ok(read('src/security/centralMigrationPreflight.js').includes('opportunityComplementManifest.at(-1).version'));
  assert.ok(read('scripts/staging/install.js').includes("run.applyRegisteredOpportunityComplementPackage(pool, 'opportunity-complement-v1')"));
});

test('the staging variant of 053 is admitted only with the staging flag and its exact pins', () => {
  const env = { [staging.FLAG]: staging.VALUE }, pins = staging.later[entry.version];
  assert.equal(staging.admits(entry.version, 'schema', pins.schema, env), true);
  assert.equal(staging.admits(entry.version, 'authority', pins.authority, env), true);
  assert.equal(staging.admits(entry.version, 'schema', pins.schema, {}), false);
  assert.equal(staging.admits(entry.version, 'schema', staging.fingerprints.schema, env), false);
  assert.equal(staging.admits('052_central_runtime_read', 'schema', staging.fingerprints.schema, env), true);
  assert.equal(staging.admits('054_unknown', 'schema', pins.schema, env), false);
  assert.notEqual(pins.schema, entry.schemaFingerprint);
});
