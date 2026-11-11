'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CASE_IDS, assertSessionFacts, assertEquivalent, assertCleanup, assertFailureEvidence, runRepositoryGate, readPartners, seedPartners } = require('../../test/integration/partner-portal/repositoryProbe');

const facts = () => ({ isolation: 'read committed', currentUser: 'c4g_opportunity_tenant_runtime',
  login: { rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false, rolreplication: false, rolinherit: false, ownerMember: false },
  tables: ['application', 'application_partner'].map(name => ({ name, rls: true, forced: true })) });

test('repository gate module imports without configuration, connection or infrastructure', () => {
  assert.equal(typeof runRepositoryGate, 'function');
  assert.equal(CASE_IDS.length, new Set(CASE_IDS).size);
  assert.ok(CASE_IDS.includes('repository.contract-matrix'));
  assert.ok(CASE_IDS.includes('cleanup.disconnect'));
});

test('repository gate refuses an incomplete environment before touching a pool', async () => {
  let touched = false;
  await assert.rejects(runRepositoryGate({ tenants: [{ pool: { query() { touched = true; } } }] }), { code: 'GATE_ENVIRONMENT_REQUIRED' });
  assert.equal(touched, false);
});

test('session evidence requires READ COMMITTED, limited non-owner login and FORCE RLS', () => {
  assert.doesNotThrow(() => assertSessionFacts(facts()));
  for (const mutate of [x => { x.isolation = 'repeatable read'; }, x => { x.currentUser = 'postgres'; },
    x => { x.login.rolbypassrls = true; }, x => { x.login.ownerMember = true; }, x => { delete x.login.rolsuper; },
    x => { x.tables[0].forced = false; }, x => { x.tables[1].rls = false; }, x => { x.tables.pop(); }]) {
    const value = facts(); mutate(value); assert.throws(() => assertSessionFacts(value));
  }
});

test('equivalence compares whole projections, countries and opaque signed cursors', () => {
  const first = { items: [{ id: 'id', people: [{ name: 'Inês' }] }], total: 26, page: 1, countries: ['Portugal'], nextCursor: 'synthetic', previousCursor: null };
  const value = assertEquivalent(first, structuredClone(first));
  assert.match(value.responseDigest, /^[a-f0-9]{64}$/); assert.ok(value.responseBytes > 0);
  for (const mutate of [x => { x.items[0].people[0].name = 'Changed'; }, x => { x.countries = []; }, x => { x.nextCursor = 'different'; }]) {
    const second = structuredClone(first); mutate(second); assert.throws(() => assertEquivalent(first, second));
  }
});

test('cleanup requires observation on the original physical session, not an admin observer', () => {
  assert.doesNotThrow(() => assertCleanup({ requestPid: 10, observedPid: 10, portals: 0, roleReset: true }));
  for (const evidence of [{ requestPid: 10, observedPid: 11, portals: 0, roleReset: true },
    { requestPid: 10, observedPid: 10, portals: 1, roleReset: true },
    { requestPid: 10, observedPid: 10, portals: 0, roleReset: false },
    { requestPid: 10, observedPid: 10, portals: null, roleReset: true }]) assert.throws(() => assertCleanup(evidence));
});

test('cleanup fault evidence cannot pass on an unrelated early failure or unobserved injection', () => {
  assert.doesNotThrow(() => assertFailureEvidence('cancel', { errorCode: 'SERVICE_UNAVAILABLE', injectedFault: true, injectedSqlState: '57014' }));
  assert.doesNotThrow(() => assertFailureEvidence('sql-abort', { errorCode: 'SERVICE_UNAVAILABLE', injectedFault: true, injectedSqlState: '22012' }));
  assert.doesNotThrow(() => assertFailureEvidence('local-error', { errorCode: 'INVALID_CURSOR', injectedFault: false, injectedSqlState: null }));
  for (const evidence of [{ errorCode: 'SERVICE_UNAVAILABLE', injectedFault: false, injectedSqlState: null },
    { errorCode: 'SERVICE_UNAVAILABLE', injectedFault: true, injectedSqlState: '42501' },
    { errorCode: 'SCHEMA_UPGRADE_REQUIRED', injectedFault: true, injectedSqlState: '57014' }]) {
    assert.throws(() => assertFailureEvidence('cancel', evidence));
  }
  assert.throws(() => assertFailureEvidence('local-error', { errorCode: 'SERVICE_UNAVAILABLE' }));
});

