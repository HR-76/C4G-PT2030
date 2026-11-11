'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFundingRepository}=require('../src/fundingTenders/repository');
const user='11111111-1111-4111-8111-111111111111',request='22222222-2222-4222-8222-222222222222';
test('offline admission rejects a new intention after authorization but preserves idempotent confirmation',async()=>{
 const state={existing:null,authorized:true,healthCalls:0};
 const pool={connect:async()=>({release(){},async query(sql){
  if(sql.includes('FROM public.global_user'))return {rows:[{id:user}]};
  if(sql.includes('FROM public.platform_admin_assignment'))return {rows:state.authorized?[{id:user}]:[]};
  if(sql.includes('WHERE request_id'))return {rows:state.existing?[state.existing]:[]};
  if(sql.includes("status IN ('QUEUED','RUNNING')"))return {rows:[]};
  if(/^(BEGIN|SET LOCAL|SELECT pg_advisory|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};
  throw Error('Unexpected write');
 }})};
 const repo=createFundingRepository({pool,workerHealth:async()=>{state.healthCalls++;return {ready:false};}});
 await assert.rejects(repo.enqueue(user,request),{code:'FUNDING_WORKER_UNAVAILABLE'});assert.equal(state.healthCalls,1);
 state.existing={run_id:request,requested_by:user,source_code:'EU_FUNDING_TENDERS',status:'QUEUED'};
 assert.equal((await repo.enqueue(user,request)).runId,request);assert.equal(state.healthCalls,1);
 state.authorized=false;await assert.rejects(repo.enqueue(user,request),{code:'FUNDING_FORBIDDEN'});assert.equal(state.healthCalls,1);
});
test('durable admission rejects a live worker that does not support checkpoints',async()=>{
 const pool={connect:async()=>({release(){},async query(sql){
  if(sql.includes('FROM public.global_user')||sql.includes('FROM public.platform_admin_assignment'))return {rows:[{id:user}]};
  if(sql.includes('WHERE request_id')||/^(BEGIN|SET LOCAL|SELECT pg_advisory|ROLLBACK)/.test(sql))return {rows:[]};
  throw Error('Unexpected collection admission');
 }})};
 const repo=createFundingRepository({pool,coverageEnabled:true,workerHealth:async()=>({ready:true,coverageSupported:false})});
 await assert.rejects(repo.enqueue(user,request),{code:'FUNDING_WORKER_UPGRADE_REQUIRED'});
});
