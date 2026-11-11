'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InboxRepository } = require('../src/async/inboxRepository');
const { createEnvelopeV2, createTrustedObservability } = require('../src/async/envelope');

const org = '11111111-1111-4111-8111-111111111111';
const execution = '22222222-2222-4222-8222-222222222222';
const original = '33333333-3333-4333-8333-333333333333';
const created = createEnvelopeV2({ trustedContext: { organizationId: org, actor: { kind: 'SERVICE', serviceActorCode: 'SYNTHETIC_WORKER' }, operation: 'synthetic_resource.update', correlationId: org, causationId: org }, job: { type: 'synthetic_resource.update', version: 1, payloadVersion: 1, idempotencyKey: 'replay-test-key' }, payload: { value: 1 }, registry: { supports: () => true }, observability: createTrustedObservability({ traceparent: null, tracestate: null }), clock: () => new Date('2030-01-01T00:00:00Z'), id: () => execution });
const input = { consumer: 'test', jobType: created.envelope.jobType, jobVersion: 1, organizationId: org, idempotencyKey: created.envelope.idempotencyKey, envelope: created.envelope, contentDigest: created.contentDigest, executionId: execution, owner: 'worker', leaseUntil: new Date('2030-01-01T00:01:00Z') };

function clientFor(state, authorized) {
  const calls = [];
  return { calls, async query(sql, params) {
    calls.push({ sql, params });
    if (sql.startsWith('INSERT')) return { rows: [] };
    if (sql.startsWith('SELECT')) return { rows: [{ state, fence: 4, execution_id: original, digest_sha256: created.contentDigest }] };
    assert.match(sql, /o\.previous_execution_id=i\.execution_id/);
    assert.match(sql, /o\.delivery_kind='REPLAY'/);
    assert.match(sql, /o\.replay_request_id IS NOT NULL/);
    assert.match(sql, /o\.content_digest=i\.digest_sha256/);
    assert.match(sql, /i\.fence=\$9/);
    return { rows: authorized ? [{ state: 'PROCESSING', fence: 5, execution_id: execution }] : [] };
  } };
}

test('terminal inbox is reopened only for replay with durable matching lineage', async () => {
  const repo = new InboxRepository();
  for (const state of ['FAILED', 'CANCELLED']) {
    const client = clientFor(state, true);
    const result = await repo.begin(client, { ...input, replay: true });
    assert.equal(result.status, 'CLAIMED');
    assert.equal(result.row.fence, 5);
    assert.equal(client.calls[2].params[7], execution);
  }
  assert.equal((await repo.begin(clientFor('FAILED', false), { ...input, replay: true })).status, 'BUSY');
  const ordinary = clientFor('FAILED', true);
  assert.equal((await repo.begin(ordinary, input)).status, 'BUSY');
  assert.equal(ordinary.calls.length, 2);
  const completed = clientFor('COMPLETED', true);
  assert.equal((await repo.begin(completed, { ...input, replay: true })).status, 'DUPLICATE');
  assert.equal(completed.calls.length, 2);
});
