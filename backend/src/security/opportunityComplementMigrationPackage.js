'use strict';
// Central package 053: opportunity complement history (collected and editorial layers).
// Explicit installation only, after 052. Fingerprints were measured on a disposable
// PostgreSQL 18 by test/integration/opportunity-complement/gate.cjs.
const previous = require('./centralRuntimeReadPackage').entry;
const PACKAGE_ID = 'opportunity-complement-v1';
const CENTRAL_BASELINE = previous.version;
const entry = Object.freeze({
  ...previous,
  version: '053_opportunity_complement',
  file: 'opportunity_complement.up.sql',
  irreversible: true,
  requiresPreflightVersion: CENTRAL_BASELINE,
  upChecksum: '0dc6f3863304f6743f23d781322b69ca09881a813e8d8c33432158464f0c4396',
  schemaFingerprint: '3315f752f070ed01f9dfa8756b09e270ff1db62fce7d066f3c9c2be35bd2c366',
  authoritySecurityFingerprint: 'd2e837e2b9cdf2bc0f1b5818650642ad186c061bda05fbf073b0227329d0eaa7'
});
module.exports = { PACKAGE_ID, CENTRAL_BASELINE, entry };
