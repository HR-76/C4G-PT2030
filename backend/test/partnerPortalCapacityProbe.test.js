'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCapacityProbe, CAPACITY_SCENARIOS, runCapacityGate } = require('../../test/integration/partner-portal/capacityProbe');
const { createTimingHub, TIMED_SCENARIOS } = require('../../test/integration/partner-portal/temporalDiagnostic');

// Offline collector tests: SQL calls below are synthetic callbacks. They must
// never produce verified PostgreSQL evidence or authorize an integration.
function fixture(options = {}) {
  const env = { hooks: {}, sequence: 0, calls: [], cleaned: [], activeFixture: null };
  if (options.timing) env.timing = createTimingHub(options.badClock ? { now: () => NaN } : {});
  let finishPending, pendingWork;
  env.close = async () => { finishPending?.(); await pendingWork; };
  const tenant = { organizationId: '10000000-0000-4000-8000-000000000001', owner: { request: { profile: 'ORG_ADMIN' } },
    credentials: { login: 'synthetic_runtime' }, pool: { async query(input) {
      const sql = typeof input === 'string' ? input : input.text;
      if (sql.includes('pg_stat_database')) {
        if (options.missingTempMetric) return { rows: [] };
        return { rows: [{ temp_bytes: '0', stats_reset: null }] };
      }
      if (sql.includes('pg_stat_activity')) {
        await new Promise(resolve => setTimeout(resolve, 1));
        return { rows: [{ active: 0 }] };
      }
      assert.fail('Unexpected collector SQL');
    } } };
  env.tenants = [tenant];
  env.runtime = { poolManager: { snapshot: () => options.missingCleanup ? {} : ({ active: 0, queued: 0, credentialDisposalsPending: 0, cleanupFailures: 0 }) } };
  env.actor = async (_tenant, { profileCode }) => ({ request: { profile: profileCode } });
  async function observe(sql, result = { rows: [] }) {
    const context = { tenant, client: {}, sql, values: [] };
    await env.hooks.beforeQuery?.(context);
    await env.hooks.afterQuery?.({ ...context, result });
  }
  env.composition = variant => ({ async execute(method, input, id, request) {
    assert.equal(method, 'partnersBrowse'); assert.equal(id, null);
    const seed = env.activeFixture; env.sequence++;
    env.calls.push({ variant, scenarioId: seed.scenarioId, input, request });
    if (!options.missingAdmission) env.hooks.onAcquire?.({ ms: 2 });
    if (!options.missingOperationStart) await observe('BEGIN TRANSACTION READ WRITE');
    if (options.failFirstWarmup && env.sequence === 1) throw Object.assign(new Error('synthetic'), { code: 'SERVICE_UNAVAILABLE' });
    if (variant === 'candidate') await observe('DECLARE c4g_partner_browse_00000000000000000000000000000000 NO SCROLL CURSOR WITHOUT HOLD FOR SELECT p.*');
    const sql = variant === 'candidate' ? 'FETCH FORWARD 100 FROM c4g_partner_browse_00000000000000000000000000000000'
      : 'SELECT p.* FROM opportunity_catalog.application_partner p';
    const timeout = options.timeoutScenarios && TIMED_SCENARIOS.includes(seed.scenarioId);
    await observe(sql, { rows: Array.from({ length: timeout ? Math.min(seed.count, 5800) : Math.min(seed.count, 10001) }, () => ({})) });
    if (!options.missingAuthorization && seed.count > 0) await env.hooks.onAuthorize?.({ operation: 'APPLICATION_READ', allowed: request.profile !== 'CONTRIBUTOR' });
    if (seed.scenarioId === 'volume-10000' && options.pendingAt === env.calls.filter(call => call.scenarioId === seed.scenarioId).length) {
      // Lease settlement leaves the reader awaiting a Central client promise.
      // Only the outer environment can settle it; tenant activity is quiet.
      pendingWork = env.timing.measure('READER', () => env.timing.authorization(() =>
        env.timing.measure('SQL_CENTRAL', () => new Promise(resolve => { finishPending = resolve; }))));
      throw Object.assign(new Error('PRIVATE_TIMEOUT_CANARY'), { code: 'LEASE_TIMEOUT' });
    }
    if (timeout) throw Object.assign(new Error('PRIVATE_TIMEOUT_CANARY'), { code: 'LEASE_TIMEOUT' });
    if (variant === 'candidate') await observe('CLOSE c4g_partner_browse_00000000000000000000000000000000');
    await observe(seed.count > 10000 ? 'ROLLBACK' : 'COMMIT');
    if (seed.count > 10000) throw Object.assign(new Error('synthetic overflow'), { code: 'LIMIT_EXCEEDED' });
    const total = request.profile === 'CONTRIBUTOR' ? 0 : seed.count;
    const token = total > 25 ? `gate.${Buffer.from(JSON.stringify({ context: { q: input.q },
      position: { offset: 25, digest: 'a'.repeat(64) }, exp: 1800000000 + env.sequence })).toString('base64url')}.${(variant === 'before' ? 'a' : 'b').repeat(43)}` : null;
    if (options.lateQuery) setTimeout(() => { observe('SELECT late_completion').catch(() => {}); }, 0);
    return { items: Array.from({ length: Math.min(total, 25) }, (_, n) => ({ id: `synthetic-${n}` })), total,
      page: 1, nextCursor: token, previousCursor: null, countries: total ? ['Portugal'] : [] };
  } });
  const seedPartners = async (_tenant, specification) => {
    if (options.seedFailure) throw new Error('synthetic fixture error');
    const seed = { ...specification, prefix: specification.prefix || 'Synthetic', rows: [], appIds: [], partnerIds: [],
      scenarioId: specification.prefix, async cleanup() { env.cleaned.push(seed.scenarioId); } };
    env.activeFixture = seed; return seed;
  };
  const run = createCapacityProbe({ seedPartners, isPreparedEnvironment: () => false, allowUnverifiedForTests: true });
  return { env, run };
}

