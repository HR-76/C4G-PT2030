'use strict';
const previous = require('./entityTypeMigrationPackage').entry;
const PACKAGE_ID = 'email-delivery-history-v1';
const CENTRAL_BASELINE = previous.version;
const entry = Object.freeze({ ...previous, version: '056_email_delivery_history', file: 'email_delivery_history.up.sql',
  irreversible: true, requiresPreflightVersion: CENTRAL_BASELINE,
  upChecksum: '662db5c79937a20c4637afd2777e17569a87f76ac532c41e3d299564e6b7ccf1',
  schemaFingerprint: 'b040d018b674cc24fb52ed8635de24b64fcfa09f19fe632c75a7d1266bef66c9',
  authoritySecurityFingerprint: 'f9fe6cfa77b718012d55674387feeb9ac1072e2a0b8036be83b6019e2afa7f6f' });
module.exports = { PACKAGE_ID, CENTRAL_BASELINE, entry };
