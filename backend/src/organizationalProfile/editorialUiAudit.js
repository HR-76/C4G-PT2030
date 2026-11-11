'use strict';
const { createAppendService } = require('../audit/appendService');
const { createAuditEvent } = require('../audit/event');
const { PostgresAppendRepository } = require('../audit/postgresAppendRepository');
function createEditorialUiAudit({ scope, catalogs, clock, policyVersion, operationAuthority='TENANT' }) {
  const append = createAppendService({ appendPort: new PostgresAppendRepository() });
  return Object.freeze({ async accept(event) {
    const state = scope.getStore();
    if (!state) throw new Error('F13_AUDIT_TRANSACTION_REQUIRED');
    const operation = catalogs.operationCatalog.resolve(event.operationCode);
    const candidate = createAuditEvent({ clock: () => clock.now(),
      trustedContext: { organizationId: state.organizationId, tenantId: operationAuthority==='TENANT'?(state.readAuditPolicy?state.tenantId:state.organizationId):null, operationAuthority,
        operationCode: event.operationCode, catalogVersion: operationAuthority==='CENTRAL'?require('../audit/eventCatalog').CATALOG_VERSION:'f13-editorial-events-v1', source: 'API', channel: 'APPLICATION', synchronous: true },
      input: { eventCode: event.eventType, actor: { type: 'HUMAN', id: event.actorId, membershipId: event.membershipId, serviceActorCode: null, supportGrantId: null },
        subject: null, resource: event.resourceId ? { type: operation.resourceType, id: event.resourceId } : null,
        decision: event.result === 'ALLOW' ? 'ALLOW' : 'DENY', outcome: event.result === 'ALLOW' ? 'SUCCESS' : 'DENIED',
        observedAt: clock.now().toISOString(), correlationId: event.correlationId, causationId: null,
        idempotencyKey: `UI-F5:${state.sequence++}:${event.correlationId}:${event.result}`, streamType: 'ACCESS',
        payload: { detailCode: event.reasonCode, policyVersion: event.policyVersion || policyVersion,
          ...(event.assuranceLevel ? { assuranceLevel: event.assuranceLevel } : {}) } } });
    if (state.readAuditPolicy) {
      const {deferPreparedReadAudit,flushPreparedReadAudit}=require('../security/tenantLeaseExecutor');
      if (deferPreparedReadAudit(state.client,state.readAuditPolicy,candidate)) return 'TRANSACTION_PENDING';
      // A critical/deny event keeps its immediate path and the preceding order.
      await flushPreparedReadAudit(state.client);
    }
    await append.append(candidate, state.client);
    return 'ACCEPTED';
  } });
}
module.exports = { createEditorialUiAudit };
