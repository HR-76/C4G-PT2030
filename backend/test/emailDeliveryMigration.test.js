'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../src/security/centralMigrationManifest');
const ledger = require('../src/opportunities/catalogRead/ledgerContract');
test('catalog ledger admits the complete history migration chain and refuses omissions or altered checksums', () => {
  const rows = manifest.emailDeliveryManifest.map(entry => ({ version: entry.version, irreversible: entry.irreversible,
    checksum_sha256: manifest.migrationSql(entry.version, 'up').checksum }));
  ledger.assertLedgerRows(rows);
  for (const version of ['054_billing_account_validation', '055_entity_type_edit']) {
    assert.throws(() => ledger.assertLedgerRows(rows.filter(row => row.version !== version)), /DRIFT/);
  }
  assert.throws(() => ledger.assertLedgerRows(rows.map(row => row.version === '056_email_delivery_history'
    ? { ...row, checksum_sha256: '0'.repeat(64) } : row)), /DRIFT/);
  assert.equal(manifest.supportsCentralVersion('056_email_delivery_history', '049_pt2030_document_upload'), true);
  assert.equal(manifest.supportsCentralVersion('055_entity_type_edit', '056_email_delivery_history'), false);
});
