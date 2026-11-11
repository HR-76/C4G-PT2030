'use strict';
const {randomUUID:id}=require('node:crypto');
async function create(db){
 const refs=await require('./pq1-http-scenarios').seed(db,true),draftId=id();
 const call=(method,input,resource,actor=db.maker)=>db.pq1.execute(method,input,resource,actor.request,id());
 const assertion={assertionId:id(),versionId:id(),knowledgeStatus:'KNOWN',conceptId:refs.concept,levelId:null};
 const experience={experienceId:id(),versionId:id(),typeId:refs.type,observedFrom:'2026-01-01T00:00:00.000Z',observedUntil:'2026-02-01T00:00:00.000Z'};
 await call('create',{draftId,items:db.draft.items,idempotencyKey:id()});
 await call('competencies',{expectedRevision:1,assertions:[assertion],idempotencyKey:id()},draftId);
 await call('experiences',{expectedRevision:2,experiences:[experience],idempotencyKey:id()},draftId);
 const documentId=id(),documentVersionId=id();
 await db.pool.query("INSERT INTO document_storage.document(document_id,organization_id,resource_type,resource_id,created_by_actor_id,correlation_id) VALUES($1,$2,'EXPERIENCE_EVIDENCE',$3,$4,$5)",[documentId,db.org,experience.experienceId,db.maker.id,id()]);
 await db.pool.query(`INSERT INTO document_storage.document_version(version_id,document_id,organization_id,version_number,object_id,storage_class,expected_size,expected_file_class,expected_sha256,declared_mime,display_filename,state,scan_state,idempotency_key,correlation_id,created_by_actor_id,observed_size,sha256) VALUES($1,$2,$3,1,$4,'DOCUMENTS',32,'PDF',$5,'application/pdf','synthetic.pdf','AVAILABLE','CLEAN',$6,$7,$8,32,$5)`,[documentVersionId,documentId,db.org,id(),'b'.repeat(64),id(),id(),db.maker.id]);
 await call('attach',{expectedRevision:3,linkId:id(),assertionVersionId:assertion.versionId,experienceVersionId:experience.versionId,documentVersionId,idempotencyKey:id()},draftId);
 const verificationId=id(),validUntil=new Date(Date.now()+600000).toISOString();
 await call('verify',{expectedRevision:4,verificationId,assertionVersionId:assertion.versionId,methodId:refs.method,validUntil,idempotencyKey:id()},draftId,db.checker);
 const submitted=await call('submit',{expectedRevision:5,idempotencyKey:id()},draftId);
 const candidate=await call('candidate',{},submitted.candidateId,db.checker);
 const version=await call('approve',{concurrencyToken:candidate.actions[0].concurrencyToken,idempotencyKey:id()},submitted.candidateId,db.checker);
 const projected=await call('version',{},version.versionId,db.checker);
 await call('publish',{concurrencyToken:projected.actions[0].concurrencyToken,idempotencyKey:id()},version.versionId,db.checker);
 const c=await db.pool.connect(),opportunityId=id(),revisionId=id();
 try{await c.query('BEGIN');await c.query(`INSERT INTO opportunity_catalog.opportunity(organization_id,opportunity_id,current_revision_id,revision_number,row_version,lifecycle_state,validation_state,title,funder_name,quality_score,quality_bucket,content_digest,normalization_version,quality_rule_version)
 VALUES($1,$2,$3,1,1,'ACTIVE','VALIDATED_MANUAL','Synthetic competency opportunity','Synthetic funder',0,'LOW',$4,'opportunity-normalization-v1','opportunity-quality-v1')`,[db.org,opportunityId,revisionId,'a'.repeat(64)]);
 await c.query("INSERT INTO opportunity_catalog.revision(organization_id,revision_id,opportunity_id,revision_number,row_version,snapshot,normalized_projection,quality_projection,content_digest) VALUES($1,$2,$3,1,1,'{}','{}','{}',$4)",[db.org,revisionId,opportunityId,'a'.repeat(64)]);await c.query('COMMIT');}finally{await c.query('ROLLBACK');c.release();}
 const ref=(await db.pool.query('SELECT concept_id,scheme_id,release_id FROM organization_profile.concept WHERE concept_id=$1',[refs.concept])).rows[0],sourceId=id(),criterionId=id();
 const saved=await db.criteria.execute('save',opportunityId,{requestId:id(),expectedHeadRevision:0,opportunityRevisionId:revisionId,sources:[{sourceId,label:'Synthetic competency',sourceKind:'SYNTHETIC',reference:'fixture:competency',versionLabel:'v1',capturedText:'Required competency'}],criteria:[{criterionId,kind:'COMPETENCY_REQUIREMENT',interpretationText:'Required competency',conceptRef:{conceptId:ref.concept_id,schemeId:ref.scheme_id,releaseId:ref.release_id},temporalBasis:'EVALUATION_INSTANT',evidence:{sourceId,locator:'1',excerpt:'Required competency',justification:'Synthetic exact requirement'}}]},null,db.maker.request);
 await db.criteria.execute('confirm',opportunityId,{requestId:id(),expectedHeadRevision:1,opportunityRevisionId:revisionId},saved.revisionId,db.checker.request);
 const draft=await call('draft',{},draftId,db.submitter);
 return {versionId:version.versionId,verificationId,validUntil,documentId,documentVersionId,opportunityId,opportunityRevisionId:revisionId,criteriaRevisionId:saved.revisionId,criterionId,revokeToken:draft.verifications[0].revoke.concurrencyToken};
}
module.exports={create};
