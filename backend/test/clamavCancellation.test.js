'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const net = require('node:net');
const { createClamavScanner } = require('../src/documents/clamavScanner');

const organizationId = '11111111-1111-4111-8111-111111111111';
const objectId = '22222222-2222-4222-8222-222222222222';
const bytes = Buffer.from('synthetic scanner bytes');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const record = { size: bytes.length, sha256, etag: 'synthetic-immutable' };
const input = signal => ({ organizationId, objectId, expectedSize: bytes.length, expectedSha256: sha256, signal });
function deferred() { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
function fakeSocket(t, { connect = true } = {}) {
  const socket = new EventEmitter(), created = deferred(), submitted = deferred();
  socket.destroyed = false; socket.closed = false; socket.writes = [];
  socket.write = (value, done) => {
    socket.writes.push(Buffer.from(value));
    queueMicrotask(() => {
      done(socket.destroyed ? new Error('closed') : undefined);
      if (value.length === 4 && value.equals(Buffer.alloc(4))) submitted.resolve();
    });
    return true;
  };
  socket.destroy = () => {
    if (socket.destroyed) return socket;
    socket.destroyed = true;
    queueMicrotask(() => { socket.closed = true; socket.emit('close'); });
    return socket;
  };
  t.mock.method(net, 'createConnection', () => {
    created.resolve();
    if (connect) queueMicrotask(() => socket.emit('connect'));
    return socket;
  });
  return { socket, created: created.promise, submitted: submitted.promise };
}
async function cancellationOutcome(scanning) {
  let timer;
  const completed = scanning.then(value => ({ value }), error => ({ error }));
  const outcome = await Promise.race([completed, new Promise(resolve => { timer = setTimeout(() => resolve({ pending: true }), 250); })]);
  clearTimeout(timer);
  return { outcome, completed };
}
function assertCancelled(outcome) {
  assert.equal(outcome.pending, undefined, 'abort must settle without waiting for the 1000 ms scanner timeout');
  assert.equal(outcome.error?.code, 'WORKER_DRAINING');
  assert.equal(outcome.value, undefined, 'cancelled work cannot publish CLEAN');
}

test('pre-aborted scan performs neither metadata nor socket access', async t => {
  let heads = 0, sockets = 0;
  t.mock.method(net, 'createConnection', () => { sockets++; throw Error('must not connect'); });
  const storage = { head: async () => { heads++; return record; }, readRange: async () => Readable.from([bytes]) };
  const scanner = createClamavScanner({ organizationId, storage, timeoutMs: 1000 });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(scanner.scan(input(controller.signal)), { code: 'WORKER_DRAINING' });
  assert.equal(heads, 0); assert.equal(sockets, 0);
});

test('abort while metadata is pending settles and a late head does not start a socket', async t => {
  const opened = deferred(), head = deferred(); let headsSignal, sockets = 0, ranges = 0;
  const transport = fakeSocket(t);
  const originalCreate = net.createConnection;
  t.mock.method(net, 'createConnection', (...args) => { sockets++; return originalCreate(...args); });
  const storage = { head: options => { headsSignal = options.signal; opened.resolve(); return head.promise; },
    readRange: async () => { ranges++; return Readable.from([bytes]); } };
  const scanner = createClamavScanner({ organizationId, storage, timeoutMs: 1000 }), controller = new AbortController();
  const scanning = scanner.scan(input(controller.signal));
  await opened.promise; controller.abort();
  const { outcome, completed } = await cancellationOutcome(scanning);
  head.resolve(record);
  await completed; await nextTurn();
  assertCancelled(outcome);
  assert.equal(headsSignal, controller.signal); assert.equal(ranges, 0); assert.equal(sockets, 0);
  assert.equal(transport.socket.writes.length, 0);
});

test('abort before connect closes the socket and does not open a storage stream', async t => {
  const transport = fakeSocket(t, { connect: false }); let ranges = 0;
  const storage = { head: async () => record, readRange: async () => { ranges++; return Readable.from([bytes]); } };
  const scanner = createClamavScanner({ organizationId, storage, timeoutMs: 1000 }), controller = new AbortController();
  const scanning = scanner.scan(input(controller.signal)); await transport.created; controller.abort();
  const { outcome, completed } = await cancellationOutcome(scanning);
  await completed;
  assertCancelled(outcome); assert.equal(transport.socket.closed, true); assert.equal(ranges, 0);
  transport.socket.emit('connect'); await nextTurn();
  assert.equal(ranges, 0); assert.equal(transport.socket.writes.length, 0);
});

test('abort while readRange is pending disposes a late stream without consuming it', async t => {
  const transport = fakeSocket(t), opened = deferred(), range = deferred(); let readSignal, reads = 0, destroyed = false;
  const late = new Readable({ read() { reads++; this.push(bytes); this.push(null); }, destroy(error, done) { destroyed = true; done(error); } });
  const storage = { head: async () => record,
    readRange: options => { readSignal = options.signal; opened.resolve(); return range.promise; } };
  const scanner = createClamavScanner({ organizationId, storage, timeoutMs: 1000 }), controller = new AbortController();
  const scanning = scanner.scan(input(controller.signal)); await opened.promise; controller.abort();
  const { outcome, completed } = await cancellationOutcome(scanning);
  range.resolve(late); await completed; await nextTurn();
  assertCancelled(outcome); assert.equal(readSignal, controller.signal);
  assert.equal(destroyed, true); assert.equal(late.closed, true); assert.equal(reads, 0);
  assert.equal(transport.socket.closed, true); assert.equal(transport.socket.writes.length, 1);
});

test('abort after complete upload while awaiting reply closes promptly and never becomes CLEAN', async t => {
  const transport = fakeSocket(t);
  const storage = { head: async () => record, readRange: async () => Readable.from([bytes]) };
  const scanner = createClamavScanner({ organizationId, storage, timeoutMs: 1000 }), controller = new AbortController();
  const scanning = scanner.scan(input(controller.signal)); await transport.submitted; controller.abort();
  const { outcome, completed } = await cancellationOutcome(scanning); await completed;
  assertCancelled(outcome); assert.equal(transport.socket.closed, true);
  transport.socket.emit('data', Buffer.from('stream: OK\0')); await nextTurn();
  assert.equal(outcome.value, undefined);
});

test('abort of an active cooperative stream waits for its close before rejecting', async t => {
  const transport = fakeSocket(t), started = deferred(); let closed = false, source;
  const storage = { head: async () => record, async readRange() {
    source = Readable.from((async function* () {
      try { started.resolve(); await new Promise(resolve => setTimeout(resolve, 10)); yield bytes; }
      finally { closed = true; }
    })()); return source;
  } };
  const scanner = createClamavScanner({ organizationId, storage, timeoutMs: 1000 }), controller = new AbortController();
  const scanning = scanner.scan(input(controller.signal)); await started.promise; controller.abort();
  const { outcome, completed } = await cancellationOutcome(scanning); await completed;
  assertCancelled(outcome); assert.equal(closed, true); assert.equal(source.closed, true); assert.equal(transport.socket.closed, true);
});

test('an aborted metadata request observes a late provider rejection', async t => {
  let sockets = 0;
  t.mock.method(net, 'createConnection', () => { sockets++; throw Error('must not connect'); });
  const opened = deferred(), head = deferred();
  const storage = { head: () => { opened.resolve(); return head.promise; }, readRange: async () => Readable.from([bytes]) };
  const scanner = createClamavScanner({ organizationId, storage, timeoutMs: 1000 }), controller = new AbortController();
  const scanning = scanner.scan(input(controller.signal)); await opened.promise; controller.abort();
  const { outcome } = await cancellationOutcome(scanning);
  head.reject(new Error('late provider failure')); await nextTurn();
  assertCancelled(outcome); assert.equal(sockets, 0);
});

test('an uncooperative source cannot hold cancellation past the existing scanner deadline', async t => {
  const transport = fakeSocket(t), started = deferred(), release = deferred(); let destroyed = false;
  const source = new EventEmitter();
  source.destroy = () => { destroyed = true; };
  source[Symbol.asyncIterator] = async function* () { started.resolve(); await release.promise; yield bytes; };
  const storage = { head: async () => record, readRange: async () => source };
  const scanner = createClamavScanner({ organizationId, storage, timeoutMs: 100 }), controller = new AbortController();
  const scanning = scanner.scan(input(controller.signal)); await started.promise; controller.abort();
  const { outcome, completed } = await cancellationOutcome(scanning);
  // Release the deliberately uncooperative iterator even when an assertion fails.
  release.resolve(); await completed; await nextTurn();
  assert.equal(outcome.pending, undefined, 'cleanup must remain bounded when destroy never emits close');
  assert.equal(outcome.error?.code, 'WORKER_DRAINING'); assert.equal(outcome.value, undefined);
  assert.equal(destroyed, true); assert.equal(transport.socket.closed, true);
  assert.equal(transport.socket.writes.length, 1, 'late bytes cannot reach the daemon after cancellation');
  assert.equal(source.listenerCount('close'), 0);
});
