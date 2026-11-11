'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateLocalTenantRoleChain}=require('../src/security/localTenantIdentityProvisioner');
const {decorate,install}=require('../../test/integration/f12-import/commit-uncertain-hook');

const login='c4g_f12_worker_test';
const validEdges=Object.freeze([
 {granted:'c4g_tenant_worker_capabilities',member:login,set_option:true,inherit_option:false,admin_option:false},
 {granted:'c4g_f4_metadata_executor',member:'c4g_tenant_worker_capabilities',set_option:true,inherit_option:false,admin_option:false},
 {granted:'c4g_import_worker_runtime',member:'c4g_tenant_worker_capabilities',set_option:true,inherit_option:false,admin_option:false}
]);
const validProfiles=Object.freeze([login,'c4g_tenant_worker_capabilities','c4g_import_worker_runtime','c4g_f4_metadata_executor'].map(rolname=>({rolname,rolcanlogin:rolname===login,rolinherit:false,rolsuper:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false})));
const validate=(rows,profiles=validProfiles,elevated=false)=>validateLocalTenantRoleChain({query:async sql=>String(sql).includes('rolcanlogin')?{rows:profiles,rowCount:profiles.length}:String(sql).includes('direct_acl')?{rows:[{elevated}],rowCount:1}:{rows,rowCount:rows.length}},{login,workload:'WORKER',functionalRoles:['c4g_import_worker_runtime','c4g_f4_metadata_executor']});

test('F12 worker role chain accepts only the approved transitive closure',async()=>{
 assert.equal((await validate(validEdges)).aggregator,'c4g_tenant_worker_capabilities');
 await assert.rejects(validate(validEdges.filter(row=>row.granted!=='c4g_import_worker_runtime')),/LOCAL_IDENTITY_ROLE_CHAIN_INVALID/);
 await assert.rejects(validate([...validEdges,{granted:'c4g_opportunity_tenant_runtime',member:login,set_option:true,inherit_option:false,admin_option:false}]),/LOCAL_IDENTITY_ROLE_CHAIN_INVALID/);
 await assert.rejects(validate([...validEdges,{granted:'c4g_worker_extra',member:'c4g_tenant_worker_capabilities',set_option:true,inherit_option:false,admin_option:false},{granted:'c4g_opportunity_tenant_runtime',member:'c4g_worker_extra',set_option:true,inherit_option:false,admin_option:false}]),/LOCAL_IDENTITY_ROLE_CHAIN_INVALID/);
 await assert.rejects(validate(validEdges.map((row,index)=>index?row:{...row,inherit_option:true})),/LOCAL_IDENTITY_ROLE_CHAIN_INVALID/);
 await assert.rejects(validate(validEdges,validProfiles.map(row=>row.rolname==='c4g_tenant_worker_capabilities'?{...row,rolbypassrls:true}:row)),/LOCAL_IDENTITY_ROLE_CHAIN_INVALID/);
 await assert.rejects(validate(validEdges,validProfiles,true),/LOCAL_IDENTITY_ROLE_CHAIN_INVALID/);
});

test('commit-uncertain hook clears armed state on rollback and injects once after the intended commit',async()=>{
 let fault=true,probes=0;const statements=[];
 const client={database:'c4g_f12_import_test',async query(statement){const sql=String(statement);statements.push(sql);if(sql==='FAIL')throw new Error('synthetic failure');if(sql.includes("to_regclass('public.c4g_f12_fault')")){probes++;return{rows:[{present:true}]};}if(sql.includes('DELETE FROM public.c4g_f12_fault')){const rowCount=fault?1:0;fault=false;return{rowCount};}return{rows:[],rowCount:1};}};
 assert.equal(decorate(client),decorate(client));
 await client.query('BEGIN');await client.query('INSERT INTO opportunity_catalog.import_row_outcome VALUES (...)');await assert.rejects(client.query('FAIL'),/synthetic failure/);await client.query('ROLLBACK');
 await client.query('BEGIN');await client.query('COMMIT');assert.equal(probes,0);
 await client.query('BEGIN');await client.query('INSERT INTO opportunity_catalog.import_row_outcome VALUES (...)');await assert.rejects(client.query('COMMIT'),error=>error.code==='COMMIT_UNCERTAIN');assert.equal(probes,1);
 await client.query('BEGIN');await client.query('COMMIT');assert.equal(probes,1);assert.equal(fault,false);assert.ok(statements.includes('ROLLBACK'));
});

test('commit-uncertain hook preserves callback connect and restores its prototype mutation',async()=>{
 let fault=true,probes=0;const client={database:'c4g_f12_import_callback',query(...args){const callback=typeof args.at(-1)==='function'?args.at(-1):null,sql=String(args[0]);let error=null,result={rows:[],rowCount:1};if(sql==='FAIL')error=new Error('synthetic callback failure');else if(sql.includes("to_regclass('public.c4g_f12_fault')")){probes++;result={rows:[{present:true}]};}else if(sql.includes('DELETE FROM public.c4g_f12_fault')){result={rowCount:fault?1:0};fault=false;}if(callback){queueMicrotask(()=>callback(error,result));return undefined;}return error?Promise.reject(error):Promise.resolve(result);}};
 class FakePool{connect(callback){if(callback){callback(null,client,()=>{});return undefined;}return Promise.resolve(client);}}
 const original=FakePool.prototype.connect,restore=install(FakePool);
 try{let received=null;new FakePool().connect((error,value)=>{assert.equal(error,null);received=value;});assert.equal(received,client);assert.equal(await new FakePool().connect(),client);const query=(...args)=>new Promise((resolve,reject)=>received.query(...args,(error,result)=>error?reject(error):resolve(result)));assert.equal((await query('SELECT $1',[1])).rowCount,1);await query('BEGIN');await query('INSERT INTO opportunity_catalog.import_row_outcome VALUES (...)');await assert.rejects(query('FAIL'),/synthetic callback failure/);await query('ROLLBACK');await query('BEGIN');await query('COMMIT');assert.equal(probes,0);await query('BEGIN');await query('INSERT INTO opportunity_catalog.import_row_outcome VALUES (...)');await assert.rejects(query('COMMIT'),error=>error.code==='COMMIT_UNCERTAIN');assert.equal(probes,1);}
 finally{restore();}
 assert.equal(FakePool.prototype.connect,original);
});
