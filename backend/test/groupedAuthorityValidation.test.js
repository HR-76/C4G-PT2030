'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {createAuthorityCoordinator, hash} = require('../src/security/authorityCoordinator');
const {createTaxonomySessionAuthority, isTaxonomySessionAuthority} = require('../src/security/authenticatedAuthority');
const {createPgSessionRegistry} = require('../src/security/sessionRegistry');
const {createAuthorityDataRepository} = require('../src/authorization/authorityDataRepository');
const {createTaxonomyAuthorization, isResourceAuthorization} = require('../src/authorization/resourceAuthorization');
const {createProductionCatalogs} = require('../src/authorization/catalogs');
const {createTenantLeaseExecutor, preparedAuthorityBinding} = require('../src/security/tenantLeaseExecutor');
const {createManualClock, createManualScheduler, validSnapshot} = require('./support/tenantRuntimeDoubles');
const protocol = require('../src/security/authorityProtocolQueries');

const validatedSession = ['pending', 'epochs', 'store', 'heartbeat', 'context', 'membership', 'policy'];
const queryByCode = new Map(protocol.queries.map(sql => [hash(sql), sql]));
const policyVersion = 'grouped-authority-test-v1';
const recentMfaRequirement = Object.freeze({maxAgeSeconds: 300, mfa: true,
  acceptedAcr: ['c4g-loa2'], acceptedAmr: ['otp'], amrMode: 'all'});

