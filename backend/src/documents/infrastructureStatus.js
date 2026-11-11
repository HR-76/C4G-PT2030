'use strict';
// Presence-only diagnostics. Do not spread an environment/configuration object
// into a result or exception: these objects can contain provider credentials.
const KEYS = Object.freeze(['C4G_R2_ENDPOINT', 'C4G_R2_DOCUMENTS_BUCKET', 'C4G_R2_QUARANTINE_BUCKET',
  'C4G_R2_ACCESS_KEY_ID', 'C4G_R2_SECRET_ACCESS_KEY', 'C4G_CLAMAV_HOST', 'C4G_CLAMAV_PORT']);
function inspectDocumentInfrastructure(env = process.env) {
  const configured = Object.fromEntries(KEYS.map(key => [key, typeof env[key] === 'string' && Boolean(env[key].trim())]));
  const blockers = [];
  if (KEYS.slice(0, 5).some(key => !configured[key])) blockers.push('R2_CONFIGURATION_MISSING');
  else {
    if (!/^https:\/\/[a-z0-9-]+\.eu\.r2\.cloudflarestorage\.com$/.test(env.C4G_R2_ENDPOINT)) blockers.push('R2_EU_ENDPOINT_INVALID');
    if (![env.C4G_R2_DOCUMENTS_BUCKET, env.C4G_R2_QUARANTINE_BUCKET].every(value => /^[a-z0-9][a-z0-9-]{2,62}$/.test(value))
      || env.C4G_R2_DOCUMENTS_BUCKET === env.C4G_R2_QUARANTINE_BUCKET) blockers.push('R2_BUCKET_CONFIGURATION_INVALID');
  }
  if (!configured.C4G_CLAMAV_HOST || !configured.C4G_CLAMAV_PORT) blockers.push('SCANNER_CONFIGURATION_MISSING');
  else if (!['127.0.0.1', '::1'].includes(env.C4G_CLAMAV_HOST) || !/^[0-9]{1,5}$/.test(env.C4G_CLAMAV_PORT)
    || Number(env.C4G_CLAMAV_PORT) < 1 || Number(env.C4G_CLAMAV_PORT) > 65535) blockers.push('SCANNER_CONFIGURATION_INVALID');
  blockers.push('R2_PRIVATE_ACCESS_NOT_VERIFIED', 'R2_LAYER_C_NOT_VERIFIED', 'SCANNER_NOT_VERIFIED', 'DOCUMENT_RUNTIME_NOT_COMPOSED');
  return Object.freeze({ ready: false, configured: Object.freeze(configured), blockers: Object.freeze(blockers),
    networkProbed: false, businessDataChanged: false });
}
module.exports = { inspectDocumentInfrastructure, KEYS };
