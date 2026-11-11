'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {manifest,checksumSql}=require('../../../backend/src/security/tenantMigrationManifest');
const {createTenantMigrationRunner}=require('../../../backend/src/security/tenantMigrationRunner');
const {tenantSchemaSnapshot,tenantSchemaFingerprint}=require('../../../backend/src/security/tenantSchemaFingerprint');
async function main(){
 const pg18=process.argv.includes('--pg18');
 const root=path.resolve(__dirname,'../../..'),config=JSON.parse(fs.readFileSync(path.join(root,`.tmp/organization-directory/${pg18?'c4g-directory-pg18':'c4g-directory-probe'}.json`)));
 assert.equal(config.host,'127.0.0.1');assert.equal(config.port,pg18?5568:5566);assert.equal(config.database,'postgres');
 const admin=new Pool(config);let pool;
 try{
  for(const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime','c4g_import_worker_runtime'])await admin.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');await admin.query('GRANT c4g_tenant_migrator TO c4g_f12_admin');
  await admin.query("CREATE DATABASE c4g_directory_probe ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0");
  pool=new Pool({...config,database:'c4g_directory_probe'});
  await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');await pool.query('REVOKE CONNECT,TEMP ON DATABASE c4g_directory_probe FROM PUBLIC');
  await pool.query('GRANT CONNECT,CREATE ON DATABASE c4g_directory_probe TO c4g_tenant_owner');await pool.query('GRANT CONNECT ON DATABASE c4g_directory_probe TO c4g_tenant_migrator,c4g_tenant_runtime');
  await pool.query('ALTER ROLE c4g_tenant_runtime IN DATABASE c4g_directory_probe SET search_path TO pg_catalog,c4g_app');
  await createTenantMigrationRunner({pool,entries:Object.freeze(manifest.filter(e=>e.ordinal<=24)),observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}}).migrate({tenantId:randomUUID(),databaseGenerationId:randomUUID(),expectedRevision:1,correlationId:'directory-probe',idempotencyKey:'directory-probe'});
  const client=await pool.connect();try{
   await client.query('BEGIN');const before=tenantSchemaFingerprint(await tenantSchemaSnapshot(client));
   const sql=fs.readFileSync(path.join(root,'backend/database/tenant/migrations/025_organization_directory.up.sql'),'utf8');
   await client.query(sql);const fingerprint=tenantSchemaFingerprint(await tenantSchemaSnapshot(client));
   console.log(JSON.stringify({postgres:pg18?18:17,migration:'025_organization_directory',sqlChecksum:checksumSql(sql),schemaFingerprint:fingerprint}));
   if(manifest.some(e=>e.ordinal===25))assert.equal(fingerprint,manifest.find(e=>e.ordinal===25).schemaFingerprint);
   await client.query('ROLLBACK');assert.equal(tenantSchemaFingerprint(await tenantSchemaSnapshot(client)),before);console.log('MIGRATION_TRANSACTION_ROLLBACK_PASS');
  }finally{await client.query('ROLLBACK').catch(()=>{});client.release()}
 }finally{await pool?.end();await admin.end()}
}
main().catch(e=>{console.error(e.code||e.name,e.message);process.exitCode=1});