test('capacity probe default refuses an unverified environment before any infrastructure or seed call', async () => {
  await assert.rejects(runCapacityGate({}), { code: 'PARTNER_GATE_ENVIRONMENT_REQUIRED' });
});

test('capacity collector covers balanced pairs and keeps warmups separate without claiming PostgreSQL verification', async () => {
  const { env, run } = fixture();
  const result = await run(env);
  assert.equal(result.environmentVerified, false); assert.equal(result.evaluation.status, 'INCOMPLETE');
  assert.ok(result.evaluation.failures.some(item => item.code === 'UNVERIFIED_ENVIRONMENT'));
  assert.equal(result.samples.length, CAPACITY_SCENARIOS.length * 4);
  assert.equal(result.warmups.length, CAPACITY_SCENARIOS.length * 2);
  assert.equal(result.scenarios.length, CAPACITY_SCENARIOS.length);
  assert.equal(env.cleaned.length, CAPACITY_SCENARIOS.length);
  assert.equal(result.observationErrors.length, 0);
  assert.ok(result.samples.every(sample => Number.isFinite(sample.operationMs) && sample.admissionMs === 2
    && sample.nodeRssPeakBytes > 0 && sample.nodeHeapPeakBytes > 0 && sample.postgresTempBytes === 0));
  assert.equal(result.evaluation.failures.length, 1, 'synthetic provenance is the only incomplete item');
  const first = result.samples.slice(0, 4);
  assert.deepEqual(first.map(sample => [sample.variant, sample.pair, sample.order]), [['before', 1, 1], ['after', 1, 2], ['after', 2, 1], ['before', 2, 2]]);
});

test('capacity collector compares cursor meaning without persisting signed cursors or expiry', async () => {
  const { env, run } = fixture(), result = await run(env);
  const samples = result.samples.filter(sample => sample.scenarioId === 'volume-26');
  assert.equal(new Set(samples.map(sample => sample.responseDigest)).size, 1);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('gate.')); assert.ok(!/"exp"\s*:/.test(serialized));
  assert.ok(!serialized.includes('synthetic_runtime'));
});

