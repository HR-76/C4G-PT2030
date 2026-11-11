'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createTimingHub, observePool, observeRuntime, observeAuthorizationFactory, TIMED_SCENARIOS } = require('../../test/integration/partner-portal/temporalDiagnostic');

test('observed authorization retains the original private brand required by the real coordinator', () => {
  const { createProductionCatalogs } = require('../src/authorization/catalogs');
  const { createTaxonomyAuthorization, isResourceAuthorization } = require('../src/authorization/resourceAuthorization');
  const { observeAuthorizationFactory } = require('../../test/integration/partner-portal/temporalDiagnostic');
  const catalogs = createProductionCatalogs({ catalogVersion: 'f13' });
  const authorization = observeAuthorizationFactory(createTaxonomyAuthorization, { catalogs,
    membershipPort: { async revalidate() { return null; } }, authorizationDataPort: { async load() { return null; } },
    authorizationAuditPort: { async accept() {} }, assurancePolicyVersion: 'c4g-assurance-v1',
    recentMfaRequirement: { maxAgeSeconds: 300, mfa: true, acceptedAcr: ['c4g-loa2'], acceptedAmr: ['otp'], amrMode: 'all' },
    clock: { now: () => new Date() } }, createTimingHub());
  assert.equal(isResourceAuthorization(authorization), true);
});

for (const scenario of ['volume-10000', 'volume-10001', 'profile-distinct-origins']) {
  test(`temporal regression preserves timeout and partial authorization in ${scenario}`, async () => {
    assert.ok(TIMED_SCENARIOS.includes(scenario));
    let clock = 0;
    const hub = createTimingHub({ now: () => clock }), trace = hub.start();
    const primary = Object.assign(new Error('SECRET_CANARY'), { code: 'LEASE_TIMEOUT' });
    let guards = 0;
    await assert.rejects(hub.run(trace, () => hub.measure('OPERATION', async () => {
      await hub.measure('RESOLVE', async () => { clock += 2; });
      await hub.measure('LEASE', () => hub.measure('READER', async () => {
        await hub.measure('SQL_TENANT', async () => { clock += 3; });
        assert.equal(await hub.authorization(() => hub.decision(async () => {
          await hub.measure('SQL_CENTRAL', async () => { clock += 5; }); return false;
        })), false, 'denial is unchanged');
        assert.equal(await hub.authorization(() => { hub.cacheGuard(); guards++; clock++; return false; }), false);
        await hub.authorization(() => { hub.cacheGuard(); guards++; clock++; throw primary; });
      }));
    })), error => error === primary);
    const result = trace.snapshot();
    assert.equal(guards, 2); assert.equal(result.status, 'VALID');
    assert.equal(result.metrics.OPERATION.failed, 1);
    assert.equal(result.metrics.AUTHORIZATION_MISS.completed, 1);
    assert.equal(result.metrics.AUTHORIZATION_HIT.completed, 1);
    assert.equal(result.metrics.AUTHORIZATION_UNRESOLVED.failed, 1);
    assert.equal(result.metrics.SQL_CENTRAL.totalMs, 5);
    assert.equal(result.metrics.SQL_TENANT.totalMs, 3);
    assert.equal(result.metrics.OPERATION.totalMs, 12);
    assert.doesNotMatch(JSON.stringify(result), /CANARY|LEASE_TIMEOUT|"resource"|"password"|"sql"/i);
  });
}

test('pending spans at settlement remain attached to their original sample through late completion', async () => {
  let clock = 0, finish;
  const hub = createTimingHub({ now: () => clock }), first = hub.start(), second = hub.start();
  const pending = hub.run(first, () => hub.measure('SQL_TENANT', () => new Promise(resolve => { finish = resolve; })));
  clock = 7;
  const settlement = first.snapshot();
  assert.equal(settlement.metrics.SQL_TENANT.inflight, 1);
  assert.equal(settlement.metrics.SQL_TENANT.pendingMs, 7);
  await hub.run(second, () => hub.measure('SQL_TENANT', async () => { clock += 2; }));
  clock = 10; finish(); await pending;
  assert.equal(first.snapshot().metrics.SQL_TENANT.totalMs, 10);
  assert.equal(second.snapshot().metrics.SQL_TENANT.totalMs, 2);
  assert.equal(settlement.metrics.SQL_TENANT.inflight, 1, 'snapshot is immutable evidence');
});