// Real branded F3/F5/F4/coordinator objects and the closed protocol execute here.
// Only PostgreSQL persistence and schema/admission metadata are controlled. The
// SQL/RLS, physical role and durable-audit claims belong to the integration gate.
function fixture(t, {timeoutMs = 10000} = {}) {
  const clock = createManualClock(), dateClock = {now: () => new Date(clock.now())};
  const catalogs = createProductionCatalogs({catalogVersion: 'f13'});
  const principals = [], transactions = [], guards = [], audit = [], tenantRuns = [];
  const hooks = {afterGroup: null, protocol: null};
  const schema = require('../src/security/authoritySecurityManifest');
  t.mock.method(schema, 'assertAuthorityAdmission', async client => {
    client.transaction.checks.push('admission'); return {currentVersion: 'synthetic-admitted'};
  });
  t.mock.method(schema, 'assertAuthoritySecurity', async client => { client.transaction.checks.push('post-lock'); });

  function addPrincipal() {
    const principal = {sid: 'synthetic-' + randomUUID(), organizationId: randomUUID(), tenantId: randomUUID(),
      userId: randomUUID(), membershipId: randomUUID(), resourceId: randomUUID(), epoch: '0',
      revoked: false, membershipStatus: 'ACTIVE', membershipVersion: 1, authorizationVersion: 1,
      cookieUntil: clock.now() + 20000, registryUntil: clock.now() + 20000,
      authTime: clock.now() / 1000, grant: true};
    principals.push(principal); return principal;
  }
  function stored(p) {
    return {cookie: {expires: new Date(p.cookieUntil).toISOString()}, auth: {user: {id: p.userId},
      revocationVersion: 1, absoluteExpiresAt: clock.now() + 60000, policyVersion,
      evidence: {policyVersion, authTime: p.authTime, acr: 'c4g-loa2', amr: ['otp']},
      organizationContext: {organizationId: p.organizationId, membershipId: p.membershipId, membershipVersion: 1}}};
  }
  function rowsFor(sql, args) {
    const bySid = principals.find(p => p.sid === args[0]);
    if (sql.startsWith('SELECT request_id FROM public.authority_write_request')) return ['pending', []];
    if (sql.startsWith('SELECT scope_key,epoch')) {
      const keys = String(args[0]).slice(1, -1).split(',').map(key => key.replace(/^"|"$/g, ''));
      const p = principals.find(value => keys.includes('ORG:' + value.organizationId));
      return ['epochs', keys.map(key => ({scope_key: key, epoch: p?.epoch || '0'}))];
    }
    if (sql === 'SELECT sess FROM public.application_session_store WHERE sid=$1') return ['store', bySid ? [{sess: stored(bySid)}] : []];
    if (sql.startsWith('UPDATE public.application_session AS aps SET last_seen_at')) {
      return ['heartbeat', bySid && !bySid.revoked && bySid.userId === args[1]
        && bySid.registryUntil > new Date(args[3]).getTime() ? [{sid: bySid.sid}] : []];
    }
    if (sql.startsWith('SELECT aps.selected_organization_id')) {
      return ['context', !bySid ? [] : [{selected_organization_id: bySid.organizationId,
        selected_membership_id: bySid.membershipId, selected_membership_version: 1,
        membership_version: bySid.membershipVersion, base_role_code: 'VIEWER', membership_status: bySid.membershipStatus,
        valid_from: new Date(0), valid_until: null, organization_status: 'ACTIVE', user_status: 'ACTIVE',
        display_name: 'Synthetic organization', slug: 'synthetic', session_expires_at: new Date(bySid.registryUntil)}]];
    }
    if (sql.startsWith('SELECT m.id,m.organization_id,m.global_user_id')) {
      const p = principals.find(value => value.membershipId === args[0] && value.organizationId === args[1]);
      return ['membership', !p ? [] : [{id: p.membershipId, organization_id: p.organizationId, global_user_id: p.userId,
        membership_version: p.membershipVersion, status: p.membershipStatus, valid_until: null}]];
    }
    if (sql.startsWith('SELECT f.organization_id,f.membership_id')) {
      const p = principals.find(value => value.organizationId === args[0] && value.membershipId === args[1]);
      return ['policy', !p ? [] : [{organization_id: p.organizationId, membership_id: p.membershipId,
        authorization_version: p.authorizationVersion, membership_version: p.membershipVersion, base_role_code: 'VIEWER',
        policy_version: policyVersion, assurance_requirements: recentMfaRequirement,
        grants: p.grant ? ['application.read', 'application.edit', 'opportunity.archive'].map(permission => ({permission,
          scope: {type: 'ORGANIZATION', id: p.organizationId, organizationId: p.organizationId}})) : []}]];
    }
    if (sql.startsWith('INSERT INTO public.authority_commit_guard')) {
      const row = {guard_id: args[0], organization_id: args[1], tenant_id: args[2], subject_id: args[3], membership_id: args[4],
        protected_operations: JSON.parse(args[7]), authority_versions: JSON.parse(args[8]), normalized_assurance: JSON.parse(args[9]),
        transaction_id: args[10], deadline: new Date(args[15]), authority_epoch: guards.length + 1, state: 'PREPARED'};
      guards.push(row); return ['guard-insert', [row]];
    }
    if (sql.startsWith('SELECT * FROM public.authority_commit_guard')) return ['guard-load', guards.filter(row => row.guard_id === args[0])];
    if (sql.startsWith('UPDATE public.authority_commit_guard SET state=$2')) {
      const row = guards.find(value => value.guard_id === args[0]);
      row.state = args[1]; return ['guard-finish', [row]];
    }
    throw new Error('Unhandled closed authority query in test: ' + sql);
  }
  const pool = {query() { throw new Error('Raw pool access is forbidden by this fixture.'); }, async connect() {
    const transaction = {id: transactions.length + 1, protocol: [], statements: [], checks: [], releases: []};
    transactions.push(transaction);
    return {transaction, release(error) { transaction.releases.push(error); }, async query(sql, values = []) {
      transaction.statements.push(sql);
      if (sql === 'SELECT authority_api.execute($1,$2::text[],$3) AS result') {
        const original = queryByCode.get(values[0]);
        assert.ok(original, 'the real closed protocol must resolve the query code');
        const [kind, rows] = rowsFor(original, values[1]);
        const observation = {kind, args: values[1], code: values[0]};
        transaction.protocol.push(observation);
        await hooks.protocol?.({transaction, observation});
        return {rows: [{result: {rows, rowCount: rows.length}}]};
      }
      if (sql === 'COMMIT' && transaction.protocol.filter(query => query.kind === 'store').length === 2
          && !transaction.protocol.some(query => query.kind === 'guard-insert')) await hooks.afterGroup?.(transaction);
      return {rows: sql.includes('c4g_database_identity') ? [{valid: true}] : []};
    }};
  }};
  const coordinator = createAuthorityCoordinator({pool, clock: dateClock, timeoutMs,
    permitSecret: 'synthetic-grouped-authority-permit-not-production'});
  const data = createAuthorityDataRepository({coordinator, policyVersion, catalogs, recentMfaRequirement});
  const sessionAuthority = createTaxonomySessionAuthority({authorityCoordinator: coordinator,
    sessionStore: {get(sid, callback) {
      coordinator.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1', [sid])
        .then(result => callback(null, result.rows[0]?.sess), callback);
    }}, sessionRegistry: createPgSessionRegistry(coordinator.pool, coordinator), ...data, policyVersion, clock: dateClock});
  const authorization = createTaxonomyAuthorization({...data, catalogs, assurancePolicyVersion: policyVersion,
    recentMfaRequirement, clock: dateClock, authorizationAuditPort: {async accept(event) { audit.push(event); return 'ACCEPTED'; }}});
  const guardPort = coordinator.bindAuthority({sessionAuthority, authorization, ...catalogs, recentMfaRequirement});

  function capture(p) {
    return sessionAuthority.captureAuthenticatedRequest({sessionID: p.sid, user: {id: p.userId}, authContext: {sessionId: p.sid},
      organizationContext: {organizationId: p.organizationId, membershipId: p.membershipId, membershipVersion: 1}});
  }
  async function run(p, handle, operationCode = 'APPLICATION_READ') {
    const operation = catalogs.operationCatalog.resolve(operationCode);
    const run = {statements: [], refusal: null, decision: null, token: null}; tenantRuns.push(run);
    const physical = {async query(sql) {
      run.statements.push(sql);
      return {rows: sql.includes('FROM pg_stat_activity') ? [{pid: tenantRuns.length, backend_start: dateClock.now().toISOString()}] : []};
    }};
    const snapshot = validSnapshot({organizationId: p.organizationId, tenantId: p.tenantId});
    const executor = createTenantLeaseExecutor({clock, scheduler: createManualScheduler(clock), poolManager: {getFence: () => 0},
      membershipRepository: {async revalidateContext() { return true; }},
      directoryRepository: {async resolveSnapshotByOrganization() { return snapshot; }}, bindingVerifier: {async verify() {}}});
    const queryModule = Object.freeze({async execute({client}) {
      try {
        const result = await guardPort.protect(client, {handle, operationCode,
          resource: {id: p.resourceId, organizationId: p.organizationId, resourceType: operation.resourceType,
            scopeType: 'ORGANIZATION', status: 'ACTIVE', distinctFromActorIds: []}});
        run.token = result.token; run.decision = result.decision;
      } catch (error) { run.refusal = error; throw error; }
      await client.query(operation.effect === 'READ' ? 'SELECT synthetic_tenant_read' : 'INSERT INTO synthetic_tenant_effect VALUES (1)');
      return 'AUTHORIZED';
    }, authorityGuard: {assert({client}) { coordinator.assert(run.token, client, preparedAuthorityBinding(client).transactionId); },
      async complete({outcome}) { if (run.token) await coordinator.complete(run.token, outcome); }}});
    const lease = executor.issue({allocation: {client: physical, deadline: clock.now() + 10000, fence: 0, async release() {}},
      snapshot, organizationContext: {organizationId: p.organizationId, membershipId: p.membershipId, membershipVersion: 1},
      operation: {operationCode, accessMode: operation.effect, ownerModule: operation.resourceType === 'APPLICATION'
        ? 'APPLICATION_FIRST_SLICE' : 'F12_PRIVATE_HTTP_RUNTIME', queryModule, requiredCapabilities: ['SYNTHETIC_QUERY']},
      correlationId: randomUUID()});
    return lease.execute({});
  }
  return {clock, dateClock, catalogs, principals, transactions, guards, audit, tenantRuns, hooks, coordinator,
    sessionAuthority, authorization, addPrincipal, capture, run};
}
const kinds = transaction => transaction.protocol.map(query => query.kind);
function assertRolledBackWithoutEffect(h) {
  const run = h.tenantRuns.at(-1);
  assert.ok(run.statements.includes('ROLLBACK'));
  assert.equal(run.statements.includes('COMMIT'), false);
  assert.equal(run.statements.some(sql => sql.includes('synthetic_tenant_')), false);
  assert.equal(h.guards.length, 0);
}

