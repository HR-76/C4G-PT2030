'use strict';

const { createAuditEvent } = require('../audit/event');
const { createAppendService } = require('../audit/appendService');
const { PostgresAppendRepository } = require('../audit/postgresAppendRepository');
const onboardingSql = require('../platformOnboarding/sql');

function createBillingAudit({ clock = () => new Date(), uuid } = {}) {
  const append = createAppendService({ appendPort: new PostgresAppendRepository() });
  return async function billingAudit(client, input) {
    const payload = {
      detailCode: input.detailCode,
      ...(input.previousRevision === null ? {} : { previousVersion: String(input.previousRevision) }),
      ...(input.newRevision === null ? {} : { newVersion: String(input.newRevision) })
    };
    const candidate = createAuditEvent({
      trustedContext: {
        scope: 'PLATFORM', organizationId: null, tenantId: null,
        operationAuthority: 'CENTRAL', operationCode: 'PLATFORM_BILLING',
        source: 'PLATFORM_BILLING', channel: 'APPLICATION', synchronous: true
      },
      input: {
        eventCode: input.eventCode,
        actor: { type: 'HUMAN', id: input.actorId, membershipId: null, serviceActorCode: null, supportGrantId: null },
        subject: null,
        resource: { type: input.resourceType, id: input.resourceId },
        decision: input.decision || 'ACCEPT', outcome: input.outcome || 'SUCCESS', observedAt: clock().toISOString(),
        correlationId: input.correlationId, causationId: null,
        idempotencyKey: input.idempotencyKey, streamType: 'DATA', payload
      },
      clock,
      ...(uuid ? { uuid } : {})
    });
    return append.append(candidate, {
      query(statement, values) {
        return client.query(statement.includes('prepare_append_v1') ? onboardingSql.auditPrepare : onboardingSql.auditAppend, values);
      }
    });
  };
}

module.exports = { createBillingAudit };