test('both privately instrumented compositions construct with real brands and reject a copied coordinator', () => {
  const { createProductionCatalogs } = require('../src/authorization/catalogs');
  const { createAuthorityCoordinator } = require('../src/security/authorityCoordinator');
  const { loadApplicationComposition } = require('../../test/integration/partner-portal/environment');
  const noSql = () => assert.fail('offline constructor must not query');
  const coordinator = createAuthorityCoordinator({ pool: { connect: noSql, query: noSql }, permitSecret: 'synthetic-only-permit-0000000000000000' });
  const options = { authorityCoordinator: coordinator,
    sessionStore: { get: noSql }, sessionRegistry: { validateSession: noSql, resolveOrganizationContext: noSql },
    authorizationCatalogs: createProductionCatalogs({ catalogVersion: 'f13' }), assurancePolicyVersion: 'c4g-assurance-v1',
    recentMfaRequirement: { maxAgeSeconds: 300, mfa: true, acceptedAcr: ['c4g-loa2'], acceptedAmr: ['otp'], amrMode: 'all' },
    tokenKeys: { gate: 'synthetic-only-key-000000000000000000000000000' }, tokenKeyId: 'gate',
    tenantRuntimeDependencies: { membershipRepository: { revalidateContext: noSql }, directoryRepository: { resolveSnapshotByOrganization: noSql },
      credentialProvider: {}, bindingVerifier: {}, poolManager: {}, regionPolicy: { allows: () => true },
      clock: { now: () => new Date() }, scheduler: { setTimeout, clearTimeout } } };
  for (const variant of ['baseline', 'candidate']) {
    const loaded = loadApplicationComposition(variant, {}, createTimingHub());
    assert.equal(typeof loaded.createApplicationComposition(options).execute, 'function');
    assert.throws(() => loaded.createApplicationComposition({ ...options, authorityCoordinator: { ...coordinator } }), /Coordinated F5 source required/);
  }
});

test('invalid clock or unknown labels invalidate diagnostics without replacing return values or errors', async () => {
  const hub = createTimingHub({ now() { throw Error('CLOCK_SECRET'); } }), trace = hub.start();
  const primary = Error('PRIMARY_SECRET');
  assert.equal(hub.run(trace, () => hub.measure('UNKNOWN_SECRET', () => 42)), 42);
  await assert.rejects(hub.run(trace, () => hub.measure('RESOLVE', async () => { throw primary; })), e => e === primary);
  assert.equal(trace.snapshot().status, 'INVALID');
  assert.doesNotMatch(JSON.stringify(trace.snapshot()), /SECRET/);
});

test('outside a timing context calls retain synchronous return and exact promise identity', () => {
  const hub = createTimingHub({ now() { throw Error('must not read clock'); } });
  const promise = Promise.resolve(true);
  assert.equal(hub.measure('SQL_CENTRAL', () => promise), promise);
  assert.equal(hub.authorization(() => false), false);
  assert.equal(hub.decision(() => 7), 7);
});

test('concurrent authorization frames do not leak miss classification and early refusals are not cache hits', async () => {
  const hub = createTimingHub(), trace = hub.start(); let resume;
  await hub.run(trace, async () => {
    const miss = hub.authorization(async () => {
      await hub.decision(() => new Promise(resolve => { resume = resolve; })); return true;
    });
    assert.equal(await hub.authorization(() => { hub.cacheGuard(); return false; }), false);
    assert.equal(await hub.authorization(() => false), false);
    resume(); assert.equal(await miss, true);
  });
  const metrics = trace.snapshot().metrics;
  assert.equal(metrics.AUTHORIZATION_HIT.completed, 1);
  assert.equal(metrics.AUTHORIZATION_MISS.completed, 1);
  assert.equal(metrics.AUTHORIZATION_UNRESOLVED.completed, 1);
  assert.equal(metrics.AUTHORIZATION.inflight, 0);
});

