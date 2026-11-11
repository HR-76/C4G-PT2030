const { evaluateAssurance } = require('../security/assurance');
const { evaluateSupportGrant } = require('./supportPolicy');

function deny(reasonCode) { return Object.freeze({ allowed: false, reasonCode }); }

function scopeMatches(scope, resource, organizationId, exactResourceScope = false) {
  if (!scope || scope.organizationId !== organizationId || resource.organizationId !== organizationId) return false;
  if (exactResourceScope) {
    if (scope.type === 'ORGANIZATION') return resource.scopeType === 'ORGANIZATION' && scope.id === organizationId;
    if (scope.type === 'UNIT') return resource.scopeType === 'UNIT' && (resource.scopeId||resource.id) === scope.id;
    if (scope.type === 'TEAM') return resource.scopeType === 'TEAM' && (resource.scopeId||resource.id) === scope.id;
    return scope.type === 'RESOURCE' && resource.scopeType === 'RESOURCE' && resource.id === scope.id;
  }
  if (scope.type === 'ORGANIZATION') return scope.id === organizationId;
  if (scope.type === 'UNIT') return resource.unitId === scope.id;
  if (scope.type === 'UNIT_SUBTREE') return resource.unitId === scope.id
    || (Array.isArray(resource.ancestorUnitIds) && resource.ancestorUnitIds.includes(scope.id));
  if (scope.type === 'TEAM') return Array.isArray(resource.teamIds) && resource.teamIds.includes(scope.id);
  return scope.type === 'RESOURCE' && resource.id === scope.id;
}

function createPolicyEngine({ permissionCatalog, profileCatalog, assurancePolicyVersion, recentMfaRequirement }) {
  if (!permissionCatalog || !profileCatalog || !assurancePolicyVersion || !recentMfaRequirement) {
    throw new TypeError('Policy engine configuration is invalid.');
  }
  return Object.freeze({ evaluate(input) {
    const { actor, membership, snapshot, operation, resource, assuranceEvidence, now } = input;
    if (!membership || membership.status !== 'ACTIVE' || membership.organizationId !== actor.organizationId
        || membership.id !== actor.membershipId || snapshot.organizationId !== actor.organizationId) {
      return deny('MEMBERSHIP_INACTIVE_OR_MISMATCH');
    }
    if (snapshot.authorizationVersion !== actor.authorizationVersion
        || snapshot.membershipVersion !== actor.membershipVersion) return deny('AUTHORIZATION_VERSION_STALE');
    const permission = permissionCatalog.resolve(operation.permission);
    if (!permission) return deny('PERMISSION_UNKNOWN');
    if (input.serviceBinding && resource.status !== 'ACTIVE' && input.allowInactiveResource !== true) return deny('RESOURCE_INACTIVE');
    if(input.serviceBinding){const binding=input.serviceBinding,grants=Array.isArray(snapshot.serviceGrants)?snapshot.serviceGrants:[];const allowed=actor.type==='SERVICE'&&actor.membershipId===null&&membership.id===null&&!permission.sensitive&&permission.sodRule===null&&binding.operationCode===operation.code&&binding.permission===permission.code&&binding.serviceActorCode===actor.id&&binding.jobType===actor.jobType&&grants.some(grant=>grant&&grant.active===true&&grant.organizationId===actor.organizationId&&grant.permission===permission.code&&grant.operationCode===operation.code&&grant.serviceActorCode===actor.id&&grant.jobType===actor.jobType&&grant.policyVersion==='f12-service-operations-v1'&&grant.authorizationVersion===actor.authorizationVersion);return allowed?Object.freeze({allowed:true,reasonCode:'AUTHORIZED',permission,appliedGrantCount:1}):deny('PERMISSION_NOT_GRANTED');}
    const profile = profileCatalog.resolve(snapshot.profileCode);
    if (!profile) return deny('PROFILE_UNKNOWN');
    const grants = [];
    for (const code of profile.permissions) grants.push({ permission: code, scope: { type: 'ORGANIZATION', id: actor.organizationId, organizationId: actor.organizationId } });
    for (const grant of snapshot.grants) grants.push(grant);
    const applicable = grants.filter(grant => grant.permission === permission.code
      && permission.scopes.includes(grant.scope.type)
      && scopeMatches(grant.scope, resource, actor.organizationId, input.exactResourceScope === true));
    if (applicable.length === 0) return deny('PERMISSION_NOT_GRANTED');
    if (resource.status !== 'ACTIVE' && input.allowInactiveResource !== true) return deny('RESOURCE_INACTIVE');
    if (permission.sodRule) {
      const rule = snapshot.sodRules.find(item => item.code === permission.sodRule);
      if (!rule || !Array.isArray(rule.distinctFromActorIds) || rule.distinctFromActorIds.includes(actor.id)) {
        return deny('SOD_VIOLATION');
      }
    }
    if (permission.sensitive || actor.type === 'SUPPORT') {
      const assurance = evaluateAssurance({ evidence: assuranceEvidence, requirement: recentMfaRequirement,
        nowSeconds: Math.floor(now.getTime() / 1000), expectedPolicyVersion: assurancePolicyVersion });
      if (!assurance.allowed) return deny(assurance.reason);
    }
    if (actor.type === 'SUPPORT') {
      const support = evaluateSupportGrant(snapshot.supportGrant, {
        actorId: actor.id, organizationId: actor.organizationId, resource, now
      });
      if (!support.allowed) return deny(support.reasonCode);
    }
    return Object.freeze({ allowed: true, reasonCode: 'AUTHORIZED', permission, appliedGrantCount: applicable.length });
  } });
}

module.exports = { createPolicyEngine, scopeMatches };
