const assert = require('node:assert/strict');
const test = require('node:test');
const { createTenantLeaseExecutor, isPreparedTenantTransaction, sameSnapshot } = require('../src/security/tenantLeaseExecutor');
const { TenantRuntimeError, aggregateCleanup, tenantFailure } = require('../src/security/tenantRuntimeErrors');
const { createManualClock, createManualScheduler, validSnapshot } = require('./support/tenantRuntimeDoubles');

function setup({ current = validSnapshot(), eligible = true, queryError = null, releaseError = null, currentFence = 1 } = {}) {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  const releases = [];
  const allocation = { client: Object.freeze({ synthetic: true }), deadline: clock.now() + 100,
    fence: 1, async release(options) { releases.push(options); if (releaseError) throw releaseError; } };
  const poolManager = { getFence: () => currentFence };
  const membershipRepository = { async revalidateContext(context) { return eligible ? context : null; } };
  const directoryRepository = { async resolveSnapshotByOrganization() { return current; } };
  const queryModule = Object.freeze({ async execute({ client, input }) {
    assert.equal(client, allocation.client);
    if (queryError) throw queryError;
    return input;
  } });
  const executor = createTenantLeaseExecutor({ membershipRepository, directoryRepository, poolManager, clock, scheduler });
  const handle = executor.issue({ allocation, snapshot: validSnapshot(),
    organizationContext: { organizationId: 'org-1', membershipId: 'm', membershipVersion: 1 },
    operation: { queryModule }, correlationId: 'c' });
  return { handle, releases, clock, scheduler };
}

test('prepared capability is physical-client/transaction-bound, fenced and invalid after commit', async () => {
  const clock = createManualClock(), scheduler = createManualScheduler(clock), snapshot = validSnapshot();
  const expected = { organizationId: snapshot.organizationId, tenantId: snapshot.tenantId, workload: 'API', requiredCapabilities: ['SYNTHETIC_QUERY'] };
  let captured, verifications = 0, beforeCommit = 0, fence = 0, sql = [];
  const physical = { async query(statement) { sql.push(statement); return { rows: [] }; } };
  const executor = createTenantLeaseExecutor({ clock, scheduler, poolManager: { getFence: () => fence },
    membershipRepository: { async revalidateContext() { return true; } },
    directoryRepository: { async resolveSnapshotByOrganization() { return snapshot; } },
    bindingVerifier: { async verify({ client }) { assert.equal(client, physical); verifications++; } } });
  const queryModule = Object.freeze({ async execute({ client }) {
    captured = client; assert.equal(isPreparedTenantTransaction(client, expected), true);
    for (const fake of [{ ...client }, physical, {}]) assert.equal(isPreparedTenantTransaction(fake, expected), false);
    for (const mismatch of [{ tenantId: 'other' }, { organizationId: 'other' }, { workload: 'WORKER' }, { requiredCapabilities: ['ABSENT'] }]) {
      assert.equal(isPreparedTenantTransaction(client, { ...expected, ...mismatch }), false);
    }
    await client.query('SELECT 1'); return true;
  }, async beforeCommit({ client }) { beforeCommit++; assert.equal(client, captured); assert.equal(isPreparedTenantTransaction(client, expected), true); } });
  const lease = executor.issue({ allocation: { client: physical, deadline: clock.now() + 100, fence: 0, async release() {} },
    snapshot, organizationContext: { organizationId: snapshot.organizationId, membershipId: 'm', membershipVersion: 1 },
    operation: { queryModule, accessMode: 'WRITE', requiredCapabilities: ['SYNTHETIC_QUERY'] }, correlationId: 'synthetic' });
  assert.equal(await lease.execute({}), true); assert.equal(verifications, 2); assert.equal(beforeCommit, 1);
  assert.equal(isPreparedTenantTransaction(captured, expected), false);
  const count = sql.length; await assert.rejects(() => captured.query('SELECT 1')); assert.equal(sql.length, count);
});

