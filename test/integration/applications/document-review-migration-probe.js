'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {createTenantMigrationRunner}=require('../../../backend/src/security/tenantMigrationRunner');
const {manifest}=require('../../../backend/src/security/tenantMigrationManifest');
const {tenantSchemaSnapshot,tenantSchemaFingerprint}=require('../../../backend/src/security/tenantSchemaFingerprint');
async function run(){
 if(process.env.APPLICATION_DOCUMENT_DISPOSABLE_PROOF!=='C4G_APPLICATION_DOCUMENT_DISPOSABLE_V1')throw Error('Disposable PostgreSQL required');
 const url=new URL(process.env.APPLICATION_DOCUMENT_ADMIN_URL);if(url.hostname!=='127.0.0.1'||url.port!=='5595'||url.pathname!=='/postgres')throw Error('Unsafe target');
 const admin=new Pool({connectionString:url.toString()});let pool;
 try{
  for(const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime','c4g_import_worker_runtime'])await admin.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');await admin.query('GRANT c4g_tenant_migrator TO c4g_f12_admin');
  await admin.query("CREATE DATABASE c4g_application_document_probe ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0");
  await admin.query('GRANT CONNECT,CREATE ON DATABASE c4g_application_document_probe TO c4g_tenant_owner');
  await admin.query('GRANT CONNECT ON DATABASE c4g_application_document_probe TO c4g_tenant_migrator,c4g_tenant_runtime');
  url.pathname='/c4g_application_document_probe';pool=new Pool({connectionString:url.toString()});
  await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await pool.query('REVOKE CONNECT,TEMP ON DATABASE c4g_application_document_probe FROM PUBLIC');
  await pool.query('ALTER ROLE c4g_tenant_runtime IN DATABASE c4g_application_document_probe SET search_path TO pg_catalog,c4g_app');
  const tenantId=randomUUID(),databaseGenerationId=randomUUID();
  await createTenantMigrationRunner({pool,entries:Object.freeze(manifest.filter(e=>e.ordinal<=22)),observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}}).migrate({tenantId,databaseGenerationId,expectedRevision:1,correlationId:'application-document-probe',idempotencyKey:'application-document-probe'});
  const client=await pool.connect();try{
   await client.query('BEGIN');const before=tenantSchemaFingerprint(await tenantSchemaSnapshot(client));
   const file=direction=>fs.readFileSync(path.resolve(__dirname,`../../../backend/database/tenant/migrations/023_application_documents_review.${direction}.sql`),'utf8');
   await client.query(file('up'));const after=tenantSchemaFingerprint(await tenantSchemaSnapshot(client));console.log('APPLICATION_DOCUMENT_023_FINGERPRINT',after);
   await client.query('SAVEPOINT occupied');
   await client.query("INSERT INTO opportunity_catalog.application_document_receipt(organization_id,idempotency_key,operation,subject_id,resource_id,intention_digest,result_projection) VALUES($1,$2,'DOCUMENT_REVIEW',$3,$4,$5,'{}'::jsonb)",[randomUUID(),randomUUID(),randomUUID(),randomUUID(),'0'.repeat(64)]);
   await assert.rejects(()=>client.query(file('down')),/Application document review history is occupied/);
   await client.query('ROLLBACK TO SAVEPOINT occupied');console.log('APPLICATION_DOCUMENT_023_OCCUPIED_DOWN_REFUSED PASS');
   await client.query(file('down'));assert.equal(tenantSchemaFingerprint(await tenantSchemaSnapshot(client)),before);console.log('APPLICATION_DOCUMENT_023_EMPTY_DOWN_RESTORES_FINGERPRINT PASS');
   await client.query('ROLLBACK');
  }finally{await client.query('ROLLBACK').catch(()=>{});client.release()}
  const runner=createTenantMigrationRunner({pool,entries:manifest,observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}});
  const upgraded=await runner.migrate({tenantId,databaseGenerationId,expectedRevision:1,correlationId:'application-document-admission',idempotencyKey:'application-document-admission'});
  assert.equal(upgraded.evidence.currentVersion,'023_application_documents_review');
  assert.equal(upgraded.evidence.schemaFingerprint,manifest.at(-1).schemaFingerprint);
  console.log('APPLICATION_DOCUMENT_023_RUNNER_ADMITTED PASS');
 }finally{await pool?.end();await admin.end()}
}
run().catch(error=>{console.error(error.code||error.name,error.message);process.exitCode=1});
