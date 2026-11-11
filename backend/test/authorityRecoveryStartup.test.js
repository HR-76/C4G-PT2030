'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthorityCoordinator, hash } = require('../src/security/authorityCoordinator');
const { createTenantAuthorityRecovery, snapshotDigest } = require('../src/security/tenantAuthorityRecovery');
const { queries } = require('../src/security/authorityProtocolQueries');

const ORG = '11111111-1111-4111-8111-111111111111';
const TENANT = '22222222-2222-4222-8222-222222222222';
const SUBJECT = '33333333-3333-4333-8333-333333333333';
const QUERY_BY_CODE = new Map(queries.map(query => [hash(query), query]));

// Only the database adapters are doubles. The coordinator, closed SQL protocol,
// branded recovery port and production composition execute their actual code.
function fixture(t, options = {}) {
  const admission = require('../src/security/authoritySecurityManifest');
  t.mock.method(admission, 'assertAuthorityAdmission', async () => {});
  t.mock.method(admission, 'assertAuthoritySecurity', async () => {});
  const calls = [], requests = new Map();
  const snapshot = { organizationId: ORG, tenantId: TENANT, workload: 'API', connectionVersion: 1,
    connectionRevision: 1, bindingDigest: 'synthetic-binding', databaseGenerationId: 'synthetic-generation',
    databaseRef: 'synthetic-database', credentialRef: 'synthetic-credential', observedSystemIdentifier: 'synthetic-system', fence: 1 };
  const guard = { guard_id: '44444444-4444-4444-8444-444444444444', organization_id: ORG, tenant_id: TENANT,
    transaction_id: 'synthetic-original-transaction', correlation_id: 'synthetic-correlation', state: 'PREPARED',
    deadline: new Date(Date.now() - 1000), source_binding: { snapshotDigest: snapshotDigest(snapshot),
      sourceOperation: options.sourceOperation || (options.receipt ? 'F12_UPDATE' : 'F12_READ'), backendPid: 123, backendStart: 'synthetic-start' },
    idempotency_key: options.receipt ? 'synthetic-request' : null, intention_digest: 'synthetic-intention' };
  function protocol(sql, values, permit) {
    if (sql.startsWith('INSERT INTO public.authority_write_request')) {
      requests.set(values[0], { state: 'WAITING', deadline: new Date(values[2]) });
    } else if (sql.startsWith('SELECT state,deadline FROM public.authority_write_request')) {
      return [requests.get(values[0])];
    } else if (sql.startsWith('SELECT request_id FROM public.authority_write_request')) {
      return [];
    } else if (sql.startsWith('SELECT guard_id,deadline FROM public.authority_commit_guard')) {
      return guard.state === 'PREPARED' ? [{ guard_id: guard.guard_id, deadline: guard.deadline }] : [];
    } else if (sql.startsWith('SELECT * FROM public.authority_commit_guard')) {
      assert.equal(values[0], guard.guard_id); return [{ ...guard }];
    } else if (sql.startsWith('UPDATE public.authority_commit_guard SET state=$2')) {
      assert.equal(typeof permit, 'string'); assert.equal(permit.length, 64);
      guard.state = values[1]; guard.reconciliation_result = values[2]; calls.push('guard-recovered'); return [{ ...guard }];
    } else if (sql.startsWith("UPDATE public.authority_write_request SET state='APPLIED'")) {
      requests.get(values[0]).state = 'APPLIED';
    } else if (sql.startsWith("UPDATE public.authority_write_request SET state='CANCELLED'") && values[0]) {
      const request = requests.get(values[0]); if (request?.state === 'WAITING') request.state = 'CANCELLED';
    } else if (sql.startsWith('SELECT om.id FROM public.organization_membership')) {
      assert.equal(values[1], SUBJECT); assert.equal(values[2], ORG); calls.push('membership-validated');
      return [{ id: values[0] }];
    } else if (sql.startsWith('INSERT INTO public.application_session ( sid,')) {
      assert.equal(values[1], SUBJECT); assert.equal(values[4], ORG); calls.push('new-session-bound');
    } else if (sql.startsWith("UPDATE public.application_session SET status = 'REVOKED'")) {
      assert.equal(values[0], 'synthetic-old-session'); calls.push('old-session-revoked');
    } else if (!sql.startsWith('INSERT INTO public.authority_write_permit')
      && !sql.startsWith('INSERT INTO public.authority_scope_epoch')
      && !sql.startsWith('DELETE FROM public.authority_write_permit')
      && !sql.startsWith("UPDATE public.authority_write_request SET state='CANCELLED'")
      && sql !== 'SET CONSTRAINTS ALL IMMEDIATE') {
      assert.fail(`Unexpected protocol query: ${sql}`);
    }
    return [];
  }
  const pool = { async query() { assert.fail('Unexpected uncoordinated query'); }, async connect() {
    calls.push('central-connect');
    return { async query(sql, values = []) {
      if (sql.includes('authority_api.execute')) {
        const original = QUERY_BY_CODE.get(values[0]); assert.ok(original, 'closed protocol query');
        const rows = protocol(original, values[1], values[2]); return { rows: [{ result: { rows, rowCount: rows.length } }] };
      }
      return { rows: sql.includes('c4g_database_identity') ? [{ valid: true }] : [] };
    }, release() { calls.push('central-release'); } };
  } };
  const tenantClient = { async query(sql, values) {
    if (sql.includes('pg_try_advisory_xact_lock')) {
      assert.deepEqual(values, [guard.transaction_id]); calls.push('nonce-lock'); return { rows: [{ locked: !options.activeSource }] };
    }
    if (sql.includes('pg_terminate_backend')) {
      assert.deepEqual(values, [123, 'synthetic-start', guard.transaction_id]); calls.push('terminate-original'); return { rows: [{ terminated: false }] };
    }
    if (sql.startsWith('SELECT request_digest AS intention_digest')) return { rows: options.receipt === 'conflict'
      ? [{ intention_digest: 'different-intention' }] : options.receipt === 'committed' ? [{ intention_digest: guard.intention_digest }] : [] };
    return { rows: [] };
  } };
  const dependencies = {
    directoryRepository: { async resolveSnapshotByOrganization(organizationId, workload) {
      calls.push('directory'); assert.equal(organizationId, ORG); assert.equal(workload, 'API');
      return options.missingSnapshot ? null : { ...snapshot, ...options.snapshot };
    } },
    credentialProvider: { async resolve(input) { calls.push('credential'); assert.equal(input.tenantId, TENANT); return { async dispose() {} }; } },
    poolManager: { async acquire(input) { calls.push('tenant-acquire'); assert.equal(input.tenantId, TENANT);
      return { client: tenantClient, async release() { calls.push('tenant-release'); } }; } },
    bindingVerifier: { async verify({ client, snapshot: selected, requiredCapabilities }) {
      calls.push('binding'); assert.equal(client, tenantClient); assert.equal(selected.tenantId, TENANT);
      assert.deepEqual(requiredCapabilities, [options.sourceOperation==='APPLICATION_REVIEW_REQUEST'?'APPLICATION_DOCUMENT_REVIEW':'F12_PRIVATE_CATALOG_READ', 'F7_AUDIT_LEDGER']);
      if (options.bindingFailure) throw new Error('TENANT_BINDING_REQUIRED');
    } },
    membershipRepository: { async revalidateContext() { assert.fail('No functional tenant operation required'); } },
    regionPolicy: { allows: () => true }, clock: { now: () => new Date() }, scheduler: { setTimeout, clearTimeout }
  };
  const coordinator = createAuthorityCoordinator({ pool, permitSecret: 'synthetic-authority-permit-at-least-32-characters', waitMs: 1 });
  const port = createTenantAuthorityRecovery(dependencies);
  const write = (selected = coordinator) => selected.write([`SUBJECT:${SUBJECT}`], async () => { calls.push('session-write'); return 'saved'; });
  return { coordinator, port, dependencies, pool, calls, guard, requests, write };
}

