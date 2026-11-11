'use strict';
const assert=require('node:assert/strict');
const {randomUUID:id}=require('node:crypto');
async function run({databases,central,call,control}){
 const db=databases[0], refs=await require('./pq1-http-scenarios').seed(db);
 const send=async(path,actor,body,verb,status=200)=>{const r=await call(path,actor,body,verb);assert.equal(r.status,status,JSON.stringify(r));return r.value;};
 const items=()=>db.draft.items.map(x=>({...x,itemId:id(),itemVersionId:id()}));
 async function draft(){const draftId=id();await send('/drafts',db.maker,{draftId,items:items(),idempotencyKey:id()},'POST',201);return draftId;}
 const d=await draft(), assertion=()=>({assertionId:id(),versionId:id(),knowledgeStatus:'UNKNOWN',conceptId:null,levelId:null});
 const keys=[id(),id()];
 const raced=await Promise.all([db.maker,db.submitter].map((actor,i)=>call(`/drafts/${d}/competencies`,actor,{expectedRevision:1,assertions:[assertion()],idempotencyKey:keys[i]},'PUT')));
 assert.equal(raced.filter(r=>r.status===200).length,1);assert(raced.some(r=>r.status===409));
 assert.equal((await send('/drafts/'+d,db.maker)).revision,2);
 const race2=await Promise.all([call(`/drafts/${d}/submit`,db.maker,{expectedRevision:2,idempotencyKey:id()}),call(`/drafts/${d}/items`,db.submitter,{expectedRevision:2,items:items(),idempotencyKey:id()},'PUT')]);
 assert.equal(race2.filter(r=>r.status<300).length,1);assert(race2.some(r=>r.status===409));
 console.log('PQ1_HTTP_TWO_SESSION_CAS_SUBMIT_EDIT_PASS');
 async function verified(expiry=null){
   const draftId=await draft(),a={assertionId:id(),versionId:id(),knowledgeStatus:'KNOWN',conceptId:refs.concept,levelId:null},e={experienceId:id(),versionId:id(),typeId:refs.type,observedFrom:'2026-01-01T00:00:00.000Z',observedUntil:'2026-02-01T00:00:00.000Z'};
   await send(`/drafts/${draftId}/competencies`,db.maker,{expectedRevision:1,assertions:[a],idempotencyKey:id()},'PUT');
   await send(`/drafts/${draftId}/experiences`,db.maker,{expectedRevision:2,experiences:[e],idempotencyKey:id()},'PUT');
   await send(`/drafts/${draftId}/evidence-links`,db.maker,{expectedRevision:3,linkId:id(),assertionVersionId:a.versionId,experienceVersionId:e.versionId,documentVersionId:null,idempotencyKey:id()});
   const validUntil=new Date(Date.now()+(expiry||1800000)).toISOString(),verificationId=id();
   await send(`/drafts/${draftId}/verifications`,db.checker,{expectedRevision:4,verificationId,assertionVersionId:a.versionId,methodId:refs.method,validUntil,idempotencyKey:id()});
   return {draftId,verificationId,validUntil};
 }
 for(const mode of ['REVOKED','EXPIRED']){
   const v=await verified(mode==='EXPIRED'?90000:null);
   const c=await send(`/drafts/${v.draftId}/submit`,db.maker,{expectedRevision:5,idempotencyKey:id()},'POST',201);
   const candidate=await send('/candidates/'+c.candidateId,db.checker),token=candidate.actions[0].concurrencyToken;
   if(mode==='REVOKED'){
     const state=await send('/drafts/'+v.draftId,db.checker);
     await send('/verifications/'+v.verificationId+'/revoke',db.checker,{concurrencyToken:state.verifications[0].revoke.concurrencyToken,reasonCode:'VERIFICATION_ERROR',idempotencyKey:id()});
   }else central.temporalClock.set(Date.parse(v.validUntil));
   const stale=await call(`/candidates/${c.candidateId}/approve`,db.checker,{concurrencyToken:token,idempotencyKey:id()});assert.equal(stale.status,409,JSON.stringify(stale));assert.equal(stale.value.error.code,'APPROVAL_STALE');
   assert.equal((await send('/candidates/'+c.candidateId,db.checker)).actions[0].reason,'APPROVAL_STALE');
   assert.equal((await db.pool.query('SELECT 1 FROM organization_profile.pq1_version WHERE candidate_id=$1',[c.candidateId])).rowCount,0);
   central.temporalClock.set(null);
 }
 console.log('PQ1_HTTP_STATUS_TRANSITION_STALES_APPROVAL_PASS');
 async function approvedUnknown(){
   const draftId=await draft();await send(`/drafts/${draftId}/competencies`,db.maker,{expectedRevision:1,assertions:[assertion()],idempotencyKey:id()},'PUT');
   const c=await send(`/drafts/${draftId}/submit`,db.maker,{expectedRevision:2,idempotencyKey:id()},'POST',201);
   const candidate=await send('/candidates/'+c.candidateId,db.checker);
   const version=await send(`/candidates/${c.candidateId}/approve`,db.checker,{concurrencyToken:candidate.actions[0].concurrencyToken,idempotencyKey:id()},'POST',201);
   const projection=await send('/versions/'+version.versionId,db.checker);
   return {id:version.versionId,body:{concurrencyToken:projection.actions[0].concurrencyToken,idempotencyKey:id()}};
 }
 const state=(await central.pool.query('SELECT grants,authorization_version FROM public.authority_f5_state WHERE organization_id=$1 AND membership_id=$2',[db.org,db.checker.membershipId])).rows[0];
 let grantVersion=Number(state.authorization_version);
 async function grants(values){grantVersion=await central.data.change({organizationId:db.org,membershipId:db.checker.membershipId,expectedVersion:grantVersion,grants:values,assuranceRequirements:central.requirement});}
 const refused=await approvedUnknown();await grants([]);
 assert.equal((await call('/versions/'+refused.id+'/publish',db.checker,refused.body)).status,403);
 assert.equal((await db.pool.query('SELECT 1 FROM organization_profile.pq1_publication WHERE version_id=$1',[refused.id])).rowCount,0);
 await grants(state.grants);
 assert.equal((await call('/versions/'+refused.id+'/publish',db.checker,refused.body)).status,409);
 const committed=await approvedUnknown(), paused=control.pause();
 const publication=call('/versions/'+committed.id+'/publish',db.checker,committed.body);
 await paused.reached;
 const revocation=grants([]);paused.release();
 const result=await publication;assert.equal(result.status,200,JSON.stringify(result));await revocation;
 assert.equal((await db.pool.query('SELECT 1 FROM organization_profile.pq1_publication WHERE version_id=$1',[committed.id])).rowCount,1);
 assert.equal((await call('/versions/'+committed.id+'/publish',db.checker,committed.body)).status,403);
 await grants(state.grants);
 console.log('PQ1_HTTP_GRANTS_BEFORE_AFTER_PUBLICATION_PASS');
 const unknown=await send('/intentions/lookup',db.maker,{operation:'SET_COMPETENCIES',resourceId:d,idempotencyKey:id()});assert.equal(unknown.status,'UNKNOWN');assert.equal(unknown.receipt,null);
 const independent=await draft();assert(independent);
 const foreign=await call('/drafts/'+d,databases[1].maker);assert.equal(foreign.status,404);
 console.log('PQ1_HTTP_UNKNOWN_INDEPENDENT_RESOURCE_AB_PASS');
}
module.exports={run};
