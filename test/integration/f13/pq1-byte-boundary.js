'use strict';
const assert = require('node:assert/strict');
const {randomUUID: id} = require('node:crypto');
const {canonicalize} = require('../../../backend/src/organizationalProfile/canonicalization');
async function run({databases,ok,call,root}) {
 const [a,b]=databases;
 const command=(method,input,resource,actor=a.maker)=>a.pq1.execute(method,input,resource,actor.request,id());
 async function publish(padding) {
  const release=id(),scheme=id(),concept=id(),draft=id(),releaseVersion='byte-'+id();
  await a.pool.query("INSERT INTO organization_profile.catalog_release(release_id,organization_id,namespace,release_version,lifecycle,semantic_digest,provenance) VALUES($1,$2,'TENANT',$4,'DRAFT',$3,'{}')",[release,a.org,'a'.repeat(64),releaseVersion]);
  await a.pool.query("INSERT INTO organization_profile.scheme(scheme_id,release_id,organization_id,scheme_code,relation_domain) VALUES($1,$2,$3,'COMPETENCY','NONE')",[scheme,release,a.org]);
  await a.pool.query("INSERT INTO organization_profile.concept(concept_id,release_id,scheme_id,organization_id,stable_code,provenance) VALUES($1,$2,$3,$4,'BYTE_TEST','{}')",[concept,release,scheme,a.org]);
  await a.pool.query("UPDATE organization_profile.catalog_release SET lifecycle='PUBLISHED',published_at=clock_timestamp() WHERE release_id=$1",[release]);
  await a.pool.query("INSERT INTO organization_profile.competency_catalog_release(release_id,organization_id,release_version,lifecycle,semantic_digest) VALUES($1,$2,$4,'PUBLISHED',$3)",[release,a.org,'a'.repeat(64),releaseVersion]);
  await a.pool.query("INSERT INTO organization_profile.competency_catalog_entry(entry_id,release_id,organization_id,kind,stable_code,framework_id,framework_version) VALUES($1,$2,$3,'COMPETENCY_CONCEPT','BYTE_TEST',$4,$5)",[concept,release,a.org,id(),'v'+ 'x'.repeat(padding)]);
  await command('create',{draftId:draft,items:a.draft.items.map(r=>({...r,itemId:id(),itemVersionId:id()})),idempotencyKey:id()});
  await command('competencies',{expectedRevision:1,assertions:[{assertionId:id(),versionId:id(),knowledgeStatus:'KNOWN',conceptId:concept,levelId:null}],idempotencyKey:id()},draft);
  const submitted=await command('submit',{expectedRevision:2,idempotencyKey:id()},draft);
  const candidate=await command('candidate',{},submitted.candidateId,a.checker);
  const version=await command('approve',{concurrencyToken:candidate.actions[0].concurrencyToken,idempotencyKey:id()},submitted.candidateId,a.checker);
  const view=await command('version',{},version.versionId,a.checker);
  await command('publish',{concurrencyToken:view.actions[0].concurrencyToken,idempotencyKey:id()},version.versionId,a.checker);
  return version.versionId;
 }
 async function activate(versionId) {
  const preview=await ok(root+'/preview',a.checker,{versionId});
  return ok(root+'/activate',a.checker,{versionId,previewToken:preview.concurrencyToken,
   expectedActivationId:preview.expectedActivationId,expectedGeneration:preview.expectedGeneration,reason:'Exact byte capacity proof',idempotencyKey:id()});
 }
 const initial=await activate(await publish(0));
 const small=(await a.pool.query('SELECT content FROM organization_profile.pq1_effective_snapshot WHERE snapshot_id=$1',[initial.snapshotId])).rows[0].content;
 const padding=262144-Buffer.byteLength(canonicalize(small));
 const exactVersion=await publish(padding),exact=await activate(exactVersion);
 const snapshot=(await a.pool.query('SELECT content FROM organization_profile.pq1_effective_snapshot WHERE snapshot_id=$1',[exact.snapshotId])).rows[0].content;
 assert.equal(Buffer.byteLength(canonicalize(snapshot)),262144);
 await ok(root+'/snapshots/'+exact.snapshotId,a.checker);
 assert.equal((await call(root+'/snapshots/'+exact.snapshotId,b.checker)).status,404);
 const cr=(await a.pool.query('SELECT r.* FROM opportunity_catalog.criteria_revision r JOIN opportunity_catalog.criteria_set s ON s.organization_id=r.organization_id AND s.head_revision_id=r.revision_id WHERE s.opportunity_id=$1',[a.testOpportunityId])).rows[0];
 const evaluated=await ok('/api/opportunities/'+a.testOpportunityId+'/prequalifications',a.checker,{opportunityRevisionId:cr.opportunity_revision_id,criteriaRevisionId:cr.revision_id,activationId:exact.activationId,generation:exact.generation,idempotencyKey:id()});
 await ok('/api/opportunities/prequalifications/'+evaluated.evaluationId,a.checker);
 const d='/api/opportunities/prequalifications/'+evaluated.evaluationId+'/decisions';
 await ok(d,a.checker,{decision:'KEEP_UNDER_REVIEW',reasonCode:'FURTHER_REVIEW',justification:'Exact byte boundary',criterionIds:[],expectedDecisionId:null,expectedGeneration:0,idempotencyKey:id()});
 assert.equal((await ok(d,a.checker)).items.length,1);
 const oversized=await publish(padding+1);
 const counts=async()=> (await a.pool.query('SELECT (SELECT count(*) FROM organization_profile.pq1_effective_snapshot) AS snapshots,(SELECT count(*) FROM organization_profile.pq1_activation) AS activations')).rows[0];
 const before=await counts(),refused=await call(root+'/preview',a.checker,{versionId:oversized});
 assert.equal(refused.status,409);assert.equal(refused.value.error.code,'LIMIT_EXCEEDED');assert.deepEqual(await counts(),before);
 await command('version',{},oversized,a.checker);
 a.versionId=exactVersion;a.oversizedVersionId=oversized;
 console.log('PQ1_POSTGRES_EXACT_262144_BYTES_FULL_PATH_PLUS_ONE_REFUSED_PUBLICATION_READABLE_AB PASS');
}
module.exports={run};
