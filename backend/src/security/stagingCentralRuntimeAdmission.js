'use strict';
// Staging only. Admits exactly one observed variant of the Central 052 state: the same schema as the generic 052
// package, plus the two staging runtime logins (c4g_central_staging_api and c4g_central_staging_worker) as members of
// c4g_central_runtime with INHERIT TRUE, SET FALSE, ADMIN FALSE. Anything else still drifts. Production never sets the
// flag below. Decision recorded in context/features/staging-central-runtime-login.md (14/11/2026).
const FLAG = 'C4G_STAGING_CENTRAL_RUNTIME_LOGINS';
const VALUE = 'admitted-v1';
const version = '052_central_runtime_read';
const fingerprints = Object.freeze({
  schema: '2b6d672a1917931b1264ecf1ea564d41625ff1bf943e4c2abb77a853728200b7',
  authority: '69fe614017584d90de8da44dc2a8b380b1e85812926a8e759607e202e175e969',
});
function admits(candidateVersion, kind, fingerprint, env = process.env) {
  return env[FLAG] === VALUE && candidateVersion === version && Object.hasOwn(fingerprints, kind)
    && typeof fingerprints[kind] === 'string' && fingerprint === fingerprints[kind];
}
module.exports = Object.freeze({ FLAG, VALUE, version, fingerprints, admits });
