'use strict';
// Targeted PostgreSQL proof of the new reader against the ACTUAL existing
// migrations/RLS and shared lock. Not an HTTP, F7 or browser acceptance gate.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('../../../backend/node_modules/pg');
const { createTenantMigrationRunner } = require('../../../backend/src/security/tenantMigrationRunner');
const { observeVerifications } = require('../../../backend/src/prequalification/admissibility');
const { fixture, verify, id, at } = require('../../../backend/test/fixtures/pq1Activation');
const { extract } = require('../../../backend/src/organizationalProfile/pq1Material');
async function run() {
  if (process.env.F13_EDITORIAL_DISPOSABLE_PROOF !== 'C4G_F13_EDITORIAL_DISPOSABLE_V1') throw Error('Disposable proof required');
  const url = new URL(process.env.F13_EDITORIAL_ADMIN_URL);
  if (url.hostname !== '127.0.0.1' || url.port !== '5587' || url.pathname !== '/postgres') throw Error('Unsafe target');
  const admin = new Pool({ connectionString: url.toString(), max: 2 });
  let pool;
  try {
    for (const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime','c4g_import_worker_runtime'])
      await admin.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
    await admin.query('GRANT c4g_tenant_migrator TO c4g_f12_admin');
    await admin.query("CREATE DATABASE c4g_pq1_activation_core ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0");
    await admin.query('GRANT CONNECT,CREATE ON DATABASE c4g_pq1_activation_core TO c4g_tenant_owner');
    await admin.query('GRANT CONNECT ON DATABASE c4g_pq1_activation_core TO c4g_tenant_migrator,c4g_tenant_runtime');
    url.pathname = '/c4g_pq1_activation_core'; pool = new Pool({ connectionString: url.toString(), max: 5 });
    await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await pool.query('REVOKE CONNECT,TEMP ON DATABASE c4g_pq1_activation_core FROM PUBLIC');
    await pool.query('ALTER ROLE c4g_tenant_runtime IN DATABASE c4g_pq1_activation_core SET search_path TO pg_catalog,c4g_app');
    const gen=randomUUID();
    await createTenantMigrationRunner({ pool, entries:Object.freeze(require('../../../backend/src/security/tenantMigrationManifest').manifest.filter(e=>e.ordinal<=19)), observationPublisher: { async publish() {} }, timeoutMs: 15000,
      scheduler: { setTimeout, clearTimeout } }).migrate({ tenantId: id(1), databaseGenerationId: gen,
      expectedRevision: 1, correlationId: 'pq1-activation-core', idempotencyKey: 'pq1-activation-core' });
    const fs=require('node:fs'),path=require('node:path');
    const {tenantSchemaSnapshot,tenantSchemaFingerprint}=require('../../../backend/src/security/tenantSchemaFingerprint');
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const before=tenantSchemaFingerprint(await tenantSchemaSnapshot(client));
      const sql=direction=>fs.readFileSync(path.resolve(__dirname,'../../../backend/database/tenant/migrations/020_f14_pq1_decisions.'+direction+'.sql'),'utf8').replace(/\r\n/g,'\n');
      await client.query(sql('up'));
      const fingerprint=tenantSchemaFingerprint(await tenantSchemaSnapshot(client));
      console.log('020 fingerprint',fingerprint);
      await client.query(sql('down'));
      assert.equal(tenantSchemaFingerprint(await tenantSchemaSnapshot(client)),before);
      console.log('020_EMPTY_UP_DOWN: PASS');
      await client.query('ROLLBACK');
    } finally {await client.query('ROLLBACK').catch(()=>{});client.release();}
    if(process.env.PQ1_CAPTURE==='1')return;
    await createTenantMigrationRunner({pool,fingerprintSchema:async c=>{const f=tenantSchemaFingerprint(await tenantSchemaSnapshot(c));console.log('RUNNER fingerprint',f);return f;},observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}}).migrate({tenantId:id(1),databaseGenerationId:gen,expectedRevision:2,correlationId:'pq1-019',idempotencyKey:'pq1-019'});
    console.log('019_RUNNER_PREFLIGHT: PASS');
  } finally { if(pool)await pool.end();await admin.end(); }
}
run().catch(error=>{console.error(error.internalCode||error.code||error.name,error.message,error.stack);process.exitCode=1;});