function transactionDouble(options = {}) {
  const state = { tx: false, roleReset: true, portals: 0, queries: [], released: [] };
  const client = { async query(sql, values) {
    state.queries.push({ sql, values });
    if (options.fail?.(sql, state)) throw options.error;
    if (sql === 'SELECT pg_backend_pid() pid') return { rows: [{ pid: 100 }] };
    if (sql === 'SHOW transaction_isolation') return { rows: [{ transaction_isolation: 'read committed' }] };
    if (sql === 'BEGIN') state.tx = true;
    if (sql.startsWith('SET LOCAL ROLE')) state.roleReset = false;
    if (sql === 'COMMIT' || sql === 'ROLLBACK') { state.tx = false; state.roleReset = true; state.portals = 0; }
    if (sql.includes('to_regclass')) return { rows: [{ relation: 'application_partner' }] };
    if (sql.startsWith('DECLARE')) state.portals++;
    if (sql.startsWith('CLOSE')) state.portals--;
    if (sql.includes('FROM pg_cursors')) return { rows: [{ n: state.portals }] };
    if (sql.includes('current_user=session_user')) return { rows: [{ pid: 100, reset: state.roleReset }] };
    return { rows: [] };
  }, release(error) { state.released.push(error); } };
  const tenant = { organizationId: '10000000-0000-4000-8000-000000000001',
    owner: { id: '20000000-0000-4000-8000-000000000001', membershipId: '20000000-0000-4000-8000-000000000002' },
    opportunityId: '50000000-0000-4000-8000-000000000001',
    runtimePool: { connect: async () => client }, pool: { connect: async () => client, query: (...args) => client.query(...args) } };
  return { state, tenant };
}

test('repository transaction helper awaits cleanup on its own session and releases once', async () => {
  const h = transactionDouble(), value = await readPartners(h.tenant);
  assert.equal(value.result.total, 0); assert.equal(value.portalsBeforeEnd, 0);
  assert.equal(value.cleanup.requestPid, value.cleanup.observedPid);
  assert.equal(h.state.released.length, 1); assert.equal(h.state.released[0], undefined);
  assert.equal(h.state.tx, false);
});

test('failed role setup rolls back before observation and never starts the repository portal', async () => {
  const primary = Object.assign(new Error('synthetic role denial'), { code: '42501' });
  const h = transactionDouble({ fail: sql => sql.startsWith('SET LOCAL ROLE'), error: primary });
  const value = await readPartners(h.tenant);
  assert.equal(value.error, primary); assert.equal(h.state.tx, false);
  assert.ok(!h.state.queries.some(query => query.sql.startsWith('DECLARE')));
  assert.ok(h.state.queries.some(query => query.sql === 'ROLLBACK'));
  assert.equal(h.state.released.length, 1);
});

test('cleanup observation failure discards the owned client rather than leaking/reusing it', async () => {
  const primary = Object.assign(new Error('synthetic disconnected session'), { code: 'ECONNRESET' });
  const h = transactionDouble({ fail: (sql, state) => sql.includes('FROM pg_cursors') && !state.tx, error: primary });
  await assert.rejects(readPartners(h.tenant), error => error === primary);
  assert.deepEqual(h.state.released, [primary]);
});

test('capacity fixture keeps at most 100 partners per application and preserves historical people', async () => {
  const h = transactionDouble();
  const body = { people: [{ id: '60000000-0000-4000-8000-000000000001', name: 'Historical', active: false }] };
  const seed = await seedPartners(h.tenant, { count: 201, body, prefix: 'OfflineFixture' });
  assert.equal(seed.rows.length, 201); assert.equal(seed.appIds.length, 3);
  assert.equal(new Set(seed.partnerIds).size, 201);
  for (const id of seed.appIds) assert.ok(seed.rows.filter(row => row.application_id === id).length <= 100);
  assert.deepEqual(seed.rows[0].body.people, body.people);
  await seed.cleanup();
  const last = h.state.queries.at(-1);
  assert.match(last.sql, /^UPDATE .* SET active=false WHERE partner_id=ANY/);
  assert.deepEqual(last.values[0], seed.partnerIds);
  assert.ok(!h.state.queries.some(query => /\b(DELETE|TRUNCATE|CREATE|GRANT|DROP)\b/.test(query.sql)));
});
