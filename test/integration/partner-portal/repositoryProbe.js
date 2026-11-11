'use strict';

// Loaded offline safely. Only runRepositoryGate/seedPartners connect through the
// explicitly supplied disposable environment. No env vars or localPlatform config.
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { createPartnersRepository, parse } = require('../../../backend/src/applications/partners');
const { createPartnersPortalRepository } = require('../../../backend/prototypes/partnerSqlPortal');
const { createPq1UiTokens } = require('../../../backend/src/organizationalProfile/pq1UiTokens');
const { CASES, ORGANIZATION, SUBJECT } = require('../../../backend/test/support/partnerBrowseContract');
const CASE_IDS = Object.freeze(['repository.roles-rls', 'repository.cross-tenant-connect', 'repository.equivalence',
  'repository.collation', 'repository.contract-matrix', 'snapshot.before-declare', 'snapshot.after-declare',
  'snapshot.between-fetches', 'cleanup.success', 'cleanup.local-error', 'cleanup.sql-abort',
  'cleanup.cancel', 'cleanup.disconnect', 'cleanup.session-reuse']);
const failure = code => Object.assign(new Error(code), { code });
const key = (operation, resourceId) => `${operation}:${resourceId}`;
const tokens = clock => createPq1UiTokens({ keys: { contract: 'synthetic-partner-contract-key-0000000000000000' },
  currentKeyId: 'contract', clock: clock || (() => Date.UTC(2026, 9, 27, 12)) });
const safeCode = error => /^[A-Z0-9_]{1,80}$/.test(error?.code || '') ? error.code : 'REPOSITORY_PROBE_FAILED';
function hasLoneSurrogate(value) {
  if (typeof value === 'string') {
    for (let i = 0; i < value.length; i++) {
      const n = value.charCodeAt(i);
      if (n >= 0xd800 && n <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return true; }
      else if (n >= 0xdc00 && n <= 0xdfff) return true;
    }
    return false;
  }
  return value && typeof value === 'object' ? Object.values(value).some(hasLoneSurrogate) : false;
}

