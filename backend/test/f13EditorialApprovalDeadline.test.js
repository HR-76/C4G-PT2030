'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createAuthorityCoordinator } = require('../src/security/authorityCoordinator');
const { createTenantLeaseExecutor, preparedAuthorityBinding } = require('../src/security/tenantLeaseExecutor');
const { createManualClock, createManualScheduler, validSnapshot } = require('./support/tenantRuntimeDoubles');

// Real coordinator/protect/assert and F4 transaction owner; Central, F3/F5 and
// tenant persistence are doubles. This is not a substitute for PostgreSQL proof.
function fixture(t, options = {}) {
  const clock = createManualClock(), start = clock.now();
  const organizationId = randomUUID(), publisherId = randomUUID(), publisherMember = randomUUID();
  const approverId = randomUUID(), approverMember = randomUUID();
  const operationCode = options.operationCode || 'F13_PROFILE_PUBLISH';
  const resourceId=randomUUID(), intentionDigest='c'.repeat(64);
  const versions = { membershipVersion: 1, authorizationVersion: 1, policyVersion: 'test-policy',
    permissionCatalogVersion: 'test-permissions', operationCatalogVersion: 'test-operations', assuranceLevel: 'RECENT_MFA' };
  const approvalEvidence = options.noApproval ? null : { ...versions, subjectId: approverId, membershipId: approverMember,
    validUntil: Object.hasOwn(options, 'validUntil') ? options.validUntil : start + 1000,
    scopeEpochs: Object.fromEntries(['POLICY', `ORG:${organizationId}`, `SUBJECT:${approverId}`, `MEMBER:${approverMember}`].map(k => [k, '0'])),
    ...(options.operationCode==='APPLICATION_DOCUMENT_EDIT'?{applicationId:resourceId,intentionDigest}: {}) };
  const trusted = { actor: { id: publisherId, membershipId: publisherMember, organizationId },
    assuranceEvidence: { authTime: start / 1000 } };
  const sessionAuthority = { async guardIdentity() { return { sessionDigest: 'a'.repeat(64), revocationVersion: 1,
    expiresAt: start + (options.sessionMs || 20000) }; }, async resolve() { return trusted; } };
  const authorization = { async authorize() { return { allowed: true, evaluation: versions }; } };
  t.mock.method(require('../src/security/authenticatedAuthority'), 'isTaxonomySessionAuthority', value => value === sessionAuthority);
  t.mock.method(require('../src/authorization/resourceAuthorization'), 'isResourceAuthorization', value => value === authorization);
  for (const name of ['assertAuthorityAdmission', 'assertAuthoritySecurity']) {
    t.mock.method(require('../src/security/authoritySecurityManifest'), name, async () => {});
  }
  t.mock.method(require('../src/security/authorityProtocolQueries'), 'execute', (client, sql, values) => client.query(sql, values));
  const guards = [], epochQueries = [], guardScopes=[];
  const central = { release() {}, async query(sql, values = []) {
    if (sql.includes('c4g_database_identity')) return { rows: [{ valid: true }] };
    if (sql.includes('SELECT scope_key,epoch')) epochQueries.push(values[0]);
    if (sql.startsWith('INSERT INTO public.authority_commit_guard')) {
      guardScopes.push(values[6]);
      const row = { guard_id: values[0], tenant_id: values[2], transaction_id: values[10],
        deadline: values[15], authority_epoch: 1, state: 'PREPARED' };
      guards.push(row); return { rows: [row] };
    }
    if (sql.startsWith('SELECT * FROM public.authority_commit_guard')) return { rows: [guards.at(-1)] };
    if (sql.startsWith('UPDATE public.authority_commit_guard SET state=')) {
      guards.at(-1).state = values[1]; return { rows: [guards.at(-1)] };
    }
    return { rows: [], rowCount: 0 };
  } };
  const coordinator = createAuthorityCoordinator({ pool: { connect: async () => central, query: (...args) => central.query(...args) },
    permitSecret: 'synthetic-deadline-test-permit-not-production', clock });
  const resourceType = options.operationCode === 'APPLICATION_DOCUMENT_EDIT' ? 'APPLICATION' : 'PROFILE_VERSION';
  const guardPort = coordinator.bindAuthority({ sessionAuthority, authorization,
    operationCatalog: { resolve: () => ({ resourceType, permission: 'profile.publish' }) },
    permissionCatalog: { resolve: () => ({ sensitive: true }) },
    recentMfaRequirement: { maxAgeSeconds: options.mfaSeconds || 300 }, leaseMs: options.leaseMs || 10000 });
  let pending = [], persisted = [], refusal, token;
  const statements = [];
  const physical = { async query(sql) {
    statements.push(sql);
    if (sql.startsWith('BEGIN')) pending = [];
    if (sql.startsWith('INSERT INTO')) pending.push(sql);
    if (sql === 'COMMIT') { persisted.push(...pending); pending = []; }
    if (sql === 'ROLLBACK') pending = [];
    return { rows: sql.includes('pg_stat_activity') ? [{ pid: 1, backend_start: new Date(start).toISOString() }] : [] };
  } };
  const snapshot = validSnapshot({ organizationId, tenantId: organizationId });
  const executor = createTenantLeaseExecutor({ clock, scheduler: createManualScheduler(clock), poolManager: { getFence: () => 0 },
    membershipRepository: { async revalidateContext() { return true; } },
    directoryRepository: { async resolveSnapshotByOrganization() { return snapshot; } }, bindingVerifier: { async verify() {} } });
  const queryModule = Object.freeze({ async execute({ client }) {
    try {
      token = (await guardPort.protect(client, { handle: {}, operationCode,
        resource: { id: resourceId, organizationId, resourceType }, approvalEvidence,
        ...(options.intention ? {intention:{operation:options.intention,key:randomUUID(),digest:options.wrongDigest?'d'.repeat(64):intentionDigest}} : {}) })).token;
    } catch (error) { refusal = error.code; throw error; }
    await client.query('INSERT INTO organization_profile.editorial_publication VALUES (synthetic)');
    await client.query('INSERT INTO audit.event VALUES (synthetic)');
    return 'PUBLISHED';
  }, async beforeCommit() { clock.advance(options.advanceMs || 0); }, authorityGuard: {
    assert({ client }) {
      try { coordinator.assert(token, client, preparedAuthorityBinding(client).transactionId); }
      catch (error) { refusal = error.code; throw error; }
    }, async complete({ outcome }) { if (token) await coordinator.complete(token, outcome); }
  } });
  const lease = executor.issue({ allocation: { client: physical, deadline: start + (options.physicalMs || 20000), fence: 0, async release() {} },
    snapshot, organizationContext: { organizationId, membershipId: publisherMember, membershipVersion: 1 },
    operation: { ownerModule: 'F13_EDITORIAL_BASELINE', operationCode, queryModule, accessMode: 'WRITE', requiredCapabilities: ['SYNTHETIC_QUERY'] },
    correlationId: randomUUID() });
  return { execute: () => lease.execute({}), start, guards, guardScopes, approverId, approverMember, statements, epochQueries,
    get persisted() { return persisted; }, get pending() { return pending; }, get refusal() { return refusal; } };
}