for (const operationCode of ['APPLICATION_READ', 'APPLICATION_EDIT', 'OPPORTUNITY_ARCHIVE']) {
  test(`${operationCode}: two complete validations share one transaction; prepare stays fresh and authorizes unchanged`, async t => {
    const h = fixture(t), p = h.addPrincipal(), handle = await h.capture(p);
    assert.equal(isTaxonomySessionAuthority(h.sessionAuthority), true);
    assert.equal(isResourceAuthorization(h.authorization), true);
    // Independent calls establish the existing protocol/validation sequence.
    const baselineStart = h.transactions.length;
    const identity = await h.sessionAuthority.guardIdentity(handle);
    const original = await h.sessionAuthority.resolve(handle);
    const baseline = h.transactions.slice(baselineStart);
    assert.equal(baseline.length, 2);
    assert.deepEqual(baseline.flatMap(kinds), [...validatedSession, ...validatedSession]);
    const start = h.transactions.length;
    assert.equal(await h.run(p, handle, operationCode), 'AUTHORIZED');
    const [group, prepare, finish] = h.transactions.slice(start);
    assert.equal(h.transactions.length - start, 3);
    assert.deepEqual(kinds(group), baseline.flatMap(kinds));
    assert.deepEqual(group.protocol.map(query => query.code), baseline.flatMap(tx => tx.protocol.map(query => query.code)));
    assert.deepEqual(kinds(prepare), ['pending', ...validatedSession, ...validatedSession,
      'membership', 'policy', 'pending', 'epochs', 'guard-insert']);
    assert.deepEqual(kinds(finish), ['guard-load', 'guard-finish']);
    for (const tx of [group, prepare, finish]) {
      assert.deepEqual(tx.checks, ['admission', 'post-lock']);
      assert.equal(tx.statements.filter(sql => sql === 'BEGIN').length, 1);
      assert.equal(tx.statements.filter(sql => sql === 'COMMIT').length, 1);
      assert.equal(tx.statements.filter(sql => sql.includes('pg_advisory_xact_lock')).length, 1);
      assert.deepEqual(tx.releases, [undefined]);
    }
    assert.notEqual(group.id, prepare.id);
    const run = h.tenantRuns.at(-1), row = h.guards[0];
    assert.equal(run.decision.allowed, true); assert.equal(run.decision.reasonCode, 'AUTHORIZED');
    assert.deepEqual(run.decision.trustedContext.actor, original.actor);
    assert.equal(row.authority_versions.sessionRevocationVersion, identity.revocationVersion);
    assert.equal(row.authority_versions.membershipVersion, 1);
    assert.equal(row.authority_versions.authorizationVersion, 1);
    assert.equal(row.state, 'TENANT_COMMITTED');
    assert.deepEqual(row.protected_operations, [{operation: operationCode,
      permission: h.catalogs.operationCatalog.resolve(operationCode).permission,
      resourceType: h.catalogs.operationCatalog.resolve(operationCode).resourceType, resourceId: p.resourceId}]);
    assert.equal(row.normalized_assurance.level, operationCode === 'OPPORTUNITY_ARCHIVE' ? 'RECENT_MFA' : 'SESSION');
    assert.equal(h.audit.length, 1);
    assert.equal(h.audit[0].eventType, operationCode === 'OPPORTUNITY_ARCHIVE' ? 'SENSITIVE_ACTION_ALLOWED' : 'AUTHORIZATION_ALLOWED');
  });
}