test('physical Central query observation covers promise, callback and synchronous errors without extra queries', async () => {
  const hub = createTimingHub(), trace = hub.start(), pool = new EventEmitter();
  const primary = Error('PRIVATE_QUERY_ERROR'); let calls = 0, receiver;
  const client = { query(...args) { calls++; receiver = this;
    if (args[0] === 'throw') throw primary;
    const cb = args.at(-1);
    if (typeof cb === 'function') { queueMicrotask(() => cb(primary)); return undefined; }
    return Promise.resolve({ rows: [1] });
  } };
  const original = client.query;
  const detach = observePool(pool, hub);
  pool.emit('acquire', client); pool.emit('acquire', client);
  await hub.run(trace, async () => {
    assert.deepEqual(await client.query('SQL_SECRET', ['VALUE_SECRET']), { rows: [1] });
    await new Promise(resolve => client.query('callback', [], error => { assert.equal(error, primary); resolve(); }));
    assert.throws(() => client.query('throw'), e => e === primary);
  });
  assert.equal(calls, 3); assert.equal(receiver, client);
  assert.equal(trace.snapshot().metrics.SQL_CENTRAL.completed, 3);
  assert.equal(trace.snapshot().metrics.SQL_CENTRAL.failed, 2);
  assert.doesNotMatch(JSON.stringify(trace.snapshot()), /SECRET|PRIVATE/);
  detach(); assert.equal(client.query, original); assert.equal(pool.listenerCount('acquire'), 0);
});

test('frozen runtime and authority dependencies preserve arguments, values and errors', async () => {
  const hub = createTimingHub(), trace = hub.start(), calls = [], primary = Error('GUARD_REFUSAL');
  const lease = Object.freeze({ execute(input) { calls.push(['execute', input]); return Promise.resolve(input); } });
  const runtime = Object.freeze({ resolve(input) { calls.push(['resolve', input]); return Promise.resolve(lease); } });
  const membership = Object.freeze({ revalidate(...args) { calls.push(['membership', ...args]); return Promise.resolve(false); } });
  const data = Object.freeze({ load(...args) { calls.push(['data', ...args]); throw primary; } });
  const originalResolve = runtime.resolve;
  const r = observeRuntime(runtime, hub);
  const dependencies = observeAuthorizationFactory(options => options, { membershipPort: membership,
    authorizationDataPort: data, authorizationAuditPort: Object.freeze({ accept() {} }) }, hub);
  const input = Object.freeze({ private: 'CANARY' });
  await hub.run(trace, async () => {
    assert.equal(await (await r.resolve(input)).execute(input), input);
    assert.equal(await hub.authorization(() => dependencies.membershipPort.revalidate(input)), false);
    assert.throws(() => dependencies.authorizationDataPort.load(input), error => error === primary);
  });
  assert.deepEqual(calls.map(row => row[0]), ['resolve', 'execute', 'membership', 'data']);
  assert.equal(trace.snapshot().metrics.AUTHORIZATION_MISS.completed, 1);
  assert.equal(trace.snapshot().metrics.AUTHORIZATION_DATA.failed, 1);
  assert.equal(runtime.resolve, originalResolve);
  assert.doesNotMatch(JSON.stringify(trace.snapshot()), /CANARY|token|REFUSAL/);
});

