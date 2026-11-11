'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const backup = require('../scripts/localPlatform/backupOpportunityV2');
const legacy = require('../src/security/opportunityEuLegacyPrearchiveMigrationPackage');
const prior = require('../src/security/opportunityEuReconciliationMigrationPackage');
const v2 = require('../src/security/opportunityV2MigrationPackage');

test('legacy backup profile is bound to registered 045 and exact 044/034 baseline', () => {
  const input = { windowId: '00000000-0000-4000-8000-000000000001',
    packageDigest: legacy.packageDigest, profile: backup.LEGACY_PREARCHIVE_PROFILE,
    stopReceipt: { id: 45, created: '2026-10-31T23:00:00.000Z', descendants: [45],
      verified: true, stopped: true } };
  assert.equal(backup.validatePauseInput(input).packageDigest, legacy.packageDigest);
  assert.equal(backup.assertBaseline({ currentVersion: legacy.CENTRAL_BASELINE,
    fingerprint: prior.entry.schemaFingerprint, postgresMajor: 18 },
  'central', backup.LEGACY_PREARCHIVE_PROFILE).version, legacy.CENTRAL_BASELINE);
  assert.equal(backup.assertBaseline({ currentVersion: v2.tenantAddition.version,
    fingerprint: v2.tenantAddition.schemaFingerprint },
  'tenant', backup.LEGACY_PREARCHIVE_PROFILE).version, v2.tenantAddition.version);
  assert.throws(() => backup.validatePauseInput({ ...input, packageDigest: 'a'.repeat(64) }));
  assert.throws(() => backup.assertBaseline({ currentVersion: legacy.entry.version,
    fingerprint: legacy.entry.schemaFingerprint, postgresMajor: 18 },
  'central', backup.LEGACY_PREARCHIVE_PROFILE));
});
