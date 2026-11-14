'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createFundingWorker } = require('../src/fundingTenders/worker');

function worker(applyError, log) {
  const finished = [];
  const run = { run_id: randomUUID(), source_code: 'EU_FUNDING_TENDERS', collected: true };
  const repository = {
    transaction() { throw Error('Unused'); },
    async claim() { return run; },
    async pending() { return [{ external_identifier: 'SECRET-LOOKING-IDENTIFIER' }]; },
    async apply() { throw applyError; },
    async finish(_run, code) { finished.push(code); }
  };
  const instance = createFundingWorker({ pool: {}, queue: { shutdown: async () => {}, claim: async () => [] }, source: { collect: async () => ({}) }, repository, log });
  return { instance, finished };
}
const handle = instance => instance.registry.resolve('funding_tenders.refresh').handler({ executionId: randomUUID(), payload: { runId: randomUUID() }, fencingToken: 1, attempt: 2 });

// Regression: a permanent failure was reported only as FUNDING_PROCESSING_FAILED, with the cause discarded. In staging a
// whole page of real records failed on OPPORTUNITY_INVALID_INPUT and nothing in the worker log said so.
test('a failed job logs the error code, never the message or the data', async () => {
  const entries = [];
  const { instance, finished } = worker(Object.assign(new Error('title: Opportunity for SECRET-LOOKING-IDENTIFIER is invalid'), { code: 'OPPORTUNITY_INVALID_INPUT' }), entry => entries.push(entry));
  await handle(instance);
  assert.deepEqual(finished, ['FUNDING_PROCESSING_FAILED']);
  assert.deepEqual(entries, [{ event: 'FUNDING_JOB_FAILED', code: 'OPPORTUNITY_INVALID_INPUT', attempt: 2 }]);
  assert.ok(!JSON.stringify(entries).includes('SECRET-LOOKING-IDENTIFIER'));
});

test('an error without a usable code is logged as UNKNOWN', async () => {
  for (const code of [undefined, 'has spaces', 'x'.repeat(65), '']) {
    const entries = [];
    const { instance } = worker(Object.assign(new Error('boom'), { code }), entry => entries.push(entry));
    await handle(instance);
    assert.equal(entries[0].code, 'UNKNOWN');
  }
});

test('the worker still fails the run the same way when no logger is given', async () => {
  const { instance, finished } = worker(Object.assign(new Error('boom'), { code: 'OPPORTUNITY_INVALID_INPUT' }));
  await handle(instance);
  assert.deepEqual(finished, ['FUNDING_PROCESSING_FAILED']);
});
