'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const backup = require('../scripts/localPlatform/backupOpportunityV2');
const pkg = require('../src/security/opportunityEuLegacyAcceptancePackage');
const migration = require('../src/security/opportunityEuLegacyPrearchiveMigrationPackage');
const tenant = require('../src/security/opportunityV2MigrationPackage').tenantAddition;

test('legacy acceptance backup is fixed to Central 045 and tenant 034', () => {
  const profile = backup.LEGACY_ACCEPTANCE_PROFILE;
  assert.deepEqual(backup.assertBaseline({ currentVersion: pkg.CENTRAL_BASELINE,
    fingerprint: migration.entry.schemaFingerprint, postgresMajor: 18 }, 'central', profile),
  { version: pkg.CENTRAL_BASELINE, fingerprint: migration.entry.schemaFingerprint });
  assert.deepEqual(backup.assertBaseline({ currentVersion: tenant.version,
    fingerprint: tenant.schemaFingerprint }, 'tenant', profile),
  { version: tenant.version, fingerprint: tenant.schemaFingerprint });
  assert.throws(() => backup.assertBaseline({ currentVersion: '044_opportunity_eu_legacy_prearchive',
    fingerprint: migration.entry.schemaFingerprint, postgresMajor: 18 }, 'central', profile),
  { message: 'OPPORTUNITY_BACKUP_BASELINE_MISMATCH' });
});