for (const method of ['partnersBrowse', 'browse']) test(`real ${method} composition scopes fresh reads and still refuses a stale guard on a hit`, async () => {
  const filename = path.resolve(__dirname, '../src/applications/composition.js');
  const local = Module.createRequire(filename), instance = new Module(filename, module);
  const hub = createTimingHub(), org = '10000000-0000-4000-8000-000000000001';
  const context = { actor: { id: org, organizationId: org, membershipId: org }, correlationId: org };
  let decisions = 0, guards = 0, groups = 0, groupActive = 0, stale = false, failAudit = false;
  const client = { async query() { return { rows: [] }; } };
  const coordinator = {
    async withAuthority(work) { groups++; groupActive++; try { return await work(); } finally { groupActive--; } }, registerRecovery() {},
    assert() { guards++; if (stale) throw Object.assign(Error('STALE'), { code: 'AUTHORITY_REQUIRED' }); },
    bindAuthority() { return { async protect() { return { token: {} }; } }; }
  };
  function repository(ports) {
    return { async [method]() {
      await ports.protect({ operationCode: 'APPLICATION_READ' });
      const target = { id: org, organizationId: org };
      const first = await hub.authorization(() => ports.authorize('APPLICATION_READ', target));
      const second = await hub.authorization(() => ports.authorize('APPLICATION_READ', target));
      return [first, second];
    } };
  }
  const replacements = {
    '../authorization/authorityDataRepository': { createAuthorityDataRepository: () => ({}) },
    '../security/authenticatedAuthority': { createTaxonomySessionAuthority: () => ({ captureAuthenticatedRequest: async () => ({}), resolve: async () => context }) },
    '../authorization/resourceAuthorization': { createTaxonomyAuthorization: ({ withAuthorityReads = work => work(), authorizationAuditPort }) => ({
      async authorize() {
        const result = await withAuthorityReads(() => hub.decision(async () => { decisions++; return { allowed: false, reasonCode: 'DENIED' }; }));
        // Even if an observational F5 event does not propagate the rejection,
        // the composition must await its audit tail before caching/returning.
        if (failAudit) authorizationAuditPort.accept({}).catch(() => {});
        return result;
      }
    }) },
    '../security/tenantRuntime': { createTenantRuntime: () => observeRuntime({ async resolve({ operationAdapter }) { return { execute: input => operationAdapter.queryModule.execute({ client, input }) }; } }, hub) },
    '../security/tenantOperationCatalog': { createAuthorizedTenantOperationCatalog: value => value },
    '../security/tenantLeaseExecutor': { preparedAuthorityBinding: () => { hub.cacheGuard(); return { transactionId: 'synthetic', tenantId: org }; } },
    '../security/tenantAuthorityRecovery': { createTenantAuthorityRecovery: () => ({}) },
    '../organizationalProfile/editorialUiAudit': { createEditorialUiAudit: () => ({ async accept() {
      assert.equal(groupActive, 0, 'the new read group must release before tenant audit');
      if (failAudit) throw Object.assign(Error('SYNTHETIC_AUDIT_FAILURE'), { code: 'AUDIT_UNAVAILABLE' });
    } }) },
    './responsibleAuthority': { createResponsibleAuthority: () => ({}) },
    './teamAccess': { createTeamAccessPolicy: () => ({}) },
    './readAuthority': { createReadAuthority: () => ({}) },
    './browseAuthority': { createTransitionCapability: () => () => false },
    './partners': { ...require('../src/applications/partners'), createPartnersRepository: repository },
    './repository': { ...require('../src/applications/repository'), createApplicationRepository: repository }
  };
  instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
  instance.require = name => replacements[name] || local(name);
  instance._compile(fs.readFileSync(filename, 'utf8'), filename);
  const composition = instance.exports.createApplicationComposition({ authorityCoordinator: coordinator,
    authorizationCatalogs: { operationCatalog: {}, permissionCatalog: {} }, tenantRuntimeDependencies: {},
    tokenKeys: { gate: 'synthetic-only-key-000000000000000000000000000' }, tokenKeyId: 'gate' });
  const trace = hub.start();
  assert.deepEqual(await hub.run(trace, () => composition.execute(method, {}, null, { headers: {} })), [false, false]);
  assert.equal(decisions, 1); assert.equal(guards, 1);
  assert.equal(groups, method === 'partnersBrowse' ? 2 : 1, 'entry validation plus partner fresh reads only; cache hit adds no group');
  assert.equal(trace.snapshot().metrics.AUTHORIZATION_MISS.completed, 1);
  assert.equal(trace.snapshot().metrics.AUTHORIZATION_HIT.completed, 1);
  stale = true; const refused = hub.start();
  await assert.rejects(hub.run(refused, () => composition.execute(method, {}, null, { headers: {} })), { code: 'AUTHORITY_REQUIRED' });
  assert.equal(decisions, 2, 'new request has a new real composition cache');
  assert.equal(guards, 2, 'cache hit still runs the real composition guard call');
  assert.equal(groups, method === 'partnersBrowse' ? 4 : 2, 'new requests open fresh groups');
  assert.equal(refused.snapshot().metrics.AUTHORIZATION_UNRESOLVED.failed, 1);
  stale = false; failAudit = true;
  await assert.rejects(composition.execute(method, {}, null, { headers: {} }), { code: 'AUDIT_UNAVAILABLE' });
  assert.equal(decisions, 3); assert.equal(guards, 2, 'audit failure must stop before the second authorization/cache hit');
  failAudit = false;
  assert.deepEqual(await composition.execute(method, {}, null, { headers: {} }), [false, false]);
  assert.equal(decisions, 4, 'a later request gets a fresh authorization after audit failure');
  assert.equal(guards, 3); assert.equal(groupActive, 0);
});
