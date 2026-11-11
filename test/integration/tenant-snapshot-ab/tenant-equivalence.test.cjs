'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {compareSnapshots,driftCases,assertTenantFixture,provePostFunctionDrift}=require('./tenant-equivalence.cjs');
test('serialized parity does not sort keys, arrays or conceal NULL versus empty arrays',()=>{
 assert.equal(compareSnapshots({x:null},{x:null}).equal,true);
 for(const [a,b]of [[{x:null},{x:[]}],[{x:1,y:2},{y:2,x:1}],[[1,2],[2,1]]])assert.throws(()=>compareSnapshots(a,b),{code:'TENANT_AB_SNAPSHOT_MISMATCH'});
});
test('the complete declared edge cases include canonical, fallback, partition, inheritance and security mutations',()=>{
 const cases=driftCases();assert.equal(cases.length,15);assert.equal(new Set(cases.map(c=>c.name)).size,15);
 assert.deepEqual(cases.filter(c=>c.unsupported).map(c=>c.name),['not-null-quoted','not-null-no-inherit','not-null-not-valid','not-null-inherited']);
 for(const name of ['not-null-canonical','not-null-partition','conventional-constraints','public-table-acl','public-column-acl','runtime-role','table-owner','rls-disabled','rls-not-forced','policy-change','metadata-executor-role'])assert(cases.some(c=>c.name===name));
});
test('mutations refuse absent ownership, habitual ports and unbound databases before SQL',()=>{
 for(const value of [undefined,{}, {ownership:{isolated:true,runId:'a'.repeat(32)}}])assert.throws(()=>assertTenantFixture(value),{code:'TENANT_AB_OWNED_FIXTURE_REQUIRED'});
});
function driftHarness({skipSecond=false,wrongError=false}={}){
 const state={changed:false,restored:false,releases:0,snapshots:0,baselineCalls:0,callback:false},tenant={index:0,identity:{tenantId:'id',databaseGenerationId:'gen'},credentials:{database:'db',login:'login'},pool:{async query(sql){if(sql.includes('NOINHERIT')){state.changed=false;state.restored=true;}else if(sql.includes(' INHERIT'))state.changed=true;return{rows:[{rolinherit:false}]};}}};
 const client={async query(sql){if(sql.includes('AS limited'))return {rows:[{database:'db',session_user:'login',current_user:'login',limited:true,api_member:true,no_broad_reader:true,read_only:'on'}]};if(sql==='BASE'){state.snapshots++;return{rows:[]};}return{rows:[]};},release(){state.releases++;}};
 const m={runtime:{async observeTenantRuntimeMetadata(c){await c.query('BASE');await c.query('SELECT c4g_system.runtime_metadata_v1($1::uuid,$2::uuid) AS metadata');if(!skipSecond)await c.query('BASE');if(state.changed)throw Object.assign(Error('refused'),{internalCode:wrongError?'DATABASE_CONFIGURATION_MISMATCH':'TENANT_SCHEMA_FINGERPRINT_MISMATCH'});return{};}}};
 return {state,tenant,module:m,pool:{connect:async()=>client},arm:'A',baseSql:'BASE',baseline:async()=>{state.baselineCalls++;return {equal:true,sha256:'a'.repeat(64),bytes:1};}};
}
test('post-function gate requires two real forwarded snapshots, refusal before callback and restoration',async()=>{
 const h=driftHarness(),r=await provePostFunctionDrift(h);assert.equal(r.snapshotCount,2);assert.equal(r.mutationAfterFunction,true);assert.equal(r.functionalCallbackExecuted,false);assert.equal(r.rejected,'TENANT_SCHEMA_FINGERPRINT_MISMATCH');assert.equal(r.restored,true);assert.equal(h.state.releases,1);assert.equal(h.state.changed,false);
});
test('early refusal or missing second snapshot cannot masquerade as a post-function proof',async()=>{
 for(const config of [{skipSecond:true},{wrongError:true}]){const h=driftHarness(config);await assert.rejects(provePostFunctionDrift(h),e=>{assert.equal(e.postFunctionReport.status,'FAIL');assert.equal(e.postFunctionReport.restored,true);return true;});assert.equal(h.state.changed,false);assert.equal(h.state.restored,true);assert.equal(h.state.releases,1);assert.equal(h.state.baselineCalls,1);}
});
