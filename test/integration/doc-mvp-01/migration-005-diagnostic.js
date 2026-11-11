'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { Pool } = require('../../../backend/node_modules/pg');
const { manifest } = require('../../../backend/src/security/tenantMigrationManifest');
const { createTenantMigrationRunner } = require('../../../backend/src/security/tenantMigrationRunner');
const { tenantSchemaFingerprint, tenantSchemaSnapshot } = require('../../../backend/src/security/tenantSchemaFingerprint');

const PROOF = 'C4G_MIGRATION_005_DIAGNOSTIC_V1';
const PREFIX = Object.freeze(manifest.filter(entry => entry.ordinal <= 5));
const DATABASES = Object.freeze(['c4g_m005_probe_a', 'c4g_m005_probe_b']);
const ROLES = Object.freeze([
  'c4g_tenant_owner', 'c4g_tenant_migrator', 'c4g_tenant_runtime', 'c4g_import_worker_runtime'
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sectionHashes(snapshot) {
  return Object.freeze(Object.fromEntries(Object.entries(snapshot).map(([name, value]) => [
    name, Object.freeze({ hash: sha256(JSON.stringify(value)), count: Array.isArray(value) ? value.length : 1 })
  ])));
}

function target() {
  if (process.env.MIGRATION_005_DIAGNOSTIC_PROOF !== PROOF) throw new Error('Migration 005 diagnostic proof is required.');
  const url = new URL(process.env.MIGRATION_005_DIAGNOSTIC_URL);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || !/^56\d{3}$/.test(url.port)
      || url.pathname !== '/postgres') throw new Error('Migration 005 diagnostic target is not isolated.');
  const evidencePath = process.env.MIGRATION_005_EVIDENCE;
  if (!evidencePath || !require('node:path').isAbsolute(evidencePath)) throw new Error('External evidence path is required.');
  return { url, evidencePath };
}

async function createInfrastructure(admin) {
  for (const role of ROLES) {
    const exists = (await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount === 1;
    if (!exists) await admin.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  }
  await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
  for (const name of DATABASES) {
    await admin.query(`CREATE DATABASE ${name} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
    await admin.query(`ALTER DATABASE ${name} SET timezone TO 'UTC'`);
    await admin.query(`GRANT CONNECT,CREATE ON DATABASE ${name} TO c4g_tenant_owner`);
    await admin.query(`GRANT CONNECT ON DATABASE ${name} TO c4g_tenant_migrator,c4g_tenant_runtime`);
  }
}

async function environment(pool) {
  const settings = (await pool.query(`SELECT current_setting('server_version') AS server_version,
    current_setting('server_version_num') AS server_version_num,current_setting('TimeZone') AS timezone,
    current_setting('server_encoding') AS server_encoding,pg_encoding_to_char(d.encoding) AS database_encoding,
    d.datlocprovider AS locale_provider,COALESCE(d.datlocale,'') AS icu_locale,
    COALESCE(d.datcollversion,'') AS collation_version
    FROM pg_database d WHERE d.datname=current_database()`)).rows[0];
  const extensions = (await pool.query("SELECT extname,extversion FROM pg_extension ORDER BY extname")).rows;
  const roles = (await pool.query(`SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,
    rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY($1::text[]) ORDER BY rolname`, [ROLES])).rows;
  return Object.freeze({ settings, extensions, roles });
}

async function prove(adminUrl, database) {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  const pool = new Pool({ connectionString: url.toString(), max: 2 });
  const captures = [];
  try {
    await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await pool.query(`REVOKE CONNECT,TEMP ON DATABASE ${database} FROM PUBLIC`);
    await pool.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${database} SET search_path TO pg_catalog,c4g_app`);
    const metadata = await environment(pool);
    const runner = createTenantMigrationRunner({
      pool,
      entries: PREFIX,
      observationPublisher: { async publish() {} },
      timeoutMs: 15000,
      scheduler: { setTimeout, clearTimeout },
      fingerprintSchema: async client => {
        const snapshot = await tenantSchemaSnapshot(client);
        const entry = PREFIX[captures.length];
        assert.ok(entry, 'Unexpected fingerprint invocation.');
        captures.push(Object.freeze({ version: entry.version, ordinal: entry.ordinal,
          expected: entry.schemaFingerprint, observed: tenantSchemaFingerprint(snapshot),
          sections: sectionHashes(snapshot), snapshot }));
        return captures.at(-1).observed;
      }
    });
    let outcome;
    try {
      const value = await runner.migrate({ tenantId: crypto.randomUUID(), databaseGenerationId: crypto.randomUUID(),
        expectedRevision: 1, correlationId: crypto.randomUUID(), idempotencyKey: `m005-${database}` });
      outcome = Object.freeze({ status: 'ACCEPTED', appliedVersions: value.appliedVersions });
    } catch (error) {
      outcome = Object.freeze({ status: 'REJECTED', name: error.name,
        internalCode: error.internalCode || null, message: error.message });
    }
    const rollback = (await pool.query(`SELECT to_regclass('c4g_system.schema_migration') IS NULL AS ledger_absent,
      to_regclass('async_exec.outbox') IS NULL AS outbox_absent,
      to_regtype('async_exec.delivery_kind') IS NULL AS delivery_kind_absent`)).rows[0];
    return Object.freeze({ database, metadata, outcome, rollback, captures: Object.freeze(captures) });
  } finally {
    await pool.end();
  }
}

function firstDifference(left, right) {
  const sections = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  for (const section of sections) {
    const a = left[section];
    const b = right[section];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const length = Math.max(Array.isArray(a) ? a.length : 1, Array.isArray(b) ? b.length : 1);
    for (let index = 0; index < length; index += 1) {
      const av = Array.isArray(a) ? a[index] : a;
      const bv = Array.isArray(b) ? b[index] : b;
      if (JSON.stringify(av) !== JSON.stringify(bv)) return Object.freeze({ section, index, left: av ?? null, right: bv ?? null });
    }
  }
  return null;
}

async function main() {
  const { url, evidencePath } = target();
  const admin = new Pool({ connectionString: url.toString(), max: 2 });
  try {
    await createInfrastructure(admin);
    const databases = [];
    for (const database of DATABASES) databases.push(await prove(url, database));
    const left005 = databases[0].captures.find(item => item.ordinal === 5);
    const right005 = databases[1].captures.find(item => item.ordinal === 5);
    assert.ok(left005 && right005, 'Migration 005 was not observed before the runner decision.');
    const evidence = Object.freeze({ schemaVersion: 1, proof: PROOF,
      manifestExpected005: PREFIX.at(-1).schemaFingerprint,
      databases: Object.freeze(databases), equivalent005: left005.observed === right005.observed,
      first005Difference: firstDifference(left005.snapshot, right005.snapshot) });
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ result: 'PASS', evidencePath,
      outcomes: databases.map(item => item.outcome), observed005: databases.map(item => item.captures.at(-1).observed),
      equivalent005: evidence.equivalent005, first005Difference: evidence.first005Difference })}\n`);
  } finally {
    await admin.end();
  }
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ name: error.name, code: error.code || null,
    internalCode: error.internalCode || null, message: error.message, stack: error.stack })}\n`);
  process.exitCode = 1;
});