test('a fresh coordinator recovers an expired guard before its first session writer', async t => {
  const f = fixture(t);
  f.coordinator.registerRuntimeRecovery(f.port);
  assert.deepEqual(f.calls, [], 'registration has no database or credential side effects');
  assert.equal(await f.write(), 'saved');
  assert.equal(f.guard.state, 'RECOVERED');
  assert.equal(f.guard.reconciliation_result, 'READ_TERMINAL');
  assert.ok(f.calls.indexOf('nonce-lock') < f.calls.indexOf('guard-recovered'));
  assert.ok(f.calls.indexOf('guard-recovered') < f.calls.indexOf('session-write'));
  assert.equal([...f.requests.values()][0].state, 'APPLIED');
});
test('review request recovery uses the document review binding', async t => {
  const f=fixture(t,{sourceOperation:'APPLICATION_REVIEW_REQUEST'});
  f.coordinator.registerRuntimeRecovery(f.port);
  await f.write();
  assert.equal(f.guard.reconciliation_result,'READ_TERMINAL');
  assert.ok(f.calls.indexOf('nonce-lock')<f.calls.indexOf('guard-recovered'));
});

test('missing runtime recovery preserves the pending guard and blocks the writer', async t => {
  const f = fixture(t);
  await assert.rejects(f.write, { code: 'AUTHORITY_RECOVERY_UNAVAILABLE' });
  assert.equal(f.guard.state, 'PREPARED'); assert.ok(!f.calls.includes('session-write'));
});

