'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const base=path.resolve(__dirname,'../src/opportunities/v2');
// Local dependency doubles exercise orchestration. The separate SQL gate uses
// the concrete collector, authority, archive and audit ports without overrides.
function load(name,overrides={}){const file=path.join(base,name),module={exports:{}};const original=createRequire(file);new Function('require','module','exports',fs.readFileSync(file,'utf8'))(id=>Object.hasOwn(overrides,id)?overrides[id]:original(id),module,module.exports);return module.exports;}
const p=require('../src/opportunities/v2/activationApproval'),{hash}=require('../src/opportunities/v2/activationArchive');
const actor='01900000-0000-7000-8000-000000000001',planId='01900000-0000-7000-8000-000000000002',runId='01900000-0000-7000-8000-000000000003',opportunityId='01900000-0000-7000-8000-000000000004',revisionId='01900000-0000-7000-8000-000000000005';
const context={actor:{type:'HUMAN',id:actor},sessionId:'bounded-executor-test-session'};
const config={policyVersion:'c4g-user-mfa-v1',recentMfaRequirement:require('../src/security/authConfig').RECOGNIZED_ASSURANCE_POLICIES['c4g-user-mfa-v1'].policy['recent-auth']};
const authority=()=>({userId:actor,storedUserId:actor,revocationVersion:1,storedRevocationVersion:1,policyVersion:config.policyVersion,absoluteExpiresAt:2000000,expiresAt:2000000,nowSeconds:1000,cookieExpires:null,evidence:{authTime:950,acr:'c4g-loa1',amr:['pwd'],policyVersion:config.policyVersion}});
function fixture(){
 const archive={kind:'FUNDING',runId,externalIdentifier:'CASCADE:11145'},expected={opportunityId,revisionId,rowVersion:4};
 const loaded={archive,source:'EU_FUNDING_TENDERS',candidateId:'funding:bounded-test',snapshot:{schemaVersion:2},payloadDigest:'a'.repeat(64),mappingDigest:'b'.repeat(64),snapshotDigest:'c'.repeat(64)};
 const preview={previewDigest:'d'.repeat(64),items:[{candidateId:loaded.candidateId,action:'CHANGE_REQUIRES_APPROVAL'}]};
 const row={plan_id:planId,prepared_by:actor,source_code:loaded.source,archive_locator:archive,archive_digest:loaded.payloadDigest,candidate_id:loaded.candidateId,mapping_digest:loaded.mappingDigest,snapshot_digest:loaded.snapshotDigest,expected,preview,preview_digest:preview.previewDigest,state:'APPROVED',fence:2,approved_by:actor,unexpired:true,expires_at:'2030-01-01T00:00:00Z'};
 row.plan_digest=hash(p.planBinding(row));
 return {archive,expected,loaded,preview,row,collected:{archive,runId,opportunityId,expected,payloadDigest:loaded.payloadDigest}};
}

test('scoped plan verification refuses another source, call, identity, digest or unproved run',async()=>{
 const f=fixture();let checks=0;
 const scope=load('executor11145Scope.js',{'./collector11145':{async verifyCollector11145Run(client,value){checks++;assert.deepEqual(value,{runId,actorId:actor});return f.collected;}}});
 assert.equal(await scope.verifyExecutor11145Plan({},f.row,f.row.plan_digest),f.collected);
 for(const changed of [{...f.row,source_code:'CORDIS'},{...f.row,archive_locator:{...f.archive,externalIdentifier:'CASCADE:11146'}},{...f.row,expected:null},{...f.row,archive_locator:{...f.archive,source:'EU'}}])await assert.rejects(scope.verifyExecutor11145Plan({},changed,f.row.plan_digest),{code:'OPPORTUNITY_V2_11145_SCOPE_INVALID'});
 await assert.rejects(scope.verifyExecutor11145Plan({},f.row,'e'.repeat(64)),{code:'OPPORTUNITY_V2_APPROVAL_STALE'});assert.equal(checks,1);
 for(const change of [{opportunityId:planId},{payloadDigest:'f'.repeat(64)},{archive:{...f.archive,runId:planId}}]){const old=f.collected;f.collected={...old,...change};await assert.rejects(scope.verifyExecutor11145Plan({},f.row,f.row.plan_digest),{code:'OPPORTUNITY_V2_11145_SCOPE_INVALID'});f.collected=old;}
 const noProof=load('executor11145Scope.js',{'./collector11145':{verifyCollector11145Run:async()=>{throw Object.assign(Error(),{code:'OPPORTUNITY_V2_11145_RUN_INVALID'});}}});
 await assert.rejects(noProof.verifyExecutor11145Plan({},f.row,f.row.plan_digest),{code:'OPPORTUNITY_V2_11145_RUN_INVALID'});
});

test('the transactional approval verifier rechecks the bounded scope and digest on every invocation',async()=>{
 const f=fixture();let proofs=0,quiescence=0;
 const scope=load('executor11145Scope.js',{'./collector11145':{verifyCollector11145Run:async()=>{proofs++;return f.collected;}}});
 const approval=load('activationApproval.js',{'./executor11145Scope':scope,'./activationArchive':{hash,loadVerifiedActivationArchive:async()=>f.loaded}});
 const client={query:async sql=>{if(sql.includes('activation_plan_v2'))return {rows:[f.row]};if(sql.includes('assert_eu_quiescent')){quiescence++;return {rows:[]};}throw Error('Unexpected SQL');}};
 const input=p.commandFor(f.row,f.loaded,'bounded-accept-request'),ctx={...context,planId,fence:2,sourceFence:3,executor11145Digest:f.row.plan_digest};
 assert.equal(await approval.verifyActivationApproval(client,{input,context:ctx}),true);
 assert.equal(await approval.verifyActivationApproval(client,{input,context:ctx,receipt:{}}),true);
 assert.equal(proofs,2);assert.equal(quiescence,2);
 await assert.rejects(approval.verifyActivationApproval(client,{input,context:{...ctx,executor11145Digest:'f'.repeat(64)}}),{code:'OPPORTUNITY_V2_APPROVAL_STALE'});
 const old=f.collected;f.collected={...old,opportunityId:planId};await assert.rejects(approval.verifyActivationApproval(client,{input,context:ctx}),{code:'OPPORTUNITY_V2_11145_SCOPE_INVALID'});
 f.collected=old;assert.equal(await approval.verifyActivationApproval(client,{input,context:{...ctx,actor:{type:'HUMAN',id:revisionId}}}),false);
});

