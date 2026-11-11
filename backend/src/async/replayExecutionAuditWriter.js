'use strict';

const { createAppendService } = require('../audit/appendService');
const { createAuditEvent } = require('../audit/event');
const { PostgresAppendRepository } = require('../audit/postgresAppendRepository');
const { createUuidV7 } = require('../audit/uuidV7');

function createReplayExecutionAuditWriter({ tenantId, clock = () => new Date(), uuid = () => createUuidV7({ now: () => clock().getTime() }), telemetryPort = null } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId || '')) throw new TypeError('Replay tenant audit context is invalid.');
  const service = createAppendService({ appendPort: new PostgresAppendRepository(), telemetryPort });
  return Object.freeze({
    async append(client, input) {
      if (!client || !input || input.eventCode !== 'ASYNC_REPLAY_EXECUTION_CREATED' || input.tenantId !== tenantId) throw new TypeError('Replay execution audit input is invalid.');
      const candidate = createAuditEvent({
        trustedContext: {
          organizationId: input.organizationId,
          tenantId,
          operationAuthority: 'TENANT',
          operationCode: 'ASYNC_JOB_REPLAY',
          source: 'WORKER',
          channel: 'APPLICATION',
          synchronous: true
        },
        input: {
          eventCode: input.eventCode,
          actor: { type: 'HUMAN', id: input.actorId, membershipId: input.membershipId, serviceActorCode: null, supportGrantId: null },
          subject: null,
          resource: { type: 'ASYNC_EXECUTION', id: input.resourceId },
          decision: 'ACCEPT',
          outcome: 'SUCCESS',
          observedAt: clock().toISOString(),
          correlationId: input.correlationId,
          causationId: input.causationId,
          idempotencyKey: input.idempotencyKey,
          streamType: 'ASYNC',
          payload: { detailCode: input.detailCode, policyVersion: 'f12-replay-policy-v1' }
        },
        clock,
        uuid
      });
      return service.append(candidate, client);
    }
  });
}

module.exports = { createReplayExecutionAuditWriter };
