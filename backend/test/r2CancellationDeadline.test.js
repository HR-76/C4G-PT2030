'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createR2Storage } = require('../src/documents/r2Storage');

const organizationId = '11111111-1111-4111-8111-111111111111';
const objectId = '22222222-2222-4222-8222-222222222222';
const configuration = { enabled: true, jurisdiction: 'eu', endpoint: 'https://fixture.eu.r2.cloudflarestorage.com',
  documentsBucket: 'fixture-docs', quarantineBucket: 'fixture-quarantine', bucketAccess: 'PRIVATE',
  capabilities: { layerCValidated: true, multipartConditionalValidated: true } };
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

function fixture(t) {
  const deadline = new AbortController(), timeoutCalls = [], calls = [];
  t.mock.method(AbortSignal, 'timeout', milliseconds => { timeoutCalls.push(milliseconds); return deadline.signal; });
  const client = { destroy() {}, send(command, { abortSignal }) {
    calls.push({ command, signal: abortSignal });
    return new Promise((resolve, reject) => {
      const abort = () => reject(new Error('synthetic provider internals'));
      if (abortSignal.aborted) abort();
      else abortSignal.addEventListener('abort', abort, { once: true });
    });
  } };
  const storage = createR2Storage(configuration, { organizationId, client,
    credentials: { accessKeyId: 'test-only-key', secretAccessKey: 'test-only-secret' } });
  return { storage, deadline, timeoutCalls, calls };
}

for (const [method, parameters, commandName] of [
  ['head', { objectId }, 'HeadObjectCommand'],
  ['readRange', { objectId, start: 0, end: 9, etag: 'synthetic-immutable' }, 'GetObjectCommand']
]) {
  test(`R2 ${method} retains its 30 second deadline while the caller signal remains active`, async t => {
    const f = fixture(t), caller = new AbortController(); let observed;
    const request = f.storage[method]({ ...parameters, signal: caller.signal }).then(
      value => { observed = { value }; }, error => { observed = { error }; });
    f.deadline.abort(new Error('synthetic timeout')); await nextTurn();
    const outcomeAtDeadline = observed, callerAbortedAtDeadline = caller.signal.aborted;
    // Always settle the original implementation too, so RED leaves no pending work.
    caller.abort(); await request; await f.storage.shutdown();
    assert.equal(outcomeAtDeadline?.error?.code, 'STORAGE_UNAVAILABLE');
    assert.equal(outcomeAtDeadline.error.message, 'STORAGE_UNAVAILABLE');
    assert.equal(outcomeAtDeadline.error.cause, undefined);
    assert.equal(callerAbortedAtDeadline, false);
    assert.deepEqual(f.timeoutCalls, [30000]);
    assert.equal(f.calls[0].command.constructor.name, commandName);
    assert.equal(f.calls[0].signal.reason, f.deadline.signal.reason);
  });

  test(`R2 ${method} propagates caller cancellation before the existing deadline`, async t => {
    const f = fixture(t), caller = new AbortController();
    const request = f.storage[method]({ ...parameters, signal: caller.signal });
    caller.abort(new Error('synthetic caller cancellation'));
    await assert.rejects(request, error => error.code === 'STORAGE_ABORTED' && error.message === 'STORAGE_ABORTED' && !error.cause);
    await f.storage.shutdown();
    assert.deepEqual(f.timeoutCalls, [30000]);
    assert.equal(f.deadline.signal.aborted, false);
    assert.equal(f.calls[0].signal.aborted, true);
    assert.equal(f.calls[0].signal.reason, caller.signal.reason);
  });

  test(`R2 ${method} preserves the default deadline without a caller signal`, async t => {
    const f = fixture(t);
    const request = f.storage[method](parameters);
    f.deadline.abort(new Error('synthetic timeout'));
    await assert.rejects(request, { code: 'STORAGE_UNAVAILABLE', message: 'STORAGE_UNAVAILABLE' });
    await f.storage.shutdown();
    assert.deepEqual(f.timeoutCalls, [30000]);
    assert.equal(f.calls[0].signal.aborted, true);
  });
}
