'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPgBossQueueAdapter } = require('../src/async/adapters/pgBossQueueAdapter');
const { createEnvelope } = require('../src/async/envelope');
const { createJobRegistry } = require('../src/async/jobRegistry');

// pg-boss marks every fetched job `active`, and C4G runs it with supervise disabled, so nothing reclaims
// an abandoned job. One malformed delivery must therefore never reject the whole batch.
const TYPE = 'synthetic_resource.update';
const QUEUE = 'c4g.synthetic.update';
const orgA = '11111111-1111-4111-8111-111111111111';
const registry = createJobRegistry([{ type: TYPE, version: 1, payloadVersion: 1, handler: async () => {} }]);

function envelope(key) {
  return createEnvelope({
    trustedContext: { organizationId: orgA, actor: { kind: 'HUMAN', id: '22222222-2222-4222-8222-222222222222', membershipVersion: 7 },
      operation: TYPE, correlationId: '44444444-4444-4444-8444-444444444444', causationId: '55555555-5555-4555-8555-555555555555' },
    job: { type: TYPE, version: 1, payloadVersion: 1, idempotencyKey: key },
    payload: { resourceId: 'r' }, registry, clock: () => new Date('2026-10-08T10:00:00Z')
  }).envelope;
}

async function adapter({ rows, lineagePort = null, failRejects = false }) {
  const calls = [];
  class Boss {
    async start() {}
    async fetch(...args) { calls.push(['fetch', ...args]); return rows; }
    async fail(...args) { calls.push(['fail', ...args]); if (failRejects) throw new Error('library detail'); }
    async stop() {}
  }
  const queue = await createPgBossQueueAdapter({
    connectionString: 'postgres://synthetic.invalid/db', queueMap: { [TYPE]: QUEUE }, lineagePort,
    inspectSchema: async () => ({ schemaVersion: 45, drift: false }), load: async () => ({ PgBoss: Boss })
  });
  return { queue, calls, failed: () => calls.filter(call => call[0] === 'fail') };
}

test('a malformed delivery is failed as POISON_MESSAGE and the valid deliveries of the batch are returned', async () => {
  const good = envelope('idem-key-good-1');
  const otherType = { ...envelope('idem-key-type-1'), jobType: 'other.type' };
  const { queue, failed } = await adapter({ rows: [
    { id: 'job-1', data: good, retryCount: 0 },
    { id: 'job-2', data: { shape: 'wrong' }, retryCount: 0 },
    { id: 'job-3', data: otherType, retryCount: 0 },
    { id: 'job-4', data: good, retryCount: 2 }
  ] });
  const jobs = await queue.claim({ type: TYPE });
  assert.deepEqual(jobs.map(job => [job.id, job.attempt, job.redelivery]), [['job-1', 1, false], ['job-4', 3, true]]);
  assert.deepEqual(failed().map(call => call.slice(1)), [[QUEUE, 'job-2', { code: 'POISON_MESSAGE' }], [QUEUE, 'job-3', { code: 'POISON_MESSAGE' }]]);
});

test('a row without a usable id cannot be failed and is skipped without breaking the batch', async () => {
  const { queue, failed } = await adapter({ rows: [{ data: envelope('idem-key-good-2') }, { id: 'job-ok', data: envelope('idem-key-good-3') }, null] });
  const jobs = await queue.claim({ type: TYPE });
  assert.deepEqual(jobs.map(job => job.id), ['job-ok']);
  assert.equal(failed().length, 0);
});

test('failing a poisoned job is best effort: a rejection never hides the valid deliveries', async () => {
  const { queue, failed } = await adapter({ rows: [{ id: 'job-bad', data: 'not an envelope' }, { id: 'job-ok', data: envelope('idem-key-good-4') }], failRejects: true });
  const jobs = await queue.claim({ type: TYPE });
  assert.deepEqual(jobs.map(job => job.id), ['job-ok']);
  assert.equal(failed().length, 1);
});

test('lineage metadata that contradicts the envelope poisons only that delivery', async () => {
  const good = envelope('idem-key-good-5');
  const lineagePort = { async load() { return { lineageVersion: 2 }; } };
  const { queue, failed } = await adapter({ rows: [{ id: 'job-1', data: good }], lineagePort });
  assert.deepEqual(await queue.claim({ type: TYPE }), []);
  assert.deepEqual(failed().map(call => call[2]), ['job-1']);
});

test('an infrastructure failure while loading lineage is not mistaken for a poisoned job', async () => {
  const lineagePort = { async load() { throw new Error('database unavailable'); } };
  const { queue, failed } = await adapter({ rows: [{ id: 'job-1', data: envelope('idem-key-good-6') }], lineagePort });
  await assert.rejects(() => queue.claim({ type: TYPE }), { message: 'ASYNC_QUEUE_OPERATION_FAILED' });
  assert.equal(failed().length, 0, 'a transient error must not permanently fail a valid job');
});

test('a clean batch is returned unchanged and nothing is failed', async () => {
  const { queue, failed } = await adapter({ rows: [{ id: 'a', data: envelope('idem-key-good-7') }, { id: 'b', data: envelope('idem-key-good-8') }] });
  assert.deepEqual((await queue.claim({ type: TYPE })).map(job => job.id), ['a', 'b']);
  assert.equal(failed().length, 0);
});