test('snapshot comparison rejects generation, binding, destination, fence and capability drift', () => {
  const snapshot = validSnapshot();
  for (const change of [{ databaseGenerationId: 'other' }, { databaseRef: 'other' }, { credentialRef: 'other' },
    { observedSystemIdentifier: 'other' }, { bindingDigest: 'other' }, { fence: 2 },
    { schema: { schemaFingerprint: 'other' } }, { schema: { verifiedCapabilities: { SYNTHETIC_QUERY: false } } }]) {
    assert.equal(sameSnapshot(snapshot, validSnapshot(change)), false);
  }
});

test('editorial deferred seals run under functional role before reset; modules cannot control constraint timing', async () => {
  for (const failSeal of [false, true]) {
    const clock = createManualClock(), scheduler = createManualScheduler(clock), snapshot = validSnapshot(), sql = [];
    const physical = { async query(statement) {
      sql.push(statement);
      if (statement === 'SET CONSTRAINTS ALL IMMEDIATE' && failSeal) throw new Error('SYNTHETIC_SEAL_FAILURE');
      return { rows: statement.includes('pg_stat_activity') ? [{ pid: 1, backend_start: '2026-10-15T00:00:00.000Z' }] : [] };
    } };
    const executor = createTenantLeaseExecutor({ clock, scheduler, poolManager: { getFence: () => 0 },
      membershipRepository: { async revalidateContext() { return true; } },
      directoryRepository: { async resolveSnapshotByOrganization() { return snapshot; } },
      bindingVerifier: { async verify() {} } });
    const queryModule = Object.freeze({ async execute({ client }) {
      await client.query('SET LOCAL ROLE c4g_organization_profile_runtime');
      await assert.rejects(() => client.query('SET CONSTRAINTS ALL IMMEDIATE'), error => error.internalCode === 'TRANSACTION_BOUNDARY_VIOLATION');
      return true;
    }, beforeCommit: ({ client }) => client.query('RESET ROLE'), authorityGuard: { assert() {}, async complete() {} } });
    const lease = executor.issue({ allocation: { client: physical, deadline: clock.now() + 100, fence: 0, async release() {} },
      snapshot, organizationContext: { organizationId: snapshot.organizationId, membershipId: 'm', membershipVersion: 1 },
      operation: { ownerModule: 'F13_EDITORIAL_BASELINE', operationCode: 'F13_PROFILE_SUBMIT', queryModule, accessMode: 'WRITE',
        requiredCapabilities: ['SYNTHETIC_QUERY'] }, correlationId: 'synthetic' });
    if (failSeal) { await assert.rejects(() => lease.execute({})); assert.equal(sql.includes('COMMIT'), false); assert.ok(sql.includes('ROLLBACK')); }
    else { assert.equal(await lease.execute({}), true); assert.ok(sql.indexOf('SET CONSTRAINTS ALL IMMEDIATE') < sql.indexOf('RESET ROLE')); }
    assert.equal(sql.filter(line => line === 'SET CONSTRAINTS ALL IMMEDIATE').length, 1);
  }
});

test('opaque lease exposes no client or infrastructure and executes only its registered module', async () => {
  const { handle, releases } = setup();
  assert.deepEqual(Object.keys(handle).sort(), ['execute', 'release']);
  assert.equal(await handle.execute({ value: 1 }).then(value => value.value), 1);
  assert.equal(releases.length, 1);
  assert.equal(releases[0].discard, false);
  await assert.rejects(handle.execute({}), error => error.internalCode === 'LEASE_NOT_ACTIVE');
});

