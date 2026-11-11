'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HealthRegistry } = require('../src/observability/health');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('twenty concurrent readiness readers execute one dependency probe, including after cache expiry', async t => {
  let now = 0, calls = 0, release = deferred();
  const health = new HealthRegistry({ clock: () => now, timeoutMs: 1000, cacheMs: 10 });
  health.register({ code: 'database', criticality: 'REQUIRED', check: () => { calls++; return release.promise; } });
  const first = Array.from({ length: 20 }, () => health.check());
  await nextTurn();
  const firstCalls = calls;
  release.resolve(true);
  assert.ok((await Promise.all(first)).every(value => value.status === 'READY'));
  t.diagnostic(`20 concurrent readers: ${firstCalls} probe executions`);
  assert.equal(firstCalls, 1);
  now = 11;
  release = deferred();
  const second = Array.from({ length: 20 }, () => health.check());
  await nextTurn();
  release.resolve(true);
  assert.ok((await Promise.all(second)).every(value => value.status === 'READY'));
  assert.equal(calls, 2);
});

test('probe timeout aborts cooperative work and allows recovery after the cached failure expires', async () => {
  let now = 0, calls = 0, signal, aborted = false;
  const health = new HealthRegistry({ clock: () => now, timeoutMs: 10, cacheMs: 20 });
  health.register({ code: 'database', criticality: 'REQUIRED', check: context => {
    calls++;
    if (calls > 1) return true;
    signal = context?.signal;
    return new Promise((resolve, reject) => signal?.addEventListener('abort', () => {
      aborted = true;
      reject(new Error('Transport stopped'));
    }, { once: true }));
  } });
  assert.deepEqual(await health.check(), { status: 'UNAVAILABLE', reasons: ['DATABASE'] });
  assert.equal(aborted, true);
  assert.equal(signal.aborted, true);
  assert.equal((await health.check()).status, 'UNAVAILABLE');
  assert.equal(calls, 1);
  now = 21;
  await nextTurn();
  assert.equal((await health.check()).status, 'READY');
  assert.equal(calls, 2);
});

test('an uncooperative timed-out probe remains single-flight across cache expiry and recovers only after settling', async () => {
  let now = 0, calls = 0, signal;
  const blocked = deferred();
  const health = new HealthRegistry({ clock: () => now, timeoutMs: 10, cacheMs: 20 });
  health.register({ code: 'database', criticality: 'REQUIRED', check: context => {
    calls++; signal = context?.signal;
    return calls === 1 ? blocked.promise : true;
  } });
  assert.equal((await health.check()).status, 'UNAVAILABLE');
  now = 100;
  const waiting = await Promise.all(Array.from({ length: 20 }, () => health.check()));
  const callsBeforeSettlement = calls;
  blocked.resolve(true);
  await nextTurn();
  assert.ok(waiting.every(value => value.status === 'UNAVAILABLE'));
  assert.equal(callsBeforeSettlement, 1);
  assert.equal(signal.aborted, true);
  // A late success must not turn the timed-out observation into READY.
  assert.equal(health.cache.get('database').reason, 'TIMEOUT');
  assert.equal((await health.check()).status, 'READY');
  assert.equal(calls, 2);
});

test('dependency probes retain independent cancellation and readiness classifications', async () => {
  let fastSignal, blockedSignal;
  const health = new HealthRegistry({ timeoutMs: 10 });
  health.register({ code: 'database', criticality: 'REQUIRED', check: context => {
    fastSignal = context?.signal; return true;
  } });
  health.register({ code: 'scanner', criticality: 'DEGRADABLE', check: context => {
    blockedSignal = context?.signal;
    return new Promise(resolve => blockedSignal?.addEventListener('abort', () => resolve(false), { once: true }));
  } });
  assert.deepEqual(await health.check(), { status: 'DEGRADED', reasons: ['SCANNER'] });
  assert.ok(fastSignal instanceof AbortSignal);
  assert.equal(fastSignal.aborted, false);
  assert.equal(blockedSignal.aborted, true);
});

test('synchronous throws and rejected probes remain bounded cached failures and can be retried', async () => {
  let now = 0, calls = 0;
  const health = new HealthRegistry({ clock: () => now, cacheMs: 10 });
  health.register({ code: 'database', criticality: 'REQUIRED', check: () => {
    calls++;
    if (calls === 1) throw new Error('Internal dependency failure');
    if (calls === 2) return Promise.reject(new Error('Internal async failure'));
    return true;
  } });
  assert.deepEqual(await health.check(), { status: 'UNAVAILABLE', reasons: ['DATABASE'] });
  assert.equal((await health.check()).status, 'UNAVAILABLE');
  assert.equal(calls, 1);
  now = 11;
  assert.equal((await health.check()).status, 'UNAVAILABLE');
  now = 22;
  assert.equal((await health.check()).status, 'READY');
  assert.equal(calls, 3);
});
