'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createAuthorityCoordinator, hash } = require('../src/security/authorityCoordinator');
const { createAuthorityDataRepository } = require('../src/authorization/authorityDataRepository');
const { createTaxonomyAuthorization, isResourceAuthorization } = require('../src/authorization/resourceAuthorization');
const { createProductionCatalogs } = require('../src/authorization/catalogs');
const { createManualClock } = require('./support/tenantRuntimeDoubles');
const protocol = require('../src/security/authorityProtocolQueries');

const byCode = new Map(protocol.queries.map(sql => [hash(sql), sql]));
const policyVersion = 'partner-authority-group-test-v1';
const recentMfaRequirement = { maxAgeSeconds: 300, mfa: true, acceptedAcr: ['c4g-loa2'], acceptedAmr: ['otp'], amrMode: 'all' };

// Real coordinator, closed protocol, F5 repository and authorizer. Only storage
// and schema/admission evidence are controlled; no infrastructure is accessed.
function fixture(t, { timeoutMs = 10000 } = {}) {
  const clock = createManualClock(), dateClock = { now: () => new Date(clock.now()) };
  const catalogs = createProductionCatalogs({ catalogVersion: 'f13' });
  const transactions = [], principals = [], events = [], policyCalls = [], active = new Set();
  const hooks = { protocol: null, commit: null, snapshot: null, audit: null };
  let groups = 0;
  const schema = require('../src/security/authoritySecurityManifest');
  t.mock.method(schema, 'assertAuthorityAdmission', async client => {
    client.transaction.checks.push('admission'); return { currentVersion: 'synthetic-admitted' };
  });
  t.mock.method(schema, 'assertAuthoritySecurity', async client => { client.transaction.checks.push('post-lock'); });
  function principal() {
    const p = { organizationId: randomUUID(), membershipId: randomUUID(), userId: randomUUID(), resourceId: randomUUID(),
      status: 'ACTIVE', grant: true, membershipVersion: 1, authorizationVersion: 1 };
    principals.push(p); return p;
  }
  function rows(sql, args) {
    const membership = sql.startsWith('SELECT m.id,m.organization_id,m.global_user_id');
    const policy = sql.startsWith('SELECT f.organization_id,f.membership_id');
    assert.ok(membership || policy, 'only the original membership/F5 domain queries are needed');
    const p = principals.find(value => value.organizationId === args[membership ? 1 : 0]
      && value.membershipId === args[membership ? 0 : 1]);
    const kind = membership ? 'membership' : 'policy';
    if (!p) return { kind, rows: [] };
    return { kind, rows: [membership ? { id: p.membershipId, organization_id: p.organizationId,
      global_user_id: p.userId, membership_version: p.membershipVersion, status: p.status, valid_until: null }
      : { organization_id: p.organizationId, membership_id: p.membershipId, membership_version: p.membershipVersion,
        authorization_version: p.authorizationVersion, base_role_code: 'VIEWER', policy_version: policyVersion,
        assurance_requirements: recentMfaRequirement, grants: p.grant ? ['application.read', 'opportunity.archive'].map(permission => ({
          permission, scope: { type: 'ORGANIZATION', id: p.organizationId, organizationId: p.organizationId } })) : [] }] };
  }
  const pool = { query() { throw Error('Raw pool use forbidden'); }, async connect() {
    const transaction = { id: transactions.length + 1, statements: [], protocol: [], checks: [], releases: [] };
    transactions.push(transaction);
    return { transaction, release(error) { transaction.releases.push(error); }, async query(sql, values = []) {
      transaction.statements.push(sql);
      if (sql === 'BEGIN') active.add(transaction);
      if (sql === 'COMMIT') { await hooks.commit?.(transaction); active.delete(transaction); }
      if (sql === 'ROLLBACK') active.delete(transaction);
      if (sql === 'SELECT authority_api.execute($1,$2::text[],$3) AS result') {
        const original = byCode.get(values[0]); assert.ok(original, 'use the exact allowlisted protocol');
        const result = rows(original, values[1]);
        const observation = { kind: result.kind, code: values[0], args: values[1] };
        transaction.protocol.push(observation); await hooks.protocol?.({ transaction, observation });
        return { rows: [{ result: { rows: result.rows, rowCount: result.rows.length } }] };
      }
      return { rows: sql.includes('c4g_database_identity') ? [{ valid: true }] : [] };
    } };
  } };
  const coordinator = createAuthorityCoordinator({ pool, clock: dateClock, timeoutMs,
    permitSecret: 'synthetic-partner-authority-group-not-production' });
  const data = createAuthorityDataRepository({ coordinator, catalogs, policyVersion, recentMfaRequirement });
  function authorizer(grouped) {
    return createTaxonomyAuthorization({ ...data, catalogs, assurancePolicyVersion: policyVersion, recentMfaRequirement,
      clock: dateClock, exactResourceScope: false,
      ...(grouped ? { withAuthorityReads(work) { groups++; return coordinator.withAuthority(work); } } : {}),
      async snapshotForResource(input) {
        policyCalls.push({ actor: input.actor, active: active.size });
        await hooks.snapshot?.(input); return input.snapshot;
      }, authorizationAuditPort: { async accept(event) {
        events.push({ event, active: active.size }); return await hooks.audit?.(event) || 'ACCEPTED';
      } } });
  }
  function trusted(p) {
    return { actor: { type: 'HUMAN', id: p.userId, organizationId: p.organizationId, membershipId: p.membershipId,
      membershipVersion: 1, authorizationVersion: 1 }, correlationId: p.resourceId,
      assuranceEvidence: { policyVersion, authTime: clock.now() / 1000, acr: 'c4g-loa2', amr: ['otp'] } };
  }
  function resource(p, operationCode = 'APPLICATION_READ') {
    return { id: p.resourceId, organizationId: p.organizationId, resourceType: catalogs.operationCatalog.resolve(operationCode).resourceType,
      scopeType: 'ORGANIZATION', status: 'ACTIVE', distinctFromActorIds: [] };
  }
  return { coordinator, clock, principals, transactions, events, policyCalls, active, hooks, principal, authorizer, trusted, resource,
    groups: () => groups };
}
const domain = transactions => transactions.flatMap(tx => tx.protocol);
const commands = transactions => transactions.reduce((sum, tx) => sum + tx.statements.length, 0);

