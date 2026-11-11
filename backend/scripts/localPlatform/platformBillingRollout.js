'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const cfg = require('./config');
const { preflightCentral } = require('../../src/security/centralMigrationPreflight');
const { preflightTenant } = require('../../src/security/tenantMigrationPreflight');
const { tenantSchemaFingerprint, tenantSchemaSnapshot } = require('../../src/security/tenantSchemaFingerprint');
const { applyCentralMigrations } = require('../runCentralMigrations');

const PREVIOUS_VERSION = '026_platform_logs';
const TARGET_VERSION = '027_platform_billing';
const BILLING_TABLES = Object.freeze([
  'billing_account', 'billing_account_version', 'billing_activity', 'billing_command_receipt',
  'billing_cycle', 'billing_cycle_revision', 'billing_fiscal_document',
  'billing_fiscal_document_revision', 'billing_payment_record'
]);

function rolloutFolder() {
  return path.join(cfg.folder, 'platform-billing-rollout');
}

function evidenceFile(name) {
  return path.join(rolloutFolder(), `${name}.json`);
}

function assertRolloutTarget(config, state) {
  cfg.assertTarget(config);
  assert.equal(config.host, 'localhost');
  assert.equal(config.port, 5432);
  assert.equal(config.centralDatabase, 'c4g_central_dev');
  assert.equal(config.tenantDatabase, 'c4g_tenant_dev');
  assert.equal(state.phase, 'READY');
  assert.deepEqual(state.target, {
    host: config.host,
    port: config.port,
    centralDatabase: config.centralDatabase,
    tenantDatabase: config.tenantDatabase
  });
  assert.match(state.tenantId || '', /^[0-9a-f-]{36}$/i);
  assert.match(state.generationId || '', /^[0-9a-f-]{36}$/i);
}