for (const [option, metric] of [['missingAdmission', 'admissionMs'], ['missingOperationStart', 'operationMs'], ['missingTempMetric', 'postgresTempBytes']]) {
  test(`capacity collector records unavailable ${metric} as null, never a fabricated zero`, async () => {
    const { env, run } = fixture({ [option]: true }), result = await run(env);
    assert.ok(result.samples.length > 0); assert.ok(result.samples.every(sample => sample[metric] === null));
    assert.equal(result.evaluation.status, 'INCOMPLETE'); assert.ok(result.observationErrors.length > 0);
  });
}

test('capacity collector records late runtime queries and restores every prior hook', async () => {
  const { env, run } = fixture({ lateQuery: true });
  const prior = () => {}; env.hooks.beforeQuery = prior;
  const result = await run(env);
  assert.ok(result.samples.some(sample => sample.success && sample.afterSuccessQueries > 0));
  assert.ok(result.evaluation.failures.some(item => item.code === 'QUERY_AFTER_SUCCESS'));
  assert.deepEqual(env.hooks, { beforeQuery: prior });
});

test('capacity collector preserves unexpected warmup failures rather than accepting later successful samples', async () => {
  const { env, run } = fixture({ failFirstWarmup: true }), result = await run(env);
  assert.ok(result.warmups.some(sample => sample.errorCode === 'SERVICE_UNAVAILABLE'));
  assert.ok(result.observationErrors.some(error => error.code === 'UNEXPECTED_WARMUP_FAILURE'));
  assert.equal(env.cleaned.length, CAPACITY_SCENARIOS.length);
});

test('capacity collector cannot claim completed coverage after fixture preparation failure', async () => {
  const { env, run } = fixture({ seedFailure: true }), result = await run(env);
  assert.equal(result.samples.length, 0); assert.equal(env.calls.length, 0);
  assert.equal(result.evaluation.status, 'INCOMPLETE');
  assert.ok(result.observationErrors.some(error => error.code === 'CAPACITY_FIXTURE_FAILED'));
  assert.ok(result.scenarios.every(scenario => scenario.status === 'NOT_RUN'));
});

test('capacity collector stops further load and fixture writes if physical cleanup cannot be confirmed', async () => {
  const { env, run } = fixture({ missingCleanup: true }), result = await run(env);
  assert.equal(env.calls.length, 1, 'do not run another operation on uncertain resources');
  assert.equal(env.cleaned.length, 0, 'outer disposable environment owns uncertain cleanup');
  assert.equal(result.samples.length, 0);
  assert.ok(result.observationErrors.some(error => error.code === 'CAPACITY_CLEANUP_UNCONFIRMED'));
  assert.equal(result.evaluation.status, 'INCOMPLETE');
});

