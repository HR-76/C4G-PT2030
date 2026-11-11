'use strict';
const { createAuditEvent } = require('../../audit/event');
const { createAppendService } = require('../../audit/appendService');
const { PostgresAppendRepository } = require('../../audit/postgresAppendRepository');
const { createUuidV7 } = require('../../audit/uuidV7');
const { cloneData } = require('./data');
const { hash } = require('./activationArchive');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
function fail() { throw Object.assign(Error('OPPORTUNITY_V2_EU_WRITER_AUDIT_INVALID'), { code: 'OPPORTUNITY_V2_EU_WRITER_AUDIT_INVALID' }); }
function createEuWriterAuditV2() {
  const append = createAppendService({ appendPort: new PostgresAppendRepository() });
  return async function audit(client, raw) {
    let value;
    try { value = cloneData(raw, { maxBytes: 65536 }); } catch { fail(); }
    if (!client?.query || !value || typeof value.requestId !== 'string' || value.requestId.length < 8 || value.requestId.length > 128
        || !UUID.test(value.runId) || typeof value.externalIdentifier !== 'string' || !value.externalIdentifier.length || value.externalIdentifier.length > 128
        || /[\u0000-\u001f]/.test(value.externalIdentifier) || value.policyVersion !== 'eu-existing-v2.0'
        || ![value.intentDigest, value.mappingDigest, value.payloadDigest].every(x => SHA.test(x))
        || !['ACCEPTED', 'REVIEW'].includes(value.decision)) fail();
    const e = value.execution;
    if (!e || !UUID.test(e.executionId) || e.runId !== undefined && e.runId !== value.runId
        || ['runFence', 'sourceFence', 'inboxFence'].some(k => !Number.isSafeInteger(e[k]) || e[k] < 1)
        || e.consumer !== 'funding-central-v1' || typeof e.workerId !== 'string' || !/^[A-Za-z0-9:_.-]{1,128}$/.test(e.workerId)) fail();
    const expected = value.expected;
    if (expected !== null && (!expected || !UUID.test(expected.opportunityId) || !UUID.test(expected.revisionId)
        || !Number.isSafeInteger(expected.rowVersion) || expected.rowVersion < 1)) fail();
    const result = value.result;
    if (!result || value.decision === 'REVIEW' && result.outcome !== 'REVIEW'
        || value.decision === 'ACCEPTED' && (!expected || !['UPDATED', 'UNCHANGED'].includes(result.outcome)
          || result.opportunityId !== expected.opportunityId || !UUID.test(result.revisionId))) fail();
    const resource = value.decision === 'REVIEW' ? { type: 'FUNDING_CANDIDATE', id: value.runId }
      : { type: 'OPPORTUNITY', id: result.opportunityId };
    const eventCode = value.decision === 'REVIEW' ? 'OPPORTUNITY_RECONCILIATION_REQUIRED'
      : result.outcome === 'UNCHANGED' ? 'OPPORTUNITY_PROVENANCE_LINKED' : 'OPPORTUNITY_REVISION_CREATED';
    const binding = { runId: value.runId, externalIdentifier: value.externalIdentifier,
      execution: { runFence: e.runFence, sourceFence: e.sourceFence, executionId: e.executionId,
        inboxFence: e.inboxFence, workerId: e.workerId, consumer: e.consumer },
      policyVersion: value.policyVersion, mappingDigest: value.mappingDigest, payloadDigest: value.payloadDigest,
      intentDigest: value.intentDigest, expected, decision: value.decision, result };
    const event = createAuditEvent({ trustedContext: { scope: 'PLATFORM', organizationId: null, tenantId: null,
      operationAuthority: 'CENTRAL', operationCode: 'OPPORTUNITY_CENTRAL_MANAGE', source: 'FUNDING_TENDERS_V2',
      channel: 'APPLICATION', synchronous: true }, input: {
      eventCode, actor: { type: 'SERVICE', id: 'FUNDING_TENDERS_CENTRAL', serviceActorCode: 'FUNDING_TENDERS_CENTRAL', membershipId: null, supportGrantId: null },
      subject: null, resource, decision: 'ACCEPT', outcome: 'SUCCESS', observedAt: new Date().toISOString(),
      correlationId: createUuidV7(), causationId: null, idempotencyKey: value.requestId, streamType: 'DATA',
      payload: { detailCode: 'FUNDING_V2_' + result.outcome, catalogVersion: 'f12-events-v2', scopeType: 'EU_WRITER_EXECUTION',
        scopeDigest: hash({ runId: value.runId, externalIdentifier: value.externalIdentifier }), semanticDigest: hash(binding) }
    } });
    const platformClient = { query(sql, values) { return client.query(sql.replace('audit.prepare_append_v1', 'audit.prepare_platform_append_v1')
      .replace('audit.append_event_v1', 'audit.append_platform_event_v1'), values); } };
    const saved = await append.append(event, platformClient);
    if (!saved || !['APPENDED', 'DUPLICATE'].includes(saved.status)) fail();
    return saved;
  };
}
module.exports = { createEuWriterAuditV2 };
