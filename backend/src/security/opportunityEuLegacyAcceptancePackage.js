'use strict';
const { createHash } = require('node:crypto');
const migration = require('./opportunityEuLegacyPrearchiveMigrationPackage');
const PACKAGE_ID = 'opportunity-eu-legacy-acceptance-391-v1';
const CENTRAL_BASELINE = migration.entry.version;
const packageDigest = createHash('sha256').update(JSON.stringify({ packageId: PACKAGE_ID,
  centralBaseline: CENTRAL_BASELINE, centralFingerprint: migration.entry.schemaFingerprint,
  tenantBaseline: require('./opportunityV2MigrationPackage').tenantAddition.version })).digest('hex');
module.exports = Object.freeze({ PACKAGE_ID, CENTRAL_BASELINE, packageDigest });