function sha256File(filename) {
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function findPostgresBin() {
  const candidates = ['18', '17'].map(version => path.join('C:/Program Files/PostgreSQL', version, 'bin'));
  const selected = candidates.find(folder => fs.existsSync(path.join(folder, 'pg_dump.exe'))
    && fs.existsSync(path.join(folder, 'pg_restore.exe')));
  if (!selected) throw Error('POSTGRES_BACKUP_TOOLS_REQUIRED');
  return selected;
}

function runPostgresTool(bin, executable, args, config, errorCode) {
  const result = spawnSync(path.join(bin, executable), args, {
    env: { ...process.env, PGPASSWORD: config.password },
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'pipe'
  });
  if (result.status !== 0) throw Error(errorCode);
  return result;
}

function protectPrivateFolder(folder) {
  fs.mkdirSync(folder, { recursive: true });
  const identity = spawnSync('whoami', ['/user', '/fo', 'csv', '/nh'], {
    encoding: 'utf8', windowsHide: true, stdio: 'pipe'
  });
  const sid = identity.stdout.match(/S-1-5-[0-9-]+/)?.[0];
  if (identity.status !== 0 || !sid) throw Error('LOCAL_PRIVATE_FOLDER_IDENTITY_REQUIRED');
  const acl = spawnSync('icacls', [folder, '/inheritance:r', '/grant:r',
    `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true, stdio: 'pipe' });
  if (acl.status !== 0) throw Error('LOCAL_PRIVATE_FOLDER_PROTECTION_FAILED');
}

async function userSchemas(pool) {
  const result = await pool.query(`SELECT nspname AS name FROM pg_catalog.pg_namespace
    WHERE nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND nspname <> 'information_schema'
    ORDER BY nspname`);
  return result.rows.map(row => row.name);
}

async function snapshot(pool) {
  const schemas = await userSchemas(pool);
  const tables = (await pool.query(`SELECT table_schema,table_name FROM information_schema.tables
    WHERE table_type='BASE TABLE' AND table_schema=ANY($1)
      AND table_name<>'c4g_schema_migration'
    ORDER BY table_schema,table_name`, [schemas])).rows;
  const data = {};
  for (const table of tables) {
    const name = `${cfg.identifier(table.table_schema)}.${cfg.identifier(table.table_name)}`;
    const rows = (await pool.query(`SELECT to_jsonb(t)::text AS row FROM ${name} t`))
      .rows.map(row => row.row).sort();
    data[name] = { count: rows.length,
      digest: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
  }
  return { schemas, data };
}

function snapshotDifferences(expected, observed) {
  const differences = [];
  if (JSON.stringify(expected.schemas) !== JSON.stringify(observed.schemas)) differences.push('SCHEMAS');
  const tables = new Set([...Object.keys(expected.data), ...Object.keys(observed.data)]);
  for (const table of [...tables].sort()) {
    if (JSON.stringify(expected.data[table]) !== JSON.stringify(observed.data[table])) differences.push(table);
  }
  return differences;
}

function assertSnapshotMatches(expected, observed) {
  const differences = snapshotDifferences(expected, observed);
  if (differences.length) {
    const error = Error('PLATFORM_BILLING_RESTORE_CONTENT_MISMATCH');
    error.code = 'PLATFORM_BILLING_RESTORE_CONTENT_MISMATCH';
    error.differences = differences;
    throw error;
  }
}

function structuralDifferences(expected, observed, prefix = '') {
  const plain = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!plain(expected) || !plain(observed)) {
    return JSON.stringify(expected) === JSON.stringify(observed) ? [] : [prefix || 'VALUE'];
  }
  const result = [];
  const keys = new Set([...Object.keys(expected), ...Object.keys(observed)]);
  for (const key of [...keys].sort()) {
    const next = prefix ? `${prefix}.${key}` : key;
    result.push(...structuralDifferences(expected[key], observed[key], next));
  }
  return result;
}

async function normalizeTenantRestoreAcl(restored, expected, observed) {
  const expectedRows = expected.organizationProfileSecurity?.authoringAcl || [];
  const observedRows = observed.organizationProfileSecurity?.authoringAcl || [];
  const observedSet = new Set(observedRows.map(JSON.stringify));
  const expectedSet = new Set(expectedRows.map(JSON.stringify));
  const missing = expectedRows.filter(row => !observedSet.has(JSON.stringify(row)));
  const additional = observedRows.filter(row => !expectedSet.has(JSON.stringify(row)));
  if (additional.length || missing.some(row => row.grantee !== 'c4g_organization_profile_owner'
      || row.is_grantable !== false
      || !['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
        .includes(row.privilege_type))) return 0;
  const grouped = new Map();
  for (const row of missing) {
    const privileges = grouped.get(row.object_name) || [];
    privileges.push(row.privilege_type);
    grouped.set(row.object_name, privileges);
  }
  for (const [table, privileges] of grouped) {
    await restored.query(`GRANT ${privileges.sort().join(',')} ON TABLE
      ${cfg.identifier('organization_profile')}.${cfg.identifier(table)}
      TO ${cfg.identifier('c4g_organization_profile_owner')}`);
  }
  return missing.length;
}

async function assertNoActiveWork(central) {
  const activeRuns = await central.query(
    "SELECT count(*)::integer AS count FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING')"
  );
  if (activeRuns.rows[0].count !== 0) throw Error('LOCAL_ACTIVE_FUNDING_RUNS');
}

async function assertNoExternalSessions(central, tenant, config) {
  const tenantPid = (await tenant.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const result = await central.query(`SELECT datname, count(*)::integer AS count
    FROM pg_catalog.pg_stat_activity
    WHERE datname = ANY($1::text[]) AND pid <> pg_backend_pid() AND pid <> $2
    GROUP BY datname ORDER BY datname`, [[config.centralDatabase, config.tenantDatabase], tenantPid]);
  if (result.rows.length !== 0) throw Error('LOCAL_APPLICATIONS_MUST_BE_STOPPED');
}

async function createRestoreDatabase(admin, name, tenantDatabase) {
  await admin.query(`CREATE DATABASE ${cfg.identifier(name)} TEMPLATE template0 ENCODING 'UTF8'
    LOCALE_PROVIDER icu ICU_LOCALE 'und'`);
  await admin.query(`REVOKE CONNECT,TEMP ON DATABASE ${cfg.identifier(name)} FROM PUBLIC`);
  if (tenantDatabase) {
    await admin.query(`GRANT CONNECT,CREATE ON DATABASE ${cfg.identifier(name)} TO c4g_tenant_owner`);
    await admin.query(`GRANT CONNECT ON DATABASE ${cfg.identifier(name)} TO c4g_tenant_migrator,c4g_tenant_runtime`);
    await admin.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${cfg.identifier(name)}
      SET search_path TO pg_catalog,c4g_app`);
  }
}

async function restoreAndVerify({ admin, config, state, bin, dump, name, before, tenantDatabase,
  tenantSchemaExpected }) {
  const restoreName = `c4g_billing_restore_${name}_${randomUUID().replaceAll('-', '')}`;
  let restored;
  let created = false;
  try {
    await createRestoreDatabase(admin, restoreName, tenantDatabase);
    created = true;
    runPostgresTool(bin, 'pg_restore.exe', ['--exit-on-error', '--no-password', '-h', config.host,
      '-p', String(config.port), '-U', config.user, '-d', restoreName, dump], config,
    'PLATFORM_BILLING_BACKUP_RESTORE_FAILED');
    restored = new Pool({ ...cfg.connection(config, restoreName), max: 1 });
    const restoredSnapshot = await snapshot(restored);
    assertSnapshotMatches(before, restoredSnapshot);
    if (tenantDatabase) {
      let restoredSchema = await tenantSchemaSnapshot(restored);
      let normalizedAclEntries = 0;
      if (tenantSchemaFingerprint(restoredSchema) !== tenantSchemaFingerprint(tenantSchemaExpected)) {
        normalizedAclEntries = await normalizeTenantRestoreAcl(restored, tenantSchemaExpected, restoredSchema);
        restoredSchema = await tenantSchemaSnapshot(restored);
      }
      if (tenantSchemaFingerprint(restoredSchema) !== tenantSchemaFingerprint(tenantSchemaExpected)) {
        const error = Error('PLATFORM_BILLING_TENANT_SCHEMA_RESTORE_MISMATCH');
        error.code = 'PLATFORM_BILLING_TENANT_SCHEMA_RESTORE_MISMATCH';
        error.differences = structuralDifferences(tenantSchemaExpected, restoredSchema);
        if (error.differences.includes('organizationProfileSecurity.authoringAcl')) {
          const expectedAcl = new Set(tenantSchemaExpected.organizationProfileSecurity.authoringAcl.map(JSON.stringify));
          const restoredAcl = new Set(restoredSchema.organizationProfileSecurity.authoringAcl.map(JSON.stringify));
          error.aclDifference = {
            missing: [...expectedAcl].filter(row => !restoredAcl.has(row)).slice(0, 20).map(JSON.parse),
            additional: [...restoredAcl].filter(row => !expectedAcl.has(row)).slice(0, 20).map(JSON.parse)
          };
        }
        throw error;
      }
      const ready = await preflightTenant(restored, {
        tenantId: state.tenantId,
        databaseGenerationId: state.generationId
      }, undefined, { timeoutMs: 15000 });
      return { dataMatches: true, schemaVersion: ready.currentVersion,
        schemaFingerprint: ready.schemaFingerprint, normalizedAclEntries };
    }
    const ready = await preflightCentral(restored);
    return { dataMatches: true, schemaVersion: ready.currentVersion, schemaFingerprint: ready.fingerprint };
  } finally {
    await restored?.end();
    if (created) await admin.query(`DROP DATABASE ${cfg.identifier(restoreName)} WITH (FORCE)`);
  }
}

function backupMetadata(root, filename) {
  const stats = fs.statSync(filename);
  assert(stats.isFile() && stats.size > 1000);
  return { file: path.relative(root, filename), bytes: stats.size, sha256: sha256File(filename) };
}

async function dumpConsistent({ pool, config, bin, database, dump }) {
  const client = await pool.connect();
  let transaction = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transaction = true;
    const exported = await client.query('SELECT pg_export_snapshot() AS snapshot_id');
    const snapshotId = exported.rows[0]?.snapshot_id;
    if (!/^[0-9A-F-]+$/i.test(snapshotId || '')) throw Error('POSTGRES_EXPORTED_SNAPSHOT_REQUIRED');
    const before = await snapshot(client);
    runPostgresTool(bin, 'pg_dump.exe', ['--format=custom', '--no-password', `--snapshot=${snapshotId}`,
      '-h', config.host, '-p', String(config.port), '-U', config.user, '-f', dump, database], config,
    'PLATFORM_BILLING_BACKUP_FAILED');
    await client.query('COMMIT');
    transaction = false;
    return before;
  } catch (error) {
    if (transaction) {
      try { await client.query('ROLLBACK'); } catch { /* preserve the original failure */ }
    }
    throw error;
  } finally {
    client.release();
  }
}

