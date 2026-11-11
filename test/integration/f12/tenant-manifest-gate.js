'use strict';

const assert = require('node:assert/strict');
const { Pool } = require('../../../backend/node_modules/pg');
const { manifest } = require('../../../backend/src/security/tenantMigrationManifest');
const { createTenantMigrationRunner } = require('../../../backend/src/security/tenantMigrationRunner');
const { preflightTenant } = require('../../../backend/src/security/tenantMigrationPreflight');
const { tenantSchemaFingerprint, tenantSchemaSnapshot } = require('../../../backend/src/security/tenantSchemaFingerprint');

const TENANT_ID = '12121212-1212-4121-8121-121212121212';
const GENERATION_ID = '34343434-3434-4343-8343-343434343434';
const DATABASES = Object.freeze([
  'f12_manifest_empty', 'f12_manifest_from_003', 'f12_manifest_from_004',
  'f12_manifest_from_005', 'f12_manifest_from_006',
  'f12_manifest_failure', 'f12_manifest_uncertain', 'f12_manifest_drift',
  'f12_manifest_gap', 'f12_manifest_concurrent'
]);

function databaseUrl(name) {
  const source = new URL(process.env.F12_GATE_URL);
  if (!['127.0.0.1', 'localhost'].includes(source.hostname) || ['5432', '5433'].includes(source.port)) {
    throw new Error('F12 cumulative manifest target refused.');
  }
  source.pathname = `/${name}`;
  return source.toString();
}

function request(label) {
  return Object.freeze({ tenantId: TENANT_ID, databaseGenerationId: GENERATION_ID,
    expectedRevision: 1, correlationId: `synthetic-${label}`, idempotencyKey: `synthetic-${label}` });
}

function runner(pool, entries = manifest, publications = []) {
  return createTenantMigrationRunner({ pool, entries,
    observationPublisher: { async publish(value) { publications.push(value); } },
    timeoutMs: 10000, scheduler: { setTimeout, clearTimeout },
    fingerprintSchema: async client => {
      const fingerprint = tenantSchemaFingerprint(await tenantSchemaSnapshot(client));
      if (!manifest.some(entry => entry.schemaFingerprint === fingerprint)) {
        process.stderr.write(`Unregistered synthetic tenant fingerprint: ${fingerprint}\n`);
      }
      return fingerprint;
    } });
}

function proxyPool(pool, intercept) {
  return Object.freeze({
    async connect() {
      const client = await pool.connect();
      return Object.freeze({
        async query(sql, params) { return intercept(client, sql, params); },
        release(error) { return client.release(error); }
      });
    }
  });
}

async function retryTransientConnection(operation, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      lastError = error;
      if (!/connection terminated unexpectedly|ECONNRESET|the database system is starting up/i.test(error.message)
        || attempt === attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 100));
    }
  }
  throw lastError;
}

