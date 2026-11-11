'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {loadDocumentWorkerConfiguration,QUEUES,REQUIRED,SCHEMA_VERSION}=require('../src/config/documentWorkerInfrastructure');
const {loadDocumentWorkerRuntime}=require('../src/config/documentWorker');
const {createDocumentWorkerProductionRuntime}=require('../src/config/documentWorkerFactory');

const credential={organizationId:'11111111-1111-4111-8111-111111111111',tenantId:'22222222-2222-4222-8222-222222222222',workload:'WORKER',connectionVersion:1,credentialRef:'worker-ref',databaseGenerationId:'33333333-3333-4333-8333-333333333333',host:'127.0.0.1',port:5432,database:'tenant_test',login:'tenant_worker',password:'synthetic',ssl:false};
function env(overrides={}){return{NODE_ENV:'test',DOCUMENT_WORKER_RUNTIME:'f11-documents',DOCUMENT_QUEUE_DATABASE_URL:'postgresql://synthetic.invalid/central',AUTHORITY_DATABASE_URL:'postgresql://authority.invalid/central',AUTHORITY_COMMIT_PERMIT_SECRET:require('node:crypto').randomBytes(32).toString('hex'),DOCUMENT_WORKER_CREDENTIALS_JSON:JSON.stringify([credential]),DOCUMENT_WORKER_STORAGE_MODE:'test-provider',DOCUMENT_WORKER_TEST_ADAPTERS:'enabled',DOCUMENT_WORKER_TEST_PROVIDER:path.resolve(__dirname,'fixtures/documentWorkerStorageProvider.js'),DOCUMENT_WORKER_TEST_STORAGE_ROOT:path.resolve(__dirname,'fixtures'),C4G_CLAMAV_HOST:'127.0.0.1',C4G_CLAMAV_PORT:'3310',...overrides};}
test('production document worker rejects malformed authority secrets',()=>{assert.throws(()=>loadDocumentWorkerConfiguration(env({NODE_ENV:'production',AUTHORITY_COMMIT_PERMIT_SECRET:'weak'})),/AUTHORITY_COMMIT_PERMIT_SECRET/);});