for (const advanceMs of [1000, 1001]) test(`approver A expires before publisher B commit at +${advanceMs}: rollback, no effects, unchanged epochs`, async t => {
  const f = fixture(t, { advanceMs });
  await assert.rejects(f.execute);
  assert.equal(f.refusal, 'AUTHORITY_GUARD_STALE');
  assert.equal(f.guards[0].deadline.getTime(), f.start + 1000);
  assert.equal(f.guards[0].state, 'ABORTED');
  assert.ok(f.epochQueries.length >= 2);
  assert.equal(f.statements.filter(sql => sql.startsWith('INSERT INTO')).length, 2);
  assert.ok(f.statements.includes('ROLLBACK')); assert.ok(!f.statements.includes('COMMIT'));
  assert.deepEqual(f.persisted, []); assert.deepEqual(f.pending, []);
});

for (const offset of [-1, 0]) test(`approval expired at entry (${offset}ms) is refused before guard/effects`, async t => {
  const f = fixture(t, { validUntil: 1_900_000_000_000 + offset });
  await assert.rejects(f.execute); assert.equal(f.refusal, 'F13_APPROVAL_STALE');
  assert.equal(f.guards.length, 0); assert.deepEqual(f.persisted, []);
  assert.equal(f.statements.some(sql => sql.startsWith('INSERT INTO')), false);
});

