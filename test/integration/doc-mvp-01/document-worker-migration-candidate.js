'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {manifest}=require('../../../backend/src/security/tenantMigrationManifest');
const {createTenantMigrationRunner}=require('../../../backend/src/security/tenantMigrationRunner');
const {tenantSchemaSnapshot,tenantSchemaFingerprint}=require('../../../backend/src/security/tenantSchemaFingerprint');

function target(){if(process.env.DOCUMENT_WORKER_LOCAL_PROOF!=='C4G_DOCUMENT_WORKER_LOCAL_V1')throw new Error('Disposable document worker proof is required.');const url=new URL(process.env.DOCUMENT_WORKER_ADMIN_URL);if(url.hostname!=='127.0.0.1'||url.port!=='56032'||url.pathname!=='/postgres')throw new Error('Unexpected document worker PostgreSQL target.');return url;}
function db(source,name){const url=new URL(source);url.pathname=`/${name}`;return url.toString();}
function request(label,identity){return{tenantId:identity.tenantId,databaseGenerationId:identity.databaseGenerationId,expectedRevision:1,correlationId:`${label}-${crypto.randomUUID()}`,idempotencyKey:`${label}-${crypto.randomUUID()}`};}
function runner(pool,entries){return createTenantMigrationRunner({pool,entries,observationPublisher:{async publish(){}},timeoutMs:60000,scheduler:{setTimeout,clearTimeout}});}
async function main(){const source=target(),admin=new Pool({connectionString:source.toString(),max:2}),name='doc_worker_candidate';let pool;try{
 for(const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime','c4g_import_worker_runtime'])await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$`);
 await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');await admin.query('GRANT c4g_tenant_migrator TO doc_worker_admin');await admin.query(`CREATE DATABASE ${name} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);await admin.query(`ALTER DATABASE ${name} SET timezone TO 'UTC'`);await admin.query(`GRANT CONNECT,CREATE ON DATABASE ${name} TO c4g_tenant_owner`);await admin.query(`GRANT CONNECT ON DATABASE ${name} TO c4g_tenant_migrator,c4g_tenant_runtime`);
 pool=new Pool({connectionString:db(source,name),max:4});await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');await pool.query(`REVOKE CONNECT,TEMP ON DATABASE ${name} FROM PUBLIC`);await pool.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${name} SET search_path TO pg_catalog,c4g_app`);const identity={tenantId:crypto.randomUUID(),databaseGenerationId:crypto.randomUUID()},through031=Object.freeze(manifest.slice(0,-1));
 await runner(pool,through031).migrate(request('candidate-031',identity));const before=await tenantSchemaSnapshot(pool),beforeHash=tenantSchemaFingerprint(before);assert.equal(beforeHash,through031.at(-1).schemaFingerprint);
 const applied=await runner(pool,manifest).migrate(request('candidate-032',identity));assert.deepEqual(applied.appliedVersions,['032_document_worker_runtime']);const after=await tenantSchemaSnapshot(pool),afterHash=tenantSchemaFingerprint(after);assert.equal(afterHash,manifest.at(-1).schemaFingerprint);assert.equal(after.documentWorkerSecurity.roles[0].rolname,'c4g_document_worker_runtime');
 const downgraded=await runner(pool,manifest).downgrade({...request('candidate-down',identity),targetVersion:'031_application_document_transport'});assert.deepEqual(downgraded.revertedVersions,['032_document_worker_runtime']);const reverted=await tenantSchemaSnapshot(pool);assert.equal(tenantSchemaFingerprint(reverted),beforeHash);assert.equal(JSON.stringify(reverted),JSON.stringify(before));
 const reapplied=await runner(pool,manifest).migrate(request('candidate-reapply',identity));assert.deepEqual(reapplied.appliedVersions,['032_document_worker_runtime']);const final=await tenantSchemaSnapshot(pool);assert.equal(JSON.stringify(final),JSON.stringify(after));
 process.stdout.write(`${JSON.stringify({result:'PASS',beforeHash,afterHash,officialRunner:true,upDownUp:true,downRestores031:true,documentWorkerSecurity:after.documentWorkerSecurity})}\n`);
 }finally{await pool?.end();await admin.end();}}
main().catch(error=>{process.stderr.write(`${JSON.stringify({name:error.name,code:error.code||null,internalCode:error.internalCode||null,message:error.message,stack:error.stack?.split('\n').slice(0,8)})}\n`);process.exitCode=1;});