for (const [name, mutate, expected] of [
  ['session revocation', p => { p.revoked = true; }, 'AUTHORITY_REQUIRED'],
  ['membership suspension', p => { p.membershipStatus = 'SUSPENDED'; }, 'AUTHORITY_REQUIRED'],
  ['authorization version change', p => { p.authorizationVersion++; }, 'AUTHORITY_REQUIRED'],
  ['epoch rotation', p => { p.epoch = '1'; }, 'AUTHORITY_STALE'],
  ['session idle expiry', (p, h) => { p.cookieUntil = h.clock.now(); }, 'AUTHORITY_REQUIRED'],
  ['registry expiry', (p, h) => { p.registryUntil = h.clock.now(); }, 'AUTHORITY_REQUIRED']
]) test(`fresh prepare rejects ${name} after the grouped callback commits`, async t => {
  const h = fixture(t), p = h.addPrincipal(), handle = await h.capture(p), start = h.transactions.length;
  let boundary = 0;
  h.hooks.afterGroup = () => { boundary++; mutate(p, h); };
  await assert.rejects(() => h.run(p, handle, 'APPLICATION_EDIT'));
  assert.equal(boundary, 1);
  assert.equal(h.tenantRuns.at(-1).refusal?.code, expected);
  const [group, prepare] = h.transactions.slice(start);
  assert.deepEqual(kinds(group), [...validatedSession, ...validatedSession]);
  assert.ok(group.statements.includes('COMMIT'));
  assert.notEqual(group.id, prepare.id);
  assert.ok(prepare.statements.includes('ROLLBACK'));
  assert.deepEqual(prepare.checks, ['admission', 'post-lock']);
  assert.equal(h.audit.length, 0);
  assertRolledBackWithoutEffect(h);
});

