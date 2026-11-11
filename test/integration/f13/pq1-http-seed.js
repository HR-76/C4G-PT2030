'use strict';
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const {createPq1UiComposition}=require('../../../backend/src/organizationalProfile/pq1UiComposition');
const {createPrequalificationComposition}=require('../../../backend/src/prequalification/composition');
const {createCriteriaComposition}=require('../../../backend/src/opportunityCriteria/composition');
async function run({databases,central,options}){
 for(const db of databases){
  const shared={...options,tenantRuntimeDependencies:db.dependencies,tokenKeys:{local:randomBytes(32).toString('hex')},tokenKeyId:'local',mfaCategory:'recent-mfa'};
  db.pq1=createPq1UiComposition(shared);db.effective=createPrequalificationComposition(shared);db.criteria=createCriteriaComposition(shared);
  const call=(method,input,id,actor=db.maker)=>db.pq1.execute(method,input,id,actor.request,randomUUID());
  const draftId=randomUUID();await call('create',{draftId,items:db.draft.items,idempotencyKey:randomUUID()});
  await call('competencies',{expectedRevision:1,assertions:[{assertionId:randomUUID(),versionId:randomUUID(),knowledgeStatus:'UNKNOWN',conceptId:null,levelId:null}],idempotencyKey:randomUUID()},draftId);
  const submitted=await call('submit',{expectedRevision:2,idempotencyKey:randomUUID()},draftId);
  const candidate=await call('candidate',{},submitted.candidateId,db.checker);
  const version=await call('approve',{concurrencyToken:candidate.actions[0].concurrencyToken,idempotencyKey:randomUUID()},submitted.candidateId,db.checker);
  const projected=await call('version',{},version.versionId,db.checker);
  await call('publish',{concurrencyToken:projected.actions[0].concurrencyToken,idempotencyKey:randomUUID()},version.versionId,db.checker);
  db.versionId=version.versionId;console.log('PQ1_SOURCE_PUBLISHED');
 }
 const a=databases[0];
 const c=await a.pool.connect();const opportunityId=randomUUID(),revisionId=randomUUID();
 try{await c.query('BEGIN');await c.query(`INSERT INTO opportunity_catalog.opportunity(organization_id,opportunity_id,current_revision_id,revision_number,row_version,lifecycle_state,validation_state,title,funder_name,quality_score,quality_bucket,content_digest,normalization_version,quality_rule_version)
 VALUES($1,$2,$3,1,1,'ACTIVE','VALIDATED_MANUAL','Synthetic opportunity','Synthetic funder',0,'LOW',$4,'opportunity-normalization-v1','opportunity-quality-v1')`,[a.org,opportunityId,revisionId,'a'.repeat(64)]);
 await c.query("INSERT INTO opportunity_catalog.revision(organization_id,revision_id,opportunity_id,revision_number,row_version,snapshot,normalized_projection,quality_projection,content_digest) VALUES($1,$2,$3,1,1,'{}','{}','{}',$4)",[a.org,revisionId,opportunityId,'a'.repeat(64)]);await c.query('COMMIT');}finally{await c.query('ROLLBACK');c.release();}
 const material=(await a.pool.query('SELECT pq1_content FROM organization_profile.pq1_candidate WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 1',[a.org])).rows[0].pq1_content;
 const ref=material.items.find(i=>i.conceptRef).conceptRef,sourceId=randomUUID();
 const saved=await a.criteria.execute('save',opportunityId,{requestId:randomUUID(),expectedHeadRevision:0,opportunityRevisionId:revisionId,
 sources:[{sourceId,label:'Synthetic',sourceKind:'SYNTHETIC',reference:'fixture:opportunity',versionLabel:'v1',capturedText:'Theme'}],
 criteria:[{criterionId:randomUUID(),kind:'THEMATIC_AFFINITY',interpretationText:'Theme',conceptRef:{conceptId:ref.conceptId,schemeId:ref.schemeId,releaseId:ref.releaseId},temporalBasis:null,evidence:{sourceId,locator:'1',excerpt:'Theme',justification:'Synthetic'}}]},null,a.maker.request);
 await a.criteria.execute('confirm',opportunityId,{requestId:randomUUID(),expectedHeadRevision:1,opportunityRevisionId:revisionId},saved.revisionId,a.checker.request);
 a.testOpportunityId=opportunityId;
}
module.exports={run};
