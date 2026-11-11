'use strict';
// External deterministic control-flow proof. No PostgreSQL, HTTP or runtime edits.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const bundle = path.join(root, 'output/central-snapshot-ab-5b9e4e70caa94f49a881fc11b39a47bb');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const manifestBytes = fs.readFileSync(path.join(bundle, 'ab.json'));
assert.equal(sha(manifestBytes), '252c80d48081fe9768d02e9d393060b89d1e32864b62943903aae9bcb9691278');
const manifest = JSON.parse(manifestBytes);
const sourcePaths = [
  'backend/src/security/tenantLeaseExecutor.js', 'backend/src/security/tenantPoolManager.js',
  'backend/src/security/tenantResolver.js', 'backend/src/security/authorityCoordinator.js',
  'backend/src/config/opportunityRuntime.js', 'backend/src/opportunities/httpComposition.js',
  'backend/src/routes/organizationDashboardRoutes.js', 'backend/test/support/tenantRuntimeDoubles.js'
];
function verifySources() {
  return sourcePaths.map(file => {
    const a = fs.readFileSync(path.join(bundle, 'A/sources', file));
    const b = fs.readFileSync(path.join(bundle, 'B/sources', file));
    assert(a.equals(b), 'A_B_CONTROL_FLOW_CHANGED');
    assert.equal(sha(a), manifest.variants.A.sources[file]);
    assert.equal(sha(b), manifest.variants.B.sources[file]);
    return { path: file, sha256: sha(a), bytes: a.length, identicalAB: true };
  });
}
const sources = verifySources();
const { createTenantLeaseExecutor, isPreparedTenantTransaction, preparedAuthorityBinding } =
  require(path.join(bundle, 'A/sources/backend/src/security/tenantLeaseExecutor.js'));
const { createManualClock, createManualScheduler, validSnapshot } =
  require(path.join(bundle, 'A/sources/backend/test/support/tenantRuntimeDoubles.js'));
const { tenantFailure } = require(path.join(bundle, 'A/sources/backend/src/security/tenantRuntimeErrors.js'));
const results = [];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function fixture({ preparationMs = 0, blockedAt = null, queryElapsedMs = 0, eligible = true, denyGuard = false } = {}) {
  const clock = createManualClock(0), manual = createManualScheduler(clock), events = [], releases = [], sql = [];
  const mark = (kind, detail = {}) => events.push({ kind, atMs: clock.now(), ...detail });
  const scheduler = {
    setTimeout(callback, delay) {
      const id = manual.setTimeout(() => { mark('TIMER_FIRED', { id, delay }); return callback(); }, delay);
      mark('TIMER_ARMED', { id, delay, dueMs: clock.now() + delay }); return id;
    },
    clearTimeout(id) { mark('TIMER_CLEARED', { id }); manual.clearTimeout(id); }
  };
  const snapshot = validSnapshot({ fence: 0 });
  const expected = { organizationId: snapshot.organizationId, tenantId: snapshot.tenantId, workload: 'API', requiredCapabilities: ['SYNTHETIC_QUERY'] };
  const entered = deferred(), gate = deferred(), completeReturned = deferred();
  let prepared, memberships = 0, directories = 0, physicalVerifications = 0, guarded = 0;
  const client = { async query(statement) {
    sql.push(statement); mark('SQL', { statement });
    return { rows: statement.includes('pg_stat_activity') ? [{ pid: 1, backend_start: '2026-10-31T00:00:00.000Z' }] : [] };
  } };
  const allocationDeadline = clock.now() + 15000;
  clock.advance(preparationMs); // Model time already consumed by the resolver; no resolver/SQL proof is claimed.
  const executor = createTenantLeaseExecutor({ clock, scheduler, poolManager: { getFence: () => 0 },
    membershipRepository: { async revalidateContext() { memberships++; mark('MEMBERSHIP'); return eligible; } },
    directoryRepository: { async resolveSnapshotByOrganization() { directories++; mark('DIRECTORY'); return snapshot; } },
    bindingVerifier: { async verify() { physicalVerifications++; mark('PHYSICAL_VERIFICATION'); } }
  });
  const queryModule = Object.freeze({ requiresAuditWrite: true,
    async execute({ client: scoped }) {
      prepared = scoped; mark('QUERY_MODULE');
      assert.equal(isPreparedTenantTransaction(scoped, expected), true);
      await scoped.query('SELECT 1');
      clock.advance(queryElapsedMs);
      if (blockedAt === 'query') { mark('QUERY_BARRIER'); entered.resolve(); await gate.promise; }
      return { ok: true };
    },
    async beforeCommit({ client: scoped }) { mark('BEFORE_COMMIT'); await scoped.query('RESET ROLE'); },
    authorityGuard: Object.freeze({
      assert({ client: scoped }) {
        guarded++; mark('AUTHORITY_ASSERT');
        assert.equal(preparedAuthorityBinding(scoped).operationCode, 'OPPORTUNITY_READ');
        if (denyGuard) throw tenantFailure('AUTHORITY_GUARD_STALE', 'TENANT_OPERATION_UNAVAILABLE');
      },
      async complete({ outcome }) {
        mark('AUTHORITY_COMPLETE_ENTER', { outcome });
        if (blockedAt === 'complete' && outcome === 'COMMITTED') { entered.resolve(); await gate.promise; }
        mark('AUTHORITY_COMPLETE_RETURN', { outcome }); completeReturned.resolve();
      }
    })
  });
  const handle = executor.issue({ allocation: { client, deadline: allocationDeadline, fence: 0,
    async release({ discard, cause }) { releases.push({ atMs: clock.now(), discard, cause: cause?.internalCode || null }); mark('RELEASE', releases.at(-1)); }
  }, snapshot, organizationContext: { organizationId: snapshot.organizationId, membershipId: 'synthetic-member', membershipVersion: 1 },
  operation: { ownerModule: 'F12_PRIVATE_HTTP_RUNTIME', operationCode: 'OPPORTUNITY_READ', accessMode: 'READ',
    requiredCapabilities: ['SYNTHETIC_QUERY'], timeoutMs: 10000, queryModule }, correlationId: 'synthetic-deadline-proof' });
  const executeStartMs = clock.now(); let settlement = 'PENDING', failureCode = null;
  const execution = handle.execute({});
  execution.then(() => { settlement = 'SUCCESS'; mark('CALLER_SUCCESS'); }, error => { settlement = 'FAIL'; failureCode = error.internalCode; mark('CALLER_FAILURE', { code: failureCode }); });
  return { clock, manual, events, releases, sql, entered, gate, completeReturned, execution,
    get prepared() { return prepared; }, get settlement() { return settlement; },
    summary() { return { allocationBudgetMs: 15000, allocationDeadlineMs: allocationDeadline, operationBudgetMs: 10000,
      preparationElapsedMs: preparationMs, executeStartMs, settlement, failureCode, memberships, directories,
      physicalVerifications, guarded, releases, events }; }
  };
}