function compositionFixture({deniedAt=0}={}){
 const f=fixture(),state={sql:[],authorityChecks:0,accepted:[],previews:[],plans:[],collectorChecks:0,packageChecks:0};
 const client={release(){},async query(sql,values=[]){state.sql.push(sql);
  if(sql.includes('authority_api.opportunity_v2_administrator')){state.authorityChecks++;return {rows:deniedAt&&state.authorityChecks>=deniedAt?[]:[{authority:authority()}]};}
  if(sql.includes('WHERE prepared_request_id'))return {rows:[]};
  if(sql.startsWith('INSERT INTO opportunity_catalog.activation_plan_v2')){const row={plan_id:values[0],prepared_by:values[2],source_code:values[3],archive_locator:values[4],archive_digest:values[5],candidate_id:values[6],mapping_digest:values[7],snapshot_digest:values[8],expected:values[9],preview:values[10],preview_digest:values[11],plan_digest:values[12],state:'DRAFT',fence:1,expires_at:'2030-01-01T00:00:00Z'};state.plans.push(row);return {rows:[row]};}
  return {rows:[]};
 }};
 const collector={assertCollector11145Package:async()=>{state.packageChecks++;},verifyCollector11145Run:async(actual,{runId:run,actorId})=>{assert.equal(actual,client);assert.equal(run,runId);assert.equal(actorId,actor);state.collectorChecks++;return f.collected;}};
 const scope=load('executor11145Scope.js',{'./collector11145':collector});
 const audit=Object.assign(async()=>{}, {recordDecision:async()=>{}});
 const composition=load('activationComposition.js',{
  './acceptedRepository':{command:value=>value,createAcceptedOpportunityV2Repository:()=>({preview:async value=>{state.previews.push(value);return f.preview;},accept:async(value,ctx)=>{state.accepted.push({value,context:ctx});return {opportunityId};}})},
  './activationArchive':{hash,loadVerifiedActivationArchive:async()=>f.loaded},
  './activationApproval':{...p,lockedPlan:async()=>f.row,verifyPlanArchive:async()=>f.loaded},
  './activationAudit':{createActivationAuditV2:()=>audit},'./collector11145':collector,'./executor11145Scope':scope,
 }).createOpportunityActivationV2({...config,pool:{connect:async()=>client}});
 return {...f,state,composition};
}
test('scoped preparation derives existing CAS and archive on the server and checks collection proof before saving',async()=>{
 const f=compositionFixture();const result=await f.composition.prepare11145({requestId:'prepare-bounded-request',runId},context);
 assert.equal(result.state,'DRAFT');assert.equal(f.state.collectorChecks,2);assert.equal(f.state.packageChecks,1);
 assert.deepEqual(f.state.previews[0].expected,f.expected);assert.equal(f.state.previews[0].candidateId,f.loaded.candidateId);assert.deepEqual(f.state.plans[0].archive_locator,f.archive);
 for(const injected of [{expected:null},{archive:{kind:'MANUAL'}},{source:'CORDIS'},{actor:{id:actor}}])await assert.rejects(f.composition.prepare11145({requestId:'prepare-bounded-request',runId,...injected},context),{code:'OPPORTUNITY_V2_ACTIVATION_INVALID'});
 assert.equal(f.state.plans.length,1);
});
test('authority loss prevents scoped preparation and acceptance effects, including at the transaction boundary',async()=>{
 for(const deniedAt of [1,2]){
  const f=compositionFixture({deniedAt});
  await assert.rejects(f.composition.accept11145({requestId:'bounded-accept-request',planId,planDigest:f.row.plan_digest,fence:2,sourceFence:3},context),{code:'OPPORTUNITY_V2_AUTHORITY_DENIED'});
  assert.equal(f.state.accepted.length,0);assert(f.state.sql.includes('ROLLBACK'));
 }
 const f=compositionFixture({deniedAt:1});await assert.rejects(f.composition.prepare11145({requestId:'prepare-bounded-request',runId},context),{code:'OPPORTUNITY_V2_AUTHORITY_DENIED'});assert.equal(f.state.collectorChecks,0);assert.equal(f.state.previews.length,0);assert.equal(f.state.plans.length,0);
});
test('scoped acceptance passes only a verified command and internal digest to the accepted writer',async()=>{
 const f=compositionFixture(),value={requestId:'bounded-accept-request',planId,planDigest:f.row.plan_digest,fence:2,sourceFence:3};
 await f.composition.accept11145(value,context);assert.equal(f.state.accepted.length,1);
 assert.equal(f.state.accepted[0].context.executor11145Digest,value.planDigest);assert.equal(f.state.accepted[0].context.sourceFence,3);
 assert.deepEqual(f.state.accepted[0].value.expected,f.expected);
 for(const mutation of [{planDigest:'f'.repeat(64)},{snapshot:{}},{source:'EU_FUNDING_TENDERS'}])await assert.rejects(f.composition.accept11145({...value,...mutation},context));
 assert.equal(f.state.accepted.length,1);
});