async function createInfrastructure() {
  const admin = new Pool({ connectionString: process.env.F12_GATE_URL, max: 2 });
  try {
    for (const role of ['c4g_tenant_owner', 'c4g_tenant_migrator', 'c4g_tenant_runtime',
      'c4g_import_worker_runtime']) {
      await retryTransientConnection(() => admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN
        CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        END IF; END $$`));
    }
    await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
    for (const name of DATABASES) {
      await admin.query(`CREATE DATABASE ${name} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
      await admin.query(`ALTER DATABASE ${name} SET timezone TO 'UTC'`);
      await admin.query(`GRANT CONNECT,CREATE ON DATABASE ${name} TO c4g_tenant_owner`);
      await admin.query(`GRANT CONNECT ON DATABASE ${name} TO c4g_tenant_migrator,c4g_tenant_runtime`);
      const pool = new Pool({ connectionString: databaseUrl(name), max: 4 });
      await retryTransientConnection(() => pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC'));
      await retryTransientConnection(() => pool.query(`REVOKE CONNECT,TEMP ON DATABASE ${name} FROM PUBLIC`));
      await retryTransientConnection(() => pool.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${name} SET search_path TO pg_catalog,c4g_app`));
      await pool.end();
    }
  } finally { await admin.end(); }
}

async function installPrefix(pool, length, label) {
  const result = await runner(pool, Object.freeze(manifest.slice(0, length))).migrate(request(label));
  assert.equal(result.evidence.currentVersion, manifest[length - 1].version);
  return result;
}

async function assertLatest(pool) {
  const evidence = await preflightTenant(pool, { tenantId: TENANT_ID, databaseGenerationId: GENERATION_ID },
    manifest, { timeoutMs: 10000 });
  assert.equal(evidence.currentVersion, manifest.at(-1).version);
  return evidence;
}

async function main() {
  await createInfrastructure();
  const pools = Object.fromEntries(DATABASES.map(name => [name, new Pool({ connectionString: databaseUrl(name), max: 6 })]));
  try {
    const emptyPublications = [];
    const empty = await runner(pools.f12_manifest_empty, manifest, emptyPublications).migrate(request('empty'));
    assert.deepEqual(empty.appliedVersions, manifest.map(entry => entry.version));
    assert.equal(emptyPublications.length, 1);
    await assertLatest(pools.f12_manifest_empty);

    await installPrefix(pools.f12_manifest_from_003, 4, 'prefix-003');
    const from003 = await runner(pools.f12_manifest_from_003).migrate(request('upgrade-003'));
    assert.deepEqual(from003.appliedVersions, manifest.slice(4).map(entry => entry.version));
    await assertLatest(pools.f12_manifest_from_003);

    await installPrefix(pools.f12_manifest_from_004, 5, 'prefix-004');
    const from004 = await runner(pools.f12_manifest_from_004).migrate(request('upgrade-004'));
    assert.deepEqual(from004.appliedVersions, manifest.slice(5).map(entry => entry.version));
    const second = await runner(pools.f12_manifest_from_004).migrate(request('upgrade-004-idempotent'));
    assert.deepEqual(second.appliedVersions, []);

    await installPrefix(pools.f12_manifest_from_005, 6, 'prefix-005');
    const from005 = await runner(pools.f12_manifest_from_005).migrate(request('upgrade-005'));
    assert.deepEqual(from005.appliedVersions, manifest.slice(6).map(entry => entry.version));
    await assertLatest(pools.f12_manifest_from_005);

    await installPrefix(pools.f12_manifest_from_006, 7, 'prefix-006');
    const from006 = await runner(pools.f12_manifest_from_006).migrate(request('upgrade-006'));
    assert.deepEqual(from006.appliedVersions, manifest.slice(7).map(entry=>entry.version));
    await assertLatest(pools.f12_manifest_from_006);

    await installPrefix(pools.f12_manifest_failure, 5, 'failure-prefix');
    const legacyExecution='56565656-5656-4656-8656-565656565656';
    const legacyEnvelope={executionId:legacyExecution,jobType:'opportunity.duplicate.scan',idempotencyKey:'legacy-rollback'};
    await pools.f12_manifest_failure.query(`INSERT INTO async_exec.outbox(outbox_id,organization_id,logical_id,envelope,digest_sha256,state,available_at,published_at)
      VALUES($1,$2,'legacy-rollback',$3,$4,'PUBLISHED',transaction_timestamp(),transaction_timestamp())`,
    ['45454545-4545-4454-8454-454545454545',TENANT_ID,legacyEnvelope,'a'.repeat(64)]);
    await pools.f12_manifest_failure.query(`INSERT INTO async_exec.inbox(consumer,job_type,job_version,organization_id,idempotency_key,digest_sha256,execution_id,state,fence,completed_at)
      VALUES('legacy-consumer','opportunity.duplicate.scan',1,$1,'legacy-rollback',$2,$3,'COMPLETED',2,transaction_timestamp())`,
    [TENANT_ID,'a'.repeat(64),legacyExecution]);
    const legacyBefore=(await pools.f12_manifest_failure.query(`SELECT
      (SELECT row_to_json(o) FROM async_exec.outbox o WHERE logical_id='legacy-rollback') AS outbox,
      (SELECT row_to_json(i) FROM async_exec.inbox i WHERE idempotency_key='legacy-rollback') AS inbox`)).rows[0];
    let injectLedgerFailure = true;
    const failingPool = proxyPool(pools.f12_manifest_failure, async (client, sql, params) => {
      if (injectLedgerFailure && String(sql).includes('INSERT INTO c4g_system.schema_migration') && params?.[1] === 5) {
        injectLedgerFailure = false;
        throw new Error('synthetic ledger failure');
      }
      return client.query(sql, params);
    });
    await assert.rejects(() => runner(failingPool).migrate(request('failure')),
      error => error.internalCode === 'TENANT_MIGRATION_LEDGER_FAILED');
    assert.equal((await pools.f12_manifest_failure.query(
      "SELECT to_regtype('async_exec.delivery_kind') IS NULL AS absent"
    )).rows[0].absent, true);
    assert.equal((await pools.f12_manifest_failure.query(
      'SELECT max(ordinal)::int AS ordinal FROM c4g_system.schema_migration'
    )).rows[0].ordinal, 4);
    assert.deepEqual((await pools.f12_manifest_failure.query(`SELECT
      (SELECT row_to_json(o) FROM async_exec.outbox o WHERE logical_id='legacy-rollback') AS outbox,
      (SELECT row_to_json(i) FROM async_exec.inbox i WHERE idempotency_key='legacy-rollback') AS inbox`)).rows[0],legacyBefore);
    const rolledBackShape=(await pools.f12_manifest_failure.query(`SELECT
      NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='async_exec.outbox'::regclass AND attname='lineage_version' AND NOT attisdropped) AS no_column,
      to_regtype('async_exec.delivery_kind') IS NULL AS no_type,
      to_regclass('async_exec.f9_tenant_outbox_execution_v1') IS NULL AS no_index,
      NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conname='outbox_lineage_shape_check') AS no_constraint`)).rows[0];
    assert.ok(Object.values(rolledBackShape).every(Boolean));
    assert.deepEqual((await runner(pools.f12_manifest_failure).migrate(request('failure-retry'))).appliedVersions,
      manifest.slice(5).map(entry => entry.version));
    const upgradedLegacy=(await pools.f12_manifest_failure.query(`SELECT lineage_version,delivery_kind,attempt,root_execution_id
      FROM async_exec.outbox WHERE logical_id='legacy-rollback'`)).rows[0];
    assert.deepEqual(upgradedLegacy,{lineage_version:0,delivery_kind:null,attempt:null,root_execution_id:null});
    assert.equal((await pools.f12_manifest_failure.query('SELECT max(ordinal)::int AS ordinal FROM c4g_system.schema_migration')).rows[0].ordinal,manifest.at(-1).ordinal);

    await installPrefix(pools.f12_manifest_uncertain, 5, 'uncertain-prefix');
    let failCommit = true;
    const uncertainPool = proxyPool(pools.f12_manifest_uncertain, async (client, sql, params) => {
      const result = await client.query(sql, params);
      if (failCommit && sql === 'COMMIT') { failCommit = false; throw new Error('synthetic commit acknowledgement loss'); }
      return result;
    });
    const reconciled = await runner(uncertainPool).migrate(request('uncertain'));
    assert.equal(reconciled.reconciled, true);
    await assertLatest(pools.f12_manifest_uncertain);

    await installPrefix(pools.f12_manifest_drift, 5, 'drift-prefix');
    await pools.f12_manifest_drift.query('SET ROLE c4g_opportunity_tenant_owner');
    await pools.f12_manifest_drift.query('CREATE TABLE opportunity_catalog.synthetic_drift(id integer)');
    await pools.f12_manifest_drift.query('RESET ROLE');
    await assert.rejects(() => runner(pools.f12_manifest_drift).migrate(request('drift')),
      error => error.internalCode === 'TENANT_SCHEMA_FINGERPRINT_MISMATCH');

    await installPrefix(pools.f12_manifest_gap, 4, 'gap-prefix');
    await pools.f12_manifest_gap.query('ALTER TABLE c4g_system.schema_migration DISABLE TRIGGER USER');
    await pools.f12_manifest_gap.query('DELETE FROM c4g_system.schema_migration WHERE ordinal=1');
    await pools.f12_manifest_gap.query('ALTER TABLE c4g_system.schema_migration ENABLE TRIGGER USER');
    await assert.rejects(() => runner(pools.f12_manifest_gap).migrate(request('gap')),
      error => error.internalCode === 'TENANT_LEDGER_MISMATCH');

    await installPrefix(pools.f12_manifest_concurrent, 5, 'concurrent-prefix');
    const attempts = await Promise.allSettled([
      runner(pools.f12_manifest_concurrent).migrate(request('concurrent-a')),
      runner(pools.f12_manifest_concurrent).migrate(request('concurrent-b'))
    ]);
    assert.ok(attempts.some(item => item.status === 'fulfilled'));
    assert.ok(attempts.every(item => item.status === 'fulfilled'
      || item.reason?.internalCode === 'LOCK_CONFLICT'));
    await assertLatest(pools.f12_manifest_concurrent);

    process.stdout.write(`${JSON.stringify({ cumulativeManifest: true, canonicalRunner: true,
      emptyTo014: true, upgrade003To014: true, upgrade004To014: true, upgrade005To014: true, upgrade006To014: true,
      rollbackBeforeLedger: true, retryAfterRollback: true, uncertainCommitReconciled: true,
      fingerprintDriftDenied: true, ledgerGapDenied: true, concurrent: true,
      idempotentSecondRun: true, versions: manifest.length })}\n`);
  } finally { await Promise.all(Object.values(pools).map(pool => pool.end())); }
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
