'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createFundingRepository } = require('../src/fundingTenders/repository');
const { createFundingRouters } = require('../src/fundingTenders/http');
const express = require('express');
const ADMIN = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const state = { active:true, assigned:true, rows:[], queries:[] };
  const pool = { connect:async()=>({release(){},async query(sql,values){
    state.queries.push(sql);
    if(sql.includes('FROM public.global_user'))return {rows:state.active?[{id:values[0]}]:[]};
    if(sql.includes('FROM public.platform_admin_assignment'))return {rows:state.assigned&&values[0]===ADMIN?[{id:ADMIN}]:[]};
    if(sql.includes("WHERE status='SUCCESS' AND limited=false"))return {rows:state.rows.filter(r=>r.status==='SUCCESS'&&r.limited===false)};
    if(sql.includes('FROM opportunity_catalog.funding_run'))return {rows:state.rows};
    if(/^(BEGIN READ ONLY|SET LOCAL|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};
    throw Error('UNEXPECTED_QUERY');
  }})};
  return {state,pool,repo:createFundingRepository({pool})};
}
test('history is bounded, uses stable ordering and projects no requester, token or collected payload',async()=>{
  const {state,repo}=fixture();state.rows=Array.from({length:101},(_,i)=>({run_id:String(i),status:'SUCCESS',result_count:i===0?null:5,created_count:2,requested_by:'private',source_fields:'private',created_at:'2026-10-17T12:00:00Z'}));
  const result=await repo.status(ADMIN);assert.equal(result.runs.length,100);assert.equal(result.runsLimited,true);assert.deepEqual(result.lastRun,result.runs[0]);assert.equal(result.lastRun.received,null);
  assert.ok(state.queries.includes('BEGIN READ ONLY'));assert.ok(state.queries.some(sql=>sql.includes('ORDER BY created_at DESC,run_id DESC LIMIT 101')));
  assert.equal(JSON.stringify(result).includes('private'),false);assert.equal(state.queries.some(sql=>/INSERT|UPDATE|DELETE/.test(sql)),false);
});

test('last complete collections remain separate from recent errors and limited samples',async()=>{
 const {state,repo}=fixture();state.rows=[{run_id:'error',status:'ERROR'},{run_id:'sample',status:'SUCCESS',limited:true},{run_id:'complete',status:'SUCCESS',limited:false}];
 const value=await repo.status(ADMIN);assert.equal(value.lastRun.runId,'error');assert.deepEqual(value.lastCompleteRuns.map(r=>r.runId),['complete']);
});
test('history rechecks live administrator and active identity before reading central runs',async()=>{
  const {state,repo}=fixture();for(const change of [{assigned:false,active:true},{assigned:true,active:false}]){
    Object.assign(state,change,{queries:[]});await assert.rejects(repo.status(ADMIN),{code:'FUNDING_FORBIDDEN'});assert.equal(state.queries.some(sql=>sql.includes('funding_run')),false);
  }
  Object.assign(state,{assigned:true,active:true,queries:[]});await assert.rejects(repo.status('organization-member'),{code:'FUNDING_FORBIDDEN'});
});
test('empty history is explicit and the HTTP status contract remains authenticated and additive',async t=>{
  const {state,pool}=fixture();const router=createFundingRouters({express,pool,catalogReader:require('../src/fundingTenders/repository').createFundingRepository({pool}),sourceMode:'live-local',
    authenticate(req,res,next){if(!req.headers['x-test-user'])return res.sendStatus(401);req.user={id:req.headers['x-test-user']};next()},
    organizationMiddleware:{requireServerSession:(_q,_s,next)=>next(),resolveOrganizationContext:(_q,_s,next)=>next()},sessionRegistry:{}});
  const app=express();app.use(router.admin);const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}));
  const url='http://127.0.0.1:'+server.address().port+'/funding-tenders';
  assert.equal((await fetch(url)).status,401);const response=await fetch(url,{headers:{'x-test-user':ADMIN}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{source:'EU_FUNDING_TENDERS',lastRun:null,lastRuns:[],lastCompleteRuns:[],runs:[],runsLimited:false,sourceMode:'live-local',collection:{sources:['EU_FUNDING_TENDERS'],limits:{results:5,pageSize:5,pages:1}}});
  state.assigned=false;assert.equal((await fetch(url,{headers:{'x-test-user':ADMIN}})).status,403);
});