function assertSessionFacts(facts) {
  assert.equal(facts.isolation, 'read committed'); assert.equal(facts.currentUser, 'c4g_opportunity_tenant_runtime');
  for (const flag of ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolbypassrls', 'rolreplication', 'rolinherit', 'ownerMember']) assert.equal(facts.login[flag], false);
  assert.deepEqual(facts.tables.map(row => row.name).sort(), ['application', 'application_partner']);
  assert.ok(facts.tables.every(row => row.rls === true && row.forced === true));
}
function assertEquivalent(before, after) {
  assert.deepEqual(after, before);
  const bytes = JSON.stringify(after);
  return { responseDigest: createHash('sha256').update(bytes).digest('hex'), responseBytes: Buffer.byteLength(bytes) };
}
function assertCleanup(evidence) {
  assert.ok(Number.isInteger(evidence.requestPid) && evidence.requestPid > 0);
  assert.equal(evidence.observedPid, evidence.requestPid); assert.equal(evidence.portals, 0); assert.equal(evidence.roleReset, true);
}
function assertFailureEvidence(phase, evidence) {
  if (phase === 'success') { assert.equal(evidence.errorCode, null); return; }
  if (phase === 'local-error') { assert.equal(evidence.errorCode, 'INVALID_CURSOR'); return; }
  assert.ok(['sql-abort', 'cancel'].includes(phase));
  assert.equal(evidence.errorCode, 'SERVICE_UNAVAILABLE'); assert.equal(evidence.injectedFault, true);
  assert.equal(evidence.injectedSqlState, phase === 'cancel' ? '57014' : '22012');
}
async function cursorCount(client) {
  return (await client.query("SELECT count(*)::int n FROM pg_cursors WHERE name LIKE 'c4g_partner_browse_%'")).rows[0].n;
}
async function beginReader(client, organizationId) {
  await client.query('BEGIN');
  try {
    assert.equal((await client.query('SHOW transaction_isolation')).rows[0].transaction_isolation, 'read committed');
    await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
    await client.query("SELECT set_config('app.organization_id',$1,true)", [organizationId]);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

// A repository-only transaction owner. Authority ports here are controlled; the
// separate authority probe must exercise the actual composition/guard/F7 path.
async function readPartners(tenant, { variant = 'after', input = {}, authorize = async () => true, protect = async () => {},
  hook, cursor = tokens(), schemaReady = true, subjectId = tenant.owner.id, client: supplied } = {}) {
  const client = supplied || await tenant.runtimePool.connect();
  let discard;
  try {
  let began = false, result, error, commands = 0, fetchedRows = 0, authorizationCalls = 0, fetches = 0;
  const requestPid = (await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;
  let portalsBeforeEnd = null;
  try {
    await beginReader(client, tenant.organizationId); began = true;
    const adapter = { async query(sql, values) {
      const phase = sql.includes('to_regclass') ? 'schema' : sql.split(' ')[0];
      if (phase === 'FETCH') fetches++;
      await hook?.({ when: 'before', phase, fetches, client, requestPid });
      commands++;
      const query = phase === 'schema' && !schemaReady ? "SELECT to_regclass('opportunity_catalog.__gate_absent_partner') AS relation" : sql;
      const answer = await client.query(query, values);
      if (phase === 'FETCH' || (variant === 'before' && phase === 'SELECT' && sql.includes('FROM opportunity_catalog.application_partner p'))) fetchedRows += answer.rows.length;
      await hook?.({ when: 'after', phase, fetches, client, requestPid });
      return answer;
    } };
    const factory = variant === 'before' ? createPartnersRepository : createPartnersPortalRepository;
    const repository = factory({ organizationId: tenant.organizationId, actor: { id: subjectId }, cursor, protect,
      authorize: async (...args) => { authorizationCalls++; return authorize(...args); }, audit: async () => { throw failure('UNEXPECTED_MUTATION_AUDIT'); } });
    result = await repository.partnersBrowse(adapter, null, parse('partnersBrowse', input));
    portalsBeforeEnd = await cursorCount(client); assert.equal(portalsBeforeEnd, 0);
    await client.query('COMMIT'); began = false;
  } catch (cause) {
    error = cause;
    if (began) { await client.query('ROLLBACK'); began = false; }
  } finally {
    if (began) await client.query('ROLLBACK');
  }
  const observed = (await client.query('SELECT pg_backend_pid() pid,current_user=session_user AS reset')).rows[0];
  const cleanup = { requestPid, observedPid: observed.pid, portals: await cursorCount(client), roleReset: observed.reset };
  assertCleanup(cleanup);
  return { result, error, cleanup, portalsBeforeEnd, commands, fetchedRows, authorizationCalls };
  } catch (error) { discard = error; throw error; }
  finally { if (!supplied) client.release(discard); }
}

// All mutations below are synthetic fixture data inside the already verified
// disposable cluster. Rows are archived with active=false; never DELETE/TRUNCATE.
async function seedPartners(tenant, { count, body = {}, prefix = `GateRepo-${randomUUID()}`, partnersPerApplication = 100, sharedOrigin = true } = {}) {
  assert.ok(Number.isInteger(count) && count >= 0 && count <= 10001);
  assert.ok(Number.isInteger(partnersPerApplication) && partnersPerApplication >= 1 && partnersPerApplication <= 100);
  const appIds = Array.from({ length: Math.ceil(count / partnersPerApplication) }, () => randomUUID());
  const opportunityIds = [];
  for (let i = 0; i < appIds.length; i++) {
    if (sharedOrigin) opportunityIds.push(tenant.opportunityId);
    else {
      const { TenantOpportunityRepository } = require('../../../backend/src/opportunities/tenantRepository');
      const repository = new TenantOpportunityRepository({ pool: tenant.pool, organizationId: tenant.organizationId,
        identityFactory: require('../../../backend/src/opportunities/identity').createIdentityFactory() });
      const created = await repository.create({ schemaVersion: 1, requestId: randomUUID(), snapshot: { schemaVersion: 1,
        title: `${prefix} origin ${i}`, funderName: 'Synthetic funder', provenanceId: randomUUID(), lifecycleState: 'ACTIVE',
        validationState: 'PENDING_REVIEW', normalizationVersion: 'opportunity-normalization-v1', qualityRuleVersion: 'opportunity-quality-v1',
        summary: 'Synthetic gate', fundingAmountMin: '0', fundingAmountMax: '1', currencyCode: 'EUR', closingDate: '2027-12-31' },
      provenance: { schemaVersion: 1, sourceType: 'ORGANIZATION_MANUAL', sourceNamespace: 'PARTNER_GATE', observedAt: new Date().toISOString() } },
      { actor: { type: 'HUMAN', reference: tenant.owner.id } });
      opportunityIds.push(created.opportunityId);
    }
  }
  const partnerIds = Array.from({ length: count }, () => randomUUID()).sort();
  const rows = partnerIds.map((partnerId, index) => ({ partner_id: partnerId, organization_id: tenant.organizationId,
    application_organization_id: tenant.organizationId, application_id: appIds[Math.floor(index / partnersPerApplication)],
    opportunity_id: opportunityIds[Math.floor(index / partnersPerApplication)], evaluation_id: null, active: true,
    application_title: 'Synthetic gate application', application_status: 'PREPARATION',
    created_at: '2026-10-27T00:00:00.000Z', updated_at: '2026-10-27T00:00:00.000Z',
    body: { country: 'Portugal', research_area_interest: '', responsible_person: '', contact: '', email: '', people: [], ...structuredClone(body),
      entity_name: `${prefix} ${String(index + 1).padStart(5, '0')}` } }));
  await installRows(tenant, rows, false);
  return { rows, appIds, partnerIds, prefix, async cleanup() {
    if (partnerIds.length) await tenant.pool.query('UPDATE opportunity_catalog.application_partner SET active=false WHERE partner_id=ANY($1::uuid[])', [partnerIds]);
  } };
}

async function installRows(tenant, rows, cloneOrigins = true) {
  if (!rows.length) return;
  const client = await tenant.pool.connect();
  try {
    await client.query('BEGIN');
    // The existing contract includes deliberately impossible central+evaluation
    // data. Prove the actual constraint rejection instead of editing its oracle.
    const impossible = rows.find(row => !row.opportunity_id && row.evaluation_id);
    if (impossible) await client.query(`INSERT INTO opportunity_catalog.application
      (organization_id,application_id,central_opportunity_id,central_revision_id,central_snapshot,evaluation_id,title,responsible_membership_id,deadline,created_by)
      VALUES($1,$2,$3,$4,'{}',$5,'Impossible fixture',$6,'2027-12-31',$7)`,
    [impossible.organization_id, impossible.application_id, randomUUID(), randomUUID(), impossible.evaluation_id, tenant.owner.membershipId, tenant.owner.id]);
    if (cloneOrigins) {
      const seed = (await client.query('SELECT * FROM opportunity_catalog.opportunity WHERE opportunity_id=$1', [tenant.opportunityId])).rows[0];
      const revision = (await client.query('SELECT * FROM opportunity_catalog.revision WHERE revision_id=$1', [seed.current_revision_id])).rows[0];
      const origins = [...new Map(rows.filter(row => row.opportunity_id).map(row => [`${row.organization_id}:${row.opportunity_id}`, row])).values()];
      const copies = origins.map(row => ({ ...seed, organization_id: row.organization_id, opportunity_id: row.opportunity_id,
        current_revision_id: randomUUID(), title: row.opportunity_title || 'Synthetic opportunity' }));
      if (copies.length) {
        await client.query(`INSERT INTO opportunity_catalog.opportunity SELECT (jsonb_populate_record(NULL::opportunity_catalog.opportunity,x)).*
          FROM jsonb_array_elements($1::jsonb) x ON CONFLICT(organization_id,opportunity_id) DO UPDATE SET title=EXCLUDED.title`, [JSON.stringify(copies)]);
        const revisions = copies.map(row => ({ ...revision, organization_id: row.organization_id, opportunity_id: row.opportunity_id, revision_id: row.current_revision_id }));
        await client.query(`INSERT INTO opportunity_catalog.revision SELECT (jsonb_populate_record(NULL::opportunity_catalog.revision,x)).*
          FROM jsonb_array_elements($1::jsonb) x ON CONFLICT DO NOTHING`, [JSON.stringify(revisions)]);
      }
    }
    const apps = [...new Map(rows.map(row => [row.application_id, row])).values()].map(row => ({ organization_id: row.application_organization_id,
      application_id: row.application_id, opportunity_id: row.opportunity_id, evaluation_id: row.evaluation_id,
      title: row.application_title, status: row.application_status, responsible_membership_id: tenant.owner.membershipId,
      created_by: tenant.owner.id, central_opportunity_id: row.opportunity_id ? null : randomUUID(),
      central_revision_id: row.opportunity_id ? null : randomUUID(), central_snapshot: row.opportunity_id ? null : { title: row.opportunity_title } }));
    await client.query(`INSERT INTO opportunity_catalog.application
      (organization_id,application_id,opportunity_id,evaluation_id,title,status,responsible_membership_id,created_by,deadline,central_opportunity_id,central_revision_id,central_snapshot)
      SELECT organization_id,application_id,opportunity_id,evaluation_id,title,status,responsible_membership_id,created_by,'2027-12-31',central_opportunity_id,central_revision_id,central_snapshot
      FROM jsonb_to_recordset($1::jsonb) AS x(organization_id uuid,application_id uuid,opportunity_id uuid,evaluation_id uuid,title text,status text,
        responsible_membership_id uuid,created_by uuid,central_opportunity_id uuid,central_revision_id uuid,central_snapshot jsonb)
      ON CONFLICT(organization_id,application_id) DO UPDATE SET title=EXCLUDED.title,status=EXCLUDED.status,
        opportunity_id=EXCLUDED.opportunity_id,evaluation_id=EXCLUDED.evaluation_id,central_opportunity_id=EXCLUDED.central_opportunity_id,
        central_revision_id=EXCLUDED.central_revision_id,central_snapshot=EXCLUDED.central_snapshot`, [JSON.stringify(apps)]);
    await client.query(`INSERT INTO opportunity_catalog.application_partner(organization_id,application_id,partner_id,active,body,created_at,updated_at)
      SELECT organization_id,application_id,partner_id,active,body,created_at,updated_at FROM jsonb_to_recordset($1::jsonb)
      AS x(organization_id uuid,application_id uuid,partner_id uuid,active boolean,body jsonb,created_at timestamptz,updated_at timestamptz)
      ON CONFLICT(organization_id,application_id,partner_id) DO UPDATE SET active=EXCLUDED.active,body=EXCLUDED.body,
        created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at`, [JSON.stringify(rows)]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function contractMatrix(env) {
  const results = [], owned = new Set();
  for (const scenario of CASES) {
    const storage = [], stats = { reads: 0 };
    async function createHarness(options = {}) {
      const organizationId = options.organizationId || ORGANIZATION, subjectId = options.subjectId || SUBJECT;
      const tenant = env.tenants.find(value => value.organizationId === organizationId); assert.ok(tenant);
      const state = { rows: structuredClone(options.rows || []), now: Date.UTC(2026, 9, 27, 12), denied: new Set(options.denied || []), failures: new Map(options.failures || []) };
      const trace = [], cursor = tokens(() => state.now);
      const context = (filters, override) => ({ organizationId, subjectId, route: 'partners-browse', q: '', country: '', person_role: '', ...filters, ...override });
      const observe = target => ({ resourceType: target.resourceType, scopeType: target.scopeType, scopeId: target.scopeId });
      return { trace, async browse(raw) {
        for (const row of state.rows) owned.add(row.partner_id);
        for (const target of env.tenants) if (owned.size) await target.pool.query('UPDATE opportunity_catalog.application_partner SET active=false WHERE partner_id=ANY($1::uuid[])', [[...owned]]);
        try {
          // Physical database-per-organization: foreign fixtures live in their
          // own disposable database, never in the selected tenant's dataset.
          for (const destination of env.tenants) await installRows(destination, state.rows.filter(row => row.organization_id === destination.organizationId));
        }
        catch (error) {
          if (scenario.name === 'authorization-trace' && state.rows.some(row => !row.opportunity_id && row.evaluation_id) && error.code === '23514' && error.constraint === 'application_exact_origin') {
            storage.push({ sqlState: error.code, constraint: error.constraint, category: 'IMPOSSIBLE_ORIGIN_FIXTURE' });
          } else if (scenario.name === 'canonical-input' && hasLoneSurrogate(state.rows) && ['22P02', '22P05', '22021'].includes(error.code)) storage.push({ sqlState: error.code, category: 'INVALID_UNICODE_STORAGE' });
          throw error;
        }
        const result = await readPartners(tenant, { input: raw, subjectId, cursor, schemaReady: options.schemaReady !== false,
          protect: async ({ operationCode, resource }) => { trace.push(['protect', operationCode, resource.id, resource.organizationId, observe(resource)]); if (options.protectError) throw failure(options.protectError); },
          authorize: async (operation, resource) => { trace.push(['authorize', operation, resource.id, resource.organizationId, observe(resource)]);
            if (state.failures.has(key(operation, resource.id))) throw failure(state.failures.get(key(operation, resource.id)));
            return !state.denied.has(key(operation, resource.id)); },
          hook: async ({ when, phase }) => { if (when === 'before' && phase === 'schema') trace.push(['schema']); } });
        stats.reads++; if (result.error) throw result.error; return result.result;
      }, issue: (position, filters = {}, override = {}) => cursor.cursor(position, context(filters, override)),
      decode: value => JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')),
      advance: ms => { state.now += ms; }, deny: (operation, id) => state.denied.add(key(operation, id)),
      allow: (operation, id) => state.denied.delete(key(operation, id)),
      failAuthorization: (operation, id, code = 'SERVICE_UNAVAILABLE') => state.failures.set(key(operation, id), code),
      mutate: (id, change) => { const row = state.rows.find(value => value.partner_id === id); assert.ok(row); change(row); },
      add: row => state.rows.push(structuredClone(row)), rows: () => structuredClone(state.rows), clearTrace: () => { trace.length = 0; },
      async close() { if (state.rows.length) for (const destination of env.tenants) {
        await destination.pool.query('UPDATE opportunity_catalog.application_partner SET active=false WHERE partner_id=ANY($1::uuid[])', [state.rows.map(row => row.partner_id)]);
      } } };
    }
    try { await scenario.run(createHarness); results.push({ id: scenario.name, status: storage.length ? 'EXPECTED_STORAGE_REJECTION' : 'PASS',
      reads: stats.reads, ...(storage.length ? { sqlState: storage[0].sqlState, constraint: storage[0].constraint } : {}), storage }); }
    catch (error) {
      // A later assertion/failure must never be hidden by an earlier expected
      // Unicode storage rejection in the same multi-part scenario.
      const expected = storage.some(item => item.sqlState === error.code && (!item.constraint || item.constraint === error.constraint));
      if (expected) results.push({ id: scenario.name, status: 'EXPECTED_STORAGE_REJECTION', reads: stats.reads,
        sqlState: error.code, constraint: error.constraint, storage });
      else results.push({ id: scenario.name, status: 'FAIL', code: safeCode(error), reads: stats.reads, storage });
    }
  }
  return { coverage: results, completeReadCoverage: results.every(row => row.status === 'PASS'),
    expectedStorageRejections: results.filter(row => row.status === 'EXPECTED_STORAGE_REJECTION').length };
}

async function runRepositoryGate(env) {
  if (!env?.tenants || env.tenants.length !== 2 || env.tenants.some(tenant => !tenant.pool?.connect || !tenant.runtimePool?.connect || !tenant.owner?.id || !tenant.opportunityId)) throw failure('GATE_ENVIRONMENT_REQUIRED');
  const { isPreparedEnvironment } = require('./environment');
  if (!isPreparedEnvironment(env)) throw failure('GATE_ENVIRONMENT_REQUIRED');
  const cases = [];
  async function check(id, body) {
    try { const evidence = await body(); cases.push({ id, status: 'PASS', evidence: { scope: 'REAL_POSTGRESQL_REPOSITORY_WITH_CONTROLLED_AUTHORITY_PORTS', ...evidence } }); }
    catch (error) { cases.push({ id, status: 'FAIL', evidence: { code: safeCode(error) } }); }
  }
  await check('repository.roles-rls', async () => {
    const sessions = [];
    for (const tenant of env.tenants) {
      const seed = await seedPartners(tenant, { count: 1 });
      const client = await tenant.runtimePool.connect();
      try {
        const login = (await client.query(`SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,rolreplication,rolinherit,
          pg_has_role(session_user,'c4g_opportunity_tenant_owner','MEMBER') AS "ownerMember" FROM pg_roles WHERE rolname=session_user`)).rows[0];
        await beginReader(client, tenant.organizationId);
        const tables = (await client.query(`SELECT relname AS name,relrowsecurity AS rls,relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='opportunity_catalog' AND relname IN ('application','application_partner') ORDER BY relname`)).rows;
        const facts = { login, tables, isolation: (await client.query('SHOW transaction_isolation')).rows[0].transaction_isolation,
          currentUser: (await client.query('SELECT current_user')).rows[0].current_user };
        assertSessionFacts(facts);
        const own = (await client.query('SELECT count(*)::int n FROM opportunity_catalog.opportunity')).rows[0].n; assert.ok(own > 0);
        const ownPartners = (await client.query('SELECT count(*)::int n FROM opportunity_catalog.application_partner WHERE partner_id=$1', [seed.partnerIds[0]])).rows[0].n;
        assert.equal(ownPartners, 1);
        await client.query("SELECT set_config('app.organization_id',$1,true)", [env.tenants.find(value => value !== tenant).organizationId]);
        assert.equal((await client.query('SELECT count(*)::int n FROM opportunity_catalog.opportunity')).rows[0].n, 0);
        const foreignPartners = (await client.query('SELECT count(*)::int n FROM opportunity_catalog.application_partner WHERE partner_id=$1', [seed.partnerIds[0]])).rows[0].n;
        assert.equal(foreignPartners, 0);
        await assert.rejects(client.query('INSERT INTO opportunity_catalog.application_partner(organization_id,application_id,partner_id,body) VALUES($1,$2,$3,$4)',
          [tenant.organizationId, seed.appIds[0], randomUUID(), seed.rows[0].body]), error => error.code === '42501');
        sessions.push({ limitedLogin: true, forcedRls: true, ownRows: own, foreignRows: 0,
          ownPartnerRows: ownPartners, foreignPartnerRows: foreignPartners, mismatchedWriteSqlState: '42501' });
      } finally { try { await client.query('ROLLBACK'); } finally { client.release(); await seed.cleanup(); } }
    }
    return { sessions };
  });
  await check('repository.cross-tenant-connect', async () => {
    const { Pool } = require('../../../backend/node_modules/pg');
    for (const tenant of env.tenants) {
      const c = tenant.credentials, other = env.tenants.find(value => value !== tenant);
      const foreign = new Pool({ host: c.host, port: c.port, user: c.login, password: c.password, database: other.credentials.database, max: 1, connectionTimeoutMillis: 5000 });
      try { await assert.rejects(foreign.query('SELECT 1'), error => error.code === '42501'); }
      finally { await foreign.end(); }
    }
    return { rejectedConnections: 2, sqlState: '42501' };
  });
  const tenant = env.tenants[0];
  await check('repository.equivalence', async () => {
    const seed = await seedPartners(tenant, { count: 101 });
    try {
      const before = await readPartners(tenant, { variant: 'before', input: { q: seed.prefix } });
      const after = await readPartners(tenant, { input: { q: seed.prefix } });
      assert.ifError(before.error); assert.ifError(after.error); const evidence = assertEquivalent(before.result, after.result);
      const oldNext = await readPartners(tenant, { variant: 'before', input: { q: seed.prefix, cursor: after.result.nextCursor } });
      const newNext = await readPartners(tenant, { input: { q: seed.prefix, cursor: before.result.nextCursor } });
      assert.ifError(oldNext.error); assert.ifError(newNext.error); assertEquivalent(oldNext.result, newNext.result);
      return { ...evidence, candidates: 101, cursorsAcceptedBothDirections: true };
    } finally { await seed.cleanup(); }
  });
  await check('repository.collation', async () => {
    const seed = await seedPartners(tenant, { count: 2, partnersPerApplication: 1 });
    try {
      for (const [left, right] of [['ab', 'a\u00adb'], ['ab', 'a\u200db'], ['A', 'A\ufe0f']]) {
        await tenant.pool.query('UPDATE opportunity_catalog.application_partner SET body=jsonb_set(body,\'{entity_name}\',to_jsonb($2::text)) WHERE partner_id=$1', [seed.rows[0].partner_id, `${seed.prefix} ${right}`]);
        await tenant.pool.query('UPDATE opportunity_catalog.application_partner SET body=jsonb_set(body,\'{entity_name}\',to_jsonb($2::text)) WHERE partner_id=$1', [seed.rows[1].partner_id, `${seed.prefix} ${left}`]);
        const value = await readPartners(tenant, { input: { q: seed.prefix } }); assert.ifError(value.error);
        assert.deepEqual(value.result.items.map(row => row.id), seed.partnerIds);
      }
      return { zeroComparisonPairs: 3, idTiebreakerPreserved: true };
    } finally { await seed.cleanup(); }
  });
  const matrix = await contractMatrix(env);
  cases.push({ id: 'repository.contract-matrix', status: matrix.coverage.some(value => value.status === 'FAIL') ? 'FAIL' : 'PASS',
    evidence: { scope: 'REAL_POSTGRESQL_REPOSITORY_WITH_CONTROLLED_AUTHORITY_PORTS', ...matrix,
      reason: matrix.completeReadCoverage ? null : 'EXPECTED_STORAGE_REJECTION_IS_NOT_READ_COVERAGE' } });
  for (const point of ['before-declare', 'after-declare', 'between-fetches']) await check(`snapshot.${point}`, async () => {
    const seed = await seedPartners(tenant, { count: 101, partnersPerApplication: 100, sharedOrigin: false });
    const target = seed.rows[100]; let committed = false, writerPid;
    const oldOpportunityTitle = (await tenant.pool.query('SELECT title FROM opportunity_catalog.opportunity WHERE opportunity_id=$1', [target.opportunity_id])).rows[0].title;
    const atPoint = ({ when, phase, fetches }) => (point === 'before-declare' && phase === 'DECLARE' && when === 'before')
      || (point === 'after-declare' && phase === 'DECLARE' && when === 'after')
      || (point === 'between-fetches' && phase === 'FETCH' && when === 'before' && fetches === 2);
    try {
      const mutation = async () => {
        const writer = await tenant.pool.connect();
        try { await writer.query('BEGIN'); writerPid = (await writer.query('SELECT pg_backend_pid() pid')).rows[0].pid;
          await writer.query("UPDATE opportunity_catalog.application_partner SET body=body||$2::jsonb,updated_at='2026-10-28T00:00:00Z' WHERE partner_id=$1", [target.partner_id, {
            entity_name: `${target.body.entity_name} changed`, country: 'Espanha', people: [
              { id: randomUUID(), name: 'Captured active person', role: 'OUTRO', research_area: '', contact: '', email: '', active: true },
              { id: randomUUID(), name: 'Historical person', role: 'OUTRO', research_area: '', contact: '', email: '', active: false }
            ] }]);
          await writer.query("UPDATE opportunity_catalog.application SET title='Changed snapshot title',status='SUBMITTED' WHERE application_id=$1", [target.application_id]);
          await writer.query("UPDATE opportunity_catalog.opportunity SET title='Changed snapshot opportunity' WHERE opportunity_id=$1", [target.opportunity_id]);
          await writer.query('COMMIT'); committed = true;
        } finally { await writer.query('ROLLBACK'); writer.release(); }
      };
      const input = { q: target.body.entity_name };
      const first = await readPartners(tenant, { input, hook: async event => {
        if (committed) return;
        if (atPoint(event)) await mutation();
      } });
      assert.ifError(first.error); assert.ok(committed); assert.notEqual(writerPid, first.cleanup.requestPid);
      const expected = point === 'before-declare' ? `${target.body.entity_name} changed` : target.body.entity_name;
      assert.equal(first.result.items[0].entity_name, expected);
      assert.equal(first.result.items[0].application_title, point === 'before-declare' ? 'Changed snapshot title' : 'Synthetic gate application');
      assert.equal(first.result.items[0].application_status, point === 'before-declare' ? 'SUBMITTED' : 'PREPARATION');
      assert.equal(first.result.items[0].opportunity_title, point === 'before-declare' ? 'Changed snapshot opportunity' : oldOpportunityTitle);
      assert.equal(first.result.items[0].people.length, point === 'before-declare' ? 1 : 0);
      assert.equal(first.result.items[0].updatedAt, point === 'before-declare' ? '2026-10-28T00:00:00.000Z' : target.updated_at);
      const next = await readPartners(tenant, { input }); assert.ifError(next.error); assert.equal(next.result.items[0].entity_name, `${target.body.entity_name} changed`);
      assert.equal(next.result.items[0].people.length, 1); assert.equal(next.result.items[0].opportunity_title, 'Changed snapshot opportunity');
      const activeSeed = await seedPartners(tenant, { count: 101 }); let removed = false;
      try {
        const item = activeSeed.rows[100], activeInput = { q: item.body.entity_name };
        const captured = await readPartners(tenant, { input: activeInput, hook: async event => {
          if (!removed && atPoint(event)) { await tenant.pool.query('UPDATE opportunity_catalog.application_partner SET active=false WHERE partner_id=$1', [item.partner_id]); removed = true; }
        } });
        assert.ifError(captured.error); assert.ok(removed);
        assert.equal(captured.result.total, point === 'before-declare' ? 0 : 1);
        const following = await readPartners(tenant, { input: activeInput }); assert.ifError(following.error); assert.equal(following.result.total, 0);
      } finally { await activeSeed.cleanup(); }
      return { writerCommitted: true, independentWriter: true, capturedExpectedVersion: true, nextRequestSeesCommit: true,
        activeRemovalCaptured: true, projectedFields: ['body', 'people', 'application_title', 'application_status', 'opportunity_title', 'updatedAt'] };
    } finally { await seed.cleanup(); }
  });
  for (const phase of ['success', 'local-error', 'sql-abort', 'cancel']) await check(`cleanup.${phase}`, async () => {
    const seed = await seedPartners(tenant, { count: 1 }); let injected = false, injectedSqlState = null;
    try {
      const value = await readPartners(tenant, { input: { q: seed.prefix, ...(phase === 'local-error' ? { cursor: 'invalid' } : {}) },
        hook: async ({ when, phase: command, client }) => {
          if (injected || command !== 'FETCH' || when !== 'before' || !['sql-abort', 'cancel'].includes(phase)) return;
          injected = true;
          try {
            if (phase === 'sql-abort') await client.query('SELECT 1/0');
            if (phase === 'cancel') { await client.query("SET LOCAL statement_timeout='40ms'"); await client.query('SELECT pg_sleep(5)'); }
          } catch (error) { injectedSqlState = error.code; throw error; }
        } });
      const fault = { errorCode: value.error ? safeCode(value.error) : null, injectedFault: injected, injectedSqlState };
      assertFailureEvidence(phase, fault);
      assertCleanup(value.cleanup); return { ...value.cleanup, ...fault, rollbackObserved: phase !== 'success' };
    } finally { await seed.cleanup(); }
  });
  await check('cleanup.disconnect', async () => {
    const client = await tenant.runtimePool.connect(); let pid;
    try {
      pid = (await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await beginReader(client, tenant.organizationId);
      await client.query('DECLARE c4g_partner_browse_disconnect NO SCROLL CURSOR WITHOUT HOLD FOR SELECT 1');
      client.release(true);
      const deadline = Date.now() + 10000; let remaining;
      do {
        remaining = (await tenant.pool.query('SELECT count(*)::int n FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0].n;
        if (!remaining) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      } while (Date.now() < deadline);
      assert.equal(remaining, 0);
      return { backendTerminated: true, verification: 'PG_STAT_ACTIVITY_BACKEND_ABSENCE_NOT_FOREIGN_PG_CURSORS' };
    } catch (error) { try { client.release(true); } catch {} throw error; }
  });
  await check('cleanup.session-reuse', async () => {
    const seed = await seedPartners(tenant, { count: 1 }), client = await tenant.runtimePool.connect();
    try {
      const first = await readPartners(tenant, { client, input: { q: seed.prefix } }); assert.ifError(first.error);
      await beginReader(client, env.tenants[1].organizationId);
      assert.equal((await client.query('SELECT count(*)::int n FROM opportunity_catalog.application_partner WHERE active')).rows[0].n, 0);
      await client.query('ROLLBACK');
      const second = await readPartners(tenant, { client, input: { q: seed.prefix } }); assert.ifError(second.error);
      assert.equal(first.cleanup.requestPid, second.cleanup.requestPid); assertEquivalent(first.result, second.result);
      return { samePhysicalSession: true, crossOrganizationGucReturnsNoRows: true, tenantDatabaseUnchanged: true };
    } finally { await client.query('ROLLBACK'); client.release(); await seed.cleanup(); }
  });
  assert.deepEqual(cases.map(row => row.id).sort(), [...CASE_IDS].sort());
  return { cases, environmentVerified: isPreparedEnvironment(env) };
}

module.exports = { CASE_IDS, assertSessionFacts, assertEquivalent, assertCleanup, assertFailureEvidence, seedPartners, readPartners, runRepositoryGate };
