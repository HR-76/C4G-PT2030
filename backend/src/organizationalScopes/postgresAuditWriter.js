'use strict';

const { createAppendService } = require('../audit/appendService');
const { createAuditEvent } = require('../audit/event');
const { PostgresAppendRepository } = require('../audit/postgresAppendRepository');

function createOrganizationalScopeAuditWriter({ organizationId, tenantId, clock = () => new Date(), uuid, telemetryPort = null }) {
  if (typeof organizationId !== 'string' || typeof tenantId !== 'string') throw new TypeError('Organizational scope audit authority is invalid.');
  const service = createAppendService({ appendPort: new PostgresAppendRepository(), telemetryPort });
  return Object.freeze({ async append(client, input) {
    if (!client || !input || !input.actor) throw new TypeError('Organizational scope audit transaction is invalid.');
    const actor = input.actor.type === 'HUMAN'
      ? { type: 'HUMAN', id: input.actor.id, membershipId: input.actor.membershipId, serviceActorCode: null, supportGrantId: null }
      : { type: 'SERVICE', id: input.actor.id, membershipId: null, serviceActorCode: input.actor.serviceActorCode, supportGrantId: null };
    const operationCode = input.eventCode.replace('ORGANIZATIONAL_SCOPE_', 'ORGANIZATIONAL_SCOPE_');
    const candidate = createAuditEvent({ trustedContext: { organizationId, tenantId, operationAuthority: 'TENANT', catalogVersion: 'f13-p1-events-v1',
      operationCode, source: 'API', channel: 'APPLICATION', synchronous: true }, input: {
      eventCode: input.eventCode, actor, subject: null, resource: { type: 'ORGANIZATIONAL_SCOPE', id: input.scopeId },
      decision: 'ACCEPT', outcome: 'SUCCESS', observedAt: clock().toISOString(), correlationId: input.correlationId,
      causationId: null, idempotencyKey: `${operationCode}:${input.idempotencyKey}`, streamType: 'DATA',
      payload: { detailCode: input.detailCode, catalogVersion: 'f13-p1-events-v1', scopeType: input.scopeType }
    }, clock, uuid });
    return service.append(candidate, client);
  } });
}

module.exports = { createOrganizationalScopeAuditWriter };
