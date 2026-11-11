'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSource}=require('../src/fundingTenders/source');
test('a durable job requests exactly one page and binds the cursor to the query contract',async()=>{
 let calls=0;
 const source=createSource({fetchImpl:async()=>{calls++;return new Response(JSON.stringify({totalResults:1200,results:Array.from({length:25},(_,i)=>({content:'Call',metadata:{identifier:[`ID-${i}`],deadlineDate:['2099-01-01']}}))}));}});
 const batch=await source.collect({pageBudget:1});assert.equal(calls,1);assert.equal(batch.nextCursor.nextPage,2);assert.match(batch.nextCursor.contract,/^[a-f0-9]{64}$/);
 await assert.rejects(source.collect({pageBudget:1,cursor:{...batch.nextCursor,contract:'0'.repeat(64)}}),{code:'SOURCE_CURSOR_INVALID'});
 await assert.rejects(source.collect({pageBudget:5}),{code:'SOURCE_CURSOR_INVALID'});
});
test('staging rejects inconsistent counters and unversioned checkpoint metadata',()=>{
 const {validateBatch}=require('../src/fundingTenders/coverage');
 const batch={records:[{externalIdentifier:'ID-1',fields:{title:'Call'}}],pages:1,received:1,failed:0,excluded:0,duplicates:0,remoteTotal:1,limited:false,nextCursor:null,contract:'a'.repeat(64),asOf:'2026-10-28',observedAt:'2026-10-28T12:00:00Z'};
 assert.doesNotThrow(()=>validateBatch(batch));
 for(const change of [{received:2},{duplicates:-1},{pages:2},{remoteTotal:-1},{contract:null},{asOf:null},{limited:true},{records:[]}])assert.throws(()=>validateBatch({...batch,...change}),{code:'FUNDING_CHECKPOINT_INVALID'});
});
test('public cycle projection uses aggregate results and omits persisted cursor and requester',()=>{
 const {publicRun}=require('../src/fundingTenders/repository');
 const value=publicRun({run_id:'root',status:'SUCCESS',result_count:25,cycle_status:'RUNNING',cycle_received:1200,cycle_created:1199,cycle_updated:0,cycle_unchanged:0,cycle_failed:0,pages:48,unique_count:1199,duplicate_count:1,excluded_count:0,invalid_count:0,remote_total:1200,input_cursor:{private:true},requested_by:'private'});
 assert.equal(value.status,'RUNNING');assert.equal(value.received,1200);assert.equal(value.created,1199);assert.equal(value.limited,true);assert.equal(value.coverage.pages,48);assert.equal(JSON.stringify(value).includes('private'),false);
});
test('coverage configuration refuses unsupported schemas and keeps old deployments disabled',()=>{
 const {coverageConfig}=require('../src/fundingTenders/coverageConfig');
 assert.deepEqual(coverageConfig(undefined,'032_single_organization_membership'),{supported:false,enabled:false});
 assert.deepEqual(coverageConfig('disabled','033_funding_coverage'),{supported:true,enabled:false});
 assert.deepEqual(coverageConfig('durable-v1','033_funding_coverage'),{supported:true,enabled:true});
 assert.throws(()=>coverageConfig('durable-v1','032_single_organization_membership'),/FUNDING_COVERAGE_SCHEMA_REQUIRED/);
 assert.throws(()=>coverageConfig('anything','033_funding_coverage'),/FUNDING_COVERAGE_CONFIG_INVALID/);
});
test('an expired cycle exposes accepted records that were not yet applied',()=>{
 const {publicRun}=require('../src/fundingTenders/repository');
 const value=publicRun({run_id:'expired',cycle_status:'ERROR',cycle_received:25,unique_count:25,cycle_created:0,cycle_updated:0,cycle_unchanged:10,cycle_failed:0,invalid_count:0});
 assert.equal(value.coverage.pending,15);
});
test('coverage tables use the stable central catalog owner, independent of the migration login',()=>{
 const sql=require('node:fs').readFileSync(require('node:path').join(__dirname,'../database/central/migrations/033_funding_coverage.up.sql'),'utf8');
 for(const name of ['funding_cycle','funding_batch','funding_cycle_seen'])assert.ok(sql.includes(`ALTER TABLE opportunity_catalog.${name} OWNER TO c4g_opportunity_central_owner;`));
});
test('P2 refuses new work on a worker that cannot refresh known identifiers',async()=>{
 const {createFundingRepository}=require('../src/fundingTenders/repository'),{randomUUID}=require('node:crypto');
 const queries=[],client={release(){},async query(sql){queries.push(sql);return {rows:/FROM public.global_user|FROM public.platform_admin_assignment/.test(sql)?[{id:'active'}]:[]};}};
 const repository=createFundingRepository({pool:{connect:async()=>client},coverageEnabled:true,refreshEnabled:true,workerHealth:async()=>({ready:true,coverageSupported:true})});
 await assert.rejects(repository.enqueue(randomUUID(),randomUUID()),{code:'FUNDING_WORKER_UPGRADE_REQUIRED'});
 assert.equal(queries.some(sql=>sql.startsWith('INSERT')),false);
});
