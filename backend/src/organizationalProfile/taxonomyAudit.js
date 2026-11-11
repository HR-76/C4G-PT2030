'use strict';
const { createAppendService } = require('../audit/appendService');
const { createAuditEvent } = require('../audit/event');
const { PostgresAppendRepository } = require('../audit/postgresAppendRepository');

function createTaxonomyAuditWriter({ organizationId, tenantId, clock = () => new Date(), uuid, telemetryPort = null, catalogVersion='f13-taxonomy-events-v1' }) {
  if (typeof organizationId !== 'string' || typeof tenantId !== 'string') throw new TypeError('F13 taxonomy audit authority is invalid.');
  const service = createAppendService({ appendPort: new PostgresAppendRepository(), telemetryPort });
  return Object.freeze({ async append(client, input) {
    const evaluated = input?.authorizationEvidence;
    if (!client || !input?.actor || !evaluated || !['SESSION', 'RECENT_MFA'].includes(evaluated.assuranceLevel)
        || typeof evaluated.policyVersion !== 'string' || !Number.isSafeInteger(evaluated.membershipVersion)
        || !Number.isSafeInteger(evaluated.authorizationVersion)) throw new TypeError('F13 evaluated audit context is invalid.');
    const actor = { type: 'HUMAN', id: input.actor.id, membershipId: input.actor.membershipId, serviceActorCode: null, supportGrantId: null };
    const candidate = createAuditEvent({ trustedContext: { organizationId, tenantId, operationAuthority: 'TENANT',
      catalogVersion, operationCode: input.operationCode, source: 'API', channel: 'APPLICATION', synchronous: true },
    input: { eventCode: input.eventCode, actor, subject: null, resource: { type: input.resourceType, id: input.resourceId },
      decision: 'ACCEPT', outcome: 'SUCCESS', observedAt: clock().toISOString(), correlationId: input.correlationId,
      causationId: null, idempotencyKey: `${input.operationCode}:${input.idempotencyKey}`, streamType: 'DATA',
      payload: { detailCode: input.detailCode, catalogVersion, scopeType: input.scopeType||'ORGANIZATION',
        ...(input.scopeDigest?{scopeDigest:input.scopeDigest}:{}),
        ...(['f13-financial-events-v1','f13-operational-events-v1','f13-population-events-v1'].includes(catalogVersion)?Object.fromEntries(['reasonRef','reasonReleaseRef','reasonCatalogVersion','purposeRef','purposeReleaseRef','purposeCatalogVersion'].filter(key=>input[key]!==undefined).map(key=>[key,input[key]])):{}),
        ...evaluated, previousVersion: input.previousVersion, newVersion: input.newVersion, semanticDigest: input.semanticDigest } }, clock, uuid });
    return service.append(candidate, client);
  } });
}
module.exports = { createTaxonomyAuditWriter };