function scenario(name, work) {
  test(name, { concurrency: false }, async () => {
    try { const result = await work(); results.push({ name, status: 'PASS', ...result }); }
    catch (error) { results.push({ name, status: 'FAIL', error: { name: error.name, code: error.code || 'ASSERTION_FAILED' } }); throw error; }
  });
}

async function rejectedAt(f, before, boundary) {
  await f.manual.advance(before); await flush(); assert.equal(f.settlement, 'PENDING');
  await f.manual.advance(boundary - before);
  await assert.rejects(f.execution, error => error.internalCode === 'LEASE_TIMEOUT'); await flush();
  assert.equal(f.settlement, 'FAIL'); assert.equal(f.releases.length, 1); assert.equal(f.releases[0].discard, true);
  assert.equal(f.releases[0].cause, 'LEASE_TIMEOUT');
}

scenario('operation 10000ms wins over a fresh 15000ms allocation', async () => {
  const f = fixture({ blockedAt: 'query' }); await f.entered.promise;
  assert.equal(f.events.find(e => e.kind === 'TIMER_ARMED').delay, 10000);
  assert(f.sql.includes("SET LOCAL statement_timeout TO '10000ms'"));
  await rejectedAt(f, 9999, 10000);
  f.gate.resolve(); await flush();
  assert.equal(f.settlement, 'FAIL'); assert.equal(f.sql.includes('COMMIT'), false);
  assert(f.sql.includes('ROLLBACK')); assert.equal(f.manual.size, 0);
  return f.summary();
});

scenario('6000ms preparation leaves 9000ms of allocation despite operation 10000ms', async () => {
  const f = fixture({ preparationMs: 6000, blockedAt: 'query' }); await f.entered.promise;
  assert.equal(f.events.find(e => e.kind === 'TIMER_ARMED').delay, 9000);
  assert(f.sql.includes("SET LOCAL statement_timeout TO '9000ms'"));
  await rejectedAt(f, 8999, 9000); assert.equal(f.clock.now(), 15000);
  f.gate.resolve(); await flush();
  assert.equal(f.settlement, 'FAIL'); assert.equal(f.sql.includes('COMMIT'), false);
  assert(f.sql.includes('ROLLBACK')); assert.equal(f.manual.size, 0);
  return f.summary();
});

