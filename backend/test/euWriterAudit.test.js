'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const { createEuWriterAuditV2 } = require('../src/opportunities/v2/euWriterAudit');
function input() { return { requestId: 'writer-audit-request', runId: randomUUID(), externalIdentifier: 'CASCADE:11145', intentDigest: 'a'.repeat(64),
  execution: { runFence: 1, sourceFence: 5, executionId: randomUUID(), inboxFence: 1, workerId: 'funding-unit', consumer: 'funding-central-v1' },
  policyVersion: 'eu-existing-v2.0', mappingDigest: 'b'.repeat(64), payloadDigest: 'c'.repeat(64), expected: null,
  decision: 'REVIEW', result: { outcome: 'REVIEW', opportunityId: null, reasonCodes: ['NEW_IDENTITY_REQUIRES_REVIEW'] } }; }
function client() { const events = []; return { events, async query(sql, values) {
  if (sql.includes('prepare_platform_append_v1')) return { rows: [{ stream_id: randomUUID(), sequence: 1, previous_hash: null, accepted_at: new Date().toISOString() }] };
  if (sql.includes('append_platform_event_v1')) { const event = JSON.parse(values.at(-1)); events.push(event); return { rows: [{ status: 'APPENDED', event_id: event.eventId, event_hash: 'd'.repeat(64) }] }; }
  throw Error('Unexpected audit query');
} }; }
test('service audit binds a review to its run, archive, policy and execution without impersonating the requestor', async () => {
  const db = client(), value = input(); await createEuWriterAuditV2()(db, value);
  const event = db.events[0]; assert.equal(event.actor.type, 'SERVICE'); assert.equal(event.actor.serviceActorCode, 'FUNDING_TENDERS_CENTRAL');
  assert.equal(event.resource.type, 'FUNDING_CANDIDATE'); assert.equal(event.resource.id, value.runId);
  assert.equal(event.payload.scopeType, 'EU_WRITER_EXECUTION'); assert.match(event.payload.semanticDigest, /^[a-f0-9]{64}$/);
  const original = event.payload.semanticDigest; value.execution.sourceFence++;
  await createEuWriterAuditV2()(db, value); assert.notEqual(db.events[1].payload.semanticDigest, original);
});
test('service audit refuses unsupported decisions, missing execution fences and inconsistent acceptance', async () => {
  for (const mutate of [v => { v.execution.inboxFence = 0; }, v => { v.policyVersion = 'other'; }, v => { v.payloadDigest = 'bad'; },
    v => { v.decision = 'APPROVED'; }, v => { v.decision = 'ACCEPTED'; }]) {
    const db = client(), value = input(); mutate(value);
    await assert.rejects(createEuWriterAuditV2()(db, value), { code: 'OPPORTUNITY_V2_EU_WRITER_AUDIT_INVALID' });
    assert.equal(db.events.length, 0);
  }
});
test('accepted observations and revisions use distinct events and audit failures propagate to the caller transaction', async () => {
  for (const outcome of ['UPDATED', 'UNCHANGED']) {
    const value = input(), db = client();
    value.expected = { opportunityId: randomUUID(), revisionId: randomUUID(), rowVersion: 5 };
    value.decision = 'ACCEPTED'; value.result = { outcome, opportunityId: value.expected.opportunityId,
      revisionId: outcome === 'UNCHANGED' ? value.expected.revisionId : randomUUID() };
    await createEuWriterAuditV2()(db, value);
    assert.equal(db.events[0].eventCode, outcome === 'UNCHANGED' ? 'OPPORTUNITY_PROVENANCE_LINKED' : 'OPPORTUNITY_REVISION_CREATED');
  }
  const error = new Error('isolated append failure');
  await assert.rejects(createEuWriterAuditV2()({ query: async () => { throw error; } }, input()), error);
});