test('initial OIDC session rotation with a membership recovers before binding and revoking SIDs', async t => {
  const f = fixture(t); f.coordinator.registerRuntimeRecovery(f.port);
  const registry = require('../src/security/sessionRegistry').createPgSessionRegistry(f.pool, f.coordinator);
  await registry.rotateSession({ previousSid: 'synthetic-old-session', sid: 'synthetic-new-session',
    globalUserId: SUBJECT, revocationVersion: 1, expiresAt: Date.now() + 60000,
    organizationContext: { organizationId: ORG, membershipId: '55555555-5555-4555-8555-555555555555', membershipVersion: 1 } });
  assert.deepEqual(f.calls.filter(call => ['guard-recovered', 'membership-validated', 'new-session-bound', 'old-session-revoked'].includes(call)),
    ['guard-recovered', 'membership-validated', 'new-session-bound', 'old-session-revoked']);
  assert.equal([...f.requests.values()][0].state, 'APPLIED');
});

test('runtime recovery requires a branded port, permits the same binding and rejects replacement', t => {
  const f = fixture(t);
  for (const invalid of [null, {}, async () => ({ terminal: true })]) {
    assert.throws(() => f.coordinator.registerRuntimeRecovery(invalid), { code: 'AUTHORITY_RECOVERY_BINDING_INVALID' });
  }
  f.coordinator.registerRuntimeRecovery(f.port); f.coordinator.registerRuntimeRecovery(f.port);
  assert.throws(() => f.coordinator.registerRuntimeRecovery(createTenantAuthorityRecovery({ ...f.dependencies })),
    { code: 'AUTHORITY_RECOVERY_BINDING_INVALID' });
  assert.deepEqual(f.calls, []);
});

test('a registered tenant recovery retains precedence over the runtime fallback', async t => {
  const f = fixture(t);
  const fallback = createTenantAuthorityRecovery({ directoryRepository: { async resolveSnapshotByOrganization() { assert.fail('Tenant binding must take precedence'); } } });
  f.coordinator.registerRuntimeRecovery(fallback); f.coordinator.registerRecovery(TENANT, f.port);
  assert.equal(await f.write(), 'saved');
});

