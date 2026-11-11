'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('../../../backend/node_modules/pg');
const { manifest, migrationSql } = require('../../../backend/src/security/tenantMigrationManifest');
const { createTenantMigrationRunner } = require('../../../backend/src/security/tenantMigrationRunner');
const { preflightTenant } = require('../../../backend/src/security/tenantMigrationPreflight');
const { tenantSchemaFingerprint, tenantSchemaSnapshot } = require('../../../backend/src/security/tenantSchemaFingerprint');
const { candidate } = require('../../../backend/src/documents/multipartMigration');
const { documentTransportPreflight } = require('../../../backend/src/documents/preflight');

const PROOF = 'C4G_DOC_MVP01_GROUP_B_V2';
const DATABASES = Object.freeze(['doc_mvp01_031_a', 'doc_mvp01_031_b']);
const ROLES = Object.freeze(['c4g_tenant_owner', 'c4g_tenant_migrator', 'c4g_tenant_runtime', 'c4g_import_worker_runtime']);

function target() {
  if (process.env.DOC_MVP01_GROUP_B_PROOF !== PROOF) throw new Error('Disposable Group B proof is required.');
  const url = new URL(process.env.DOC_MVP01_GROUP_B_ADMIN_URL);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '56031' || url.pathname !== '/postgres') throw new Error('Group B target is not the dedicated local PostgreSQL instance.');
  const evidencePath = process.env.DOC_MVP01_GROUP_B_EVIDENCE;
  if (!evidencePath || !path.isAbsolute(evidencePath)) throw new Error('External evidence path is required.');
  return Object.freeze({ evidencePath, url });
}
function databaseUrl(source, database) { const url = new URL(source.toString()); url.pathname = `/${database}`; return url.toString(); }
function request(label, identity) { return Object.freeze({ tenantId: identity.tenantId, databaseGenerationId: identity.databaseGenerationId, expectedRevision: 1, correlationId: `${label}-${crypto.randomUUID()}`, idempotencyKey: `${label}-${crypto.randomUUID()}` }); }
function runner(pool, entries = manifest) { return createTenantMigrationRunner({ pool, entries, observationPublisher: { async publish() {} }, timeoutMs: 60000, scheduler: { setTimeout, clearTimeout } }); }
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function sectionHashes(snapshot) { return Object.freeze(Object.fromEntries(Object.entries(snapshot).map(([name, value]) => [name, Object.freeze({ count: Array.isArray(value) ? value.length : 1, sha256: hash(value) })]))); }
function difference(before, after) {
  const result = {};
  for (const section of Object.keys(after)) {
    const left = before[section]; const right = after[section];
    if (JSON.stringify(left) === JSON.stringify(right)) continue;
    if (!Array.isArray(left) || !Array.isArray(right)) { result[section] = { before: left, after: right }; continue; }
    const oldRows = new Map(left.map(row => [JSON.stringify(row), row])); const newRows = new Map(right.map(row => [JSON.stringify(row), row]));
    result[section] = Object.freeze({ added: right.filter(row => !oldRows.has(JSON.stringify(row))), removed: left.filter(row => !newRows.has(JSON.stringify(row))) });
  }
  return Object.freeze(result);
}
async function createInfrastructure(admin) {
  for (const role of ROLES) await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$`);
  await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator'); await admin.query('GRANT c4g_tenant_migrator TO doc_mvp01_b_admin');
  for (const database of DATABASES) {
    await admin.query(`CREATE DATABASE ${database} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
    await admin.query(`ALTER DATABASE ${database} SET timezone TO 'UTC'`);
    await admin.query(`GRANT CONNECT,CREATE ON DATABASE ${database} TO c4g_tenant_owner`);
    await admin.query(`GRANT CONNECT ON DATABASE ${database} TO c4g_tenant_migrator,c4g_tenant_runtime`);
    const pool = new Pool({ connectionString: databaseUrl(admin.options.connectionString, database), max: 1 });
    try { await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC'); await pool.query(`REVOKE CONNECT,TEMP ON DATABASE ${database} FROM PUBLIC`); await pool.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${database} SET search_path TO pg_catalog,c4g_app`); }
    finally { await pool.end(); }
  }
}
async function environment(pool) { return (await pool.query(`SELECT current_database() AS database,current_user,current_setting('server_version') AS server_version,current_setting('server_version_num') AS server_version_num,current_setting('TimeZone') AS timezone,current_setting('server_encoding') AS server_encoding,d.datlocprovider AS locale_provider,COALESCE(d.datlocale,'') AS icu_locale,COALESCE(d.datcollversion,'') AS collation_version FROM pg_database d WHERE d.datname=current_database()`)).rows[0]; }
async function securityProof(pool, organizationId) {
  const grants = (await pool.query(`SELECT
    has_table_privilege('c4g_document_runtime','document_storage.multipart_upload','SELECT') AS can_select,
    has_table_privilege('c4g_document_runtime','document_storage.multipart_upload','INSERT') AS can_insert,
    has_table_privilege('c4g_document_runtime','document_storage.multipart_upload','UPDATE') AS can_update,
    has_table_privilege('c4g_document_runtime','document_storage.multipart_upload','DELETE') AS can_delete,
    has_table_privilege('c4g_document_runtime','document_storage.multipart_upload','TRUNCATE') AS can_truncate,
    has_table_privilege('c4g_document_runtime','document_storage.multipart_part','INSERT') AS direct_part_insert,
    has_function_privilege('c4g_document_runtime','document_storage.register_multipart_upload(uuid,uuid,uuid,text,timestamp with time zone)','EXECUTE') AS can_register,
    has_function_privilege('public','document_storage.register_multipart_upload(uuid,uuid,uuid,text,timestamp with time zone)','EXECUTE') AS public_register`)).rows[0];
  assert.deepEqual(grants, { can_select: true, can_insert: false, can_update: false, can_delete: false, can_truncate: false, direct_part_insert: false, can_register: true, public_register: false });
  const client = await pool.connect(); let foreignDenied = false; let directDenied = false;
  try {
    await client.query('BEGIN'); await client.query('SET LOCAL ROLE c4g_document_runtime'); await client.query("SELECT set_config('app.organization_id',$1,true)", [organizationId]);
    await client.query('SAVEPOINT foreign_call');
    try { await client.query('SELECT * FROM document_storage.claim_expired_multipart_uploads($1,1)', [crypto.randomUUID()]); }
    catch (error) { foreignDenied = /DOCUMENT_TENANT_CONTEXT_INVALID/.test(error.message); }
    await client.query('ROLLBACK TO SAVEPOINT foreign_call');
    await client.query('SAVEPOINT direct_write');
    try { await client.query("INSERT INTO document_storage.multipart_upload(version_id,organization_id,object_id,provider_upload_id,state,expires_at) VALUES($1,$2,$3,'forbidden','INITIATED',clock_timestamp()+interval '1 minute')", [crypto.randomUUID(), organizationId, crypto.randomUUID()]); }
    catch (error) { directDenied = error.code === '42501'; }
    await client.query('ROLLBACK');
  } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  assert.equal(foreignDenied, true); assert.equal(directDenied, true);
  return Object.freeze({ grants, foreignOrganizationDenied: foreignDenied, directWriteDenied: directDenied });
}
async function prove(source, database) {
  const pool = new Pool({ connectionString: databaseUrl(source, database), max: 3 }); const identity = Object.freeze({ tenantId: crypto.randomUUID(), databaseGenerationId: crypto.randomUUID() }); const through030 = Object.freeze(manifest.slice(0, -1));
  try {
    const baseline = await runner(pool, through030).migrate(request(`${database}-to030`, identity)); assert.equal(baseline.evidence.currentVersion, '030_organization_notices');
    const snapshot030 = await tenantSchemaSnapshot(pool); const fingerprint030 = tenantSchemaFingerprint(snapshot030); assert.equal(fingerprint030, through030.at(-1).schemaFingerprint);
    const applied = await runner(pool).migrate(request(`${database}-to031`, identity)); assert.deepEqual(applied.appliedVersions, ['031_application_document_transport']); assert.equal(applied.evidence.currentVersion, '031_application_document_transport');
    const snapshot031 = await tenantSchemaSnapshot(pool); const fingerprint031 = tenantSchemaFingerprint(snapshot031); assert.equal(fingerprint031, manifest.at(-1).schemaFingerprint);
    assert.deepEqual(await documentTransportPreflight(pool), { ready: true, version: '031_application_document_transport' }); const security = await securityProof(pool, identity.tenantId);
    const reverted = await runner(pool).downgrade({ ...request(`${database}-down031`, identity), targetVersion: '030_organization_notices' }); assert.deepEqual(reverted.revertedVersions, ['031_application_document_transport']);
    const snapshotDown = await tenantSchemaSnapshot(pool); assert.equal(JSON.stringify(snapshotDown), JSON.stringify(snapshot030)); assert.equal(tenantSchemaFingerprint(snapshotDown), fingerprint030);
    const reapplied = await runner(pool).migrate(request(`${database}-reapply031`, identity)); assert.deepEqual(reapplied.appliedVersions, ['031_application_document_transport']);
    const snapshotReapplied = await tenantSchemaSnapshot(pool); assert.equal(JSON.stringify(snapshotReapplied), JSON.stringify(snapshot031));
    const finalPreflight = await preflightTenant(pool, identity, manifest, { timeoutMs: 60000 }); assert.equal(finalPreflight.currentVersion, '031_application_document_transport');
    return Object.freeze({ database, identity, environment: await environment(pool), fingerprint030, fingerprint031, snapshot030, snapshot031, snapshotDown, snapshotReapplied, physicalDifference: difference(snapshot030, snapshot031), security, finalPreflight: { currentVersion: finalPreflight.currentVersion, schemaFingerprint: finalPreflight.schemaFingerprint, capabilities: finalPreflight.capabilities } });
  } finally { await pool.end(); }
}
async function run() {
  const { evidencePath, url } = target(); const admin = new Pool({ connectionString: url.toString(), max: 2 });
  try {
    await createInfrastructure(admin); const results = [];
    for (const database of DATABASES) results.push(await prove(url, database));
    assert.equal(results[0].fingerprint031, results[1].fingerprint031); assert.equal(JSON.stringify(results[0].snapshot031), JSON.stringify(results[1].snapshot031));
    const metadata = candidate(); assert.equal(metadata.admitted, true); assert.equal(metadata.schemaFingerprint, results[0].fingerprint031);
    const summary = Object.freeze({ result: 'PASS', admitted: true, migration: metadata.version, upChecksum: metadata.upChecksum, downChecksum: metadata.downChecksum, fingerprint030: results[0].fingerprint030, fingerprint031: results[0].fingerprint031, imageDigest: process.env.DOC_MVP01_GROUP_B_IMAGE_DIGEST || null, officialRunnerTo031: true, upDownUp: true, downRestores030: true, reproducible: true, preflight: true, security: true, sectionHashes030: sectionHashes(results[0].snapshot030), sectionHashes031: sectionHashes(results[0].snapshot031), physicalDifference: results[0].physicalDifference, databases: results.map(item => ({ database: item.database, identity: item.identity, environment: item.environment, security: item.security, finalPreflight: item.finalPreflight })) });
    fs.mkdirSync(evidencePath, { recursive: true });
    for (const item of results) for (const [name, value] of [['030',item.snapshot030],['031',item.snapshot031],['down-to-030',item.snapshotDown],['reapplied-031',item.snapshotReapplied]]) fs.writeFileSync(path.join(evidencePath, `${item.database}-${name}.json`), `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.writeFileSync(path.join(evidencePath, 'official-admission.json'), `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); process.stdout.write(`${JSON.stringify({ ...summary, physicalDifference: Object.fromEntries(Object.entries(summary.physicalDifference).map(([key,value]) => [key,{ added:value.added?.length ?? null, removed:value.removed?.length ?? null }])) })}\n`);
  } finally { await admin.end(); }
}
run().catch(error => { process.stderr.write(`${JSON.stringify({ name: error.name, code: error.code || null, internalCode: error.internalCode || null, message: error.message, stack: error.stack?.split('\n').slice(0, 10) })}\n`); process.exitCode = 1; });
