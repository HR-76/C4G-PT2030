'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {createTenantMigrationRunner}=require('../../../backend/src/security/tenantMigrationRunner');
const {manifest}=require('../../../backend/src/security/tenantMigrationManifest');
const {tenantSchemaSnapshot,tenantSchemaFingerprint}=require('../../../backend/src/security/tenantSchemaFingerprint');
async function run(){
 if(process.env.APPLICATION_DISPOSABLE_PROOF!=='C4G_APPLICATION_DISPOSABLE_V1')throw Error('Disposable PostgreSQL required');
 const url=new URL(process.env.APPLICATION_ADMIN_URL);
 if(url.hostname!=='127.0.0.1'||url.port!=='5592'||url.pathname!=='/postgres')throw Error('Unsafe target');
 const admin=new Pool({connectionString:url.toString()});let pool;
 try{
  for(const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime','c4g_import_worker_runtime'])await admin.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');await admin.query('GRANT c4g_tenant_migrator TO c4g_f12_admin');
  await admin.query("CREATE DATABASE c4g_application_probe ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0");
  await admin.query('GRANT CONNECT,CREATE ON DATABASE c4g_application_probe TO c4g_tenant_owner');
  await admin.query('GRANT CONNECT ON DATABASE c4g_application_probe TO c4g_tenant_migrator,c4g_tenant_runtime');
  url.pathname='/c4g_application_probe';pool=new Pool({connectionString:url.toString()});
  await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await pool.query('REVOKE CONNECT,TEMP ON DATABASE c4g_application_probe FROM PUBLIC');
  await pool.query('ALTER ROLE c4g_tenant_runtime IN DATABASE c4g_application_probe SET search_path TO pg_catalog,c4g_app');
  await createTenantMigrationRunner({pool,entries:Object.freeze(manifest.filter(e=>e.ordinal<=20)),observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}}).migrate({tenantId:randomUUID(),databaseGenerationId:randomUUID(),expectedRevision:1,correlationId:'application-probe',idempotencyKey:'application-probe'});
  const c=await pool.connect();try{
   await c.query('BEGIN');const beforeSnapshot=await tenantSchemaSnapshot(c),before=tenantSchemaFingerprint(beforeSnapshot);
   const file=dir=>fs.readFileSync(path.resolve(__dirname,`../../../backend/database/tenant/migrations/021_application_first_slice.${dir}.sql`),'utf8');
   await c.query(file('up'));const after=tenantSchemaFingerprint(await tenantSchemaSnapshot(c));console.log('APPLICATION_021_FINGERPRINT',after);
   await c.query('SAVEPOINT occupied');
   await c.query(`INSERT INTO opportunity_catalog.application_receipt(organization_id,idempotency_key,operation,subject_id,resource_id,intention_digest,result_projection)
    VALUES($1,$2,'CREATE',$3,$4,$5,'{}'::jsonb)`,[randomUUID(),randomUUID(),randomUUID(),randomUUID(),'0'.repeat(64)]);
   await assert.rejects(()=>c.query(file('down')),/Application history is occupied/);
   await c.query('ROLLBACK TO SAVEPOINT occupied');
   console.log('APPLICATION_021_OCCUPIED_DOWN_REFUSED PASS');
   await c.query(file('down'));const downSnapshot=await tenantSchemaSnapshot(c);
   if(tenantSchemaFingerprint(downSnapshot)!==before)for(const key of Object.keys(beforeSnapshot))if(JSON.stringify(beforeSnapshot[key])!==JSON.stringify(downSnapshot[key])){
    const old=beforeSnapshot[key],now=downSnapshot[key];console.log('DOWN_MISMATCH',key);
    if(old&&typeof old==='object')for(const field of Object.keys(old))if(JSON.stringify(old[field])!==JSON.stringify(now[field]))console.log('DOWN_FIELD',field,JSON.stringify(old[field]).slice(0,400),JSON.stringify(now[field]).slice(0,400));
   }
   assert.equal(tenantSchemaFingerprint(downSnapshot),before);
   console.log('APPLICATION_021_EMPTY_DOWN_RESTORES_FINGERPRINT PASS');
   await c.query('ROLLBACK');
  }finally{await c.query('ROLLBACK').catch(()=>{});c.release()}
 }finally{await pool?.end();await admin.end()}
}
run().catch(e=>{console.error(e.code||e.name,e.message);process.exitCode=1});
