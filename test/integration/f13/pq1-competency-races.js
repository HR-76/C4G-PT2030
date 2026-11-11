'use strict';
const assert=require('node:assert/strict'),{randomUUID:id}=require('node:crypto');
async function run({databases,call,control}){
 const db=databases[0],refs=await require('./pq1-http-scenarios').seed(db);
 const ok=async(path,actor,body,verb,status=200)=>{const r=await call(path,actor,body,verb);assert.equal(r.status,status,JSON.stringify(r));return r.value;};
 const draftId=id(),a={assertionId:id(),versionId:id(),knowledgeStatus:'KNOWN',conceptId:refs.concept,levelId:null},e={experienceId:id(),versionId:id(),typeId:refs.type,observedFrom:'2026-01-01T00:00:00.000Z',observedUntil:'2026-02-01T00:00:00.000Z'};
 await ok('/drafts',db.maker,{draftId,items:db.draft.items,idempotencyKey:id()},'POST',201);
 await ok(`/drafts/${draftId}/competencies`,db.maker,{expectedRevision:1,assertions:[a],idempotencyKey:id()},'PUT');
 await ok(`/drafts/${draftId}/experiences`,db.maker,{expectedRevision:2,experiences:[e],idempotencyKey:id()},'PUT');
 const link=revision=>({expectedRevision:revision,linkId:id(),assertionVersionId:a.versionId,experienceVersionId:e.versionId,documentVersionId:null,idempotencyKey:id()});
 const verify=revision=>({expectedRevision:revision,verificationId:id(),assertionVersionId:a.versionId,methodId:refs.method,validUntil:new Date(Date.now()+1800000).toISOString(),idempotencyKey:id()});
 await ok(`/drafts/${draftId}/evidence-links`,db.maker,link(3));
 for(const [first,second,event,revision] of [['verifications','evidence-links','COMPETENCY_ASSERTION_VERIFIED',4],['evidence-links','verifications','EVIDENCE_ATTACHED',5]]){
   const pause=control.pause(event);
   const send=method=>call(`/drafts/${draftId}/${method}`,method==='verifications'?db.checker:db.maker,method==='verifications'?verify(revision):link(revision));
   const winner=send(first);await pause.reached;const loser=send(second);await new Promise(resolve=>setTimeout(resolve,100));pause.release();
   const results=await Promise.all([winner,loser]);assert.equal(results[0].status,200,JSON.stringify(results));assert.equal(results[1].status,409,JSON.stringify(results));
 }
 const current=await ok('/drafts/'+draftId,db.maker);assert.equal(current.revision,6);assert.equal(current.verifications.length,0);assert.equal(current.links.length,2);
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM organization_profile.competency_verification_result WHERE assertion_version_id=$1',[a.versionId])).rows[0].n,1);
 console.log('PQ1_VERIFY_ATTACH_BOTH_ORDERS_CAS_NO_PARTIAL_EFFECT_PASS');
}
module.exports={run};