test('document worker configuration is closed to 032 and the three F11 queues',()=>{const value=loadDocumentWorkerConfiguration(env());assert.equal(value.credentials.length,1);assert.equal(SCHEMA_VERSION,'032_document_worker_runtime');assert.deepEqual(Object.keys(QUEUES),['document.scan','document.reconcile','document.expire_upload']);assert.deepEqual(REQUIRED,['F9_ASYNC_EXECUTION','F9_EXECUTION_LINEAGE','F7_AUDIT_LEDGER','F11_PRIVATE_DOCUMENT_STORAGE','APPLICATION_DOCUMENT_TRANSPORT','DOCUMENT_WORKER_RUNTIME']);assert.equal(value.pollIntervalMs,1000);assert.equal(value.batchSize,5);});
test('test storage selection is rejected outside an explicit test process',()=>{assert.throws(()=>loadDocumentWorkerConfiguration(env({NODE_ENV:'production'})),/forbidden/);assert.throws(()=>loadDocumentWorkerConfiguration(env({DOCUMENT_WORKER_TEST_ADAPTERS:'disabled'})),/forbidden/);assert.throws(()=>loadDocumentWorkerConfiguration(env({DOCUMENT_WORKER_TEST_PROVIDER:'relative.js'})),/forbidden/);});
test('production storage selection fails closed on incomplete R2 configuration',()=>{assert.throws(()=>loadDocumentWorkerConfiguration(env({NODE_ENV:'production',DOCUMENT_WORKER_STORAGE_MODE:'r2'})),/C4G_R2_ENDPOINT/);});
test('runtime loader requires the dedicated explicit selector before touching infrastructure',async()=>{await assert.rejects(()=>loadDocumentWorkerRuntime({env:env({DOCUMENT_WORKER_RUNTIME:'disabled'})}),/selection/);});
test('worker requires a separately configured restricted authority instead of using its queue connection',()=>{
 for(const change of [{AUTHORITY_DATABASE_URL:''},{AUTHORITY_COMMIT_PERMIT_SECRET:''}])assert.throws(()=>loadDocumentWorkerConfiguration(env(change)),/restricted authority/);
});
test('worker requires an explicit queue credential and never falls back to Central authority',()=>{
 assert.throws(()=>loadDocumentWorkerConfiguration(env({DOCUMENT_QUEUE_DATABASE_URL:'',CENTRAL_DATABASE_URL:'postgresql://authority.invalid/central'})),/DOCUMENT_QUEUE_DATABASE_URL/);
 assert.equal(loadDocumentWorkerConfiguration(env()).centralDatabaseUrl,'postgresql://synthetic.invalid/central');
});
test('partial worker construction closes both owned pools when test-provider loading fails',async t=>{
 const {Pool}=require('pg'),ended=[],original=Pool.prototype.end;
 t.mock.method(Pool.prototype,'end',function(...args){ended.push(this);return original.apply(this,args);});
 await assert.rejects(()=>require('../src/config/documentWorkerInfrastructure').createDocumentWorkerInfrastructure({env:env({DOCUMENT_WORKER_TEST_PROVIDER:path.join(__dirname,'fixtures/provider-does-not-exist.js')})}),error=>error.code==='MODULE_NOT_FOUND');
 assert.equal(new Set(ended).size,2);assert(ended.every(pool=>pool.ended));
});
test('production runtime preserves the lifecycle shutdown result after closing infrastructure',async()=>{const expected=Object.freeze({mode:'FORCED',errorCode:'WORKER_SHUTDOWN_INCOMPLETE',pending:1});let baseCalls=0,closeCalls=0;const runtime=await createDocumentWorkerProductionRuntime({env:{},infrastructureFactory:async()=>({readiness:()=>({ready:true}),async close(){closeCalls++;}}),runtimeFactory:()=>({registry:{},queue:{},async start(){},async runOnce(){},state(){return'STOPPED';},async shutdown(){baseCalls++;return expected;}})});assert.equal(await runtime.shutdown(),expected);assert.equal(await runtime.shutdown(),expected);assert.equal(baseCalls,1);assert.equal(closeCalls,1);});
test('runtime construction failure closes the started queue before its remaining infrastructure',async()=>{
 const order=[];
 await assert.rejects(()=>createDocumentWorkerProductionRuntime({infrastructureFactory:async()=>({queue:{async shutdown(){order.push('queue');}},async close(){order.push('pools');}}),runtimeFactory:()=>{throw Error('SYNTHETIC_CONSTRUCTION_FAILURE');}}),/SYNTHETIC_CONSTRUCTION_FAILURE/);
 assert.deepEqual(order,['queue','pools']);
});
test('direct worker entrypoint publishes its runtime before loading the factory',()=>{
 const os=require('node:os'),{spawnSync}=require('node:child_process');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'c4g-worker-entry-'));
 try{
  const preload=path.join(directory,'preload.cjs'),modulePath=require.resolve('../src/config/documentWorkerInfrastructure');
  fs.writeFileSync(preload,`require.cache[${JSON.stringify(modulePath)}]={exports:{createDocumentWorkerInfrastructure:async()=>({queue:{async claim(){return[];},async shutdown(){}},portsForOrganization(){throw Error('No job expected');},transactionResolver:{async resolve(){throw Error('No transaction expected');}},retryPort:{async schedule(){}},continuous:false,readiness:()=>({ready:true}),async close(){}})}};`);
  const child=spawnSync(process.execPath,['--require',preload,require.resolve('../src/documentWorker')],{env:{...process.env,DOCUMENT_WORKER_RUNTIME:'f11-documents',DOCUMENT_WORKER_HEALTH_PORT:''},encoding:'utf8',timeout:5000,maxBuffer:32768,windowsHide:true});
  assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.equal(child.signal,null);
  assert.match(child.stdout,/DOCUMENT_WORKER_READY/);assert.doesNotMatch(child.stderr,/circular dependency|runtimeFactory/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('document worker role is non-login and limited to inbox, outbox and audit append',()=>{const sql=fs.readFileSync(path.resolve(__dirname,'../database/tenant/migrations/032_document_worker_runtime.up.sql'),'utf8');assert.match(sql,/CREATE ROLE c4g_document_worker_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);assert.match(sql,/GRANT USAGE ON SCHEMA async_exec,audit TO c4g_document_worker_runtime/);assert.match(sql,/GRANT SELECT,INSERT ON async_exec\.inbox,async_exec\.outbox TO c4g_document_worker_runtime/);assert.match(sql,/GRANT UPDATE\(state,claim_owner,lease_until,fence,result_code,execution_id,completed_at\) ON async_exec\.inbox/);assert.match(sql,/GRANT UPDATE\(state,queue_id,available_at,claim_owner,lease_until,fence,updated_at,published_at\) ON async_exec\.outbox/);assert.match(sql,/GRANT EXECUTE ON FUNCTION audit\.prepare_append_v1/);assert.match(sql,/GRANT EXECUTE ON FUNCTION audit\.append_event_v1/);assert.doesNotMatch(sql,/GRANT (?:[^;]*,)?(?:DELETE|TRUNCATE)(?:,|\s)/);assert.doesNotMatch(sql,/GRANT (?:USAGE|SELECT|INSERT|UPDATE|EXECUTE)[^;]+document_storage/);});

test('concurrent infrastructure close calls await the same cleanup and failure',async()=>{
 const {createInfrastructureClose}=require('../src/config/documentWorkerInfrastructure');let release,calls=0;const gate=new Promise(resolve=>{release=resolve});const failure=Error('cleanup failed');
 const close=createInfrastructureClose(async()=>{calls++;await gate;throw failure});const first=close(),second=close();assert.equal(first,second);assert.equal(calls,1);release();await assert.rejects(first,error=>error===failure);await assert.rejects(second,error=>error===failure);assert.equal(close(),first);
});