scenario('operation expires during authority completion after COMMIT without late success', async () => {
  const f = fixture({ blockedAt: 'complete', queryElapsedMs: 9000 }); await f.entered.promise;
  assert.equal(f.sql.filter(sql => sql === 'COMMIT').length, 1);
  assert.equal(f.events.find(e => e.kind === 'SQL' && e.statement === 'COMMIT').atMs, 9000);
  await rejectedAt(f, 999, 1000); assert.equal(f.clock.now(), 10000);
  const queryCount = f.sql.length;
  await assert.rejects(f.prepared.query('SELECT forbidden_after_deadline'), error => error.internalCode === 'LEASE_TIMEOUT');
  assert.equal(f.sql.length, queryCount);
  assert.equal(f.events.some(e => e.kind === 'AUTHORITY_COMPLETE_RETURN'), false);
  f.gate.resolve(); await f.completeReturned.promise; await flush();
  assert.equal(f.settlement, 'FAIL'); assert.equal(f.sql.filter(sql => sql === 'COMMIT').length, 1);
  assert.equal(f.sql.includes('ROLLBACK'), false); assert.equal(f.releases.length, 1); assert.equal(f.manual.size, 0);
  await assert.rejects(f.prepared.query('SELECT forbidden_after_completion'), error => error.internalCode === 'LEASE_NOT_ACTIVE');
  return f.summary();
});

scenario('successful control preserves fresh revalidations and completes authority before release', async () => {
  const f = fixture({ queryElapsedMs: 100 }); assert.deepEqual(await f.execution, { ok: true }); await flush();
  const observed = f.summary(); assert.equal(observed.memberships, 3); assert.equal(observed.directories, 3);
  assert.equal(observed.physicalVerifications, 2); assert.equal(observed.guarded, 1);
  assert.equal(f.settlement, 'SUCCESS'); assert.equal(f.releases.length, 1); assert.equal(f.releases[0].discard, false);
  const index = kind => f.events.findIndex(e => e.kind === kind);
  assert(index('AUTHORITY_ASSERT') < index('AUTHORITY_COMPLETE_ENTER'));
  assert(index('AUTHORITY_COMPLETE_RETURN') < index('RELEASE'));
  assert.equal(f.events.some(e => e.kind === 'TIMER_FIRED'), false); assert.equal(f.manual.size, 0);
  return observed;
});

scenario('membership refusal and authority refusal cannot commit or succeed', async () => {
  const observations = [];
  for (const options of [{ eligible: false }, { denyGuard: true }]) {
    const f = fixture(options), expected = options.eligible === false ? 'ORGANIZATION_MISMATCH' : 'AUTHORITY_GUARD_STALE';
    await assert.rejects(f.execution, error => error.internalCode === expected); await flush();
    assert.equal(f.settlement, 'FAIL'); assert.equal(f.sql.includes('COMMIT'), false);
    assert.equal(f.releases.length, 1); assert.equal(f.releases[0].discard, true); assert.equal(f.manual.size, 0);
    if (options.eligible === false) assert.equal(f.sql.length, 0); else assert(f.sql.includes('ROLLBACK'));
    observations.push(f.summary());
  }
  return { observations };
});

test.after(() => {
  const after = verifySources(); assert.deepEqual(after, sources);
  const value = { schemaVersion: 1, status: results.length === 5 && results.every(r => r.status === 'PASS') ? 'PASS' : 'FAIL',
    suite: 'FROZEN_EXECUTOR_DETERMINISTIC_CONTROL_FLOW', generatedAt: new Date().toISOString(),
    manifestSha256: sha(manifestBytes), testSha256: sha(fs.readFileSync(__filename)), sources, sourceIntegrityAfter: 'PASS',
    measuredPerformance: false, infrastructureCreated: false, clock: 'MANUAL_MILLISECONDS', realWallClockDelaysUsed: false,
    limitations: ['Real frozen executor; membership/directory/physical verification/authority guard and SQL client are controlled doubles.',
      'No PostgreSQL guard, grants, trigger, transaction durability, HTTP response or performance assertion is established.',
      '6000ms preparation models consumed allocation time; this scenario does not execute the resolver.',
      'Post-COMMIT late completion is observed, not cancelled by Promise.race. Caller failure remains final.'], results };
  fs.writeFileSync(path.join(__dirname, 'deterministic-result.json'), JSON.stringify(value, null, 2) + '\n');
});
