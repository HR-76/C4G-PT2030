'use strict';
// Central package 051: email template and logo history. Explicit installation
// only; no existing entrypoint applies it. Fingerprints were measured on a
// disposable PostgreSQL 18 by test/integration/email-templates/gate.cjs.
const previous = require('./billingPdfMigrationPackage').entry;
const PACKAGE_ID = 'email-templates-v1';
const CENTRAL_BASELINE = previous.version;
const entry = Object.freeze({
  ...previous,
  version: '051_email_templates',
  file: 'email_templates.up.sql',
  requiresPreflightVersion: CENTRAL_BASELINE,
  upChecksum: '1c627a25edb2a18355082f6582b2211f5c9a5c6b1af7e8b263603d441d7b2aca',
  schemaFingerprint: 'ac57824cbc8411b98c525cdde3c29c36c753e5b2f15eedb98b456fa456309a38',
  authoritySecurityFingerprint: '7c19b360b90bca762deac174044c9812c92a1f7fb7d62d10219927f41586aa51'
});
module.exports = { PACKAGE_ID, CENTRAL_BASELINE, entry };
