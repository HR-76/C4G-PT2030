'use strict';
const {waitForSignal,bounded,deferCleanup,trackServer,listening}=require('./support/networkWait');
const test = require('./support/networkWait').test, assert = require('node:assert/strict'), http = require('node:http');
const { createLauncherDrain, trackPool, watchServer, trackExpress } = require('../../test/integration/doc-mvp-01/launcher-drain');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function pool() { let closed = false; return { calls: [], async query(work) { assert.equal(closed, false); this.calls.push('query'); return typeof work === 'function' ? work() : work; }, async connect() { return { release() {} }; }, async end() { closed = true; this.calls.push('end'); } }; }
test('old order demonstrably closes before a residual query; tracker drains it instead', async () => {
  const old = pool(); await old.end(); await assert.rejects(() => old.query('late'));
  const p = pool(), release = deferred(); trackPool(p); const query = p.query(release.promise);
  const drain = createLauncherDrain({ pools: [p], settleMs: 500 }); const done = drain();
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(p.calls, ['query']); release.resolve('ok'); await query; await done; assert.deepEqual(p.calls, ['query', 'end']);
});
test('empty/partial startup and repeated shutdown are idempotent', async () => {
  const p = pool(); const drain = createLauncherDrain({ pools: [null, p], servers: [null] });
  const a = drain(), b = drain(); assert.equal(a, b); await a; assert.deepEqual(p.calls, ['end']);
});
test('a retained client prevents pool close; timeout preserves the pool', async () => {
  const p = pool(); trackPool(p); const client = await p.connect();
  await assert.rejects(createLauncherDrain({ pools: [p], settleMs: 30 })(), /DATABASE_DRAIN_TIMEOUT/);
  assert.deepEqual(p.calls, []); client.release(); await p.end();
});
for (const forced of [false, true]) test(forced ? 'deadline cancels an active HTTP operation and drains sockets' : 'active HTTP request finishes within grace', async () => {
  const entered = deferred(), completion = deferred(), requestClosed = deferred(), phases = []; let aborted = false;
  const server = http.createServer(async (req, res) => { entered.resolve(); req.on('close', () => { aborted = true; completion.resolve(); requestClosed.resolve(); }); await completion.promise; if (!res.destroyed) res.end('ok'); });
  trackServer(server);deferCleanup(()=>completion.resolve());const watched = watchServer(server); server.listen(0,'127.0.0.1');await listening(server);
  const response = new Promise(resolve => { const req = http.get(`http://127.0.0.1:${server.address().port}`, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); }); deferCleanup(()=>req.destroy());req.on('error', e => resolve(e.code)); });
  await waitForSignal(entered.promise,response,'HTTP handler entry');
  const drain = createLauncherDrain({ servers: [watched], graceMs: forced ? 30 : 500, record: e => phases.push(e.phase), cancelWork: async () => { completion.resolve(); } });
  const result = drain(); if (!forced) completion.resolve(); await result; const status = await response;
  await bounded(requestClosed.promise,'request closed');
  assert.equal(server.listening, false); assert.equal(phases.includes('CANCEL_HTTP'), forced); if (!forced) assert.equal(status, 200); else { assert(aborted); assert.notEqual(status, 200); }
});
test('producer failure is observed and does not close dependencies still in use', async () => {
  const p = pool(); await assert.rejects(createLauncherDrain({ pools: [p], stopProducers: async () => { throw Error('STOP_FAILED'); } })(), /STOP_FAILED/); assert.deepEqual(p.calls, []);
});
test('delegated pool ownership drains and seals without a double end', async () => {
  const p = pool(); await createLauncherDrain({ pools: [p], closePools: false })();
  assert.deepEqual(p.calls, []); await assert.rejects(() => p.query('late'), /LAUNCHER_POOL_CLOSED/);
  await p.end(); assert.deepEqual(p.calls, ['end']);
});
test('aborted HTTP socket does not mean its async Express handler has stopped using the pool', async () => {
  const express = require('express'), app = express(), entered = deferred(), release = deferred(), completed = deferred(), p = pool();
  trackPool(p);
  app.get('/', async (req, res) => { entered.resolve(); await release.promise; await p.query('late handler query'); completed.resolve(); if (!res.destroyed) res.end('ok'); });
  const work = trackExpress(app), server = http.createServer(app), watched = watchServer(server);
  trackServer(server);deferCleanup(()=>release.resolve());server.listen(0,'127.0.0.1');await listening(server);
  const request = http.get(`http://127.0.0.1:${server.address().port}`); const requestError = deferred(); request.on('error', error => requestError.resolve(error.code));
  deferCleanup(()=>request.destroy());await waitForSignal(entered.promise,requestError.promise,'HTTP handler entry'); request.destroy();
  const shutdown = createLauncherDrain({ servers: [watched], pools: [p], work: [work], graceMs: 100, settleMs: 500 })();
  await new Promise(resolve => setImmediate(resolve)); assert(!p.calls.includes('end')); assert.equal(work.active.size, 1);
  release.resolve(); await bounded(completed.promise,'handler completed'); await shutdown;
  assert.deepEqual(p.calls, ['query', 'end']); assert.equal(work.active.size, 0); assert.equal(await requestError.promise, 'ECONNRESET');
});