test('lease is single-use and rejects a concurrent execution before revalidation or query', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  let queryCalls = 0;
  let membershipCalls = 0;
  let markQueryStarted;
  const queryStarted = new Promise(resolve => { markQueryStarted = resolve; });
  let resolveQuery;
  const pendingQuery = new Promise(resolve => { resolveQuery = resolve; });
  const releases = [];
  const executor = createTenantLeaseExecutor({ clock, scheduler, poolManager: { getFence: () => 0 },
    membershipRepository: { async revalidateContext(value) { membershipCalls += 1; return value; } },
    directoryRepository: { async resolveSnapshotByOrganization() { return validSnapshot(); } } });
  const handle = executor.issue({ allocation: { client: {}, deadline: clock.now() + 100, fence: 0,
    async release(options) { releases.push(options); } }, snapshot: validSnapshot(),
    organizationContext: { organizationId: 'org-1', membershipId: 'm', membershipVersion: 1 },
    operation: { queryModule: Object.freeze({ execute() {
      queryCalls += 1;
      markQueryStarted();
      return pendingQuery;
    } }) }, correlationId: 'c' });
  const first = handle.execute({ request: 1 });
  await queryStarted;
  await assert.rejects(handle.execute({ request: 2 }), error => error.internalCode === 'LEASE_NOT_ACTIVE');
  assert.equal(membershipCalls, 1);
  assert.equal(queryCalls, 1);
  assert.equal(releases.length, 0);
  resolveQuery({ ok: true });
  assert.deepEqual(await first, { ok: true });
  assert.equal(releases.length, 1);
});

test('public release cannot free the client while lease execution is active', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  let markQueryStarted;
  const queryStarted = new Promise(resolve => { markQueryStarted = resolve; });
  let resolveQuery;
  const pendingQuery = new Promise(resolve => { resolveQuery = resolve; });
  const releases = [];
  const executor = createTenantLeaseExecutor({ clock, scheduler, poolManager: { getFence: () => 0 },
    membershipRepository: { async revalidateContext(value) { return value; } },
    directoryRepository: { async resolveSnapshotByOrganization() { return validSnapshot(); } } });
  const handle = executor.issue({ allocation: { client: {}, deadline: clock.now() + 100, fence: 0,
    async release(options) { releases.push(options); } }, snapshot: validSnapshot(),
    organizationContext: { organizationId: 'org-1', membershipId: 'm', membershipVersion: 1 },
    operation: { queryModule: Object.freeze({ execute() { markQueryStarted(); return pendingQuery; } }) }, correlationId: 'c' });
  const execution = handle.execute({});
  await queryStarted;
  await assert.rejects(handle.release(), error => error.internalCode === 'LEASE_IN_USE');
  assert.equal(releases.length, 0);
  resolveQuery('done');
  assert.equal(await execution, 'done');
  assert.equal(releases.length, 1);
});

test('executor revalidates membership and directory before the first functional query', async () => {
  for (const options of [{ eligible: false }, { current: validSnapshot({ bindingDigest: 'changed' }) }]) {
    const { handle, releases } = setup(options);
    await assert.rejects(handle.execute({}), error => error.internalCode === 'ORGANIZATION_MISMATCH'
      || error.internalCode === 'TRANSITION_CONFLICT');
    assert.equal(releases[0].discard, true);
  }
});

test('query failure discards the client and cleanup failure is aggregated', async () => {
  const primary = new Error('synthetic module failure');
  const state = setup({ queryError: primary });
  await assert.rejects(state.handle.execute({}), error => error.internalCode === 'TENANT_QUERY_FAILED'
    && !error.message.includes(primary.message));
  assert.equal(state.releases[0].discard, true);
});

test('query and release failures are aggregated without reporting success', async () => {
  const state = setup({ queryError: new Error('query canary'), releaseError: new Error('release canary') });
  await assert.rejects(state.handle.execute({}), error => error instanceof AggregateError
    && error.errors[0].internalCode === 'TENANT_QUERY_FAILED'
    && error.errors[1].internalCode === 'LEASE_CLEANUP_FAILED'
    && !error.errors[1].message.includes('release canary'));
  assert.equal(state.releases.length, 1);
});

