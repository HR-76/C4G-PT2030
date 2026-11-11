'use strict';
const { createAppendService } = require('../audit/appendService');
const { createAuditEvent } = require('../audit/event');
const { PostgresAppendRepository } = require('../audit/postgresAppendRepository');
const { policyRef, bundleRef } = require('./editorialRelease');
function createEditorialAuditWriter({ organizationId, tenantId, clock = () => new Date() }) {
  const service = createAppendService({ appendPort: new PostgresAppendRepository() });
  return Object.freeze({ async append(client, input) {
    const candidate = createAuditEvent({ clock, trustedContext: { organizationId, tenantId, operationAuthority: 'TENANT',
      catalogVersion: 'f13-editorial-events-v1', operationCode: input.operationCode, source: 'API', channel: 'APPLICATION', synchronous: true },
    input: { eventCode: input.eventCode,
      actor: { type: 'HUMAN', id: input.actor.id, membershipId: input.actor.membershipId, serviceActorCode: null, supportGrantId: null },
      subject: null, resource: { type: input.resourceType, id: input.resourceId }, decision: 'ACCEPT', outcome: 'SUCCESS',
      observedAt: clock().toISOString(), correlationId: input.correlationId, causationId: null,
      idempotencyKey: `${input.operationCode}:${input.idempotencyKey}`, streamType: 'DATA',
      payload: { ...input.authorizationEvidence, detailCode: input.detailCode, scopeType: 'ORGANIZATION',
        catalogVersion: 'f13-editorial-events-v1', schemaRef: 'F13_ORG_EDITORIAL_BASELINE:1.0.0',
        completionPolicyRef: policyRef.id, bundleRef: bundleRef.id,
        previousVersion: input.previousVersion, newVersion: input.newVersion,
        ...(input.candidateRef ? { candidateRef: input.candidateRef } : {}),
        ...(input.versionRef ? { versionRef: input.versionRef } : {}),
        ...(input.completionResult ? { completionResult: input.completionResult } : {}) } } });
    return service.append(candidate, client);
  } });
}
module.exports = { createEditorialAuditWriter };
