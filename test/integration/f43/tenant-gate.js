const assert = require('node:assert/strict');
const { Pool } = require('../../../backend/node_modules/pg');
const { createTenantMigrationRunner, TENANT_MIGRATION_LOCK } = require('../../../backend/src/security/tenantMigrationRunner');
const { preflightTenant } = require('../../../backend/src/security/tenantMigrationPreflight');
const { TENANT_BASELINE_VERSION, manifest } = require('../../../backend/src/security/tenantMigrationManifest');
const baselineManifest = Object.freeze([manifest[0]]);

const DATABASE = 'c4g_f43_synthetic_gate';
const TENANT_ID = '43000000-0000-4000-8000-000000000001';
const GENERATION_ID = '43000000-0000-4000-8000-000000000002';

function assertDisposableTarget() {
  if (process.env.F43_DISPOSABLE_PROOF !== 'C4G_F43_DISPOSABLE_V1') {
    throw new Error('Disposable F4.3 proof is absent.');
  }
  const target = new URL(process.env.F43_GATE_DATABASE_URL);
  const admin = new URL(process.env.F43_GATE_ADMIN_URL);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname)
      || target.pathname !== `/${DATABASE}` || admin.pathname !== '/postgres'
      || target.hostname !== admin.hostname || target.port !== admin.port) {
    throw new Error('F4.3 gate target is not an approved disposable endpoint.');
  }
  for (const name of ['DATABASE_URL', 'CENTRAL_DATABASE_URL', 'TEST_DATABASE_URL']) {
    if (process.env[name] && process.env[name] === process.env.F43_GATE_DATABASE_URL) {
      throw new Error('F4.3 gate target matches an application connection string.');
    }
  }
  process.stdout.write(`F4.3 disposable target verified: host=${target.hostname} port=${target.port} database=${DATABASE}.\n`);
}

function ownerPool(pool) {
  return Object.freeze({
    async connect() {
      const client = await pool.connect();
      try { await client.query('SET ROLE c4g_tenant_owner'); }
      catch (error) { client.release(); throw error; }
      return client;
    }
  });
}

async function expectPreflightFailure(pool, expected, code) {
  await assert.rejects(() => preflightTenant(pool, expected, undefined, { timeoutMs: 5000 }), error => {
    assert.equal(error.internalCode, code, `expected ${code}, observed ${error.internalCode || 'UNCLASSIFIED'}`);
    return true;
  });
}

async function expectReadOnlyRefusal(client, sql) {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    await assert.rejects(() => client.query(sql), error => error && error.code === '25006');
  } finally {
    await client.query('ROLLBACK');
  }
}

