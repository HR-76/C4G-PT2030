'use strict';
const { createHash } = require('node:crypto');
const PACKAGE_ID = 'opportunity-eu-legacy-prearchive-v1';
const CENTRAL_BASELINE = '044_opportunity_eu_expired_reconciliation';
// Measured after restore of an isolated PostgreSQL 18 database at 044.
const entry = Object.freeze({
  version: '045_opportunity_eu_legacy_prearchive', irreversible: true,
  acceptsHistoricalCrlfChecksum: false, requiresPreflightVersion: CENTRAL_BASELINE,
  requiresCatalogSecurityFingerprint: 'e555853a5df214eef5cc64c4f4021de6a2db672373c53cc7809270ed19d1e4b7',
  upChecksum: '68cb256a60029fce201d4f5c9dace068b284785affce897267ecc25fc17fc7b7',
  schemaFingerprint: '6535ac51c1c105aca1cffab3397239fcf495a282968f7ed579205ac163469aa1',
  authoritySecurityFingerprint: 'eb5f1c51a34ce0219b929629d4918cf152bda95d44fb9209a58d08d076992f7e',
  catalogSecurityFingerprint: 'e555853a5df214eef5cc64c4f4021de6a2db672373c53cc7809270ed19d1e4b7',
  euWriterSecurityFingerprint: '83deaef4092291c3518484b389fb5c3cffc2ab9825832ea872ca1a0d2868d8e0',
  euRunReconciliationSecurityFingerprint: '040b426fc45dc4af1c2e2b36a0c9056ac28a1e84119704f314d5bdd1f7f3fb82',
  euLegacyPrearchiveSecurityFingerprint: 'd960c020d800e12656fad7a32e7795219090aca8debc0f09ff7e05a38bbec1c5'
});
const packageDigest = createHash('sha256').update(JSON.stringify({ packageId: PACKAGE_ID,
  centralBaseline: CENTRAL_BASELINE, entry })).digest('hex');
function assertPackageId(value) {
  if (value !== PACKAGE_ID) throw new TypeError('EU legacy prearchive package is not registered.');
  return PACKAGE_ID;
}
module.exports = Object.freeze({ PACKAGE_ID, CENTRAL_BASELINE, entry, packageDigest, assertPackageId });
