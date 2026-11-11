'use strict';
const { createAuthorizationService } = require('../authorization/authorizationService');
const { createPolicyEngine } = require('../authorization/policyEngine');
const { createAuditCoordinator } = require('../authorization/audit');
const { createMetricsPort } = require('../authorization/metrics');
const authorizationPorts=new WeakSet();
function isResourceAuthorization(port){return authorizationPorts.has(port);}

function createTaxonomyAuthorization({ catalogs, membershipPort, authorizationDataPort, authorizationAuditPort,
  assurancePolicyVersion, recentMfaRequirement, clock, telemetry, exactResourceScope = true, snapshotForResource = null,
  withAuthorityReads }) {
  if (typeof exactResourceScope !== 'boolean') throw new TypeError('Resource scope mode is invalid.');
  if (snapshotForResource !== null && typeof snapshotForResource !== 'function') throw new TypeError('Resource policy is invalid.');
  const engine = createPolicyEngine({ permissionCatalog: catalogs.permissionCatalog, profileCatalog: catalogs.profileCatalog,
    assurancePolicyVersion, recentMfaRequirement });
  const auditCoordinator = createAuditCoordinator({ port: authorizationAuditPort, timeoutMs: 100 });
  // Functional F7 is emitted once by the repository; F5 emits only decision events.
  const operationCatalog = Object.freeze({ version: catalogs.operationCatalog.version, resolve(code) {
    const operation = catalogs.operationCatalog.resolve(code);
    return operation ? Object.freeze({ ...operation, auditEvent: 'AUTHORIZATION_ALLOWED' }) : null;
  } });
  const port=Object.freeze({ async authorize(operationCode, trusted, resource) {
    let evaluation = null;
    const service = createAuthorizationService({ operationCatalog, membershipPort, authorizationDataPort, withAuthorityReads,
      scopeSnapshot: (snapshot, actor) => snapshot && snapshotForResource
        ? snapshotForResource({actor, snapshot, resource, operationCode}) : snapshot,
      resourcePort: { async load(input) { return input.resourceId === resource.id && input.resourceType === resource.resourceType
        && input.organizationId === resource.organizationId ? resource : null; } },
      policyEngine: { evaluate(input) {
        if (input.membership.globalUserId !== input.actor.id || input.membership.membershipVersion !== input.actor.membershipVersion) {
          return Object.freeze({ allowed: false, reasonCode: 'MEMBERSHIP_INACTIVE_OR_MISMATCH' });
        }
        const evidence = input.assuranceEvidence;
        const permission = catalogs.permissionCatalog.resolve(input.operation.permission);
        if (permission?.sensitive && (!evidence || !Number.isFinite(evidence.authTime) || typeof evidence.acr !== 'string'
            || !Array.isArray(evidence.amr) || evidence.amr.some(value => typeof value !== 'string'))) {
          return Object.freeze({ allowed: false, reasonCode: 'AUTH_EVIDENCE_MISSING' });
        }
        const snapshot = input.snapshot;
        const scoped = { ...snapshot, grants: snapshot.grants.filter(grant =>
          (grant.resourceId === undefined || grant.resourceId === resource.id)
          && (grant.resourceType === undefined || grant.resourceType === resource.resourceType)) };
        const decision = engine.evaluate({ ...input, snapshot: scoped, exactResourceScope });
        if (!decision.allowed) return decision;
        if (resource.distinctFromActorIds.includes(input.actor.id)) return Object.freeze({ allowed: false, reasonCode: 'SOD_VIOLATION' });
        evaluation = Object.freeze({ assuranceLevel: permission.sensitive && recentMfaRequirement.mfa ? 'RECENT_MFA' : 'SESSION',
          policyVersion: assurancePolicyVersion, membershipVersion: input.membership.membershipVersion,
          authorizationVersion: snapshot.authorizationVersion, permissionCatalogVersion: catalogs.permissionCatalog.version,
          operationCatalogVersion: catalogs.operationCatalog.version });
        return decision;
      } }, auditCoordinator: { emit: event => auditCoordinator.emit(evaluation && event.result === 'ALLOW'
        ? Object.freeze({ ...event, policyVersion: evaluation.policyVersion, assuranceLevel: evaluation.assuranceLevel }) : event) }, clock,
      metricsPort: createMetricsPort(labels => { try { telemetry?.record('F5', 1, labels); } catch {} }) });
    const decision = await service.authorize({ operationCode, actor: trusted.actor, resourceId: resource.id,
      assuranceEvidence: trusted.assuranceEvidence, correlationId: trusted.correlationId });
    return Object.freeze({ ...decision, evaluation: decision.allowed ? evaluation : null });
  } });
  authorizationPorts.add(port);
  return port;
}
module.exports = { createTaxonomyAuthorization,isResourceAuthorization };