test('query execution is rejected at the lease deadline and the late client is discarded', async () => {
  let started;
  const began = new Promise(resolve => { started = resolve; });
  const never = new Promise(() => {});
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  const releases = [];
  const executor = createTenantLeaseExecutor({ clock, scheduler, poolManager: { getFence: () => 0 },
    membershipRepository: { async revalidateContext(value) { return value; } },
    directoryRepository: { async resolveSnapshotByOrganization() { return validSnapshot(); } } });
  const handle = executor.issue({ allocation: { client: {}, deadline: clock.now() + 10, fence: 0,
    async release(options) { releases.push(options); } }, snapshot: validSnapshot(),
    organizationContext: { organizationId: 'org-1', membershipId: 'm', membershipVersion: 1 },
    operation: { queryModule: Object.freeze({ execute() { started(); return never; } }) }, correlationId: 'c' });
  const execution = handle.execute({});
  await began;
  await scheduler.advance(10);
  await assert.rejects(execution, error => error.internalCode === 'LEASE_TIMEOUT');
  assert.equal(releases[0].discard, true);
});

test('pre-query revalidation is bounded by the lease deadline and releases the client', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  const releases = [];
  const executor = createTenantLeaseExecutor({ clock, scheduler, poolManager: { getFence: () => 0 },
    membershipRepository: { revalidateContext() { return new Promise(() => {}); } },
    directoryRepository: { async resolveSnapshotByOrganization() { return validSnapshot(); } } });
  const handle = executor.issue({ allocation: { client: {}, deadline: clock.now() + 10, fence: 0,
    async release(options) { releases.push(options); } }, snapshot: validSnapshot(),
    organizationContext: { organizationId: 'org-1', membershipId: 'm', membershipVersion: 1 },
    operation: { queryModule: Object.freeze({ async execute() { throw new Error('query must not execute'); } }) }, correlationId: 'c' });
  const execution = handle.execute({});
  await Promise.resolve();
  await scheduler.advance(10);
  await assert.rejects(execution, error => error.internalCode === 'LEASE_TIMEOUT');
  assert.equal(releases.length, 1);
  assert.equal(releases[0].discard, true);
  assert.equal(scheduler.size, 0);
});

test('late pre-query continuations cannot execute after lease timeout', async t => {
  for (const phase of ['membership', 'directory']) await t.test(phase, async () => {
    const clock = createManualClock();
    const scheduler = createManualScheduler(clock);
    const releases = [];
    let queryCalls = 0;
    let resolveDeferred;
    let markStarted;
    const deferred = new Promise(resolve => { resolveDeferred = resolve; });
    const started = new Promise(resolve => { markStarted = resolve; });
    const executor = createTenantLeaseExecutor({ clock, scheduler, poolManager: { getFence: () => 0 },
      membershipRepository: { revalidateContext(value) {
        if (phase !== 'membership') return Promise.resolve(value);
        markStarted();
        return deferred;
      } },
      directoryRepository: { resolveSnapshotByOrganization() {
        if (phase !== 'directory') return Promise.resolve(validSnapshot());
        markStarted();
        return deferred;
      } } });
    const handle = executor.issue({ allocation: { client: {}, deadline: clock.now() + 10, fence: 0,
      async release(options) { releases.push(options); } }, snapshot: validSnapshot(),
      organizationContext: { organizationId: 'org-1', membershipId: 'm', membershipVersion: 1 },
      operation: { queryModule: Object.freeze({ async execute() { queryCalls += 1; } }) }, correlationId: 'c' });
    const execution = handle.execute({});
    await started;
    await scheduler.advance(10);
    await assert.rejects(execution, error => error.internalCode === 'LEASE_TIMEOUT');
    resolveDeferred(phase === 'membership' ? { organizationId: 'org-1' } : validSnapshot());
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    assert.equal(queryCalls, 0);
    assert.equal(releases.length, 1);
    assert.equal(releases[0].discard, true);
  });
});

