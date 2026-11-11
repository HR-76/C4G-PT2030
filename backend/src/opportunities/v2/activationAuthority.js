'use strict';

const { evaluateAssurance } = require('../../security/assurance');
const { cloneData, deepFreeze } = require('./data');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SESSION = /^[A-Za-z0-9._~-]{8,512}$/;
const SQL = 'SELECT authority FROM authority_api.opportunity_v2_administrator($1::text,$2::uuid)';
function denied() { throw Object.assign(new Error('OPPORTUNITY_V2_AUTHORITY_DENIED'), { code: 'OPPORTUNITY_V2_AUTHORITY_DENIED' }); }

function humanContext(value) {
  try {
    const context = cloneData(value, { maxBytes: 4096 });
    if (!context || Array.isArray(context) || !context.actor || Array.isArray(context.actor)
        || Object.keys(context.actor).length !== 2 || context.actor.type !== 'HUMAN'
        || !UUID.test(context.actor.id) || !SESSION.test(context.sessionId)) return null;
    return context;
  } catch { return null; }
}

// Opt-in central authority. No HTTP body, tenant role, cached platform role or
// caller-provided MFA evidence can replace the locked, persisted session.
// SERVICE is deliberately refused until an authenticated worker lease exists.
function createActivationAuthorityV2({ policyVersion, recentMfaRequirement } = {}) {
  let requirement;
  try { requirement = cloneData(recentMfaRequirement, { maxBytes: 4096 }); } catch { /* invalid below */ }
  if (typeof policyVersion !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(policyVersion)
      || !requirement || typeof requirement.mfa !== 'boolean' || !Number.isSafeInteger(requirement.maxAgeSeconds)
      || requirement.maxAgeSeconds < 1 || requirement.maxAgeSeconds > 86400 || !['any', 'all'].includes(requirement.amrMode)
      || ![requirement.acceptedAcr, requirement.acceptedAmr].every(list => Array.isArray(list)
        && (!requirement.mfa || list.length > 0) && list.every(item => typeof item === 'string' && item.length > 0 && item.length <= 256))) {
    throw new TypeError('Activation requires a versioned recent authentication policy.');
  }
  deepFreeze(requirement);

  async function authorize(client, raw) {
    const context = humanContext(raw);
    if (!context) return false;
    const result = await client.query(SQL, [context.sessionId, context.actor.id]);
    if (result.rows.length !== 1) return false;
    const value = result.rows[0]?.authority;
    if (!value || value.userId !== context.actor.id || value.storedUserId !== context.actor.id
        || !Number.isSafeInteger(value.revocationVersion) || value.revocationVersion < 1
        || value.storedRevocationVersion !== value.revocationVersion || value.policyVersion !== policyVersion
        || !Number.isFinite(value.nowSeconds) || !Number.isFinite(value.absoluteExpiresAt)
        || value.absoluteExpiresAt <= value.nowSeconds * 1000 || !Number.isFinite(value.expiresAt)
        || value.expiresAt <= value.nowSeconds * 1000) return false;
    if (value.cookieExpires !== null && (typeof value.cookieExpires !== 'string'
        || !Number.isFinite(Date.parse(value.cookieExpires)) || Date.parse(value.cookieExpires) <= value.nowSeconds * 1000)) return false;
    const evidence = value.evidence;
    if (!evidence || !Array.isArray(evidence.amr) || evidence.amr.some(item => typeof item !== 'string')) return false;
    return evaluateAssurance({ evidence, requirement, nowSeconds: value.nowSeconds, expectedPolicyVersion: policyVersion }).allowed === true;
  }

  async function assertAdministrator(client, raw) {
    const context = humanContext(raw);
    if (!context || await authorize(client, context) !== true) denied();
    return context.actor.id;
  }
  return Object.freeze({ authorize, assertAdministrator });
}

module.exports = { createActivationAuthorityV2, humanContext };
