'use strict';
// Common A/B functional proof only, outside every timing population.
// Adapted from the frozen EU-writer gate: ownership, real blocked-PID proof,
// committed post-preflight drift, cleanup and revalidation are preserved.
// Each arm loads its actual aggregate collector and coordinator from sourceRoot.
const path = require('node:path');
const REVISIONS = ['042_opportunity_eu_source_control_v2', '043_opportunity_eu_writer_v2'];
const DATABASE = 'c4g_f13_authority_synthetic_central';
const LOCK = 'SELECT pg_advisory_xact_lock(43001306,1)';
const fail = code => Object.assign(new Error(code), { code });
const safeCode = error => /^[A-Z0-9_]{1,64}$/.test(error?.code || '') ? error.code : 'METADATA_DRIFT_PROOF_FAILED';
const identitySql = `SELECT current_database() AS database,session_user,current_user,
  r.rolcanlogin AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit) AS limited
  FROM pg_roles r WHERE r.rolname=current_user`;

function endpoint(pool) {
  const options = pool?.options;
  if (!options || typeof pool.query !== 'function' || typeof pool.connect !== 'function') throw fail('METADATA_OWNED_FIXTURE_REQUIRED');
  let host = options.host, port = options.port, database = options.database;
  if (options.connectionString) {
    let url;
    try { url = new URL(options.connectionString); } catch { throw fail('METADATA_OWNED_FIXTURE_REQUIRED'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash) throw fail('METADATA_OWNED_FIXTURE_REQUIRED');
    const decoded = decodeURIComponent(url.pathname.slice(1));
    if ((host && host !== url.hostname) || (port && Number(port) !== Number(url.port)) || (database && database !== decoded)) throw fail('METADATA_OWNED_FIXTURE_REQUIRED');
    host = url.hostname; port = url.port; database = decoded;
  }
  if (host !== '127.0.0.1' || database !== DATABASE || !Number.isInteger(Number(port)) ||
    Number(port) <= 0 || Number(port) > 65535 || [5432, 5433].includes(Number(port))) throw fail('METADATA_OWNED_FIXTURE_REQUIRED');
  return { host, port: Number(port), database };
}

function assertOwnership({ ownership, ownerPool, readerPool, authorityPool, revision, permitSecret }) {
  if (ownership?.isolated !== true || !/^[a-f0-9]{32}$/.test(ownership?.runId || '') || ownership.centralDatabase !== DATABASE ||
    !REVISIONS.includes(revision) || typeof permitSecret !== 'string' || permitSecret.length < 32) throw fail('METADATA_OWNED_FIXTURE_REQUIRED');
  const target = JSON.stringify(endpoint(ownerPool));
  if ([readerPool, authorityPool].some(pool => JSON.stringify(endpoint(pool)) !== target)) throw fail('METADATA_OWNED_FIXTURE_REQUIRED');
}

async function assertIdentities({ ownerPool, readerPool, authorityPool }) {
  const owner = (await ownerPool.query(identitySql)).rows?.[0];
  if (owner?.database !== DATABASE || owner?.session_user !== owner?.current_user) throw fail('METADATA_FIXTURE_IDENTITY_MISMATCH');
  for (const pool of new Set([readerPool, authorityPool])) {
    const row = (await pool.query(identitySql)).rows?.[0];
    if (row?.database !== DATABASE || row?.limited !== true || row.session_user !== 'c4g_authority_runtime' || row.current_user !== row.session_user)
      throw fail('METADATA_RUNTIME_ROLE_REQUIRED');
  }
}

function expectedDrift(error, kind) {
  if (kind === 'schema') return error?.code === 'CENTRAL_SCHEMA_DRIFT' || /^Central schema drift detected for /.test(error?.message || '');
  const code = { authority: 'AUTHORITY_SECURITY_DRIFT', catalog: 'CATALOG_SECURITY_DRIFT', writer: 'EU_WRITER_SECURITY_DRIFT' }[kind];
  return error?.code === code || error?.message === code || (kind === 'authority' && expectedDrift(error, 'schema'));
}

async function validateCurrent(pool, checkpoint) {
  const client = await pool.connect();
  try { await checkpoint(client); }
  finally { client.release(); }
}

async function transactionalCase({ ownerPool, readerPool, checkpoint }, item, report) {
  const result = { case: item.name, rejected: false, restored: false }, client = await ownerPool.connect();
  report.transactional.push(result);
  try {
    await client.query('BEGIN');
    await checkpoint(client);
    await client.query(item.sql);
    try { await checkpoint(client); }
    catch (error) { if (!expectedDrift(error, item.kind)) throw error; result.rejected = true; }
    if (!result.rejected) throw fail('METADATA_DRIFT_NOT_REFUSED');
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
  await validateCurrent(readerPool, checkpoint);
  result.restored = true;
}

async function deadline(promise, ms, code) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(fail(code)), ms); })]); }
  finally { clearTimeout(timer); }
}

