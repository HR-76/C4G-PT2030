'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {query}=require('../src/applications/contracts'),{createApplicationRepository}=require('../src/applications/repository');
const {createPq1UiTokens}=require('../src/organizationalProfile/pq1UiTokens');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
 const org=randomUUID(),actor={id:randomUUID()},queries=[];let fingerprint='initial';
 const row={organization_id:org,application_id:id(1),opportunity_id:id(100),title:'Candidatura',responsible_membership_id:id(200),deadline:'2026-12-31',notes:null,total_budget:'100.01',organization_budget:null,status:'SUBMITTED',revision:1,created_at:new Date(),updated_at:new Date(),opportunity_title:'Aviso',responsible_name:'Ana'};
 const client={query:async(sql,params)=>{if(sql==='SET LOCAL jit = off')return {rows:[]};queries.push({sql,params});return {rows:[{total:55,items:[row],counts:{SUBMITTED:55},fingerprint}]};}};
 const repo=createApplicationRepository({organizationId:org,actor,cursor:createPq1UiTokens({keys:{test:'x'.repeat(32)},currentKeyId:'test'}),protect:async()=>{},
  readAuthority:async()=>({teamOnly:false,membershipId:id(200),application:{all:true,ids:[]},opportunity:{all:true,ids:[]},evaluation:{all:false,ids:[]}}),responsibleDirectory:async()=>new Map([[id(200),'Ana']]),transitionCapability:async()=>true,
  authorize:async()=>assert.fail('per-row remote authority call')});
 return {repo,client,queries,change:()=>{fingerprint='changed'}};
}
test('browse validates exact query and rejects invalid filters',()=>{
 for(const value of [{q:[]},{sort:'sql'},{direction:'up'},{status:'OTHER'},{q:'a'.repeat(201)},{cursor:'x'.repeat(4097)},{page:'2'}])assert.throws(()=>query('browse',value),{code:'INVALID_INPUT'});
 assert.equal(query('browse',{q:' Ana '}).q,'Ana');
});
test('SQL browse projects the authorized page without resource-by-resource remote reads',async()=>{
 const f=fixture(),result=await f.repo.browse(f.client,query('browse',{}));
 assert.equal(result.total,55);assert.equal(result.items[0].responsibleName,'Ana');assert.equal(result.items[0].totalBudget,'100.01');assert(result.items[0].allowedTransitions.includes('APPROVED'));
 assert.equal(f.queries.length,1);assert.equal(f.queries[0].params.at(-2),25);
 assert.match(f.queries[0].sql,/a\.central_opportunity_id=\$11/);assert.doesNotMatch(f.queries[0].sql,/to_jsonb\(a\)->/);
});
test('SQL browse binds search values and its cursor/filter contract',async()=>{
 const f=fixture(),needle="' OR true --",first=await f.repo.browse(f.client,query('browse',{q:needle}));
 assert(!f.queries[0].sql.includes(needle));assert(f.queries[0].params.includes(needle));
 await assert.rejects(f.repo.browse(f.client,query('browse',{cursor:first.nextCursor,q:'other'})),{code:'INVALID_CURSOR'});
 await assert.rejects(f.repo.browse(f.client,query('browse',{cursor:first.nextCursor+'x',q:needle})),{code:'INVALID_CURSOR'});
});
test('SQL browse rejects changed aggregate identity before releasing the next page',async()=>{
 const f=fixture(),first=await f.repo.browse(f.client,query('browse',{}));f.change();
 await assert.rejects(f.repo.browse(f.client,query('browse',{cursor:first.nextCursor})),{code:'INVALID_CURSOR'});
});

test('browse computes the frozen final deadline without compiling unused current temporal state',async()=>{
 const f=fixture();await f.repo.browse(f.client,query('browse',{}));
 const sql=f.queries[0].sql;
 assert.match(sql,/final_candidates/);
 assert.doesNotMatch(sql,/next_candidates|v2_opening|v2_state/);
 // The complete filtered-set fingerprint must remain: page-only hashing loses stale-cursor detection.
 assert.match(sql,/FROM filtered f\) AS fingerprint/);
});