test('approval still valid one millisecond before expiry permits publication', async t => {
  const f = fixture(t, { advanceMs: 999 });
  assert.equal(await f.execute(), 'PUBLISHED'); assert.equal(f.persisted.length, 2);
  assert.equal(f.guards[0].state, 'TENANT_COMMITTED');
});

for (const limits of [{ leaseMs: 500 }, { sessionMs: 500 }, { physicalMs: 500 }, { mfaSeconds: 1 }]) {
  test(`earlier existing limit wins: ${JSON.stringify(limits)}`, async t => {
    const f = fixture(t, { ...limits, validUntil: 1_900_000_005_000 });
    await f.execute();
    assert.equal(f.guards[0].deadline.getTime(), f.start + (limits.mfaSeconds ? 1000 : 500));
  });
}

for (const operationCode of ['F13_PROFILE_SUBMIT', 'F13_PROFILE_READ', 'OPPORTUNITY_UPDATE']) {
  test(`no approval preserves existing deadline: ${operationCode}`, async t => {
    const f = fixture(t, { noApproval: true, operationCode, advanceMs: 1001 });
    await f.execute(); assert.equal(f.guards[0].deadline.getTime(), f.start + 10000);
  });
}

test('explicit null approval expiry introduces no deadline', async t => {
  const f = fixture(t, { validUntil: null, advanceMs: 1001 });
  await f.execute(); assert.equal(f.guards[0].deadline.getTime(), f.start + 10000);
});
test('review request fences reviewer authority until commit', async t => {
  const f=fixture(t,{operationCode:'APPLICATION_DOCUMENT_EDIT',intention:'APPLICATION_REVIEW_REQUEST',advanceMs:1000});
  await assert.rejects(f.execute);assert.equal(f.refusal,'AUTHORITY_GUARD_STALE');assert.deepEqual(f.persisted,[]);
  assert.ok(f.guardScopes[0].includes(`SUBJECT:${f.approverId}`));assert.ok(f.guardScopes[0].includes(`MEMBER:${f.approverMember}`));
});
test('reviewer evidence is refused for other document mutations', async t => {
  const f=fixture(t,{operationCode:'APPLICATION_DOCUMENT_EDIT',intention:'APPLICATION_DOCUMENT_LINK'});
  await assert.rejects(f.execute);assert.equal(f.refusal,'AUTHORITY_APPROVAL_INVALID');assert.deepEqual(f.persisted,[]);
});
test('reviewer evidence cannot be reused for a different intention', async t => {
  const f=fixture(t,{operationCode:'APPLICATION_DOCUMENT_EDIT',intention:'APPLICATION_REVIEW_REQUEST',wrongDigest:true});
  await assert.rejects(f.execute);assert.equal(f.refusal,'AUTHORITY_APPROVAL_INVALID');assert.deepEqual(f.persisted,[]);
});
for (const validUntil of [undefined, NaN, Infinity, '1900000001000', new Date(1_900_000_001_000), 1_900_000_001_000.5]) {
  test(`invalid approval expiry fails closed: ${String(validUntil)}`, async t => {
    const f = fixture(t, { validUntil });
    await assert.rejects(f.execute); assert.equal(f.refusal, 'F13_APPROVAL_STALE');
    assert.equal(f.guards.length, 0); assert.deepEqual(f.persisted, []);
  });
}
