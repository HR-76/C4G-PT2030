'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createActivationReadV2}=require('../src/opportunities/v2/activationRead');
const {adaptManualOpportunityV2,manualEditorialId}=require('../src/opportunities/manualV2');
const {createManualCandidateArchiveV2}=require('../src/opportunities/manualV2Archive');
const {loadVerifiedActivationArchive,hash}=require('../src/opportunities/v2/activationArchive');
const {previewReconciliation}=require('../src/opportunities/v2/reconciliation');
const {planBinding}=require('../src/opportunities/v2/activationApproval');
async function fixture({existing=false}={}){
 const actor=randomUUID(),requestId=randomUUID(),editorialId=manualEditorialId(actor,requestId),policyVersion='c4g-user-mfa-v1';
 const observedAt='2026-10-31T00:00:00.000Z',bundle=adaptManualOpportunityV2({kind:'CALL',fields:{'/description/title':{state:'PRESENT',value:'Reviewed source facts',reason:null}}},{editorialId,observedAt});
 const state={queries:[],archive:null,plan:null,authorized:true};
 const legacy={schemaVersion:1,title:'Accepted historical title',funderName:'Historical funder',provenanceId:randomUUID(),lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1'};
 if(existing)state.head={opportunity_id:randomUUID(),current_revision_id:randomUUID(),row_version:1,revision_number:1,lifecycle_state:'ACTIVE',snapshot:legacy};
 const client={release(){},async query(sql,values=[]){
  state.queries.push(sql);
  if(sql.startsWith('INSERT INTO opportunity_catalog.manual_v2_candidate')){state.archive=Object.fromEntries(['candidate_id','requested_by','request_id','editorial_id','intent_digest','content_digest','artifact','canonical_snapshot','observed_at','mapping_version','mapping_digest','payload_digest'].map((key,i)=>[key,['artifact','canonical_snapshot'].includes(key)?JSON.parse(values[i]):values[i]]));return {rows:[state.archive],rowCount:1};}
  if(sql.includes('opportunity_v2_administrator'))return {rows:state.authorized?[{authority:{userId:actor,storedUserId:actor,revocationVersion:1,storedRevocationVersion:1,policyVersion,absoluteExpiresAt:2000000,expiresAt:2000000,nowSeconds:1000,cookieExpires:null,evidence:{authTime:950,acr:'c4g-loa1',amr:['pwd'],policyVersion}}}]:[]};
  if(sql.includes('FROM opportunity_catalog.manual_v2_candidate'))return {rows:[state.archive]};
  if(sql.includes('FROM opportunity_catalog.activation_plan_v2'))return {rows:state.plan?[state.plan]:[]};
  if(sql.startsWith('SELECT snapshot FROM opportunity_catalog.revision'))return {rows:[{snapshot:legacy}]};
  if(sql.startsWith('SELECT current_revision_id'))return {rows:state.head?[state.head]:[]};
  if(sql.startsWith('SELECT opportunity_id FROM opportunity_catalog.source_identity_v2'))return {rows:state.head?[{opportunity_id:state.head.opportunity_id}]:[]};
  if(sql.startsWith('SELECT o.*,r.snapshot'))return {rows:state.head?[state.head]:[]};
  if(sql.startsWith('SELECT source_namespace'))return {rows:[{namespace:'C4G_MANUAL',externalId:'EDITORIAL:'+editorialId}]};
  return {rows:[],rowCount:0};
 }};
 await createManualCandidateArchiveV2({audit:async()=>{}}).stage(client,{userId:actor,requestId,editorialId,observedAt,...bundle});
 const archive={kind:'MANUAL',candidateId:state.archive.candidate_id},loaded=await loadVerifiedActivationArchive(client,archive);
 const expected=existing?{opportunityId:state.head.opportunity_id,revisionId:state.head.current_revision_id,rowVersion:1}:null;
 const preview=previewReconciliation({accepted:existing?[{...expected,snapshot:legacy,identities:[{namespace:'C4G_MANUAL',externalId:'EDITORIAL:'+editorialId}],mappingDigest:null}]:[],candidates:[{candidateId:loaded.candidateId,snapshot:loaded.snapshot,mappingDigest:loaded.mappingDigest}]});
 state.plan={plan_id:randomUUID(),prepared_by:actor,source_code:loaded.source,archive_locator:archive,archive_digest:loaded.payloadDigest,candidate_id:loaded.candidateId,mapping_digest:loaded.mappingDigest,snapshot_digest:loaded.snapshotDigest,expected,preview,preview_digest:preview.previewDigest,state:'DRAFT',fence:1,expires_at:'2026-11-01T00:00:00.000Z',unexpired:true};
 state.plan.plan_digest=hash(planBinding(state.plan));state.queries=[];
 const reads=createActivationReadV2({pool:{connect:async()=>client},policyVersion,recentMfaRequirement:require('../src/security/authConfig').RECOGNIZED_ASSURANCE_POLICIES[policyVersion].policy['recent-auth']});
 return {reads,state,context:{actor:{type:'HUMAN',id:actor},sessionId:'unit-read-session'}};
}
test('authenticated reviewer receives verified candidate facts and the exact historical accepted revision',async()=>{
 const f=await fixture({existing:true}),result=await f.reads.get(f.state.plan.plan_id,f.context);
 assert.equal(result.candidate.snapshot.description.title.value,'Reviewed source facts');assert.equal(result.accepted.snapshot.title,'Accepted historical title');
 assert.deepEqual(result.accepted.revisionId,f.state.plan.expected.revisionId);assert.equal(result.review.currentPreviewMatches,true);assert.equal(result.review.canApprove,true);
 assert.equal(result.current.rowVersion,1);assert.equal(Object.isFrozen(result),true);
 assert.equal(f.state.queries.filter(sql=>sql.includes('opportunity_v2_administrator')).length,4);
 assert.equal(f.state.queries.some(sql=>/^(INSERT|UPDATE|DELETE)/.test(sql)),false);
});
test('stale accepted head is visible but cannot be represented as an approvable current preview',async()=>{
 const f=await fixture({existing:true});f.state.head.row_version=2;
 const result=await f.reads.get(f.state.plan.plan_id,f.context);assert.equal(result.accepted.rowVersion,1);assert.equal(result.current.rowVersion,2);
 assert.equal(result.review.currentPreviewMatches,false);assert.equal(result.review.canApprove,false);assert.equal(result.review.reasonCode,'OPPORTUNITY_V2_STALE_REVISION');
});
test('factual reads fail closed on tampered archive, absent plan, authority loss and unbounded query inputs',async()=>{
 const f=await fixture();f.state.archive.canonical_snapshot.description.title.value='Tampered';
 await assert.rejects(f.reads.get(f.state.plan.plan_id,f.context),{code:'OPPORTUNITY_V2_ACTIVATION_UNAVAILABLE'});
 f.state.plan=null;await assert.rejects(f.reads.get(randomUUID(),f.context),{code:'OPPORTUNITY_V2_PLAN_NOT_FOUND'});
 f.state.authorized=false;await assert.rejects(f.reads.list({},f.context),{code:'OPPORTUNITY_V2_AUTHORITY_DENIED'});
 await assert.rejects(f.reads.list({limit:10000},f.context),{code:'OPPORTUNITY_V2_ACTIVATION_INVALID'});
 assert.equal(f.state.queries.at(-1),'ROLLBACK');
});
