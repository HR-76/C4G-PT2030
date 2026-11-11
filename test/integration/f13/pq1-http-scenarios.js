'use strict';
const assert=require('node:assert/strict');
const {randomUUID:id}=require('node:crypto');
async function seed(db, documentRequired=false){
 const release=id(),framework=id(),scheme=id(),concept=id(),type=id(),method=id();
 await db.pool.query(`INSERT INTO organization_profile.catalog_release(release_id,organization_id,namespace,release_version,lifecycle,semantic_digest,provenance) VALUES($1,$2,'TENANT','pq1-synthetic-v1','DRAFT',$3,'{"governance":{"defaultLocale":"pt-PT"}}')`,[release,db.org,'a'.repeat(64)]);
 await db.pool.query(`INSERT INTO organization_profile.scheme(scheme_id,release_id,organization_id,scheme_code,relation_domain) VALUES($1,$2,$3,'COMPETENCY','NONE')`,[scheme,release,db.org]);
 await db.pool.query(`INSERT INTO organization_profile.concept(concept_id,release_id,scheme_id,organization_id,stable_code,provenance) VALUES($1,$2,$3,$4,'PQ1_SYNTHETIC_COMPETENCY','{}')`,[concept,release,scheme,db.org]);
 await db.pool.query(`UPDATE organization_profile.catalog_release SET lifecycle='PUBLISHED',published_at=clock_timestamp() WHERE release_id=$1`,[release]);
 await db.pool.query(`INSERT INTO organization_profile.competency_catalog_release(release_id,organization_id,release_version,lifecycle,semantic_digest) VALUES($1,$2,'pq1-synthetic-v1','PUBLISHED',$3)`,[release,db.org,'a'.repeat(64)]);
 for(const [entry,kind] of [[concept,'COMPETENCY_CONCEPT'],[type,'EXPERIENCE_TYPE'],[method,'VERIFICATION_METHOD']])await db.pool.query(`INSERT INTO organization_profile.competency_catalog_entry(entry_id,release_id,organization_id,kind,stable_code,framework_id,framework_version,max_validity_seconds) VALUES($1,$2,$3,$4,$4,$5,$6,$7)`,[entry,release,db.org,kind,kind==='COMPETENCY_CONCEPT'?framework:null,kind==='COMPETENCY_CONCEPT'?'synthetic-v1':null,kind==='VERIFICATION_METHOD'?3600:null]);
 await db.pool.query(`INSERT INTO organization_profile.pq1_method_descriptor VALUES($1,$2,$3,'F13_PQ1_VERIFICATION_DESCRIPTOR_V1',$4)`,[method,db.org,release,documentRequired]);
 return {concept,type,method};
}
async function run({databases,central,call,setFault,control}){
 const results=[];
 async function ok(path,actor,body,verb,status=200){const r=await call(path,actor,body,verb);assert.equal(r.status,status,JSON.stringify(r));return r.value;}
 for(const db of databases){
 const refs=await seed(db,db===databases[1]),draftId=id(),items=db.draft.items.map(x=>({...x,itemId:id(),itemVersionId:id()}));
 await ok('/context',db.maker);
 await ok('/drafts',db.maker,{draftId,items,idempotencyKey:id()},'POST',201);
 await ok('/drafts/'+draftId,db.maker);
 const assertion={assertionId:id(),versionId:id(),knowledgeStatus:'KNOWN',conceptId:refs.concept,levelId:null};
 await ok(`/drafts/${draftId}/competencies`,db.maker,{expectedRevision:1,assertions:[assertion],idempotencyKey:id()},'PUT');
 const experience={experienceId:id(),versionId:id(),typeId:refs.type,observedFrom:'2026-01-01T00:00:00.000Z',observedUntil:'2026-02-01T00:00:00.000Z'};
 if(db===databases[1]) {
   const before=(await db.pool.query('SELECT count(*)::int n FROM organization_profile.pq1_provenance')).rows[0].n;
   setFault('F7_EXPERIENCE');assert.equal((await call(`/drafts/${draftId}/experiences`,db.maker,{expectedRevision:2,experiences:[experience],idempotencyKey:id()},'PUT')).status,503);
   assert.equal((await db.pool.query('SELECT count(*)::int n FROM organization_profile.pq1_provenance')).rows[0].n,before);
 }
 await ok(`/drafts/${draftId}/experiences`,db.maker,{expectedRevision:2,experiences:[experience],idempotencyKey:id()},'PUT');
 let documentVersionId=null;
 if(db===databases[1]) {
   const document=id();documentVersionId=id();
   await db.pool.query("INSERT INTO document_storage.document(document_id,organization_id,resource_type,resource_id,created_by_actor_id,correlation_id) VALUES($1,$2,'EXPERIENCE_EVIDENCE',$3,$4,$5)",[document,db.org,experience.experienceId,db.maker.id,id()]);
   await db.pool.query(`INSERT INTO document_storage.document_version(version_id,document_id,organization_id,version_number,object_id,storage_class,expected_size,expected_file_class,expected_sha256,declared_mime,display_filename,state,scan_state,idempotency_key,correlation_id,created_by_actor_id,observed_size,sha256) VALUES($1,$2,$3,1,$4,'DOCUMENTS',32,'PDF',$5,'application/pdf','synthetic.pdf','AVAILABLE','CLEAN',$6,$7,$8,32,$5)`,[documentVersionId,document,db.org,id(),'b'.repeat(64),id(),id(),db.maker.id]);
   const docs=await ok(`/drafts/${draftId}/experiences/${experience.experienceId}/documents`,db.maker);assert.deepEqual(docs.items,[{documentId:document,documentVersionId}]);
   assert.equal((await call(`/drafts/${draftId}/verifications`,db.checker,{expectedRevision:3,verificationId:id(),assertionVersionId:assertion.versionId,methodId:refs.method,validUntil:new Date(Date.now()+1800000).toISOString(),idempotencyKey:id()})).status,409);
 }
 await ok(`/drafts/${draftId}/evidence-links`,db.maker,{expectedRevision:3,linkId:id(),assertionVersionId:assertion.versionId,experienceVersionId:experience.versionId,documentVersionId,idempotencyKey:id()});
 const verify={expectedRevision:4,verificationId:id(),assertionVersionId:assertion.versionId,methodId:refs.method,validUntil:new Date(Date.now()+1800000).toISOString(),idempotencyKey:id()};
 assert.equal((await call(`/drafts/${draftId}/verifications`,db.maker,verify)).status,403);
 if(documentVersionId){
   const state=(await central.pool.query('SELECT grants,authorization_version FROM public.authority_f5_state WHERE organization_id=$1 AND membership_id=$2',[db.org,db.checker.membershipId])).rows[0];
   const change=grants=>central.data.change({organizationId:db.org,membershipId:db.checker.membershipId,expectedVersion:Number(state.authorization_version),grants,assuranceRequirements:central.requirement});
   state.authorization_version=await change(state.grants.filter(g=>g.permission!=='document.read'));
   assert.equal((await call(`/drafts/${draftId}/verifications`,db.checker,verify)).status,403);
   await change(state.grants);
   await db.pool.query("UPDATE document_storage.document_version SET state='QUARANTINED',scan_state='ERROR' WHERE version_id=$1",[documentVersionId]);
   assert.equal((await call(`/drafts/${draftId}/verifications`,db.checker,verify)).status,404);
   await db.pool.query("UPDATE document_storage.document_version SET state='AVAILABLE',scan_state='CLEAN' WHERE version_id=$1",[documentVersionId]);
 }
 await ok(`/drafts/${draftId}/verifications`,db.checker,verify);
 const detail=await ok('/drafts/'+draftId,db.maker);assert.equal(detail.revision,5);assert.equal(detail.verifications[0].effectiveStatusAtSubmission,'VERIFIED');
 const candidate=await ok(`/drafts/${draftId}/submit`,db.maker,{expectedRevision:5,idempotencyKey:id()},'POST',201);assert.equal(candidate.completion.result,'COMPLETE');
 const c=await ok('/candidates/'+candidate.candidateId,db.checker);assert.equal(c.actions[0].status,'AVAILABLE',JSON.stringify(c.actions));
 if(db===databases[0]) {
   const failed={concurrencyToken:c.actions[0].concurrencyToken,idempotencyKey:id()};
   const before=(await db.pool.query('SELECT count(*)::int n FROM organization_profile.pq1_version')).rows[0].n;
   setFault('F7');assert.equal((await call(`/candidates/${candidate.candidateId}/approve`,db.checker,failed)).status,503);
   assert.equal((await db.pool.query('SELECT count(*)::int n FROM organization_profile.pq1_version')).rows[0].n,before);
   const lookup=await ok('/intentions/lookup',db.checker,{operation:'APPROVE',resourceId:candidate.candidateId,idempotencyKey:failed.idempotencyKey});
   assert(['FAILED_FINAL','RESOLVING'].includes(lookup.status),JSON.stringify(lookup));
 }
 const version=await ok(`/candidates/${candidate.candidateId}/approve`,db.checker,{concurrencyToken:c.actions[0].concurrencyToken,idempotencyKey:id()},'POST',201);
 const v=await ok('/versions/'+version.versionId,db.checker);
 const publish={concurrencyToken:v.actions[0].concurrencyToken,idempotencyKey:id()};
 if(db===databases[0]) {
   setFault('F7_PUBLISH');assert.equal((await call(`/versions/${version.versionId}/publish`,db.checker,{...publish,idempotencyKey:id()})).status,503);
   assert.equal((await db.pool.query('SELECT 1 FROM organization_profile.pq1_publication WHERE version_id=$1',[version.versionId])).rowCount,0);
   setFault('COMMIT');
 }
 let result;
 if(documentVersionId){
   const paused=control.pause(),publishing=call(`/versions/${version.versionId}/publish`,db.checker,publish);await paused.reached;
   let changed=false;const quarantine=db.pool.query("UPDATE document_storage.document_version SET state='QUARANTINED',scan_state='ERROR' WHERE version_id=$1",[documentVersionId]).then(()=>{changed=true;});
   await new Promise(resolve=>setTimeout(resolve,100));assert.equal(changed,false);paused.release();result=await publishing;await quarantine;
   assert.equal(result.status,200);assert.equal((await call('/versions/'+version.versionId,db.maker)).status,404);
   await db.pool.query("UPDATE document_storage.document_version SET state='AVAILABLE',scan_state='CLEAN' WHERE version_id=$1",[documentVersionId]);
   console.log('PQ1_HTTP_F11_REVOCATION_AND_COMMIT_LOCK_PASS');
 } else result=await call(`/versions/${version.versionId}/publish`,db.checker,publish);assert([200,503].includes(result.status),JSON.stringify(result));
 let recovered; for(let attempt=0;attempt<20;attempt++){recovered=await ok('/intentions/lookup',db.checker,{operation:'PUBLISH',resourceId:version.versionId,idempotencyKey:publish.idempotencyKey});if(recovered.status!=='RESOLVING')break;await new Promise(resolve=>setTimeout(resolve,1000));}
 assert.equal(recovered.status,'CONFIRMED',JSON.stringify(recovered));
 await ok(`/versions/${version.versionId}/publish`,db.checker,publish);
 assert.equal((await ok('/intentions/lookup',db.checker,{operation:'PUBLISH',resourceId:version.versionId,idempotencyKey:publish.idempotencyKey})).status,'CONFIRMED');
 const published=await ok('/versions/'+version.versionId,db.maker);assert.equal(published.state,'PUBLISHED');assert.equal(published.active,false);
 if(db===databases[0]) {
   const d=await ok('/drafts/'+draftId,db.checker), token=d.verifications[0].revoke.concurrencyToken;
   const revoke={concurrencyToken:token,reasonCode:'EVIDENCE_WITHDRAWN',idempotencyKey:id()};
   assert.equal((await call('/verifications/'+verify.verificationId+'/revoke',db.maker,revoke)).status,409);
   setFault('F7_REVOKE');assert.equal((await call('/verifications/'+verify.verificationId+'/revoke',db.checker,revoke)).status,503);
   assert.equal((await db.pool.query('SELECT 1 FROM organization_profile.pq1_verification_status_event WHERE verification_id=$1',[verify.verificationId])).rowCount,0);
   await ok('/verifications/'+verify.verificationId+'/revoke',db.checker,revoke);
   await ok('/verifications/'+verify.verificationId+'/revoke',db.checker,revoke);
   const historic=await ok('/versions/'+version.versionId,db.maker);
   assert.equal(historic.verifications[0].effectiveStatusAtSubmission,'VERIFIED');assert.equal(historic.verifications[0].currentStatus,'REVOKED');
   assert.equal((await db.pool.query('SELECT status FROM organization_profile.competency_verification_result WHERE verification_id=$1',[verify.verificationId])).rows[0].status,'VERIFIED');
 }
 results.push({db,draftId,versionId:version.versionId});
 }
 assert.equal((await call('/versions/'+results[0].versionId,databases[1].maker)).status,404);
 for(const db of databases){
   const c=await db.pool.connect();try {await c.query('BEGIN');await assert.rejects(()=>c.query(require('fs').readFileSync(require('path').resolve(__dirname,'../../../backend/database/tenant/migrations/018_f13_pq1_publication.down.sql'),'utf8')),/PQ1_DOWNGRADE_REQUIRES_EMPTY/);}finally{await c.query('ROLLBACK');c.release();}
 }
 console.log('PQ1_OCCUPIED_DOWN_REFUSES_DATA_LOSS_PASS');
 console.log('PQ1_HTTP_MULTIDOMAIN_AB_PASS');
}
module.exports={run,seed};