async function prepare() {
  const config = cfg.readConfig();
  const state = JSON.parse(fs.readFileSync(path.join(cfg.folder, 'runtime.json')));
  assertRolloutTarget(config, state);
  const folder = rolloutFolder();
  protectPrivateFolder(folder);
  const backup = path.join(folder, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  protectPrivateFolder(backup);
  const bin = findPostgresBin();
  const central = new Pool({ ...cfg.connection(config, config.centralDatabase), max: 1 });
  const tenant = new Pool({ ...cfg.connection(config, config.tenantDatabase), max: 1 });
  try {
    const centralReady = await preflightCentral(central);
    assert.equal(centralReady.currentVersion, PREVIOUS_VERSION);
    const tenantReady = await preflightTenant(tenant, {
      tenantId: state.tenantId,
      databaseGenerationId: state.generationId
    }, undefined, { timeoutMs: 15000 });
    const tenantSchemaExpected = await tenantSchemaSnapshot(tenant);
    await assertNoActiveWork(central);

    fs.copyFileSync(path.join(cfg.folder, 'runtime.json'), path.join(backup, 'runtime.json'));
    const before = {};
    const dumps = {};
    for (const [pool, database, name] of [[central, config.centralDatabase, 'central'],
      [tenant, config.tenantDatabase, 'tenant']]) {
      const dump = path.join(backup, `${name}.dump`);
      before[name] = await dumpConsistent({ pool, config, bin, database, dump });
      runPostgresTool(bin, 'pg_restore.exe', ['--list', dump], config,
        'PLATFORM_BILLING_BACKUP_UNREADABLE');
      dumps[name] = backupMetadata(cfg.root, dump);
    }
    cfg.saveState(before, path.join(backup, 'data-fingerprints.json'));

    const restore = {
      central: await restoreAndVerify({ admin: central, config, state, bin,
        dump: path.join(cfg.root, dumps.central.file), name: 'central', before: before.central,
        tenantDatabase: false }),
      tenant: await restoreAndVerify({ admin: central, config, state, bin,
        dump: path.join(cfg.root, dumps.tenant.file), name: 'tenant', before: before.tenant,
        tenantDatabase: true, tenantSchemaExpected })
    };
    assert.equal(restore.central.schemaVersion, PREVIOUS_VERSION);
    assert.equal(restore.tenant.schemaVersion, tenantReady.currentVersion);

    const evidence = {
      formatVersion: 1,
      result: 'PASS',
      status: 'PREPARED',
      target: { host: config.host, port: config.port, centralDatabase: config.centralDatabase,
        tenantDatabase: config.tenantDatabase },
      currentCentralVersion: centralReady.currentVersion,
      expectedMigration: TARGET_VERSION,
      backup: { folder: path.relative(cfg.root, backup), ...dumps },
      before,
      restore,
      observedAt: new Date().toISOString()
    };
    cfg.saveState(evidence, evidenceFile('prepare'));
    console.log('PLATFORM_BILLING_ROLLOUT_PREPARE_PASS');
    return evidence;
  } finally {
    await central.end();
    await tenant.end();
  }
}

function assertBackupUnchanged(evidence) {
  for (const name of ['central', 'tenant']) {
    const item = evidence.backup[name];
    const filename = path.resolve(cfg.root, item.file);
    const privateRoot = path.resolve(rolloutFolder()) + path.sep;
    if (!filename.startsWith(privateRoot) || !fs.existsSync(filename)
        || fs.statSync(filename).size !== item.bytes || sha256File(filename) !== item.sha256) {
      throw Error('PLATFORM_BILLING_BACKUP_EVIDENCE_INVALID');
    }
  }
}

function assertExistingDataPreserved(before, after) {
  assert.deepEqual(after.schemas, before.schemas);
  for (const [table, value] of Object.entries(before.data)) assert.deepEqual(after.data[table], value);
}

async function apply() {
  const config = cfg.readConfig();
  const stateFile = path.join(cfg.folder, 'runtime.json');
  const state = JSON.parse(fs.readFileSync(stateFile));
  assertRolloutTarget(config, state);
  const evidence = JSON.parse(fs.readFileSync(evidenceFile('prepare')));
  assert.equal(evidence.formatVersion, 1);
  assert.equal(evidence.result, 'PASS');
  assert.equal(evidence.status, 'PREPARED');
  assert.equal(evidence.currentCentralVersion, PREVIOUS_VERSION);
  assert.equal(evidence.expectedMigration, TARGET_VERSION);
  assert.deepEqual(evidence.target, {
    host: config.host, port: config.port, centralDatabase: config.centralDatabase,
    tenantDatabase: config.tenantDatabase
  });
  assertBackupUnchanged(evidence);

  const central = new Pool({ ...cfg.connection(config, config.centralDatabase), max: 1 });
  const tenant = new Pool({ ...cfg.connection(config, config.tenantDatabase), max: 1 });
  try {
    const current = await preflightCentral(central);
    assert.ok([PREVIOUS_VERSION, TARGET_VERSION].includes(current.currentVersion));
    await preflightTenant(tenant, { tenantId: state.tenantId,
      databaseGenerationId: state.generationId }, undefined, { timeoutMs: 15000 });
    await assertNoExternalSessions(central, tenant, config);
    await assertNoActiveWork(central);
    assert.deepEqual(await snapshot(tenant), evidence.before.tenant);

    if (current.currentVersion === PREVIOUS_VERSION) {
      assert.deepEqual(await snapshot(central), evidence.before.central);
    }
    const applied = await applyCentralMigrations(central);
    assert.deepEqual(applied, current.currentVersion === PREVIOUS_VERSION ? [TARGET_VERSION] : []);
    const ready = await preflightCentral(central);
    assert.equal(ready.currentVersion, TARGET_VERSION);

    const centralAfter = await snapshot(central);
    const expectedSchemas = evidence.before.central.schemas;
    assert.deepEqual(centralAfter.schemas, expectedSchemas);
    for (const [table, value] of Object.entries(evidence.before.central.data)) {
      assert.deepEqual(centralAfter.data[table], value);
    }
    const added = Object.keys(centralAfter.data).filter(table => !(table in evidence.before.central.data));
    assert.deepEqual(added.sort(), BILLING_TABLES.map(table => `"public"."${table}"`).sort());
    for (const table of added) assert.equal(centralAfter.data[table].count, 0);
    assertExistingDataPreserved(evidence.before.tenant, await snapshot(tenant));

    state.platformBilling = true;
    cfg.saveState(state, stateFile);
    const result = {
      formatVersion: 1,
      result: 'PASS',
      status: 'APPLIED',
      migration: TARGET_VERSION,
      schemaFingerprint: ready.fingerprint,
      backup: evidence.backup,
      existingCentralDataPreserved: true,
      tenantDataPreserved: true,
      billingTablesEmpty: true,
      observedAt: new Date().toISOString()
    };
    cfg.saveState(result, evidenceFile('apply'));
    console.log('PLATFORM_BILLING_ROLLOUT_APPLY_PASS');
    return result;
  } finally {
    await central.end();
    await tenant.end();
  }
}

async function main(argv = process.argv.slice(2)) {
  assert.deepEqual(argv.length, 1);
  if (argv[0] === '--prepare') return prepare();
  if (argv[0] === '--apply') return apply();
  throw Error('PLATFORM_BILLING_ROLLOUT_MODE_REQUIRED');
}

if (require.main === module) main().catch(error => {
  const code = error.code || (/^[A-Z0-9_]+$/.test(error.message || '')
    ? error.message : 'PLATFORM_BILLING_ROLLOUT_FAILED');
  console.error(code);
  process.exitCode = 1;
});

module.exports = {
  BILLING_TABLES, PREVIOUS_VERSION, TARGET_VERSION, apply, assertExistingDataPreserved,
  assertRolloutTarget, assertSnapshotMatches, dumpConsistent, main, prepare, sha256File,
  normalizeTenantRestoreAcl, snapshotDifferences, structuralDifferences
};
