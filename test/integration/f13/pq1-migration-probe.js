'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('../../../backend/node_modules/pg');
const { manifest } = require('../../../backend/src/security/tenantMigrationManifest');
const { createTenantMigrationRunner } = require('../../../backend/src/security/tenantMigrationRunner');
const { tenantSchemaSnapshot, tenantSchemaFingerprint } = require('../../../backend/src/security/tenantSchemaFingerprint');
const { resolvePq1Release, policyRef } = require('../../../backend/src/organizationalProfile/pq1Release');
async function run() {
  if (process.env.F13_EDITORIAL_DISPOSABLE_PROOF !== 'C4G_F13_EDITORIAL_DISPOSABLE_V1') throw new Error('Disposable proof required');
  const url = new URL(process.env.F13_EDITORIAL_ADMIN_URL);
  if (url.hostname !== '127.0.0.1' || !['5574','5578'].includes(url.port)) throw new Error('Unsafe target');
  const admin = new Pool({ connectionString: url.toString(), max: 2 });
  const databases = [];
  const fixtures = [];
  let central;
  try {
    for (const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime','c4g_import_worker_runtime']) {
      await admin.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    }
    await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
    await admin.query('GRANT c4g_tenant_migrator TO c4g_f12_admin');
    for (let n = 0; n < 2; n++) {
      const name = `c4g_f13_editorial_${n}`, org = randomUUID(), gen = randomUUID();
      await admin.query(`CREATE DATABASE ${name} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
      await admin.query(`ALTER DATABASE ${name} SET timezone TO 'UTC'`);
      await admin.query(`GRANT CONNECT,CREATE ON DATABASE ${name} TO c4g_tenant_owner`);
      await admin.query(`GRANT CONNECT ON DATABASE ${name} TO c4g_tenant_migrator,c4g_tenant_runtime`);
      const tenantUrl = new URL(url); tenantUrl.pathname = '/' + name;
      const pool = new Pool({ connectionString: tenantUrl.toString(), max: 8 });
      databases.push({ name, org, gen, pool });
      await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
      await pool.query(`REVOKE CONNECT,TEMP ON DATABASE ${name} FROM PUBLIC`);
      await pool.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${name} SET search_path TO pg_catalog,c4g_app`);
      const prefix = Object.freeze(manifest.filter(entry => entry.ordinal <= 17));
      const runner = createTenantMigrationRunner({ pool, entries: prefix, observationPublisher: { async publish() {} },
        timeoutMs: 15000, scheduler: { setTimeout, clearTimeout } });
      await runner.migrate({ tenantId: org, databaseGenerationId: gen, expectedRevision: 1,
        correlationId: 'editorial-gate', idempotencyKey: 'editorial-gate' });
      const sql = direction => fs.readFileSync(path.resolve(__dirname,
        '../../../backend/database/tenant/migrations/018_f13_pq1_publication.' + direction + '.sql'), 'utf8').replace(/\r\n/g,'\n');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql('up'));
        const fingerprint = tenantSchemaFingerprint(await tenantSchemaSnapshot(client));
        await client.query('SET LOCAL ROLE c4g_organization_profile_runtime');
        await client.query("SELECT set_config('app.organization_id',$1,true)", [org]);
        assert.deepEqual((await resolvePq1Release(client)).policyRef, policyRef);
        await client.query('RESET ROLE');
        await client.query(sql('down'));
        assert.equal(tenantSchemaFingerprint(await tenantSchemaSnapshot(client)), prefix.at(-1).schemaFingerprint);
        await client.query('ROLLBACK');
        process.stdout.write(JSON.stringify({ database: n, migrationProbeOnly: true, fingerprint,
          policyResolvedUnderRuntime: true, emptyDownReturns017: true }) + '\n');
      } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
      await createTenantMigrationRunner({pool,observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}}).migrate({tenantId:org,databaseGenerationId:gen,expectedRevision:2,correlationId:'pq1-admission',idempotencyKey:'pq1-admission'});
      process.stdout.write('PQ1_CANONICAL_RUNNER_ADMISSION_PASS\n');
      assert.equal((await require('../../../backend/src/opportunities/preflight').opportunityPreflight(pool,'tenant')).ready,true);
      process.stdout.write('PQ1_F12_PREFLIGHT_018_PASS\n');
      await require('./pq1-http-scenarios').seed({pool,org});
      const occupied=await pool.connect();try {
        await occupied.query('BEGIN');await assert.rejects(()=>occupied.query(sql('down')),/PQ1_DOWNGRADE_REQUIRES_EMPTY/);
      } finally {await occupied.query('ROLLBACK');occupied.release();}
      assert.equal((await pool.query('SELECT count(*)::int n FROM organization_profile.pq1_method_descriptor')).rows[0].n,1);
      process.stdout.write('PQ1_OCCUPIED_DOWN_PRESERVES_DATA_PASS\n');

    }
  } finally {
    for (const db of databases) { await db.pool.end(); await admin.query('DROP DATABASE '+db.name); }
    await admin.end();
  }
}
run().catch(error=>{process.stderr.write(JSON.stringify({code:error.internalCode,details:error.errors?.map(e=>e.internalCode),message:error.message})+'\n');process.exitCode=1;});