test('pre-query repository failures are sanitized without leaking adapter details', async t => {
  const canary = 'postgresql://user:secret@private-host/private-db';
  for (const phase of ['membership', 'directory']) await t.test(phase, async () => {
    const clock = createManualClock();
    const scheduler = createManualScheduler(clock);
    const releases = [];
    const executor = createTenantLeaseExecutor({ clock, scheduler, poolManager: { getFence: () => 0 },
      membershipRepository: { async revalidateContext(value) {
        if (phase === 'membership') throw new Error(canary);
        return value;
      } },
      directoryRepository: { async resolveSnapshotByOrganization() {
        if (phase === 'directory') throw new Error(canary);
        return validSnapshot();
      } } });
    const handle = executor.issue({ allocation: { client: {}, deadline: clock.now() + 100, fence: 0,
      async release(options) { releases.push(options); } }, snapshot: validSnapshot(),
      organizationContext: { organizationId: 'org-1', membershipId: 'm', membershipVersion: 1 },
      operation: { queryModule: Object.freeze({ async execute() { throw new Error('query must not execute'); } }) }, correlationId: 'c' });
    await assert.rejects(handle.execute({}), error => {
      assert.equal(error.name, 'TenantRuntimeError');
      assert.equal(error.internalCode, phase === 'membership' ? 'ORGANIZATION_CONTEXT_UNAVAILABLE' : 'DIRECTORY_UNAVAILABLE');
      assert.doesNotMatch(error.message, /secret|private-host|private-db/);
      assert.doesNotMatch(JSON.stringify(error), /secret|private-host|private-db/);
      return true;
    });
    assert.equal(releases.length, 1);
    assert.equal(releases[0].discard, true);
  });
});

test('expired lease is refused before query', async () => {
  const expired = setup();
  expired.clock.advance(100);
  await assert.rejects(expired.handle.execute({}), error => error.internalCode === 'LEASE_TIMEOUT');
  assert.equal(expired.releases[0].discard, true);
});

test('fenced lease is refused before query', async () => {
  const fenced = setup({ currentFence: 2 });
  await assert.rejects(fenced.handle.execute({}), error => error.internalCode === 'TRANSITION_CONFLICT');
  assert.equal(fenced.releases[0].discard, true);
});

test('only privately branded runtime errors and cleanup aggregates cross execution boundaries', async t => {
  const canary = 'postgresql://forged:secret@private-host/private-db';
  const legitimate = tenantFailure('LEGITIMATE_RUNTIME_FAILURE', 'TENANT_NOT_AVAILABLE', { correlationId: 'safe' });
  const copied = {};
  Object.defineProperties(copied, Object.getOwnPropertyDescriptors(legitimate));
  Object.defineProperties(copied, {
    cause: { value: new Error(canary), enumerable: false },
    externalCanary: { value: canary, enumerable: true }
  });
  const prototypeOnly = Object.create(TenantRuntimeError.prototype);
  Object.defineProperties(prototypeOnly, {
    message: { value: canary, enumerable: false },
    stack: { value: canary, enumerable: false },
    cause: { value: new Error(canary), enumerable: false },
    externalCanary: { value: canary, enumerable: true }
  });
  const prototypeMutated = Object.assign(new Error(canary), {
    cause: new Error(canary), externalCanary: canary
  });
  Object.setPrototypeOf(prototypeMutated, TenantRuntimeError.prototype);
  const constructedExternally = new TenantRuntimeError('EXTERNAL_CONSTRUCTION', 'TENANT_NOT_AVAILABLE');
  constructedExternally.externalCanary = canary;
  const forgeries = [
    Object.assign(new Error(canary), { name: 'TenantRuntimeError', cause: new Error(canary), externalCanary: canary }),
    { name: 'TenantRuntimeError', code: 'TENANT_NOT_AVAILABLE', internalCode: 'FORGED',
      message: canary, stack: canary, cause: new Error(canary), externalCanary: canary },
    prototypeOnly,
    prototypeMutated,
    constructedExternally,
    copied,
    Object.assign(new AggregateError([new Error(canary)], canary), { externalCanary: canary }),
    aggregateCleanup(new Error(canary), tenantFailure('SAFE_CLEANUP'))
  ];
  for (const [index, forged] of forgeries.entries()) await t.test(`forgery-${index + 1}`, async () => {
    const state = setup({ queryError: forged });
    await assert.rejects(state.handle.execute({}), error => {
      assert.equal(error.internalCode, 'TENANT_QUERY_FAILED');
      assert.doesNotMatch(JSON.stringify(error), /forged:secret|private-host|private-db/);
      assert.doesNotMatch(require('node:util').inspect(error, { depth: 10, showHidden: true }),
        /forged:secret|private-host|private-db/);
      return true;
    });
  });
  await t.test('legitimate runtime failure', async () => {
    const state = setup({ queryError: legitimate });
    await assert.rejects(state.handle.execute({}), error => error === legitimate);
  });
  await t.test('legitimate cleanup aggregate', async () => {
    const aggregate = aggregateCleanup(tenantFailure('PRIMARY'), tenantFailure('CLEANUP'));
    const state = setup({ queryError: aggregate });
    await assert.rejects(state.handle.execute({}), error => error === aggregate);
  });
  await t.test('release boundary', async () => {
    const forged = Object.assign(new Error(canary), { name: 'TenantRuntimeError', cause: new Error(canary) });
    Object.setPrototypeOf(forged, TenantRuntimeError.prototype);
    const state = setup({ releaseError: forged });
    await assert.rejects(state.handle.execute({}), error => {
      assert.equal(error.internalCode, 'LEASE_CLEANUP_FAILED');
      assert.doesNotMatch(require('node:util').inspect(error, { depth: 10, showHidden: true }),
        /forged:secret|private-host|private-db/);
      return true;
    });
  });
});