for (const [name, options, message] of [
  ['missing directory snapshot', { missingSnapshot: true }, 'AUTHORITY_SOURCE_DRIFT'],
  ['tenant mismatch', { snapshot: { tenantId: ORG } }, 'AUTHORITY_SOURCE_DRIFT'],
  ['changed connection', { snapshot: { connectionVersion: 2 } }, 'AUTHORITY_SOURCE_DRIFT'],
  ['binding verification failure', { bindingFailure: true }, 'TENANT_BINDING_REQUIRED'],
  ['unproven transaction termination', { activeSource: true }, 'AUTHORITY_SOURCE_STILL_ACTIVE'],
  ['conflicting idempotency receipt', { receipt: 'conflict' }, 'AUTHORITY_INTENTION_CONFLICT']
]) {
  test(`runtime recovery fails closed for ${name}`, async t => {
    const f = fixture(t, options); f.coordinator.registerRuntimeRecovery(f.port);
    await assert.rejects(f.write, { message });
    assert.equal(f.guard.state, 'PREPARED'); assert.ok(!f.calls.includes('session-write'));
    assert.equal([...f.requests.values()][0].state, 'CANCELLED');
    if (message === 'AUTHORITY_SOURCE_DRIFT') assert.ok(!f.calls.includes('credential'));
    if (options.bindingFailure) assert.ok(!f.calls.includes('nonce-lock'));
  });
}

for (const receipt of ['committed', 'absent']) {
  test(`runtime recovery observes the ${receipt} receipt before releasing the writer`, async t => {
    const f = fixture(t, { receipt }); f.coordinator.registerRuntimeRecovery(f.port);
    assert.equal(await f.write(), 'saved');
    assert.equal(f.guard.reconciliation_result, receipt === 'committed' ? 'COMMITTED' : 'ROLLED_BACK');
  });
}

test('production installs recovery without I/O before the first authenticated request', async t => {
  const f = fixture(t); let coordinator;
  const composition = require('../src/productionComposition').createProductionComposition({
    dependencies: { express: require('express'), cors: require('cors'), centralPool: {
      query() { assert.fail('No startup query'); }, connect() { assert.fail('No startup connection'); } },
      authorityPool: f.pool, opportunityRuntimeDependencies: f.dependencies, enableRegistration: false,
      createAdmission(input) { coordinator = input.authorityCoordinator; return null; } },
    env: { AUTH_MODE: 'oidc', NODE_ENV: 'development', PUBLIC_APP_URL: 'http://localhost:3000',
      OIDC_ISSUER: 'https://issuer.example.test', OIDC_REDIRECT_URI: 'http://localhost:3000/api/auth/oidc/callback',
      OIDC_CLIENT_ID: 'synthetic', SESSION_SECRET: 'synthetic-session-secret-at-least-32-characters',
      AUTHORITY_COMMIT_PERMIT_SECRET: 'synthetic-authority-permit-at-least-32-characters',
      SESSION_IDLE_MS: '1800000', SESSION_ABSOLUTE_MS: '28800000', OIDC_TRANSACTION_MS: '600000',
      AUTH_POLICY_VERSION: 'c4g-user-mfa-v1', PRIVILEGED_LOGIN_ASSURANCE_CATEGORY: 'recent-auth',
      AUTH_ASSURANCE_POLICY_JSON: JSON.stringify({ 'recent-auth': { mfa: false, maxAgeSeconds: 300,
        acceptedAcr: ['c4g-loa1'], acceptedAmr: ['pwd'], amrMode: 'any' } }) }
  });
  t.after(() => composition.closeOpportunityRuntime());
  assert.deepEqual(f.calls, [], 'composition does not query Central or the tenant');
  assert.equal(await f.write(coordinator), 'saved');
  assert.equal(f.guard.state, 'RECOVERED');
});
