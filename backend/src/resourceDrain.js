'use strict';
// Shared bounded drain. It owns only explicitly supplied servers, work and pools.
const trackers = new WeakMap();
function trackPool(pool) {
  if (trackers.has(pool)) return trackers.get(pool);
  const active = new Set(); let closing = false;
  const query = pool.query.bind(pool), connect = pool.connect.bind(pool);
  const observe = work => { const token = {}; active.add(token); return Promise.resolve().then(work).finally(() => active.delete(token)); };
  pool.query = (...args) => {
    if (closing) return Promise.reject(new Error('LAUNCHER_POOL_CLOSED'));
    const callback = typeof args.at(-1) === 'function' ? args.pop() : null;
    const pending = observe(() => query(...args));
    if (callback) { pending.then(value => callback(null, value), error => callback(error)); return; }
    return pending;
  };
  const acquire = async () => {
    if (closing) throw new Error('LAUNCHER_POOL_CLOSED');
    const token = {}; active.add(token);
    try { const client = await connect(), release = client.release.bind(client); let released = false;
      client.release = (...args) => { if (!released) { released = true; active.delete(token); release(...args); } };
      return client;
    } catch (error) { active.delete(token); throw error; }
  };
  pool.connect = callback => {
    const pending = acquire();
    if (typeof callback === 'function') { pending.then(client => callback(null, client, client.release), error => callback(error)); return; }
    return pending;
  };
  const tracker = { active, seal: () => { if (active.size) throw new Error('LAUNCHER_POOL_BUSY'); closing = true; }, close: async () => { if (active.size) throw new Error('LAUNCHER_POOL_BUSY'); closing = true; await pool.end(); } };
  trackers.set(pool, tracker); return tracker;
}
function deadline(work, ms, code) {
  let timer;
  return Promise.race([Promise.resolve().then(work), new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), ms); })]).finally(() => clearTimeout(timer));
}
function watchServer(server) {
  const sockets = new Set(); let draining = false;
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('request', (req, res) => res.once('finish', () => { if (draining) server.closeIdleConnections?.(); }));
  return { server, sockets, beginDrain() { draining = true; } };
}
function trackExpress(app) {
  const active = new Set(), seen = new WeakSet();
  function visit(stack) { for (const layer of stack || []) {
    if (layer.route) { visit(layer.route.stack); continue; }
    const original = layer.handle;
    if (!original || seen.has(layer)) continue; seen.add(layer);
    if (original.stack) { visit(original.stack); continue; }
    const invoke = (context, args) => {
      const value = original.apply(context, args);
      if (!value || typeof value.then !== 'function') return value;
      const token = {}; active.add(token);
      return Promise.resolve(value).finally(() => active.delete(token));
    };
    layer.handle = original.length === 4
      ? function (error, req, res, next) { return invoke(this, [error, req, res, next]); }
      : function (req, res, next) { return invoke(this, [req, res, next]); };
  } }
  visit(app.router?.stack); return { active };
}
function createResourceDrain({ servers = [], pools = [], work = [], closePools = true, stopProducers = async () => {}, stopWorkers = async () => {}, closeConsumers = async () => {}, cancelWork = async () => {}, graceMs = 5000, settleMs = 10000, record = () => {} }) {
  let shutdown;
  const tracked = pools.filter(Boolean).map(trackPool);
  return () => shutdown ||= (async () => {
    const start = Date.now(); const event = (phase, extra = {}) => record({ phase, elapsedMs: Date.now() - start, ...extra });
    event('STOP_PRODUCERS'); await deadline(stopProducers, graceMs, 'PRODUCER_STOP_TIMEOUT');
    event('STOP_ADMISSION');
    event('STOP_WORKERS');
    const workersStopped = deadline(stopWorkers, settleMs, 'WORKER_STOP_TIMEOUT').then(() => ({ ok: true }), error => ({ error }));
    const closed = servers.filter(Boolean).map(({ server, beginDrain }) => new Promise((resolve, reject) => {
      if (!server.listening) return resolve();
      beginDrain?.();
      server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections?.();
    }));
    try { await deadline(() => Promise.all(closed), graceMs, 'HTTP_DRAIN_TIMEOUT'); }
    catch (error) {
      if (error.code !== 'HTTP_DRAIN_TIMEOUT') throw error;
      event('CANCEL_HTTP'); const cancelling = deadline(cancelWork, settleMs, 'WORK_CANCEL_TIMEOUT');
      for (const { server, sockets } of servers.filter(Boolean)) { for (const socket of sockets) socket.destroy(); server.closeAllConnections?.(); }
      await cancelling;
      await deadline(() => Promise.all(closed), settleMs, 'HTTP_CLOSE_TIMEOUT');
    }
    const workUntil = Date.now() + settleMs;
    while (work.some(t => t.active.size)) {
      if (Date.now() >= workUntil) throw Object.assign(new Error('REQUEST_WORK_DRAIN_TIMEOUT'), { code: 'REQUEST_WORK_DRAIN_TIMEOUT' });
      await new Promise(resolve => setTimeout(resolve, Math.min(10, workUntil - Date.now())));
    }
    const workerResult = await workersStopped; if (workerResult.error) throw workerResult.error;
    event('CLOSE_CONSUMERS'); await deadline(closeConsumers, settleMs, 'CONSUMER_CLOSE_TIMEOUT');
    // Bounded polling observes outstanding clients/queries; it is not a guessed sleep.
    const until = Date.now() + settleMs;
    while (tracked.some(t => t.active.size)) {
      if (Date.now() >= until) throw Object.assign(new Error('DATABASE_DRAIN_TIMEOUT'), { code: 'DATABASE_DRAIN_TIMEOUT' });
      await new Promise(resolve => setTimeout(resolve, Math.min(10, until - Date.now())));
    }
    event(closePools ? 'CLOSE_POOLS' : 'POOLS_DRAINED');
    for (const tracker of tracked) { tracker.seal(); if (closePools) await deadline(() => tracker.close(), settleMs, 'POOL_CLOSE_TIMEOUT'); }
    const status = closePools ? 'CLOSED' : 'DRAINED';
    event(status); return { status, elapsedMs: Date.now() - start };
  })();
}
module.exports = { createResourceDrain, trackPool, watchServer, trackExpress, deadline };
