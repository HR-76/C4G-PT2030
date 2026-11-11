'use strict';

const { createHash } = require('node:crypto');
const { createAuditEvent } = require('../../audit/event');
const { createAppendService } = require('../../audit/appendService');
const { PostgresAppendRepository } = require('../../audit/postgresAppendRepository');
const { createUuidV7 } = require('../../audit/uuidV7');
const { humanContext } = require('./activationAuthority');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const ACCEPTED_EVENTS = Object.freeze({ CREATED: 'OPPORTUNITY_CREATED', REVISION_CREATED: 'OPPORTUNITY_REVISION_CREATED', UNCHANGED: 'OPPORTUNITY_PROVENANCE_LINKED' });
const DECISION_EVENTS = Object.freeze({ PREPARED: 'OPPORTUNITY_IMPORT_UPLOADED', APPROVED: 'OPPORTUNITY_IMPORT_CONFIRMED', REVOKED: 'OPPORTUNITY_IMPORT_CANCELLED' });
const SOURCE_EVENTS = Object.freeze({ SUSPEND:'OPPORTUNITY_SOURCE_SUSPENSION_REQUESTED', QUIESCE:'OPPORTUNITY_SOURCE_QUIESCED', RESUME:'OPPORTUNITY_SOURCE_RESUMED',CONFIGURE:'OPPORTUNITY_SOURCE_QUIESCED' });
function invalid() { throw Object.assign(new Error('OPPORTUNITY_V2_AUDIT_INVALID'), { code: 'OPPORTUNITY_V2_AUDIT_INVALID' }); }

// No injectable permissive audit callback: the operational composition always
// appends through the existing PostgreSQL platform ledger in the caller's tx.
function createActivationAuditV2() {
  const service = createAppendService({ appendPort: new PostgresAppendRepository() });
  async function append(client, { context, requestId, eventCode, resource, detailCode, scopeDigest, semanticDigest, scopeType='OPPORTUNITY_ACTIVATION_PLAN', newVersion }) {
    const actorContext = humanContext(context);
    if (!client?.query || !actorContext || typeof requestId !== 'string' || requestId.length < 8 || requestId.length > 128
        || !SHA.test(scopeDigest) || !SHA.test(semanticDigest)) invalid();
    const event = createAuditEvent({
      trustedContext: { scope: 'PLATFORM', organizationId: null, tenantId: null, operationAuthority: 'CENTRAL',
        operationCode: 'OPPORTUNITY_CENTRAL_MANAGE', source: 'OPPORTUNITY_V2_ACTIVATION', channel: 'APPLICATION', synchronous: true },
      input: { eventCode, actor: { type: 'HUMAN', id: actorContext.actor.id, membershipId: null, serviceActorCode: null, supportGrantId: null },
        subject: null, resource, decision: 'ACCEPT', outcome: 'SUCCESS', observedAt: new Date().toISOString(),
        correlationId: createUuidV7(), causationId: null,
        idempotencyKey: createHash('sha256').update('opportunity-v2-activation\0' + eventCode + '\0' + requestId).digest('hex'),
        streamType: 'DATA', payload: { detailCode, catalogVersion: 'f12-events-v2', scopeType, scopeDigest, semanticDigest, ...(newVersion===undefined?{}:{newVersion}) } }
    });
    const platformClient = { query(sql, values) {
      return client.query(sql.replace('audit.prepare_append_v1', 'audit.prepare_platform_append_v1')
        .replace('audit.append_event_v1', 'audit.append_platform_event_v1'), values);
    } };
    const result = await service.append(event, platformClient);
    if (!result || !['APPENDED', 'DUPLICATE'].includes(result.status)) invalid();
    return result;
  }

  async function audit(client, event) {
    if (!event || event.operation !== 'OPPORTUNITY_V2_ACCEPT' || !Object.hasOwn(ACCEPTED_EVENTS, event.action)
        || !UUID.test(event.opportunityId) || !UUID.test(event.revisionId) || !SHA.test(event.approvalDigest)
        || !UUID.test(event.context?.planId)) invalid();
    const scopeDigest = createHash('sha256').update('opportunity-v2-plan\0' + event.context.planId).digest('hex');
    return append(client, { context: event.context, requestId: event.requestId, eventCode: ACCEPTED_EVENTS[event.action],
      resource: { type: 'OPPORTUNITY', id: event.opportunityId }, detailCode: 'OPPORTUNITY_V2_' + event.action,
      scopeDigest, semanticDigest: event.approvalDigest });
  }
  audit.recordDecision = async function recordDecision(client, event) {
    if (!event || !Object.hasOwn(DECISION_EVENTS, event.decision) || !UUID.test(event.planId) || !SHA.test(event.planDigest)) invalid();
    return append(client, { context: event.context, requestId: event.requestId, eventCode: DECISION_EVENTS[event.decision],
      resource: { type: 'OPPORTUNITY_ACTIVATION_PLAN', id: event.planId }, detailCode: 'OPPORTUNITY_V2_PLAN_' + event.decision,
      scopeDigest: createHash('sha256').update('opportunity-v2-plan\0' + event.planId).digest('hex'), semanticDigest: event.planDigest });
  };
  audit.recordSourceControl = async function recordSourceControl(client,event) {
    if(!event||!Object.hasOwn(SOURCE_EVENTS,event.action)||!Number.isSafeInteger(event.sourceFence)||event.sourceFence<1)invalid();
    const capability=event.action==='CONFIGURE'?require('./euWriterAuthority').writerCapability(event.writerCapability):null;
    return append(client,{context:event.context,requestId:event.requestId,eventCode:SOURCE_EVENTS[event.action],
      resource:{type:'OPPORTUNITY_SOURCE',id:'EU'},detailCode:'OPPORTUNITY_EU_'+event.action,scopeType:'OPPORTUNITY_SOURCE',
      scopeDigest:createHash('sha256').update('opportunity-v2-source\0EU').digest('hex'),
      semanticDigest:createHash('sha256').update('opportunity-v2-source\0EU\0'+event.action+'\0'+event.sourceFence+(capability?'\0'+JSON.stringify(capability):'')).digest('hex'),newVersion:event.sourceFence});
  };
  audit.recordCollection = async function recordCollection(client, event) {
    if (!event || !UUID.test(event.runId) || !UUID.test(event.requestId) || !SHA.test(event.payloadDigest)) invalid();
    return append(client, { context: event.context, requestId: 'collect11145:' + event.requestId,
      eventCode: 'OPPORTUNITY_IMPORT_UPLOADED', resource: { type: 'FUNDING_CANDIDATE', id: event.runId },
      detailCode: 'OPPORTUNITY_11145_COLLECTED', scopeType: 'OPPORTUNITY_11145_COLLECTION',
      scopeDigest: createHash('sha256').update('opportunity-11145-collection\0' + event.runId).digest('hex'), semanticDigest: event.payloadDigest });
  };
  return Object.freeze(audit);
}

module.exports = { createActivationAuditV2 };
