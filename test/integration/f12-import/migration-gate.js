'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {manifest:currentManifest,migrationSql}=require('../../../backend/src/security/tenantMigrationManifest');
// This regression proves the historical 014 -> 015 transition; cumulative
// consumers separately exercise the current manifest, including editorial 016.
const manifest=Object.freeze(currentManifest.filter(entry=>entry.ordinal<=15));
const {createTenantMigrationRunner}=require('../../../backend/src/security/tenantMigrationRunner');
const {tenantSchemaSnapshot,tenantSchemaFingerprint}=require('../../../backend/src/security/tenantSchemaFingerprint');

async function run(){
 if(process.env.F12_IMPORT_DISPOSABLE_PROOF!=='C4G_F12_IMPORT_DISPOSABLE_V1')throw new Error('Disposable proof required');
 const url=new URL(process.env.F12_IMPORT_ADMIN_URL);
 if(url.hostname!=='127.0.0.1'||['5432','5433'].includes(url.port))throw new Error('Unsafe target');
 const admin=new Pool({connectionString:url.toString(),max:2});
 const database='c4g_f12_import_gate',tenantId=randomUUID(),generation=randomUUID();
 let pool;
 try{
  for(const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime','c4g_import_worker_runtime'])await admin.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
  await admin.query('GRANT c4g_tenant_migrator TO c4g_f12_admin');
  await admin.query(`CREATE DATABASE ${database} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
  await admin.query(`GRANT CONNECT,CREATE ON DATABASE ${database} TO c4g_tenant_owner`);
  await admin.query(`GRANT CONNECT ON DATABASE ${database} TO c4g_tenant_migrator,c4g_tenant_runtime`);
  const tenantUrl=new URL(url);tenantUrl.pathname=`/${database}`;pool=new Pool({connectionString:tenantUrl.toString(),max:4});
  await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await pool.query(`REVOKE CONNECT,TEMP ON DATABASE ${database} FROM PUBLIC`);
  await pool.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${database} SET search_path TO pg_catalog,c4g_app`);
  const runner=createTenantMigrationRunner({pool,entries:Object.freeze(manifest.slice(0,-1)),observationPublisher:{async publish(){}},timeoutMs:20000,scheduler:{setTimeout,clearTimeout}});
  await runner.migrate({tenantId,databaseGenerationId:generation,expectedRevision:1,correlationId:'f12-import',idempotencyKey:'f12-import'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query(migrationSql(manifest.at(-1).version,'up').sql);
   const fingerprint=tenantSchemaFingerprint(await tenantSchemaSnapshot(client));
   if(process.env.F12_IMPORT_CAPTURE==='1')process.stdout.write(JSON.stringify({fingerprint})+'\n');
   else assert.equal(fingerprint,manifest.at(-1).schemaFingerprint);
   await client.query(migrationSql(manifest.at(-1).version,'down').sql);
   assert.equal(tenantSchemaFingerprint(await tenantSchemaSnapshot(client)),manifest.at(-2).schemaFingerprint);
   await client.query('ROLLBACK');
  }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
 }finally{
  if(pool)await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS ${database}`).catch(()=>{});
  await admin.end();
 }
}
run().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