test('grouped decision retains domain protocol, decision and audit while reducing two transactions to one', async t => {
  const f = fixture(t), p = f.principal(), trusted = f.trusted(p), resource = f.resource(p);
  const baseline = await f.authorizer(false).authorize('APPLICATION_READ', trusted, resource);
  const originalTransactions = [...f.transactions], originalEvents = f.events.map(row => row.event);
  const start = f.transactions.length, eventStart = f.events.length;
  const candidate = f.authorizer(true);
  const actual = await candidate.authorize('APPLICATION_READ', trusted, resource);
  const grouped = f.transactions.slice(start);
  assert.equal(isResourceAuthorization(candidate), true);
  assert.equal(baseline.allowed, true); assert.deepEqual(actual, baseline);
  assert.deepEqual(f.events.slice(eventStart).map(row => row.event), originalEvents);
  assert.deepEqual(domain(grouped), domain(originalTransactions));
  assert.deepEqual(domain(grouped).map(row => row.kind), ['membership', 'policy']);
  assert.equal(originalTransactions.length, 2); assert.equal(grouped.length, 1);
  assert.equal(commands(originalTransactions), 14); assert.equal(commands(grouped), 8);
  assert.deepEqual(grouped[0].checks, ['admission', 'post-lock']);
  assert.deepEqual(grouped[0].releases, [undefined]);
  assert.ok(f.policyCalls.every(row => row.active === 0), 'tenant policy runs after the read group commits');
  assert.ok(f.events.every(row => row.active === 0), 'F7 runs after the read group commits');
});

for (const [fault, reason, expectedQueries] of [
  ['inactive', 'MEMBERSHIP_INACTIVE_OR_MISMATCH', ['membership']],
  ['membership', 'MEMBERSHIP_UNAVAILABLE', ['membership']],
  ['policy', 'POLICY_DATA_UNAVAILABLE', ['membership', 'policy']]
]) test(`grouped ${fault} refusal preserves short circuit, reason and audit`, async t => {
  const f = fixture(t), p = f.principal();
  if (fault === 'inactive') p.status = 'SUSPENDED';
  else f.hooks.protocol = ({ observation }) => { if (observation.kind === fault) throw Error('PRIVATE_STORAGE_FAILURE'); };
  const results = [], events = [];
  for (const grouped of [false, true]) {
    const start = f.transactions.length, eventStart = f.events.length;
    results.push(await f.authorizer(grouped).authorize('APPLICATION_READ', f.trusted(p), f.resource(p)));
    events.push(f.events.slice(eventStart).map(row => row.event));
    assert.deepEqual(domain(f.transactions.slice(start)).map(row => row.kind), expectedQueries);
  }
  assert.equal(results[0].reasonCode, reason); assert.deepEqual(results[1], results[0]);
  assert.deepEqual(events[1], events[0]); assert.equal(f.policyCalls.length, 0);
  assert.ok(f.events.every(row => row.active === 0));
  assert.equal(f.groups(), 1);
});