async function postLockCase({ ownerPool, readerPool, authorityPool, revision, permitSecret, checkpoint, createAuthorityCoordinator }, item, report) {
  const result = { case: item.name, mutationAfterPreflight: false, realBlockedAuthorityTransactions: 0,
    functionalCallbackExecuted: false, restored: false };
  report.postLock.push(result);
  const blocker = await ownerPool.connect();
  let pending, mutated = false, backendPid, reachedResolve, blocked = false;
  const reached = new Promise(resolve => { reachedResolve = resolve; });
  const observed = { query: (...args) => authorityPool.query(...args), async connect() {
    const client = await authorityPool.connect();
    try { backendPid = Number((await client.query('SELECT pg_backend_pid() AS pid')).rows?.[0]?.pid); }
    catch (error) { client.release(); throw error; }
    if (!Number.isSafeInteger(backendPid) || backendPid <= 0) { client.release(); throw fail('METADATA_AUTHORITY_PID_INVALID'); }
    return { on: (...args) => client.on(...args), removeListener: (...args) => client.removeListener(...args), release: error => client.release(error),
      query(...args) { if (args[0] === LOCK) reachedResolve(); return client.query(...args); } };
  } };
  const coordinator = createAuthorityCoordinator({ pool: observed, permitSecret });
  try {
    await blocker.query('BEGIN'); await blocker.query(LOCK);
    pending = coordinator.withAuthority(async () => { result.functionalCallbackExecuted = true; throw fail('METADATA_PROTECTED_CALLBACK_EXECUTED'); });
    pending.catch(() => {});
    await deadline(Promise.race([reached, pending]), 7000, 'METADATA_POST_LOCK_CHECKPOINT_NOT_REACHED');
    const until = process.hrtime.bigint() + 2000000000n;
    do {
      const observation = await ownerPool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE pid=$1 AND usename='c4g_authority_runtime' AND wait_event_type='Lock' AND wait_event='advisory'
        AND cardinality(pg_blocking_pids(pid))>0`, [backendPid]);
      result.realBlockedAuthorityTransactions = observation.rows?.[0]?.n;
      if (result.realBlockedAuthorityTransactions === 1) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (process.hrtime.bigint() < until);
    if (!blocked) throw fail('METADATA_REAL_LOCK_NOT_OBSERVED');
    await ownerPool.query(item.up); mutated = true; result.mutationAfterPreflight = true;
    await blocker.query('COMMIT');
    let refused = false;
    try { await deadline(pending, 12000, 'METADATA_AUTHORITY_DID_NOT_DRAIN'); }
    catch (error) { if (error?.code !== 'AUTHORITY_SECURITY_DRIFT') throw error; refused = true; }
    if (!refused || result.functionalCallbackExecuted) throw fail('METADATA_POST_LOCK_DRIFT_NOT_REFUSED');
    result.rejected = 'AUTHORITY_SECURITY_DRIFT';
  } finally {
    let cleanupFailure;
    for (const [stage, cleanup] of [
      ['blocker-rollback', () => blocker.query('ROLLBACK')],
      ['blocker-release', () => blocker.release()],
      ['authority-drain', () => pending && deadline(pending.catch(() => {}), 12000, 'METADATA_AUTHORITY_DID_NOT_DRAIN')],
      ['permission-restore', () => mutated && ownerPool.query(item.down)]
    ]) {
      try { await cleanup(); }
      catch (error) { cleanupFailure ||= error; report.cleanupErrors.push({ case: item.name, stage, code: safeCode(error) }); }
    }
    if (cleanupFailure) throw cleanupFailure;
  }
  await validateCurrent(readerPool, checkpoint);
  result.restored = true;
}

async function validateMetadataDrift({ sourceRoot, ownerPool, readerPool, authorityPool, revision, permitSecret, ownership, onProgress = () => {} } = {}) {
  const args = { ownerPool, readerPool, authorityPool, revision, permitSecret, ownership };
  assertOwnership(args);
  if (typeof sourceRoot !== 'string' || !path.isAbsolute(sourceRoot)) throw fail('METADATA_SOURCE_ROOT_REQUIRED');
  const schema = require(path.join(sourceRoot, 'backend/src/security/centralSchemaManifest.js'));
  const { createAuthorityCoordinator } = require(path.join(sourceRoot, 'backend/src/security/authorityCoordinator.js'));
  const checkpoint = client => schema.assertCentralSchema(client, revision);
  Object.assign(args, { checkpoint, createAuthorityCoordinator });
  if (typeof onProgress !== 'function') throw fail('METADATA_PROGRESS_INVALID');
  const report = { schemaVersion: 1, status: 'RUNNING', revision, runId: ownership.runId, collector: 'ACTUAL_AGGREGATE_WITH_SECURITY_READS', transactional: [], postLock: [], cleanupErrors: [],
    limits: ['Caller verifies container label and exact ID before supplying pools.',
      'Mutations are functional checks outside all latency populations.', 'Transactional mutations use the fixture owner; revalidation uses the scoped reader.'] };
  try {
    await assertIdentities(args);
    await validateCurrent(readerPool, checkpoint);
    const cases = [
      { name: 'table-structure', kind: 'schema', sql: 'ALTER TABLE public.global_user ADD COLUMN eu_metadata_proof_drift integer' },
      { name: 'authority-table-acl', kind: 'authority', sql: 'GRANT SELECT ON public.global_user TO PUBLIC' },
      { name: 'catalog-table-acl', kind: 'catalog', sql: 'GRANT SELECT ON opportunity_catalog.funding_run TO PUBLIC' }
    ];
    if (revision === REVISIONS[1]) cases.push(
      { name: 'writer-helper-definition', kind: 'writer', sql: 'ALTER FUNCTION opportunity_catalog.assert_eu_writer_permit_v2(uuid) COST 101' },
      { name: 'writer-helper-public-execute', kind: 'writer', sql: 'GRANT EXECUTE ON FUNCTION opportunity_catalog.assert_eu_writer_permit_v2(uuid) TO PUBLIC' });
    for (const item of cases) {
      await transactionalCase(args, item, report);
      await onProgress({ stage: 'transactional-drift-complete', revision, case: item.name, status: 'PASS' });
    }
    for (const item of [
      { name: 'authority-table-acl', up: 'GRANT SELECT ON public.global_user TO PUBLIC', down: 'REVOKE SELECT ON public.global_user FROM PUBLIC' },
      { name: 'authority-role-attribute', up: 'ALTER ROLE c4g_authority_runtime INHERIT', down: 'ALTER ROLE c4g_authority_runtime NOINHERIT' }
    ]) {
      await postLockCase(args, item, report);
      await onProgress({ stage: 'post-lock-drift-complete', revision, case: item.name, status: 'PASS' });
    }
    await validateCurrent(readerPool, checkpoint);
    report.status = 'PASS';
    return report;
  } catch (error) {
    report.status = 'FAIL'; report.failure = { code: safeCode(error) };
    if (error && (typeof error === 'object' || typeof error === 'function'))
      Object.defineProperty(error, 'metadataDriftReport', { value: report, configurable: true });
    throw error;
  }
}

module.exports = { validateMetadataDrift };
