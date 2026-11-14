'use strict';
// Staging only. Admits exactly one observed variant of each Central state from 052 on: the same schema as the generic
// package, plus the two staging runtime logins (c4g_central_staging_api and c4g_central_staging_worker) as members of
// c4g_central_runtime with INHERIT TRUE, SET FALSE, ADMIN FALSE. Anything else still drifts. Production never sets the
// flag below. Decision recorded in context/features/staging-central-runtime-login.md (14/11/2026). The 053 pins were
// measured by test/integration/opportunity-complement/gate.cjs, which first reproduces the 052 pins.
const FLAG = 'C4G_STAGING_CENTRAL_RUNTIME_LOGINS';
const VALUE = 'admitted-v1';
const version = '052_central_runtime_read';
const fingerprints = Object.freeze({
  schema: '2b6d672a1917931b1264ecf1ea564d41625ff1bf943e4c2abb77a853728200b7',
  authority: '69fe614017584d90de8da44dc2a8b380b1e85812926a8e759607e202e175e969',
});
const later = Object.freeze({
  '054_billing_account_validation': Object.freeze({
    schema: 'cfdbedb567f55b6313bc5290074ccd8cdbf9d1f9df1e6f0ba4f5abef011e0961',
    authority: 'ebdb09c37b0a2e2a748f0427e992c0144bf162e1d39ff92824c9687ed9293aec',
  }),
  '053_opportunity_complement': Object.freeze({
    schema: '5a66cb328bb0f9eac5829f6f00763db0bf510ca285b469e70b40900cd17aba49',
    authority: 'b0e509e0c10ae5c4c548212c9605657733e79821e19343d8b2e898dd00c263c6',
  }),
});
function admits(candidateVersion, kind, fingerprint, env = process.env) {
  const accepted = candidateVersion === version ? fingerprints : later[candidateVersion];
  return env[FLAG] === VALUE && Boolean(accepted) && Object.hasOwn(accepted, kind)
    && typeof accepted[kind] === 'string' && fingerprint === accepted[kind];
}
module.exports = Object.freeze({ FLAG, VALUE, version, fingerprints, later, admits });