test('lease timeout is not extended by a non-cooperative client cleanup', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  let markQueryStarted;
  const queryStarted = new Promise(resolve => { markQueryStarted = resolve; });
  let markReleaseStarted;
  const releaseStarted = new Promise(resolve => { markReleaseStarted = resolve; });
  const executor = createTenantLeaseExecutor({ clock, scheduler, poolManager: { getFence: () => 0 },
    membershipRepository: { async revalidateContext(value) { return value; } },
    directoryRepository: { async resolveSnapshotByOrganization() { return validSnapshot(); } } });
  const handle = executor.issue({ allocation: { client: {}, deadline: clock.now() + 10, fence: 0,
    release() { markReleaseStarted(); return new Promise(() => {}); } }, snapshot: validSnapshot(),
    organizationContext: { organizationId: 'org-1', membershipId: 'm', membershipVersion: 1 },
    operation: { queryModule: Object.freeze({ execute() {
      markQueryStarted();
      return new Promise(() => {});
    } }) }, correlationId: 'c' });
  const execution = handle.execute({});
  await queryStarted;
  await scheduler.advance(10);
  await releaseStarted;
  await assert.rejects(execution, error => error.internalCode === 'LEASE_TIMEOUT');
  assert.equal(scheduler.size, 0);
});

test('client cleanup started after a successful query is bounded by the lease deadline', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  let markReleaseStarted;
  const releaseStarted = new Promise(resolve => { markReleaseStarted = resolve; });
  const executor = createTenantLeaseExecutor({ clock, scheduler, poolManager: { getFence: () => 0 },
    membershipRepository: { async revalidateContext(value) { return value; } },
    directoryRepository: { async resolveSnapshotByOrganization() { return validSnapshot(); } } });
  const handle = executor.issue({ allocation: { client: {}, deadline: clock.now() + 10, fence: 0,
    release() { markReleaseStarted(); return new Promise(() => {}); } }, snapshot: validSnapshot(),
    organizationContext: { organizationId: 'org-1', membershipId: 'm', membershipVersion: 1 },
    operation: { queryModule: Object.freeze({ async execute() { return 'done'; } }) }, correlationId: 'c' });
  const execution = handle.execute({});
  await releaseStarted;
  await scheduler.advance(10);
  await assert.rejects(execution, error => error.internalCode === 'LEASE_CLEANUP_TIMEOUT');
  assert.equal(scheduler.size, 0);
});
