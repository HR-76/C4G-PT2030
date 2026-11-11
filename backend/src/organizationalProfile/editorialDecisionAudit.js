'use strict';
const { createAppendService } = require('../audit/appendService');
const { createAuditEvent } = require('../audit/event');
const { PostgresAppendRepository } = require('../audit/postgresAppendRepository');
function createEditorialDecisionAudit({ scope, clock, assurancePolicyVersion }) {
  const append = createAppendService({ appendPort: new PostgresAppendRepository() });
  return Object.freeze({ async accept(event) {
    const state = scope.getStore();
    if (!state) throw new Error('F13_AUDIT_TRANSACTION_REQUIRED');
    try {
      const code = !state.admission && event.result === 'ALLOW' && event.operationCode === 'F13_PROFILE_READ' ? 'PROFILE_ACCESSED' : event.eventType;
      const candidate = createAuditEvent({ clock: () => clock.now(),
        trustedContext: { organizationId: state.organizationId, tenantId: state.organizationId, operationAuthority: 'TENANT',
          operationCode: event.operationCode, catalogVersion: 'f13-editorial-events-v1', source: 'API', channel: 'APPLICATION', synchronous: true },
        input: { eventCode: code, actor: { type: 'HUMAN', id: event.actorId, membershipId: event.membershipId,
          serviceActorCode: null, supportGrantId: null }, subject: null,
        resource: event.resourceId ? { type: ({ F13_PROFILE_SUBMIT: 'PROFILE_DRAFT', F13_PROFILE_APPROVE: 'PROFILE_DRAFT_REVISION',
          F13_PROFILE_PUBLISH: 'PROFILE_VERSION', F13_PROFILE_READ: 'PROFILE_PROJECTION' })[event.operationCode], id: event.resourceId } : null,
        decision: event.result === 'ALLOW' ? 'ALLOW' : 'DENY', outcome: event.result === 'ALLOW' ? 'SUCCESS' : 'DENIED',
        observedAt: clock.now().toISOString(), correlationId: event.correlationId, causationId: null,
        idempotencyKey: `F5:${event.operationCode}:${event.correlationId}:${event.result}:${state.admission?'A':'G'}`, streamType: 'ACCESS',
        payload: { detailCode: event.reasonCode, policyVersion: event.policyVersion || assurancePolicyVersion,
          ...(event.assuranceLevel ? { assuranceLevel: event.assuranceLevel } : {}) } } });
      await append.append(candidate, state.client);
      return 'ACCEPTED';
    } catch (error) { state.failed = true; throw error; }
  } });
}
module.exports = { createEditorialDecisionAudit };
