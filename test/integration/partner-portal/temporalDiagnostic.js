'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');

const TIMED_SCENARIOS = Object.freeze(['volume-10000', 'volume-10001', 'profile-distinct-origins']);
const LABELS = Object.freeze(['OPERATION', 'RESOLVE', 'LEASE', 'PROTECT', 'READER',
  'AUTHORIZATION', 'AUTHORIZATION_MEMBERSHIP', 'AUTHORIZATION_DATA', 'RESOURCE_POLICY', 'AUDIT', 'AUTHORIZATION_HIT', 'AUTHORIZATION_MISS',
  'AUTHORIZATION_UNRESOLVED', 'SQL_CENTRAL', 'SQL_TENANT', 'CLEANUP']);

// Fixed-size aggregates only. Durations are inclusive and may overlap; they
// are not an exclusive decomposition of elapsed time. No SQL/arguments/errors
// or resource keys enter the collector. An invalid clock cannot mask work.
function createTimingHub({ now = () => performance.now() } = {}) {
  const scope = new AsyncLocalStorage();
  function start() {
    let invalid = false;
    const active = new Set();
    const metrics = Object.fromEntries(LABELS.map(key => [key, { started: 0, completed: 0, failed: 0, totalMs: 0, maxMs: 0 }]));
    function clock() {
      try { const value = now(); if (Number.isFinite(value) && value >= 0) return value; } catch { /* diagnostic only */ }
      invalid = true; return 0;
    }
    function elapsed(begin) { const duration = clock() - begin; if (duration < 0) { invalid = true; return 0; } return duration; }
    function begin(label) {
      if (!Object.hasOwn(metrics, label) || active.size >= 1024) { invalid = true; return () => {}; }
      const token = { label, at: clock() }, metric = metrics[label]; metric.started++; active.add(token);
      return (failed, classification) => {
        if (!active.delete(token)) return;
        const duration = elapsed(token.at);
        for (const key of classification ? [label, classification] : [label]) {
          const row = metrics[key];
          if (key !== label) row.started++;
          row.completed++; if (failed) row.failed++;
          row.totalMs += duration; row.maxMs = Math.max(row.maxMs, duration);
        }
      };
    }
    return { begin, snapshot() {
      const copy = Object.fromEntries(LABELS.map(key => [key, { ...metrics[key], inflight: 0, pendingMs: 0 }]));
      for (const token of active) { copy[token.label].inflight++; copy[token.label].pendingMs += elapsed(token.at); }
      return { schemaVersion: 1, status: invalid ? 'INVALID' : 'VALID', inclusive: true, metrics: copy };
    } };
  }
  function track(label, work, classify) {
    const current = scope.getStore(); if (!current) return work();
    const end = current.collector.begin(label);
    try {
      const result = work();
      if (result && typeof result.then === 'function') return result.then(
        value => { end(false, classify?.(false)); return value; },
        error => { end(true, classify?.(true)); throw error; });
      end(false, classify?.(false)); return result;
    } catch (error) { end(true, classify?.(true)); throw error; }
  }
  const hub = {
    start, run: (collector, work) => scope.run({ collector }, work),
    measure: (label, work) => track(label, work),
    authorization(work) {
      const current = scope.getStore(); if (!current) return work();
      const authorization = { decision: false, guard: false };
      return scope.run({ ...current, authorization }, () => track('AUTHORIZATION', work,
        failed => authorization.decision ? 'AUTHORIZATION_MISS' : !failed && authorization.guard ? 'AUTHORIZATION_HIT' : 'AUTHORIZATION_UNRESOLVED'));
    },
    decision(work) {
      const current = scope.getStore();
      if (current?.authorization) current.authorization.decision = true;
      return track('AUTHORIZATION_MEMBERSHIP', work);
    },
    cacheGuard() { const current = scope.getStore(); if (current?.authorization) current.authorization.guard = true; },
    begin(label) { return scope.getStore()?.collector.begin(label) || (() => {}); }
  };
  return hub;
}

// Observe physical clients of the two synthetic Central pools, including
// already-open sessions on their next acquisition. Preserve pg callback and
// promise protocols and the receiver; do not wrap Pool.query (double count).
function observePool(pool, hub) {
  const originals = new Map();
  function acquired(client) {
    if (originals.has(client)) return;
    const original = client.query;
    function query(...args) {
      const callback = typeof args.at(-1) === 'function' ? args.at(-1) : null;
      if (!callback) return hub.measure('SQL_CENTRAL', () => original.apply(this, args));
      const end = hub.begin('SQL_CENTRAL');
      args[args.length - 1] = function(error, ...values) { end(Boolean(error)); return callback.call(this, error, ...values); };
      try { return original.apply(this, args); } catch (error) { end(true); throw error; }
    }
    originals.set(client, { original, query }); client.query = query;
  }
  pool.on('acquire', acquired);
  return () => {
    pool.removeListener('acquire', acquired);
    for (const [client, { original, query }] of originals) if (client.query === query) client.query = original;
    originals.clear();
  };
}

function observeRuntime(runtime, hub) {
  return { ...runtime, async resolve(...args) {
    const lease = await hub.measure('RESOLVE', () => runtime.resolve(...args));
    return { ...lease, execute(...input) { return hub.measure('LEASE', () => lease.execute(...input)); } };
  } };
}
// Return the original branded port. Only its input dependencies are observed;
// never substitute the coordinator, session authority or private brand checks.
function observeAuthorizationFactory(factory, options, hub) {
  const membership = options.membershipPort, data = options.authorizationDataPort, audit = options.authorizationAuditPort;
  return factory({ ...options,
    membershipPort: { ...membership, revalidate: (...args) => hub.decision(() => membership.revalidate(...args)) },
    authorizationDataPort: { ...data, load: (...args) => hub.measure('AUTHORIZATION_DATA', () => data.load(...args)) },
    authorizationAuditPort: { ...audit, accept: (...args) => hub.measure('AUDIT', () => audit.accept(...args)) },
    ...(options.snapshotForResource ? { snapshotForResource: (...args) => hub.measure('RESOURCE_POLICY', () => options.snapshotForResource(...args)) } : {})
  });
}

module.exports = { createTimingHub, observePool, observeRuntime, observeAuthorizationFactory, TIMED_SCENARIOS };
