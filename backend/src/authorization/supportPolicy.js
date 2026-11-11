const MAX_SUPPORT_MS = 4 * 60 * 60 * 1000;
const MAX_START_DELAY_MS = 24 * 60 * 60 * 1000;

function evaluateSupportGrant(grant, { actorId, organizationId, resource, now }) {
  const keys = ['status', 'operatorId', 'organizationId', 'ticketRef', 'reasonCode', 'organizationApproverId',
    'c4gApproverId', 'approvedAt', 'startsAt', 'expiresAt', 'scopeType', 'scopeId'];
  if (!grant || typeof grant !== 'object' || Object.getPrototypeOf(grant) !== Object.prototype
      || Reflect.ownKeys(grant).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(grant, key))) {
    return Object.freeze({ allowed: false, reasonCode: 'SUPPORT_GRANT_INVALID' });
  }
  if (!grant || grant.status !== 'ACTIVE') return Object.freeze({ allowed: false, reasonCode: 'SUPPORT_GRANT_MISSING' });
  const start = Date.parse(grant.startsAt);
  const expiry = Date.parse(grant.expiresAt);
  const approved = Date.parse(grant.approvedAt);
  const timestamp = now.getTime();
  if (![start, expiry, approved].every(Number.isFinite) || expiry <= start || expiry - start > MAX_SUPPORT_MS
      || start - approved > MAX_START_DELAY_MS || start < approved || timestamp < start || timestamp >= expiry) {
    return Object.freeze({ allowed: false, reasonCode: 'SUPPORT_WINDOW_INVALID' });
  }
  if (grant.operatorId !== actorId || grant.organizationId !== organizationId
      || typeof grant.ticketRef !== 'string' || grant.ticketRef.length < 1
      || typeof grant.reasonCode !== 'string' || grant.reasonCode.length < 1
      || !grant.organizationApproverId || !grant.c4gApproverId
      || grant.organizationApproverId === grant.c4gApproverId
      || [grant.organizationApproverId, grant.c4gApproverId].includes(actorId)) {
    return Object.freeze({ allowed: false, reasonCode: 'SUPPORT_APPROVAL_INVALID' });
  }
  const scopeMatches = grant.scopeType === 'ORGANIZATION' || (grant.scopeType === 'RESOURCE' && grant.scopeId === resource.id);
  return Object.freeze(scopeMatches
    ? { allowed: true }
    : { allowed: false, reasonCode: 'SUPPORT_SCOPE_MISMATCH' });
}

module.exports = { MAX_START_DELAY_MS, MAX_SUPPORT_MS, evaluateSupportGrant };
