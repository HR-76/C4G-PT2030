const assert = require('node:assert/strict');
const test = require('node:test');
const { createTenantPoolManager: createRawTenantPoolManager, validatePolicy } = require('../src/security/tenantPoolManager');
const { createManualClock, createManualScheduler, createPoolFactory } = require('./support/tenantRuntimeDoubles');

function credentialLease(material = {},workload) {
  return { workload,material, async dispose() {} };
}
function createTenantPoolManager(options){return createRawTenantPoolManager(options);}

function setup(overrides = {}) {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  const pools = createPoolFactory(overrides);
  const rawManager = createRawTenantPoolManager({ poolFactory: pools.factory, clock, scheduler, jitter: () => 0,
    policy: { globalLimit: 3, perTenantLimit: 2, operationalReserve: 1,
      globalQueueLimit: 8, perTenantQueueLimit: 4, operationalQueueReserve: 1, acquireTimeoutMs: 10,
      leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  const manager=rawManager;
  return { clock, scheduler, pools, manager,rawManager };
}

test('API/WORKER pools and fences are independent',async()=>{
 const {rawManager,pools}=setup(),base={tenantId: 'tenant-workload', workload: 'API', connectionVersion:1,workloadClass:'FUNCTIONAL',correlationId:'workload'};
 const api=await rawManager.acquire({...base,workload:'API',credentialLease:credentialLease({},'API')});
 const worker=await rawManager.acquire({...base,workload:'WORKER',credentialLease:credentialLease({},'WORKER')});
 assert.equal(pools.calls.length,2);assert.notEqual(pools.calls[0].workload,pools.calls[1].workload);
 await rawManager.drainVersion({tenantId:base.tenantId,workload:'API',connectionVersion:1});
 assert.equal(rawManager.getFence(base.tenantId,'API'),1);assert.equal(rawManager.getFence(base.tenantId,'WORKER'),0);
 await api.release();await worker.release();await rawManager.closeAll();
});

test('pool acquisition fails closed without an exact workload binding',async()=>{
 const {rawManager}=setup(),request={tenantId: 'tenant-workload', connectionVersion:1,workloadClass:'FUNCTIONAL',correlationId:'workload'};
 await assert.rejects(rawManager.acquire({...request,credentialLease:credentialLease({},'API')}),/workload/i);
 await assert.rejects(rawManager.acquire({...request,workload:'WORKER',credentialLease:credentialLease({},'API')}),/workload binding/i);
 await rawManager.closeAll();
});

test('drain and revoke require an explicit valid workload',async()=>{
 const {rawManager}=setup();
 const version={tenantId:'tenant-workload',connectionVersion:1};
 await assert.rejects(rawManager.drainVersion(version),/workload/i);
 await assert.rejects(rawManager.revokeVersion(version),/workload/i);
 await assert.rejects(rawManager.drainVersion({...version,workload:''}),/workload/i);
 await assert.rejects(rawManager.revokeVersion({...version,workload:'UNKNOWN'}),/workload/i);
 assert.equal(rawManager.getFence(version.tenantId,'API'),0);
 assert.equal(rawManager.getFence(version.tenantId,'WORKER'),0);
 await rawManager.closeAll();
});

test('queue limits and operational queue reserve are mandatory consistent policy', () => {
  const policy = { globalLimit: 3, perTenantLimit: 2, operationalReserve: 1,
    globalQueueLimit: 4, perTenantQueueLimit: 2, operationalQueueReserve: 1, acquireTimeoutMs: 10,
    leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
    circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 };
  assert.equal(validatePolicy(policy).globalQueueLimit, 4);
  assert.throws(() => validatePolicy({ ...policy, globalQueueLimit: undefined }), /globalQueueLimit/);
  assert.throws(() => validatePolicy({ ...policy, perTenantQueueLimit: 5 }), /inconsistent/);
  assert.throws(() => validatePolicy({ ...policy, operationalQueueReserve: 4 }), /inconsistent/);
});

test('pool creation is single-flight per tenant and version and isolated across versions', async () => {
  const { manager, pools } = setup();
  const request = { tenantId: 'tenant-a', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL', credentialLease: credentialLease({},'API'), correlationId: 'c' };
  const [first, second] = await Promise.all([manager.acquire(request), manager.acquire(request)]);
  assert.equal(pools.calls.length, 1);
  await first.release();
  await second.release();
  const third = await manager.acquire({ ...request, connectionVersion: 2 });
  assert.equal(pools.calls.length, 2);
  await third.release();
  await manager.closeAll();
});

test('single-flight creation survives one waiter timeout and serves another waiter with its own deadline', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  let continueFactory;
  let markStarted;
  let factoryCalls = 0;
  let sharedSignal;
  const started = new Promise(resolve => { markStarted = resolve; });
  const gate = new Promise(resolve => { continueFactory = resolve; });
  const firstMaterial = { valid: true };
  const secondMaterial = { valid: true };
  let firstDisposals = 0;
  let secondDisposals = 0;
  const firstCredential = { material: firstMaterial, async dispose() {
    firstDisposals += 1;
    firstMaterial.valid = false;
  } };
  const secondCredential = { material: secondMaterial, async dispose() {
    secondDisposals += 1;
    secondMaterial.valid = false;
  } };
  const manager = createTenantPoolManager({ clock, scheduler, jitter: () => 0,
    poolFactory: async options => {
      factoryCalls += 1;
      sharedSignal = options.signal;
      markStarted();
      await gate;
      if (!options.credentialMaterial.valid) throw new Error('credential material was disposed too early');
      return { async connect() { return { release() {} }; }, async end() {} };
    },
    policy: { globalLimit: 3, perTenantLimit: 2, operationalReserve: 1,
      globalQueueLimit: 4, perTenantQueueLimit: 2, operationalQueueReserve: 1, acquireTimeoutMs: 10,
      leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  const request = (correlationId, lease) => ({ tenantId: 'tenant-a', workload: 'API', connectionVersion: 1,
    workloadClass: 'FUNCTIONAL', credentialLease: lease, correlationId });
  const first = manager.acquire(request('first', firstCredential));
  await started;
  await scheduler.advance(5);
  const second = manager.acquire(request('second', secondCredential));
  await scheduler.advance(5);
  await assert.rejects(first, error => error.internalCode === 'POOL_EXHAUSTED');
  assert.equal(sharedSignal.aborted, false);
  assert.equal(firstDisposals, 0);
  assert.equal(firstMaterial.valid, true);
  continueFactory();
  const lease = await second;
  assert.equal(factoryCalls, 1);
  assert.equal(firstDisposals, 1);
  assert.equal(secondDisposals, 1);
  await lease.release();
  await manager.closeAll();
  assert.equal(manager.snapshot().active, 0);
});

test('one physical single-flight failure counts once regardless of waiter count', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  let rejectPool;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const physical = new Promise((resolve, reject) => { rejectPool = reject; });
  const manager = createTenantPoolManager({ clock, scheduler, jitter: () => 0,
    poolFactory: () => { markStarted(); return physical; },
    policy: { globalLimit: 3, perTenantLimit: 2, operationalReserve: 1,
      globalQueueLimit: 4, perTenantQueueLimit: 2, operationalQueueReserve: 1, acquireTimeoutMs: 20,
      leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  const request = correlationId => ({ tenantId: 'tenant-a', workload: 'API', connectionVersion: 1,
    workloadClass: 'FUNCTIONAL', credentialLease: credentialLease({},'API'), correlationId });
  const first = manager.acquire(request('first'));
  const second = manager.acquire(request('second'));
  await started;
  rejectPool(new Error('synthetic physical failure'));
  await assert.rejects(first, error => error.internalCode === 'TENANT_UNREACHABLE');
  await assert.rejects(second, error => error.internalCode === 'TENANT_UNREACHABLE');
  await assert.rejects(manager.acquire(request('retry')), error => error.internalCode === 'RETRY_BACKOFF');
  clock.advance(5);
  await assert.rejects(manager.acquire(request('after-backoff')), error => error.internalCode !== 'CIRCUIT_OPEN');
  await manager.closeAll();
});

test('invalid pool factory results are closed before rejection', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  let ends = 0;
  const manager = createTenantPoolManager({ clock, scheduler, jitter: () => 0,
    poolFactory: async () => ({ async end() { ends += 1; } }),
    policy: { globalLimit: 1, perTenantLimit: 1, operationalReserve: 0,
      globalQueueLimit: 2, perTenantQueueLimit: 1, operationalQueueReserve: 1, acquireTimeoutMs: 10,
      leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  await assert.rejects(manager.acquire({ tenantId: 'a', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
    credentialLease: credentialLease({},'API'), correlationId: 'invalid' }), error => error.internalCode === 'INVALID_POOL_RESULT');
  assert.equal(ends, 1);
  await manager.closeAll();
  assert.equal(manager.snapshot().active, 0);
});

test('invalid pool cleanup failure is sanitized, aggregated and observable', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  const manager = createTenantPoolManager({ clock, scheduler, jitter: () => 0,
    poolFactory: async () => ({ async end() { throw new Error('synthetic driver cleanup detail'); } }),
    policy: { globalLimit: 1, perTenantLimit: 1, operationalReserve: 0,
      globalQueueLimit: 2, perTenantQueueLimit: 1, operationalQueueReserve: 1, acquireTimeoutMs: 10,
      leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  await assert.rejects(manager.acquire({ tenantId: 'a', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
    credentialLease: credentialLease({},'API'), correlationId: 'invalid-cleanup' }), error => {
    assert.equal(error.name, 'AggregateError');
    assert.deepEqual(error.errors.map(item => item.internalCode), ['INVALID_POOL_RESULT', 'POOL_CLEANUP_FAILED']);
    assert.doesNotMatch(error.message, /driver|detail/);
    return true;
  });
  assert.equal(manager.snapshot().cleanupFailures, 1);
  await assert.rejects(manager.closeAll(), error => error instanceof AggregateError);
});

test('functional load preserves the operational reserve and queued acquisition times out', async () => {
  const { manager, scheduler } = setup();
  const first = await manager.acquire({ tenantId: 'a', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL', credentialLease: credentialLease({},'API'), correlationId: '1' });
  const second = await manager.acquire({ tenantId: 'b', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL', credentialLease: credentialLease({},'API'), correlationId: '2' });
  const waiting = manager.acquire({ tenantId: 'c', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL', credentialLease: credentialLease({},'API'), correlationId: '3' });
  const operational = await manager.acquire({ tenantId: 'ops', workload: 'API', connectionVersion: 1, workloadClass: 'OPERATIONAL', credentialLease: credentialLease({},'API'), correlationId: '4' });
  await scheduler.advance(10);
  await assert.rejects(waiting, error => error.internalCode === 'POOL_EXHAUSTED');
  await Promise.all([first.release(), second.release(), operational.release()]);
  await manager.closeAll();
});

test('bounded queue enforces tenant and global limits while preserving operational queue reserve', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  const pools = createPoolFactory();
  const manager = createTenantPoolManager({ poolFactory: pools.factory, clock, scheduler, jitter: () => 0,
    policy: { globalLimit: 3, perTenantLimit: 2, operationalReserve: 1,
      globalQueueLimit: 4, perTenantQueueLimit: 1, operationalQueueReserve: 1, acquireTimeoutMs: 10,
      leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  const request = (tenantId, workloadClass = 'FUNCTIONAL') => ({ tenantId, workload: 'API', connectionVersion: 1,
    workloadClass, credentialLease: credentialLease({ synthetic: tenantId }), correlationId: tenantId });
  const first = await manager.acquire(request('active-a'));
  const second = await manager.acquire(request('active-b'));
  const reserved = await manager.acquire(request('active-ops', 'OPERATIONAL'));
  const queued = [manager.acquire(request('a')), manager.acquire(request('b')), manager.acquire(request('c'))];
  await assert.rejects(manager.acquire(request('a')), error => error.internalCode === 'POOL_EXHAUSTED');
  await assert.rejects(manager.acquire(request('d')), error => error.internalCode === 'POOL_EXHAUSTED');
  queued.push(manager.acquire(request('ops', 'OPERATIONAL')));
  await assert.rejects(manager.acquire(request('extra-ops', 'OPERATIONAL')),
    error => error.internalCode === 'POOL_EXHAUSTED');
  assert.equal(manager.snapshot().queued, 4);
  await scheduler.advance(10);
  await Promise.all(queued.map(acquisition => assert.rejects(acquisition,
    error => error.internalCode === 'POOL_EXHAUSTED')));
  await first.release();
  await second.release();
  await reserved.release();
  await manager.closeAll();
});

test('credential ownership is disposed once on queue refusal and queued timeout', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  const pools = createPoolFactory();
  const manager = createTenantPoolManager({ poolFactory: pools.factory, clock, scheduler, jitter: () => 0,
    policy: { globalLimit: 1, perTenantLimit: 1, operationalReserve: 0,
      globalQueueLimit: 1, perTenantQueueLimit: 1, operationalQueueReserve: 0, acquireTimeoutMs: 10,
      leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  const active = await manager.acquire({ tenantId: 'active', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
    credentialLease: credentialLease({},'API'), correlationId: 'active' });
  let queuedDisposals = 0;
  let refusedDisposals = 0;
  const queued = manager.acquire({ tenantId: 'queued', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
    credentialLease: { material: {}, async dispose() { queuedDisposals += 1; } }, correlationId: 'queued' });
  await assert.rejects(manager.acquire({ tenantId: 'refused', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
    credentialLease: { material: {}, async dispose() { refusedDisposals += 1; } }, correlationId: 'refused' }),
  error => error.internalCode === 'POOL_EXHAUSTED');
  assert.equal(refusedDisposals, 1);
  await scheduler.advance(10);
  await assert.rejects(queued, error => error.internalCode === 'POOL_EXHAUSTED');
  assert.equal(queuedDisposals, 1);
  await active.release();
  await manager.closeAll();
});

test('pre-acquisition refusals reject before credential disposal settles', async t => {
  await t.test('closed manager', async () => {
    const { manager } = setup();
    await manager.closeAll();
    let finishDisposal;
    const disposal = new Promise(resolve => { finishDisposal = resolve; });
    const refused = manager.acquire({ tenantId: 'closed', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
      credentialLease: { material: {}, dispose: () => disposal }, correlationId: 'closed' });
    await assert.rejects(refused, error => error.internalCode === 'POOL_CLOSED');
    assert.equal(manager.snapshot().credentialDisposalsPending, 1);
    finishDisposal();
    for (let index = 0; index < 10 && manager.snapshot().credentialDisposalsPending; index += 1) await Promise.resolve();
    assert.equal(manager.snapshot().credentialDisposalsPending, 0);
  });
  await t.test('invalid acquisition', async () => {
    const { manager } = setup();
    let finishDisposal;
    const disposal = new Promise(resolve => { finishDisposal = resolve; });
    const refused = manager.acquire({ tenantId: null, workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
      credentialLease: { material: {}, dispose: () => disposal }, correlationId: 'invalid' });
    await assert.rejects(refused, error => error instanceof TypeError && error.message === 'Tenant pool acquisition is invalid.');
    assert.equal(manager.snapshot().credentialDisposalsPending, 1);
    finishDisposal();
    for (let index = 0; index < 10 && manager.snapshot().credentialDisposalsPending; index += 1) await Promise.resolve();
    await manager.closeAll();
  });
  await t.test('queue exhausted and late disposal failure', async () => {
    const clock = createManualClock();
    const scheduler = createManualScheduler(clock);
    const pools = createPoolFactory();
    const manager = createTenantPoolManager({ poolFactory: pools.factory, clock, scheduler, jitter: () => 0,
      policy: { globalLimit: 1, perTenantLimit: 1, operationalReserve: 0,
        globalQueueLimit: 1, perTenantQueueLimit: 1, operationalQueueReserve: 0, acquireTimeoutMs: 10,
        leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
        circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
    const active = await manager.acquire({ tenantId: 'active', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
      credentialLease: credentialLease({},'API'), correlationId: 'active' });
    const queued = manager.acquire({ tenantId: 'queued', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
      credentialLease: credentialLease({},'API'), correlationId: 'queued' });
    let rejectDisposal;
    const disposal = new Promise((resolve, reject) => { rejectDisposal = reject; });
    const unhandled = [];
    const onUnhandled = reason => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const refused = manager.acquire({ tenantId: 'refused', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
        credentialLease: { material: {}, dispose: () => disposal }, correlationId: 'refused' });
      await assert.rejects(refused, error => error.internalCode === 'POOL_EXHAUSTED');
      assert.equal(manager.snapshot().credentialDisposalsPending, 1);
      rejectDisposal(new Error('credential://synthetic-secret@private-host'));
      for (let index = 0; index < 20 && (manager.snapshot().credentialDisposalsPending
        || manager.snapshot().credentialCleanupFailures === 0); index += 1) await Promise.resolve();
      assert.equal(manager.snapshot().credentialDisposalsPending, 0);
      assert.equal(manager.snapshot().credentialCleanupFailures, 1);
      assert.equal(unhandled.length, 0);
      await scheduler.advance(10);
      await assert.rejects(queued, error => error.internalCode === 'POOL_EXHAUSTED');
      await active.release();
      await assert.rejects(manager.closeAll(), error => {
        assert.doesNotMatch(require('node:util').inspect(error, { depth: 10 }), /synthetic-secret|private-host/);
        return true;
      });
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

test('draining fences old leases, blocks new acquisition and closes after release', async () => {
  const { manager, pools, scheduler } = setup();
  const request = { tenantId: 'tenant-a', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL', credentialLease: credentialLease({},'API'), correlationId: 'c' };
  const lease = await manager.acquire(request);
  await manager.drainVersion({ tenantId: 'tenant-a', workload: 'API', connectionVersion: 1 });
  await assert.rejects(manager.acquire(request), error => error.internalCode === 'CONNECTION_NOT_AVAILABLE');
  await lease.release();
  assert.equal(pools.pools[0].ended, true);
  assert.equal(scheduler.size, 0);
  await assert.rejects(manager.acquire(request), error => error.internalCode === 'CONNECTION_NOT_AVAILABLE');
  await manager.closeAll();
});

test('blocked tenant cannot recreate a pool while another tenant remains available', async () => {
  const { manager } = setup();
  const fences = await manager.blockTenant('tenant-a');
  assert.deepEqual(await manager.blockTenant('tenant-a'), fences);
  const request = tenantId => ({ tenantId, workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
    credentialLease: credentialLease({},'API'), correlationId: tenantId });
  await assert.rejects(manager.acquire(request('tenant-a')), error => error.internalCode === 'CONNECTION_NOT_AVAILABLE');
  await assert.rejects(manager.acquire({ ...request('tenant-a'), workload:'WORKER', credentialLease:credentialLease({},'WORKER') }), error => error.internalCode === 'CONNECTION_NOT_AVAILABLE');
  assert.throws(()=>manager.allowTenant({tenantId:'tenant-a',workloads:{API:{connectionVersion:2,expectedFence:fences.API.fence}}}),error=>error.internalCode==='TRANSITION_CONFLICT');
  const allowed=manager.allowTenant({tenantId:'tenant-a',workloads:{API:{connectionVersion:2,expectedFence:fences.API.fence},WORKER:{connectionVersion:2,expectedFence:fences.WORKER.fence}}});
  assert.deepEqual(allowed,{API:fences.API.fence,WORKER:fences.WORKER.fence});
  const restored = await manager.acquire({ ...request('tenant-a'), connectionVersion: 2 });
  const other = await manager.acquire(request('tenant-b'));
  await restored.release();
  await other.release();
  await manager.closeAll();
});

test('cutover drains the old version while new leases use only the new version', async () => {
  const { manager, pools } = setup();
  const base = { tenantId: 'tenant-a', workload: 'API', workloadClass: 'FUNCTIONAL', credentialLease: credentialLease({},'API'), correlationId: 'c' };
  const oldLease = await manager.acquire({ ...base, connectionVersion: 1 });
  await manager.drainVersion({ tenantId: 'tenant-a', workload: 'API', connectionVersion: 1 });
  const fence = manager.getFence('tenant-a','API');
  await manager.drainVersion({ tenantId: 'tenant-a', workload: 'API', connectionVersion: 1 });
  assert.equal(manager.getFence('tenant-a','API'), fence);
  const newLease = await manager.acquire({ ...base, connectionVersion: 2 });
  assert.equal(newLease.connectionVersion, 2);
  await oldLease.release();
  await assert.rejects(manager.acquire({ ...base, connectionVersion: 1 }),
    error => error.internalCode === 'CONNECTION_NOT_AVAILABLE');
  await newLease.release();
  assert.deepEqual(pools.calls.map(call => call.connectionVersion), [1, 2]);
  await manager.closeAll();
});

test('workload block can be reconstructed without defaulting to API',async()=>{
 const first=setup(),state=await first.manager.blockWorkload('tenant-restart','WORKER');
 await first.manager.closeAll();
 const second=setup();second.manager.synchronizeBlocked(state);
 await assert.rejects(second.manager.acquire({tenantId:'tenant-restart',workload:'WORKER',connectionVersion:1,workloadClass:'FUNCTIONAL',credentialLease:credentialLease({},'WORKER'),correlationId:'restart'}),error=>error.internalCode==='CONNECTION_NOT_AVAILABLE');
 const api=await second.manager.acquire({tenantId:'tenant-restart',workload:'API',connectionVersion:1,workloadClass:'FUNCTIONAL',credentialLease:credentialLease({},'API'),correlationId:'api'});await api.release();
 assert.equal(second.manager.allowWorkload({tenantId:'tenant-restart',workload:'WORKER',connectionVersion:2,expectedFence:state.fence}),state.fence);
 const worker=await second.manager.acquire({tenantId:'tenant-restart',workload:'WORKER',connectionVersion:2,workloadClass:'FUNCTIONAL',credentialLease:credentialLease({},'WORKER'),correlationId:'worker'});await worker.release();await second.manager.closeAll();
});

test('circuit breaker is isolated per tenant and open calls do not postpone half-open recovery', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  const failures = new Map();
  const poolFactory = async ({ tenantId }) => ({
    async connect() {
      if (tenantId === 'bad' && (failures.get(tenantId) || 0) < 2) {
        failures.set(tenantId, (failures.get(tenantId) || 0) + 1);
        throw new Error('synthetic connect failure');
      }
      return { release() {} };
    },
    async end() {}
  });
  const manager = createTenantPoolManager({ poolFactory, clock, scheduler, jitter: () => 0,
    policy: { globalLimit: 3, perTenantLimit: 2, operationalReserve: 1,
      globalQueueLimit: 8, perTenantQueueLimit: 4, operationalQueueReserve: 1, acquireTimeoutMs: 10,
      leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  const request = tenantId => ({ tenantId, workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
    credentialLease: credentialLease({},'API'), correlationId: tenantId });
  await assert.rejects(manager.acquire(request('bad')));
  await assert.rejects(manager.acquire(request('bad')), error => error.internalCode === 'RETRY_BACKOFF');
  clock.advance(5);
  await assert.rejects(manager.acquire(request('bad')));
  await assert.rejects(manager.acquire(request('bad')), error => error.internalCode === 'CIRCUIT_OPEN');
  const healthy = await manager.acquire(request('good'));
  await healthy.release();
  clock.advance(50);
  const recovered = await manager.acquire(request('bad'));
  await recovered.release();
  await manager.closeAll();
});

test('circuit breaker scope includes workload and connection version', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  const attempts = new Map();
  const manager = createTenantPoolManager({
    poolFactory: async ({ workload, connectionVersion }) => ({
      async connect() {
        const key = `${workload}:${connectionVersion}`;
        attempts.set(key, (attempts.get(key) || 0) + 1);
        if (key === 'API:1') throw new Error('synthetic old-version failure');
        return { release() {} };
      },
      async end() {}
    }),
    clock, scheduler, jitter: () => 0,
    policy: { globalLimit: 4, perTenantLimit: 3, operationalReserve: 1,
      globalQueueLimit: 8, perTenantQueueLimit: 4, operationalQueueReserve: 1,
      acquireTimeoutMs: 10, leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15,
      circuitFailureThreshold: 1, circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 }
  });
  const request = (workload, connectionVersion) => ({ tenantId: 'same-tenant', workload, connectionVersion,
    workloadClass: 'FUNCTIONAL', credentialLease: credentialLease({}, workload), correlationId: `${workload}-${connectionVersion}` });
  await assert.rejects(manager.acquire(request('API', 1)));
  await assert.rejects(manager.acquire(request('API', 1)), error => error.internalCode === 'CIRCUIT_OPEN');
  const newApi = await manager.acquire(request('API', 2));
  const worker = await manager.acquire(request('WORKER', 1));
  await newApi.release();
  await worker.release();
  assert.equal(attempts.get('API:2'), 1);
  assert.equal(attempts.get('WORKER:1'), 1);
  await manager.closeAll();
});

test('idle pools close deterministically and leave an empty inventory', async () => {
  const { manager, scheduler, pools } = setup();
  const lease = await manager.acquire({ tenantId: 'a', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL', credentialLease: credentialLease({},'API'), correlationId: 'c' });
  await lease.release();
  await scheduler.advance(30);
  assert.equal(pools.pools[0].ended, true);
  assert.deepEqual(manager.snapshot(), { active: 0, queued: 0, pools: 0, tenants: 0, circuitsOpen: 0,
    credentialDisposalsPending: 0, credentialCleanupTimeouts: 0, credentialCleanupFailures: 0,
    cleanupFailures: 0 });
  await manager.closeAll();
});

test('acquisition timeout covers a hung pool factory after queue dispatch', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  let aborted = false;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const manager = createTenantPoolManager({ clock, scheduler, jitter: () => 0,
    poolFactory: async ({ signal }) => new Promise((resolve, reject) => {
      markStarted();
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
    }),
    policy: { globalLimit: 3, perTenantLimit: 2, operationalReserve: 1,
      globalQueueLimit: 8, perTenantQueueLimit: 4, operationalQueueReserve: 1, acquireTimeoutMs: 10,
      leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  const acquisition = manager.acquire({ tenantId: 'a', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
    credentialLease: credentialLease({},'API'), correlationId: 'c' });
  await started;
  await scheduler.advance(10);
  await assert.rejects(acquisition, error => error.internalCode === 'POOL_EXHAUSTED');
  for (let index = 0; index < 10 && manager.snapshot().active !== 0; index += 1) await Promise.resolve();
  assert.equal(aborted, true);
  assert.equal(manager.snapshot().active, 0);
  await manager.closeAll();
});

test('shutdown cancellation of an in-flight pool creation is expected and does not fail closeAll', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const manager = createTenantPoolManager({ clock, scheduler, jitter: () => 0,
    poolFactory: ({ signal }) => new Promise((resolve, reject) => {
      markStarted();
      signal.addEventListener('abort', () => reject(new Error('synthetic expected cancellation')), { once: true });
    }),
    policy: { globalLimit: 1, perTenantLimit: 1, operationalReserve: 0,
      globalQueueLimit: 2, perTenantQueueLimit: 1, operationalQueueReserve: 1, acquireTimeoutMs: 100,
      leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  const acquisition = manager.acquire({ tenantId: 'a', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
    credentialLease: credentialLease({},'API'), correlationId: 'close' });
  await started;
  await manager.closeAll();
  await assert.rejects(acquisition, error => error.internalCode === 'POOL_CLOSED');
  assert.deepEqual(manager.snapshot(), { active: 0, queued: 0, pools: 0, tenants: 0,
    circuitsOpen: 0, credentialDisposalsPending: 0, credentialCleanupTimeouts: 0,
    credentialCleanupFailures: 0, cleanupFailures: 0 });
});

test('shutdown reports a bounded failure while a pool factory ignores abort', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  const manager = createTenantPoolManager({ clock, scheduler, jitter: () => 0,
    poolFactory: async () => new Promise(() => {}),
    policy: { globalLimit: 3, perTenantLimit: 2, operationalReserve: 1,
      globalQueueLimit: 8, perTenantQueueLimit: 4, operationalQueueReserve: 1, acquireTimeoutMs: 10,
      leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  const acquisition = manager.acquire({ tenantId: 'a', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
    credentialLease: credentialLease({},'API'), correlationId: 'c' });
  await scheduler.advance(10);
  await assert.rejects(acquisition, error => error.internalCode === 'POOL_EXHAUSTED');
  let closeSettled = false;
  const closing = manager.closeAll().finally(() => { closeSettled = true; });
  for (let index = 0; index < 20 && scheduler.size === 0; index += 1) await Promise.resolve();
  assert.equal(closeSettled, false);
  assert.equal(scheduler.size, 1);
  await scheduler.advance(15);
  await assert.rejects(closing, error => error.internalCode === 'PHYSICAL_CLEANUP_TIMEOUT');
  assert.equal(manager.snapshot().active, 1);
});

test('a client arriving after acquisition timeout is discarded exactly once', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  let resolveClient;
  let markConnectStarted;
  let markReleased;
  const connectStarted = new Promise(resolve => { markConnectStarted = resolve; });
  const released = new Promise(resolve => { markReleased = resolve; });
  const connected = new Promise(resolve => { resolveClient = resolve; });
  const releases = [];
  const manager = createTenantPoolManager({ clock, scheduler, jitter: () => 0,
    poolFactory: async () => ({ async connect() { markConnectStarted(); return connected; }, async end() {} }),
    policy: { globalLimit: 3, perTenantLimit: 2, operationalReserve: 1,
      globalQueueLimit: 8, perTenantQueueLimit: 4, operationalQueueReserve: 1, acquireTimeoutMs: 10,
      leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  const acquisition = manager.acquire({ tenantId: 'a', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
    credentialLease: credentialLease({},'API'), correlationId: 'c' });
  await connectStarted;
  await scheduler.advance(10);
  await assert.rejects(acquisition, error => error.internalCode === 'POOL_EXHAUSTED');
  resolveClient({ release(error) { releases.push(error); markReleased(); } });
  await released;
  assert.equal(releases.length, 1);
  assert.equal(releases[0].internalCode, 'ACQUIRE_TIMEOUT');
  await manager.closeAll();
});

test('lifecycle and shutdown cancel an acquisition whose connect is still pending', async t => {
  for (const action of ['revoke', 'block', 'close']) await t.test(action, async () => {
    const clock = createManualClock();
    const scheduler = createManualScheduler(clock);
    let resolveClient;
    let markConnectStarted;
    const connectStarted = new Promise(resolve => { markConnectStarted = resolve; });
    const connected = new Promise(resolve => { resolveClient = resolve; });
    let markLateRelease;
    const lateReleased = new Promise(resolve => { markLateRelease = resolve; });
    const releases = [];
    const manager = createTenantPoolManager({ clock, scheduler, jitter: () => 0,
      poolFactory: async () => ({ connect() { markConnectStarted(); return connected; }, async end() {} }),
      policy: { globalLimit: 2, perTenantLimit: 1, operationalReserve: 0,
        globalQueueLimit: 8, perTenantQueueLimit: 4, operationalQueueReserve: 1, acquireTimeoutMs: 100,
        leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
        circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
    const acquisition = manager.acquire({ tenantId: 'a', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
      credentialLease: credentialLease({},'API'), correlationId: 'c' });
    await connectStarted;
    let closing = null;
    if (action === 'revoke') await manager.revokeVersion({ tenantId: 'a', workload: 'API', connectionVersion: 1 });
    else if (action === 'block') await manager.blockTenant('a');
    else closing = manager.closeAll();
    await assert.rejects(acquisition, error => action === 'close'
      ? error.internalCode === 'POOL_CLOSED' : error.internalCode === 'CONNECTION_NOT_AVAILABLE');
    resolveClient({ release(error) { releases.push(error); markLateRelease(); } });
    await lateReleased;
    if (closing) await closing;
    for (let index = 0; index < 10 && manager.snapshot().active !== 0; index += 1) await Promise.resolve();
    assert.equal(releases.length, 1);
    assert.equal(releases[0].internalCode, action === 'close' ? 'POOL_CLOSED' : 'CONNECTION_NOT_AVAILABLE');
    assert.equal(manager.snapshot().active, 0);
    if (action !== 'close') await manager.closeAll();
  });
});

test('a hung physical connect remains budgeted and its timeout activates backoff', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  let connects = 0;
  let markConnectStarted;
  const connectStarted = new Promise(resolve => { markConnectStarted = resolve; });
  let resolveClient;
  const connected = new Promise(resolve => { resolveClient = resolve; });
  let markLateRelease;
  const lateReleased = new Promise(resolve => { markLateRelease = resolve; });
  const manager = createTenantPoolManager({ clock, scheduler, jitter: () => 0,
    poolFactory: async () => ({ connect() { connects += 1; markConnectStarted(); return connected; }, async end() {} }),
    policy: { globalLimit: 1, perTenantLimit: 1, operationalReserve: 0,
      globalQueueLimit: 8, perTenantQueueLimit: 4, operationalQueueReserve: 1, acquireTimeoutMs: 10,
      leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  const request = { tenantId: 'a', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
    credentialLease: credentialLease({},'API'), correlationId: 'c' };
  const first = manager.acquire(request);
  await connectStarted;
  await scheduler.advance(10);
  await assert.rejects(first, error => error.internalCode === 'POOL_EXHAUSTED');
  assert.equal(manager.snapshot().active, 1);
  const retry = manager.acquire(request);
  assert.equal(connects, 1);
  assert.equal(manager.snapshot().active, 1);
  resolveClient({ release() { markLateRelease(); } });
  await lateReleased;
  await assert.rejects(retry, error => error.internalCode === 'RETRY_BACKOFF');
  assert.equal(manager.snapshot().active, 0);
  await manager.closeAll();
  assert.equal(manager.snapshot().active, 0);
});

test('failed idle cleanup remains visible and retryable instead of disappearing', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  let endAttempts = 0;
  const manager = createTenantPoolManager({ clock, scheduler, jitter: () => 0,
    poolFactory: async () => ({ async connect() { return { release() {} }; }, async end() {
      endAttempts += 1;
      if (endAttempts === 1) throw new Error('synthetic close failure');
    } }),
    policy: { globalLimit: 3, perTenantLimit: 2, operationalReserve: 1,
      globalQueueLimit: 8, perTenantQueueLimit: 4, operationalQueueReserve: 1, acquireTimeoutMs: 10,
      leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  const lease = await manager.acquire({ tenantId: 'a', workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
    credentialLease: credentialLease({},'API'), correlationId: 'c' });
  await lease.release();
  await scheduler.advance(30);
  assert.equal(manager.snapshot().pools, 1);
  assert.equal(manager.snapshot().cleanupFailures, 1);
  await manager.closeAll();
  assert.equal(endAttempts, 2);
});

test('pool end timeout stays observable and a later reconciliation can retry cleanup', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  let rejectFirstEnd;
  let endAttempts = 0;
  const firstEnd = new Promise((resolve, reject) => { rejectFirstEnd = reject; });
  const manager = createTenantPoolManager({ clock, scheduler, jitter: () => 0,
    poolFactory: async () => ({ async connect() { return { release() {} }; }, end() {
      endAttempts += 1;
      return endAttempts === 1 ? firstEnd : Promise.resolve();
    } }),
    policy: { globalLimit: 1, perTenantLimit: 1, operationalReserve: 0,
      globalQueueLimit: 2, perTenantQueueLimit: 1, operationalQueueReserve: 1, acquireTimeoutMs: 10,
      leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  const lease = await manager.acquire({ tenantId: 'a', workload: 'API', connectionVersion: 1,
    workloadClass: 'FUNCTIONAL', credentialLease: credentialLease({},'API'), correlationId: 'hung-end' });
  await lease.release();
  const closing = manager.closeAll();
  for (let index = 0; index < 20 && endAttempts === 0; index += 1) await Promise.resolve();
  assert.equal(endAttempts, 1);
  await scheduler.advance(15);
  await assert.rejects(closing, error => error.internalCode === 'POOL_CLEANUP_TIMEOUT');
  assert.equal(manager.snapshot().pools, 1);
  assert.equal(manager.snapshot().cleanupFailures, 1);
  rejectFirstEnd(new Error('synthetic late pool failure'));
  for (let index = 0; index < 20 && endAttempts === 1; index += 1) await Promise.resolve();
  await manager.closeAll();
  assert.equal(endAttempts, 2);
  assert.deepEqual(manager.snapshot(), { active: 0, queued: 0, pools: 0, tenants: 0,
    circuitsOpen: 0, credentialDisposalsPending: 0, credentialCleanupTimeouts: 0,
    credentialCleanupFailures: 0, cleanupFailures: 0 });
});

test('acquisition timeout rejects without waiting for credential disposal', async () => {
  const { manager, scheduler } = setup();
  const active = await Promise.all(['holder-a', 'holder-b'].map(tenantId => manager.acquire({ tenantId, workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL', credentialLease: credentialLease({},'API'), correlationId: tenantId })));
  let finishDisposal;
  const disposal = new Promise(resolve => { finishDisposal = resolve; });
  const acquisition = manager.acquire({ tenantId: 'queued', workload: 'API', connectionVersion: 1,
    workloadClass: 'FUNCTIONAL', credentialLease: { material: {}, dispose: () => disposal },
    correlationId: 'queued' });
  let settled = false;
  acquisition.catch(() => { settled = true; });
  await scheduler.advance(10);
  await Promise.resolve();
  assert.equal(settled, true);
  await assert.rejects(acquisition, error => error.internalCode === 'POOL_EXHAUSTED');
  assert.equal(manager.snapshot().queued, 0);
  finishDisposal();
  await Promise.resolve();
  await Promise.all(active.map(lease => lease.release()));
  await manager.closeAll();
});

test('late credential cleanup failure remains observable after its waiter times out', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const manager = createTenantPoolManager({ clock, scheduler, jitter: () => 0,
    poolFactory: ({ signal }) => new Promise((resolve, reject) => {
      markStarted();
      signal.addEventListener('abort', () => reject(new Error('expected cancellation')), { once: true });
    }),
    policy: { globalLimit: 1, perTenantLimit: 1, operationalReserve: 0,
      globalQueueLimit: 2, perTenantQueueLimit: 1, operationalQueueReserve: 1, acquireTimeoutMs: 10,
      leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  const acquisition = manager.acquire({ tenantId: 'a', workload: 'API', connectionVersion: 1,
    workloadClass: 'FUNCTIONAL', credentialLease: { material: {}, async dispose() {
      throw new AggregateError([new Error('credential://synthetic-secret@private-host')],
        'synthetic credential cleanup detail');
    } }, correlationId: 'late-cleanup' });
  await started;
  await scheduler.advance(10);
  await assert.rejects(acquisition, error => error.internalCode === 'POOL_EXHAUSTED');
  for (let index = 0; index < 20 && manager.snapshot().cleanupFailures === 0; index += 1) await Promise.resolve();
  assert.equal(manager.snapshot().cleanupFailures, 1);
  await assert.rejects(manager.closeAll(), error => {
    assert.ok(error instanceof AggregateError || error.internalCode === 'CREDENTIAL_CLEANUP_FAILED');
    assert.doesNotMatch(require('node:util').inspect(error, { depth: 10 }),
      /synthetic-secret|private-host|credential cleanup detail/);
    return true;
  });
});

test('closeAll awaits late physical cleanup and sanitizes an external AggregateError', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  let resolveClient;
  let markConnectStarted;
  let markReleaseStarted;
  let rejectRelease;
  const connected = new Promise(resolve => { resolveClient = resolve; });
  const connectStarted = new Promise(resolve => { markConnectStarted = resolve; });
  const releaseStarted = new Promise(resolve => { markReleaseStarted = resolve; });
  const releasePending = new Promise((resolve, reject) => { rejectRelease = reject; });
  const manager = createTenantPoolManager({ clock, scheduler, jitter: () => 0,
    poolFactory: async () => ({ connect() { markConnectStarted(); return connected; }, async end() {} }),
    policy: { globalLimit: 1, perTenantLimit: 1, operationalReserve: 0,
      globalQueueLimit: 2, perTenantQueueLimit: 1, operationalQueueReserve: 1, acquireTimeoutMs: 10,
      leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  const acquisition = manager.acquire({ tenantId: 'a', workload: 'API', connectionVersion: 1,
    workloadClass: 'FUNCTIONAL', credentialLease: credentialLease({},'API'), correlationId: 'late-physical' });
  await connectStarted;
  await scheduler.advance(10);
  await assert.rejects(acquisition, error => error.internalCode === 'POOL_EXHAUSTED');
  resolveClient({ release() { markReleaseStarted(); return releasePending; } });
  await releaseStarted;
  let closeSettled = false;
  const closing = manager.closeAll().finally(() => { closeSettled = true; });
  await Promise.resolve();
  assert.equal(closeSettled, false);
  rejectRelease(new AggregateError([new Error('postgres://synthetic:secret@private-host/database')],
    'synthetic driver cleanup detail'));
  await assert.rejects(closing, error => {
    assert.equal(error.internalCode, 'CLIENT_CLEANUP_FAILED');
    assert.doesNotMatch(require('node:util').inspect(error, { depth: 10 }), /synthetic:secret|private-host|driver cleanup/);
    return true;
  });
  assert.equal(manager.snapshot().cleanupFailures, 1);
});

test('client release timeout remains tracked until physical cleanup can be reconciled', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  let finishRelease;
  let markReleaseStarted;
  const releaseStarted = new Promise(resolve => { markReleaseStarted = resolve; });
  const pendingRelease = new Promise(resolve => { finishRelease = resolve; });
  const manager = createTenantPoolManager({ clock, scheduler, jitter: () => 0,
    poolFactory: async () => ({ async connect() { return { release() {
      markReleaseStarted();
      return pendingRelease;
    } }; }, async end() {} }),
    policy: { globalLimit: 1, perTenantLimit: 1, operationalReserve: 0,
      globalQueueLimit: 2, perTenantQueueLimit: 1, operationalQueueReserve: 1, acquireTimeoutMs: 10,
      leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  const lease = await manager.acquire({ tenantId: 'a', workload: 'API', connectionVersion: 1,
    workloadClass: 'FUNCTIONAL', credentialLease: credentialLease({},'API'), correlationId: 'client-cleanup' });
  const releasing = lease.release();
  await releaseStarted;
  await scheduler.advance(15);
  await assert.rejects(releasing, error => error.internalCode === 'CLIENT_CLEANUP_TIMEOUT');
  assert.equal(manager.snapshot().active, 1);
  const closing = manager.closeAll();
  await Promise.resolve();
  await scheduler.advance(15);
  await assert.rejects(closing, error => error.internalCode === 'CLIENT_CLEANUP_TIMEOUT');
  finishRelease();
  for (let index = 0; index < 20 && manager.snapshot().active !== 0; index += 1) await Promise.resolve();
  assert.equal(manager.snapshot().active, 0);
  await manager.closeAll();
});

test('a client release failure after its public timeout remains sanitized and observable', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  let rejectRelease;
  let markReleaseStarted;
  const releaseStarted = new Promise(resolve => { markReleaseStarted = resolve; });
  const pendingRelease = new Promise((resolve, reject) => { rejectRelease = reject; });
  const manager = createTenantPoolManager({ clock, scheduler, jitter: () => 0,
    poolFactory: async () => ({ async connect() { return { release() {
      markReleaseStarted();
      return pendingRelease;
    } }; }, async end() {} }),
    policy: { globalLimit: 1, perTenantLimit: 1, operationalReserve: 0,
      globalQueueLimit: 2, perTenantQueueLimit: 1, operationalQueueReserve: 1, acquireTimeoutMs: 10,
      leaseTimeoutMs: 20, idleTimeoutMs: 30, drainTimeoutMs: 15, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  const lease = await manager.acquire({ tenantId: 'a', workload: 'API', connectionVersion: 1,
    workloadClass: 'FUNCTIONAL', credentialLease: credentialLease({},'API'), correlationId: 'late-client-failure' });
  const releasing = lease.release();
  await releaseStarted;
  await scheduler.advance(15);
  await assert.rejects(releasing, error => error.internalCode === 'CLIENT_CLEANUP_TIMEOUT');
  rejectRelease(new Error('postgresql://client:secret@private-host/private-db'));
  for (let index = 0; index < 20 && manager.snapshot().cleanupFailures === 0; index += 1) await Promise.resolve();
  assert.equal(manager.snapshot().cleanupFailures, 1);
  await assert.rejects(manager.closeAll(), error => {
    assert.equal(error.internalCode, 'CLIENT_CLEANUP_FAILED');
    assert.doesNotMatch(require('node:util').inspect(error, { depth: 10 }), /client:secret|private-host|private-db/);
    return true;
  });
});

test('closeAll bounds a pending credential disposal and reconciles it on retry', async () => {
  const { manager, scheduler } = setup();
  const active = await Promise.all(['holder-a', 'holder-b'].map(tenantId => manager.acquire({ tenantId, workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL', credentialLease: credentialLease({},'API'), correlationId: tenantId })));
  let finishDisposal;
  let markDisposalStarted;
  const disposalStarted = new Promise(resolve => { markDisposalStarted = resolve; });
  const disposal = new Promise(resolve => { finishDisposal = resolve; });
  const acquisition = manager.acquire({ tenantId: 'queued', workload: 'API', connectionVersion: 1,
    workloadClass: 'FUNCTIONAL', credentialLease: { material: {}, dispose() {
      markDisposalStarted();
      return disposal;
    } }, correlationId: 'queued-cleanup' });
  await scheduler.advance(10);
  await disposalStarted;
  await assert.rejects(acquisition, error => error.internalCode === 'POOL_EXHAUSTED');
  assert.equal(manager.snapshot().credentialDisposalsPending, 1);
  assert.equal(manager.snapshot().credentialCleanupTimeouts, 0);
  assert.equal(manager.snapshot().credentialCleanupFailures, 0);
  await Promise.all(active.map(lease => lease.release()));
  const closing = manager.closeAll();
  await Promise.resolve();
  await scheduler.advance(15);
  await assert.rejects(closing, error => error.internalCode === 'CREDENTIAL_CLEANUP_TIMEOUT');
  assert.equal(manager.snapshot().credentialDisposalsPending, 1);
  assert.equal(manager.snapshot().credentialCleanupTimeouts, 1);
  assert.equal(manager.snapshot().credentialCleanupFailures, 0);
  assert.equal(manager.snapshot().cleanupFailures, 1);
  finishDisposal();
  for (let index = 0; index < 20 && manager.snapshot().credentialDisposalsPending; index += 1) await Promise.resolve();
  assert.equal(manager.snapshot().credentialDisposalsPending, 0);
  assert.equal(manager.snapshot().credentialCleanupTimeouts, 0);
  assert.equal(manager.snapshot().credentialCleanupFailures, 0);
  assert.equal(manager.snapshot().cleanupFailures, 0);
  await manager.closeAll();
});

test('credential cleanup snapshot reconciles mixed late success and failure without double counting', async () => {
  const { manager, scheduler } = setup();
  const active = await Promise.all(['holder-a', 'holder-b'].map(tenantId => manager.acquire({ tenantId, workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL', credentialLease: credentialLease({},'API'), correlationId: tenantId })));
  let finishFirst;
  let rejectSecond;
  const firstDisposal = new Promise(resolve => { finishFirst = resolve; });
  const secondDisposal = new Promise((resolve, reject) => { rejectSecond = reject; });
  const acquisitions = [firstDisposal, secondDisposal].map((disposal, index) => manager.acquire({
    tenantId: `queued-${index}`, workload: 'API', connectionVersion: 1, workloadClass: 'FUNCTIONAL',
    credentialLease: { material: {}, dispose: () => disposal }, correlationId: `queued-${index}`
  }));
  assert.equal(manager.snapshot().credentialDisposalsPending, 0);
  assert.equal(manager.snapshot().credentialCleanupTimeouts, 0);
  assert.equal(manager.snapshot().credentialCleanupFailures, 0);
  await scheduler.advance(10);
  await Promise.all(acquisitions.map(acquisition => assert.rejects(acquisition,
    error => error.internalCode === 'POOL_EXHAUSTED')));
  assert.equal(manager.snapshot().credentialDisposalsPending, 2);
  await Promise.all(active.map(lease => lease.release()));
  const closing = manager.closeAll();
  await Promise.resolve();
  await scheduler.advance(15);
  await assert.rejects(closing, error => error.internalCode === 'CREDENTIAL_CLEANUP_TIMEOUT');
  assert.equal(manager.snapshot().credentialDisposalsPending, 2);
  assert.equal(manager.snapshot().credentialCleanupTimeouts, 2);
  assert.equal(manager.snapshot().cleanupFailures, 2);
  finishFirst();
  rejectSecond(new Error('credential://mixed-secret@private-host'));
  for (let index = 0; index < 20 && manager.snapshot().credentialDisposalsPending; index += 1) await Promise.resolve();
  assert.equal(manager.snapshot().credentialDisposalsPending, 0);
  assert.equal(manager.snapshot().credentialCleanupTimeouts, 0);
  assert.equal(manager.snapshot().credentialCleanupFailures, 1);
  assert.equal(manager.snapshot().cleanupFailures, 1);
  await assert.rejects(manager.closeAll(), error => {
    assert.doesNotMatch(require('node:util').inspect(error, { depth: 10 }), /mixed-secret|private-host/);
    return true;
  });
});