for (const fault of ['commit', 'deadline']) test(`grouped ${fault} failure cannot emit ALLOW or reach tenant policy`, async t => {
  const f = fixture(t, { timeoutMs: fault === 'deadline' ? 40 : 10000 }), p = f.principal();
  if (fault === 'commit') f.hooks.commit = () => { throw Error('PRIVATE_COMMIT_FAILURE'); };
  else f.hooks.protocol = () => { f.clock.advance(25); };
  const decision = await f.authorizer(true).authorize('APPLICATION_READ', f.trusted(p), f.resource(p));
  assert.equal(decision.allowed, false); assert.equal(decision.reasonCode, 'POLICY_DATA_UNAVAILABLE');
  assert.equal(f.transactions.length, 1); assert.ok(f.transactions[0].statements.includes('ROLLBACK'));
  assert.equal(f.transactions[0].releases.length, 1); assert.ok(f.transactions[0].releases[0]);
  assert.equal(f.policyCalls.length, 0); assert.ok(f.events.every(row => row.event.result === 'DENY' && row.active === 0));
});

test('fresh decisions observe membership and grant revocation without sharing snapshots between calls', async t => {
  const f = fixture(t), p = f.principal(), authorization = f.authorizer(true), trusted = f.trusted(p), target = f.resource(p);
  assert.equal((await authorization.authorize('APPLICATION_READ', trusted, target)).allowed, true);
  p.grant = false;
  assert.equal((await authorization.authorize('APPLICATION_READ', trusted, target)).reasonCode, 'PERMISSION_NOT_GRANTED');
  p.status = 'SUSPENDED';
  assert.equal((await authorization.authorize('APPLICATION_READ', trusted, target)).reasonCode, 'MEMBERSHIP_INACTIVE_OR_MISMATCH');
  assert.deepEqual(f.transactions.map(tx => tx.protocol.map(row => row.kind)), [['membership', 'policy'], ['membership', 'policy'], ['membership']]);
  assert.deepEqual(f.events.map(row => row.event.result), ['ALLOW', 'DENY', 'DENY']);
});

test('concurrent decisions keep tenant membership, grants and audit isolated', async t => {
  const f = fixture(t), a = f.principal(), b = f.principal(), authorization = f.authorizer(true);
  b.grant = false;
  const results = await Promise.all([a, b].map(p => authorization.authorize('APPLICATION_READ', f.trusted(p), f.resource(p))));
  assert.deepEqual(results.map(row => row.allowed), [true, false]);
  assert.equal(f.transactions.length, 2);
  for (const tx of f.transactions) {
    assert.deepEqual(tx.protocol.map(row => row.kind), ['membership', 'policy']);
    assert.deepEqual(tx.protocol[0].args, [...tx.protocol[1].args].reverse());
  }
  assert.deepEqual(f.events.map(row => [row.event.organizationId, row.event.result]).sort(), [[a.organizationId, 'ALLOW'], [b.organizationId, 'DENY']].sort());
});

test('read groups reuse the existing coordinator transaction in protected preparation', async t => {
  const f = fixture(t), p = f.principal(), authorization = f.authorizer(true);
  const decision = await f.coordinator.withAuthority(() => authorization.authorize('APPLICATION_READ', f.trusted(p), f.resource(p)));
  assert.equal(decision.allowed, true); assert.equal(f.groups(), 1);
  assert.equal(f.transactions.length, 1); assert.deepEqual(domain(f.transactions).map(row => row.kind), ['membership', 'policy']);
  assert.equal(f.transactions[0].statements.filter(sql => sql === 'BEGIN').length, 1);
  assert.equal(f.transactions[0].statements.filter(sql => sql === 'COMMIT').length, 1);
});

test('critical audit rejection remains authoritative after the group releases its transaction', async t => {
  const f = fixture(t), p = f.principal(); f.hooks.audit = () => 'REJECTED';
  const results = [], events = [];
  for (const grouped of [false, true]) {
    const start = f.events.length;
    results.push(await f.authorizer(grouped).authorize('OPPORTUNITY_ARCHIVE', f.trusted(p), f.resource(p, 'OPPORTUNITY_ARCHIVE')));
    events.push(f.events.slice(start).map(row => row.event));
  }
  assert.equal(results[0].reasonCode, 'AUDIT_CRITICAL_UNAVAILABLE'); assert.deepEqual(results[1], results[0]);
  assert.deepEqual(events[1], events[0]); assert.ok(f.events.every(row => row.active === 0));
  assert.equal(f.groups(), 1);
});

test('request and operation validation precede any grouped reads', async t => {
  const f = fixture(t), p = f.principal(), authorization = f.authorizer(true);
  await assert.rejects(authorization.authorize('APPLICATION_READ', { ...f.trusted(p), actor: { ...f.trusted(p).actor, unexpected: true } }, f.resource(p)), TypeError);
  assert.equal((await authorization.authorize('UNKNOWN', f.trusted(p), f.resource(p))).reasonCode, 'OPERATION_NOT_REGISTERED');
  assert.equal(f.groups(), 0); assert.equal(f.transactions.length, 0);
});
