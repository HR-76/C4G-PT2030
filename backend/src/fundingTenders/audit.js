'use strict';
const { createAuditEvent } = require('../audit/event');
const { createAppendService } = require('../audit/appendService');
const { PostgresAppendRepository } = require('../audit/postgresAppendRepository');
const { createUuidV7 } = require('../audit/uuidV7');
function createPlatformAudit({source = 'FUNDING_TENDERS'} = {}) {
  const service = createAppendService({ appendPort: new PostgresAppendRepository() });
  return async function audit(client, { actor, eventCode, requestId, resourceId = null, detailCode }) {
    const platformClient = { query(sql, params) { return client.query(sql.replace('audit.prepare_append_v1', 'audit.prepare_platform_append_v1').replace('audit.append_event_v1', 'audit.append_platform_event_v1'), params); } };
    const event = createAuditEvent({ trustedContext: { scope: 'PLATFORM', organizationId: null, tenantId: null, operationAuthority: 'CENTRAL', operationCode: 'OPPORTUNITY_CENTRAL_MANAGE', source, channel: 'APPLICATION', synchronous: true }, input: {
      eventCode, actor: { type: actor.type, id: actor.id, membershipId: null, serviceActorCode: actor.type === 'SERVICE' ? actor.id : null, supportGrantId: null },
      subject: null, resource: resourceId ? { type: 'OPPORTUNITY', id: resourceId } : null, decision: 'ACCEPT', outcome: 'SUCCESS',
      observedAt: new Date().toISOString(), correlationId: createUuidV7(), causationId: null, idempotencyKey: requestId, streamType: 'DATA', payload: { detailCode, catalogVersion: 'f12-events-v2' }
    } });
    return service.append(event, platformClient);
  };
}
module.exports = { createPlatformAudit };