for (const [pendingAt, badClock] of [[1, false], [2, false], [3, false], [4, false], [1, true]]) {
  test(`pending Central work at operation ${pendingAt}, invalid clock ${badClock}: stop load and defer fixture archive`, async () => {
    const { env, run } = fixture({ timing: true, pendingAt, badClock });
    const prior = () => {}; env.hooks.beforeQuery = prior;
    try {
      const result = await run(env);
      const rows = [...result.warmups, ...result.samples].filter(row => row.scenarioId === 'volume-10000');
      const timedOut = rows.find(row => row.errorCode === 'LEASE_TIMEOUT');
      assert.equal(timedOut.errorCode, 'LEASE_TIMEOUT', 'retain the primary refusal');
      assert.equal(timedOut.success, false);
      assert.ok(Number.isFinite(timedOut.cleanupMs), 'tenant cleanup succeeded');
      assert.equal(timedOut.temporalDiagnostic.status, badClock ? 'INVALID' : 'INCOMPLETE');
      for (const label of ['SQL_CENTRAL', 'READER', 'AUTHORIZATION']) {
        assert.equal(timedOut.temporalDiagnostic.afterCleanup.metrics[label].inflight, 1);
      }
      assert.equal(env.calls.length, 30 + pendingAt, 'no subsequent variant, pair or scenario');
      assert.equal(rows.length, pendingAt);
      assert.deepEqual(env.cleaned, CAPACITY_SCENARIOS.slice(0, 5).map(row => row.id), 'do not archive the affected fixture');
      assert.equal(result.scenarios[5].status, 'INCOMPLETE');
      assert.ok(result.scenarios.slice(6).every(row => row.status === 'NOT_RUN'));
      for (const code of ['CAPACITY_CLEANUP_UNCONFIRMED', 'CAPACITY_FIXTURE_ARCHIVE_DEFERRED']) {
        assert.ok(result.observationErrors.some(row => row.scenarioId === 'volume-10000' && row.code === code));
      }
      assert.notEqual(result.evaluation.status, 'PASS');
      assert.deepEqual(env.hooks, { beforeQuery: prior });
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_TIMEOUT_CANARY/);
    } finally { await env.close(); }
  });
}

test('capacity collector does not turn missing authority observations into a valid zero for examined rows', async () => {
  const { env, run } = fixture({ missingAuthorization: true }), result = await run(env);
  assert.ok(result.samples.filter(sample => sample.candidates > 0).every(sample => sample.authorizationCalls === null));
  assert.ok(result.samples.filter(sample => sample.candidates === 0).every(sample => sample.authorizationCalls === 0));
  assert.ok(result.observationErrors.some(error => error.code === 'AUTHORITY_MEASUREMENT_UNAVAILABLE'));
});

test('three failed workloads retain timeout verdict and receive bounded settlement/cleanup timings in all AB/BA samples', async () => {
  const { env, run } = fixture({ timing: true, timeoutScenarios: true }), result = await run(env);
  const timed = [...result.warmups, ...result.samples].filter(row => TIMED_SCENARIOS.includes(row.scenarioId));
  assert.equal(timed.length, 18);
  for (const row of timed) {
    assert.equal(row.errorCode, 'LEASE_TIMEOUT');
    assert.equal(row.temporalDiagnostic.status, 'VALID');
    assert.equal(row.temporalDiagnostic.atSettlement.metrics.OPERATION.failed, 1);
    assert.equal(row.temporalDiagnostic.afterCleanup.metrics.CLEANUP.completed, 1);
    assert.equal(row.temporalDiagnostic.afterCleanup.metrics.OPERATION.inflight, 0);
  }
  assert.equal(result.samples.length, 52); assert.equal(result.warmups.length, 26);
  assert.equal(env.cleaned.length, 13, 'settled failures allow safe fixture archive');
  assert.ok(result.scenarios.every(row => row.status === 'COMPLETE'));
  assert.ok(result.observationErrors.some(row => row.code === 'UNEXPECTED_WARMUP_FAILURE'));
  assert.ok(result.evaluation.failures.some(row => row.code === 'UNEXPECTED_OUTCOME'));
  assert.ok([...result.warmups, ...result.samples].filter(row => !TIMED_SCENARIOS.includes(row.scenarioId)).every(row => !row.temporalDiagnostic));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_TIMEOUT_CANARY/);
  assert.deepEqual(env.hooks, {});
});

test('invalid temporal clock is reported without changing the operation result or skipping cleanup', async () => {
  const { env, run } = fixture({ timing: true, badClock: true }), result = await run(env);
  const timed = result.samples.filter(row => TIMED_SCENARIOS.includes(row.scenarioId));
  assert.ok(timed.every(row => row.temporalDiagnostic.status === 'INVALID'));
  assert.ok(result.observationErrors.some(row => row.code === 'TEMPORAL_DIAGNOSTIC_INVALID'));
  assert.ok(timed.filter(row => row.candidates <= 10000).every(row => row.success));
  assert.equal(env.cleaned.length, 13);
});
