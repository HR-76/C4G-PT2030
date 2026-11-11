'use strict';
const assert = require('node:assert/strict'), { randomUUID: id } = require('node:crypto');
async function run({ databases, call, control }) {
  const db = databases[0], refs = await require('./pq1-http-scenarios').seed(db);
  const ok = async (path, actor, body, method) => { const r = await call(path, actor, body, method); assert(r.status < 300, JSON.stringify(r)); return r.value; };
  for (const operation of ['approve','publish']) for (const revokeFirst of [true,false]) {
    const draftId = id(), assertion = { assertionId:id(),versionId:id(),knowledgeStatus:'KNOWN',conceptId:refs.concept,levelId:null };
    const experience = { experienceId:id(),versionId:id(),typeId:refs.type,observedFrom:'2026-01-01T00:00:00.000Z',observedUntil:'2026-02-01T00:00:00.000Z' };
    await ok('/drafts', db.maker, {draftId,items:db.draft.items,idempotencyKey:id()});
    await ok(`/drafts/${draftId}/competencies`,db.maker,{expectedRevision:1,assertions:[assertion],idempotencyKey:id()},'PUT');
    await ok(`/drafts/${draftId}/experiences`,db.maker,{expectedRevision:2,experiences:[experience],idempotencyKey:id()},'PUT');
    await ok(`/drafts/${draftId}/evidence-links`,db.maker,{expectedRevision:3,linkId:id(),assertionVersionId:assertion.versionId,experienceVersionId:experience.versionId,documentVersionId:null,idempotencyKey:id()});
    const verificationId=id();
    await ok(`/drafts/${draftId}/verifications`,db.checker,{expectedRevision:4,verificationId,assertionVersionId:assertion.versionId,methodId:refs.method,validUntil:new Date(Date.now()+1800000).toISOString(),idempotencyKey:id()});
    const candidate=await ok(`/drafts/${draftId}/submit`,db.maker,{expectedRevision:5,idempotencyKey:id()});
    let target=candidate.candidateId, collection='candidates', projection=await ok('/candidates/'+target,db.checker);
    if(operation==='publish') {
      target=(await ok('/candidates/'+target+'/approve',db.checker,{concurrencyToken:projection.actions[0].concurrencyToken,idempotencyKey:id()})).versionId;
      collection='versions';projection=await ok('/versions/'+target,db.checker);
    }
    const original=await ok('/drafts/'+draftId,db.submitter);
    const editorial=()=>call(`/${collection}/${target}/${operation}`,db.checker,{concurrencyToken:projection.actions[0].concurrencyToken,idempotencyKey:id()});
    const revoke=()=>call('/verifications/'+verificationId+'/revoke',db.submitter,{concurrencyToken:original.verifications[0].revoke.concurrencyToken,reasonCode:'VERIFICATION_ERROR',idempotencyKey:id()});
    const paused=control.pause(revokeFirst?'ASSERTION_REVOKED':operation==='approve'?'PROFILE_VERSION_APPROVED':'PROFILE_VERSION_PUBLISHED');
    const first=(revokeFirst?revoke:editorial)();await paused.reached;
    const second=(revokeFirst?editorial:revoke)();await new Promise(resolve=>setTimeout(resolve,100));paused.release();
    const result=await Promise.all([first,second]);assert(result[0].status<300,JSON.stringify(result));
    assert.equal(result[1].status,revokeFirst?409:200,JSON.stringify(result));
    if(revokeFirst)assert.equal(result[1].value.error.code,'APPROVAL_STALE');
    const table=operation==='approve'?'pq1_version':'pq1_publication',key=operation==='approve'?'candidate_id':'version_id';
    assert.equal((await db.pool.query(`SELECT count(*)::int n FROM organization_profile.${table} WHERE ${key}=$1`,[target])).rows[0].n,revokeFirst?0:1);
    assert.equal((await db.pool.query('SELECT count(*)::int n FROM organization_profile.pq1_verification_status_event WHERE verification_id=$1',[verificationId])).rows[0].n,1);
    console.log(`PQ1_${operation.toUpperCase()}_REVOKE_${revokeFirst?'REVOKE_FIRST':'EDITORIAL_FIRST'}_PASS`);
  }
}
module.exports={run};