test('authorization grant removal at the boundary still reaches real policy denial and produces no tenant effect', async t => {
  const h = fixture(t), p = h.addPrincipal(), handle = await h.capture(p);
  h.hooks.afterGroup = () => { p.grant = false; };
  await assert.rejects(() => h.run(p, handle, 'APPLICATION_EDIT'));
  assert.equal(h.tenantRuns.at(-1).refusal?.code, 'AUTHORITY_DENIED');
  assert.equal(h.audit.at(-1).reasonCode, 'PERMISSION_NOT_GRANTED');
  assertRolledBackWithoutEffect(h);
});

test('sensitive authorization revalidates MFA evidence at fresh prepare', async t => {
  const h = fixture(t), p = h.addPrincipal(), handle = await h.capture(p);
  h.hooks.afterGroup = () => { p.authTime -= 301; };
  await assert.rejects(() => h.run(p, handle, 'OPPORTUNITY_ARCHIVE'));
  assert.equal(h.tenantRuns.at(-1).refusal?.code, 'AUTHORITY_DENIED');
  assert.equal(h.audit.at(-1).reasonCode, 'AUTH_EVIDENCE_EXPIRED');
  assertRolledBackWithoutEffect(h);
});

test('the grouped callbacks share a deadline and roll back before prepare when their combined duration exceeds it', async t => {
  const h = fixture(t, {timeoutMs: 40}), p = h.addPrincipal(), handle = await h.capture(p);
  const start = h.transactions.length;
  h.hooks.protocol = ({observation}) => { if (observation.kind === 'store') h.clock.advance(25); };
  await assert.rejects(() => h.run(p, handle));
  assert.equal(h.tenantRuns.at(-1).refusal?.code, 'AUTHORITY_DEADLINE');
  const grouped = h.transactions.slice(start);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].protocol.filter(query => query.kind === 'store').length, 2);
  assert.equal(grouped[0].statements.includes('COMMIT'), false);
  assert.ok(grouped[0].statements.includes('ROLLBACK'));
  assert.equal(grouped[0].releases[0]?.code, 'AUTHORITY_DEADLINE');
  assertRolledBackWithoutEffect(h);
});

test('subsequent requests and tenants reload authority and retain separate handles, guards and source transactions', async t => {
  const h = fixture(t), a = h.addPrincipal(), b = h.addPrincipal();
  const handleA = await h.capture(a), handleB = await h.capture(b);
  const start = h.transactions.length;
  assert.equal(await h.run(a, handleA), 'AUTHORIZED');
  a.revoked = true;
  assert.equal(await h.run(b, handleB), 'AUTHORIZED');
  const beforeRetry = h.transactions.length;
  await assert.rejects(() => h.run(a, handleA));
  assert.equal(h.tenantRuns.at(-1).refusal?.code, 'AUTHORITY_REQUIRED');
  assert.deepEqual(h.guards.map(row => [row.organization_id, row.tenant_id, row.subject_id]),
    [[a.organizationId, a.tenantId, a.userId], [b.organizationId, b.tenantId, b.userId]]);
  assert.equal(new Set(h.guards.map(row => row.transaction_id)).size, 2);
  assert.deepEqual(h.audit.map(event => event.organizationId), [a.organizationId, b.organizationId]);
  assert.deepEqual(h.transactions.slice(start, beforeRetry).filter(tx => kinds(tx).includes('guard-insert'))
    .map(tx => tx.protocol.filter(query => query.kind === 'store').map(query => query.args[0])),
  [[a.sid, a.sid], [b.sid, b.sid]]);
  assert.equal(h.transactions.length, beforeRetry + 1);
  assert.deepEqual(kinds(h.transactions.at(-1)), ['pending', 'epochs', 'store', 'heartbeat']);
  assert.equal(h.tenantRuns.at(-1).statements.includes('COMMIT'), false);
});

test('a handle from another tenant is rejected before prepare even when both sessions remain valid', async t => {
  const h = fixture(t), a = h.addPrincipal(), b = h.addPrincipal(), handleA = await h.capture(a);
  await assert.rejects(() => h.run(b, handleA));
  assert.equal(h.tenantRuns.at(-1).refusal?.code, 'AUTHORITY_SCOPE_INVALID');
  assertRolledBackWithoutEffect(h);
});