async function run() {
  assertDisposableTarget();
  const admin = new Pool({ connectionString: process.env.F43_GATE_ADMIN_URL, max: 2 });
  let tenant;
  let migrationTenant;
  const cleanupErrors = [];
  try {
    await admin.query("CREATE ROLE c4g_tenant_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
    await admin.query("CREATE ROLE c4g_tenant_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
    await admin.query("CREATE ROLE c4g_tenant_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
    await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
    await admin.query('GRANT c4g_tenant_migrator TO c4g_f43_admin');
    await admin.query(`CREATE DATABASE ${DATABASE} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
    await admin.query(`ALTER DATABASE ${DATABASE} SET timezone TO 'UTC'`);
    await admin.query(`GRANT CONNECT, CREATE ON DATABASE ${DATABASE} TO c4g_tenant_owner`);
    await admin.query(`GRANT CONNECT ON DATABASE ${DATABASE} TO c4g_tenant_migrator, c4g_tenant_runtime`);
    tenant = new Pool({ connectionString: process.env.F43_GATE_DATABASE_URL, max: 6 });
    migrationTenant = new Pool({ connectionString: process.env.F43_GATE_DATABASE_URL, max: 4 });
    await tenant.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await tenant.query(`REVOKE CONNECT, TEMP ON DATABASE ${DATABASE} FROM PUBLIC`);
    await tenant.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${DATABASE} SET search_path TO pg_catalog, c4g_app`);
    const physicalPool = ownerPool(migrationTenant);
    const publications = [];
    const publisher = Object.freeze({ async publish(value) {
      assert.deepEqual(Object.keys(value).sort(), ['correlationId', 'evidence', 'expectedRevision', 'idempotencyKey']);
      assert.equal(value.evidence.currentVersion, TENANT_BASELINE_VERSION);
      publications.push(value);
    } });
    const runner = createTenantMigrationRunner({ pool: physicalPool, observationPublisher: publisher, timeoutMs: 5000,
      scheduler: { setTimeout, clearTimeout }, entries: baselineManifest });
    const request = { tenantId: TENANT_ID, databaseGenerationId: GENERATION_ID, expectedRevision: 1,
      correlationId: 'f43-synthetic-correlation', idempotencyKey: 'f43-synthetic-idempotency' };
    await expectPreflightFailure(physicalPool, { tenantId: TENANT_ID, databaseGenerationId: GENERATION_ID },
      'TENANT_PREFLIGHT_FAILED');
    const timeoutRunner = createTenantMigrationRunner({
      pool: physicalPool,
      observationPublisher: { async publish() { throw new Error('timeout path must not publish'); } },
      timeoutMs: 25,
      scheduler: { setTimeout, clearTimeout },
      entries: baselineManifest,
      validateDatabase: client => client.query('SELECT pg_sleep(1)')
    });
    await assert.rejects(() => timeoutRunner.migrate(request), error => {
      assert.equal(error.internalCode, 'TENANT_MIGRATION_DATABASE_CONTRACT_FAILED');
      return true;
    });
    assert.equal(await tenant.query("SELECT to_regclass('c4g_system.tenant_identity') AS marker")
      .then(result => result.rows[0].marker), null);
    const installed = await runner.migrate(request);
    assert.deepEqual(installed.appliedVersions, [TENANT_BASELINE_VERSION]);
    assert.equal(installed.reconciled, false);
    assert.equal(publications.length, 1);
    const evidence = await preflightTenant(physicalPool, { tenantId: TENANT_ID, databaseGenerationId: GENERATION_ID },
      undefined, { timeoutMs: 5000 });
    assert.equal(evidence.currentVersion, TENANT_BASELINE_VERSION);
    assert.deepEqual(evidence.capabilities, ['TENANT_CONTROL_BASELINE']);
    const objects = await tenant.query(`
      SELECT n.nspname AS schema_name, c.relname AS object_name
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname IN ('c4g_system','c4g_app') AND c.relkind IN ('r','p')
       ORDER BY n.nspname,c.relname`);
    assert.deepEqual(objects.rows, [
      { schema_name: 'c4g_system', object_name: 'schema_migration' },
      { schema_name: 'c4g_system', object_name: 'tenant_identity' }
    ]);
    const owner = await tenant.connect();
    try {
      await owner.query('SET ROLE c4g_tenant_owner');
      await assert.rejects(() => owner.query("UPDATE c4g_system.tenant_identity SET product_code='C4G'"), /immutable/);
      await assert.rejects(() => owner.query('DELETE FROM c4g_system.tenant_identity'), /immutable/);
      await assert.rejects(() => owner.query('TRUNCATE c4g_system.tenant_identity'), /immutable/);
      await assert.rejects(() => owner.query(`
        INSERT INTO c4g_system.tenant_identity
          (product_code,database_role,marker_format_version,tenant_id,database_generation_id,identity_revision)
        VALUES ('C4G','TENANT',1,$1,$2,1)`, [TENANT_ID, GENERATION_ID]), /duplicate key/);
      await assert.rejects(() => owner.query(`
        INSERT INTO c4g_system.schema_migration
          (migration_id,ordinal,checksum_sha256,irreversible,resulting_fingerprint)
        VALUES ('001_gap',2,$1,false,$2)`, ['0'.repeat(64), '1'.repeat(64)]), /contiguous/);
      await assert.rejects(() => owner.query('TRUNCATE c4g_system.schema_migration'), /append-only/);
    } finally { await owner.query('RESET ROLE'); owner.release(); }
    await expectPreflightFailure(physicalPool, { tenantId: '43000000-0000-4000-8000-000000000099',
      databaseGenerationId: GENERATION_ID }, 'TENANT_MARKER_MISMATCH');
    await expectPreflightFailure(physicalPool, { tenantId: TENANT_ID,
      databaseGenerationId: '43000000-0000-4000-8000-000000000099' }, 'TENANT_MARKER_MISMATCH');
    const drift = await tenant.connect();
    try {
      await drift.query('SET ROLE c4g_tenant_owner');
      await drift.query('CREATE TABLE c4g_app.unexpected_drift(id INTEGER)');
      await expectPreflightFailure(physicalPool, { tenantId: TENANT_ID, databaseGenerationId: GENERATION_ID },
        'TENANT_SCHEMA_SHAPE_MISMATCH');
      await drift.query('DROP TABLE c4g_app.unexpected_drift');
    } finally { await drift.query('RESET ROLE'); drift.release(); }
    await tenant.query('GRANT INSERT ON c4g_system.tenant_identity TO c4g_tenant_runtime');
    await expectPreflightFailure(physicalPool, { tenantId: TENANT_ID, databaseGenerationId: GENERATION_ID },
      'PRIVILEGE_CONTRACT_MISMATCH');
    await tenant.query('REVOKE INSERT ON c4g_system.tenant_identity FROM c4g_tenant_runtime');
    await tenant.query('GRANT SELECT ON c4g_system.tenant_identity TO c4g_f43_admin');
    await expectPreflightFailure(physicalPool, { tenantId: TENANT_ID, databaseGenerationId: GENERATION_ID },
      'PRIVILEGE_CONTRACT_MISMATCH');
    await tenant.query('REVOKE SELECT ON c4g_system.tenant_identity FROM c4g_f43_admin');
    await tenant.query('CREATE EXTENSION pg_trgm');
    await expectPreflightFailure(physicalPool, { tenantId: TENANT_ID, databaseGenerationId: GENERATION_ID },
      'EXTENSION_ALLOWLIST_MISMATCH');
    await tenant.query('DROP EXTENSION pg_trgm');
    await tenant.query('ALTER TABLE c4g_system.schema_migration OWNER TO c4g_f43_admin');
    await tenant.query('GRANT SELECT ON c4g_system.schema_migration TO c4g_tenant_owner');
    await expectPreflightFailure(physicalPool, { tenantId: TENANT_ID, databaseGenerationId: GENERATION_ID },
      'TENANT_SCHEMA_FINGERPRINT_MISMATCH');
    await tenant.query('ALTER TABLE c4g_system.schema_migration OWNER TO c4g_tenant_owner');
    await tenant.query('ALTER TABLE c4g_system.schema_migration DISABLE TRIGGER schema_migration_append_only');
    await tenant.query("UPDATE c4g_system.schema_migration SET checksum_sha256=$1", ['f'.repeat(64)]);
    await expectPreflightFailure(physicalPool, { tenantId: TENANT_ID, databaseGenerationId: GENERATION_ID },
      'TENANT_LEDGER_MISMATCH');
    await tenant.query("UPDATE c4g_system.schema_migration SET checksum_sha256=$1", [
      require('../../../backend/src/security/tenantMigrationManifest').migrationSql(TENANT_BASELINE_VERSION, 'up').checksum
    ]);
    await tenant.query('ALTER TABLE c4g_system.schema_migration ENABLE TRIGGER schema_migration_append_only');
    await preflightTenant(physicalPool, { tenantId: TENANT_ID, databaseGenerationId: GENERATION_ID },
      undefined, { timeoutMs: 5000 });
    const runtime = await tenant.connect();
    try {
      await runtime.query('SET ROLE c4g_tenant_runtime');
      await expectReadOnlyRefusal(runtime, `INSERT INTO c4g_system.tenant_identity
        (product_code,database_role,marker_format_version,tenant_id,database_generation_id,identity_revision)
        VALUES ('C4G','TENANT',1,'43000000-0000-4000-8000-000000000010','43000000-0000-4000-8000-000000000011',1)`);
      await expectReadOnlyRefusal(runtime, 'CREATE TABLE c4g_app.forbidden(id INTEGER)');
      await expectReadOnlyRefusal(runtime, 'SELECT * FROM c4g_system.tenant_identity FOR UPDATE');
    } finally { await runtime.query('RESET ROLE'); runtime.release(); }
    const lockHolder = await tenant.connect();
    try {
      await lockHolder.query('BEGIN');
      await lockHolder.query('SELECT pg_advisory_xact_lock($1)', [TENANT_MIGRATION_LOCK]);
      await assert.rejects(() => runner.migrate(request), error => error.internalCode === 'LOCK_CONFLICT');
    } finally {
      await lockHolder.query('ROLLBACK');
      lockHolder.release();
    }
    const replay = await runner.migrate(request);
    assert.deepEqual(replay.appliedVersions, []);
    assert.equal(publications.length, 2);
    assert.equal(await tenant.query("SELECT count(*)::int AS count FROM c4g_system.tenant_identity").then(r => r.rows[0].count), 1);
    assert.equal(await tenant.query("SELECT count(*)::int AS count FROM c4g_system.schema_migration").then(r => r.rows[0].count), 1);
    process.stdout.write('F4.3 PostgreSQL 17 disposable gate passed.\n');
  } finally {
    if (tenant) {
      try { await tenant.end(); } catch (error) { cleanupErrors.push(error); }
    }
    if (migrationTenant) {
      try { await migrationTenant.end(); } catch (error) { cleanupErrors.push(error); }
    }
    try {
      await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE datname=$1`, [DATABASE]);
      await admin.query(`DROP DATABASE IF EXISTS ${DATABASE}`);
      await admin.query('DROP ROLE IF EXISTS c4g_tenant_runtime');
      await admin.query('DROP ROLE IF EXISTS c4g_tenant_migrator');
      await admin.query('DROP ROLE IF EXISTS c4g_tenant_owner');
    } catch (error) { cleanupErrors.push(error); }
    try { await admin.end(); } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'F4.3 disposable gate cleanup failed.');
  }
}

if (require.main === module) {
  run().catch(error => {
    console.error(`${error.name}: ${error.internalCode || 'UNCLASSIFIED'}: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { assertDisposableTarget, run };
