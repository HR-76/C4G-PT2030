'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { organizationScope } = require('../src/async/organizationScope');
const { InboxRepository } = require('../src/async/inboxRepository');
const { OutboxRepository } = require('../src/async/outboxRepository');
const { createEnvelope } = require('../src/async/envelope');
const { createJobRegistry } = require('../src/async/jobRegistry');

// `organization_id IS NOT DISTINCT FROM $n` cannot use a btree index: on 300k rows it turned a 0.04 ms
// index lookup into a 12 ms sequential scan, on every complete/heartbeat of every job. The Central
// funding job has a NULL organization, so the predicate must still match NULL to NULL.
const EXPECTED = (column, parameter) =>
  `(${column} = $${parameter}::uuid OR (${column} IS NULL AND $${parameter}::uuid IS NULL))`;

test('the organization scope predicate is index-friendly and still matches NULL to NULL', () => {
  assert.equal(organizationScope('organization_id', 4), EXPECTED('organization_id', 4));
  assert.equal(organizationScope('i.organization_id', 4), EXPECTED('i.organization_id', 4));
  assert.equal(organizationScope('organization_id', 1), EXPECTED('organization_id', 1));
  assert.throws(() => organizationScope('organization_id; DROP TABLE x', 1), TypeError);
  assert.throws(() => organizationScope('organization_id', 0), TypeError);
  assert.throws(() => organizationScope('organization_id', '1'), TypeError);
});

test('the outbox and inbox repositories no longer use IS NOT DISTINCT FROM on the organization', () => {
  for (const file of ['outboxRepository.js', 'inboxRepository.js']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/async', file), 'utf8');
    assert.doesNotMatch(source, /organization_id\s+IS NOT DISTINCT FROM/i, file);
    assert.match(source, /organizationScope\(/, file);
  }
});

const TYPE = 'synthetic_resource.update';
const registry = createJobRegistry([{ type: TYPE, version: 1, payloadVersion: 1, handler: async () => {} }]);
const orgA = '11111111-1111-4111-8111-111111111111';
const built = createEnvelope({
  trustedContext: { organizationId: orgA, actor: { kind: 'HUMAN', id: '22222222-2222-4222-8222-222222222222', membershipVersion: 7 },
    operation: TYPE, correlationId: '44444444-4444-4444-8444-444444444444', causationId: '55555555-5555-4555-8555-555555555555' },
  job: { type: TYPE, version: 1, payloadVersion: 1, idempotencyKey: 'idem-key-scope-1' },
  payload: { resourceId: 'r' }, registry, clock: () => new Date('2026-10-08T10:00:00Z')
});

function recorder(answer = () => ({ rows: [], rowCount: 0 })) {
  const statements = [];
  return { statements, client: { async query(sql, values) { statements.push({ sql: sql.replace(/\s+/g, ' '), values }); return answer(sql, values); } } };
}
const key = { consumer: 'worker', jobType: TYPE, jobVersion: 1, organizationId: orgA, idempotencyKey: 'idem-key-scope-1', owner: 'w1', fence: 1 };

test('every inbox statement that selects by organization uses the index-friendly predicate', async () => {
  const inbox = new InboxRepository();
  const { client, statements } = recorder();
  await inbox.complete(client, { ...key, resultCode: 'SUCCESS' });
  await inbox.heartbeat(client, { ...key, leaseUntil: new Date() });
  await inbox.transition(client, { ...key, state: 'FAILED', resultCode: 'PERMANENT' });
  assert.equal(statements.length, 3);
  for (const { sql, values } of statements) {
    assert.ok(sql.includes(EXPECTED('organization_id', 4)), sql);
    assert.doesNotMatch(sql, /IS NOT DISTINCT FROM/i);
    assert.equal(values[3], orgA);
  }
});

test('inbox begin falls back to a locked, index-friendly read after a conflict', async () => {
  const inbox = new InboxRepository();
  const row = { digest_sha256: built.contentDigest, state: 'COMPLETED', fence: 1, lease_until: null };
  const { client, statements } = recorder(sql => (/^\s*INSERT/.test(sql) ? { rows: [], rowCount: 0 } : { rows: [row], rowCount: 1 }));
  const outcome = await inbox.begin(client, { consumer: 'worker', jobType: TYPE, jobVersion: 1, organizationId: orgA, idempotencyKey: 'idem-key-scope-1',
    envelope: built.envelope, contentDigest: built.contentDigest, executionId: built.envelope.executionId, owner: 'w1', leaseUntil: new Date() });
  assert.equal(outcome.status, 'DUPLICATE');
  const read = statements.find(({ sql }) => /FOR UPDATE/.test(sql));
  assert.ok(read.sql.includes(EXPECTED('organization_id', 4)), read.sql);
  assert.doesNotMatch(read.sql, /IS NOT DISTINCT FROM/i);
});

test('outbox lineage lookups use the index-friendly predicate', async () => {
  const outbox = new OutboxRepository();
  const { client, statements } = recorder(() => ({ rows: [], rowCount: 0 }));
  assert.equal(await outbox.findLineage(client, { organizationId: orgA, logicalId: 'logical-1' }), null);
  assert.ok(statements[0].sql.includes(EXPECTED('organization_id', 1)), statements[0].sql);
  assert.doesNotMatch(statements[0].sql, /IS NOT DISTINCT FROM/i);
});
