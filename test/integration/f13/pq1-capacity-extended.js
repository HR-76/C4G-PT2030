'use strict';
const assert=require('node:assert/strict'),{randomUUID:id}=require('node:crypto');
async function run({db,central,call,items,assertions,counts}){
 const documentMaximum=process.env.PQ1_CAPACITY_DOCUMENT_MAX==='1',profileItems=documentMaximum?[items[0],items.at(-1)]:items;
 const refs=await require('./pq1-http-scenarios').seed(db,true),draftId=id();
 await call('create',{draftId,items:profileItems,idempotencyKey:id()});
 await call('competencies',{expectedRevision:1,assertions,idempotencyKey:id()},draftId);
 const experiences=Array.from({length:100},()=>({experienceId:id(),versionId:id(),typeId:refs.type,observedFrom:'2026-01-01T00:00:00.000Z',observedUntil:'2026-02-01T00:00:00.000Z'}));
 const before=await counts();await assert.rejects(call('experiences',{expectedRevision:2,experiences:[...experiences,{...experiences[0],experienceId:id(),versionId:id()}],idempotencyKey:id()},draftId));assert.deepEqual(await counts(),before);
 await call('experiences',{expectedRevision:2,experiences:documentMaximum?[experiences[0]]:experiences,idempotencyKey:id()},draftId);
 const documentId=id(),documentVersionId=id();
 await db.pool.query("INSERT INTO document_storage.document(document_id,organization_id,resource_type,resource_id,created_by_actor_id,correlation_id) VALUES($1,$2,'EXPERIENCE_EVIDENCE',$3,$4,$5)",[documentId,db.org,experiences[0].experienceId,db.maker.id,id()]);
 await db.pool.query("INSERT INTO document_storage.document_version(version_id,document_id,organization_id,version_number,object_id,storage_class,expected_size,expected_file_class,expected_sha256,declared_mime,display_filename,state,scan_state,idempotency_key,correlation_id,created_by_actor_id,observed_size,sha256) VALUES($1,$2,$3,1,$4,'DOCUMENTS',32,'PDF',$5,'application/pdf','synthetic-capacity.pdf','AVAILABLE','CLEAN',$6,$7,$8,32,$5)",[documentVersionId,documentId,db.org,id(),'b'.repeat(64),id(),id(),db.maker.id]);
 let revision=3;
 for(const assertion of assertions){if((revision-3)%25===0)console.log('PQ1_CAPACITY_ATTACH_PROGRESS '+(revision-3));await call('attach',{expectedRevision:revision++,linkId:id(),assertionVersionId:assertion.versionId,experienceVersionId:experiences[0].versionId,documentVersionId,idempotencyKey:id()},draftId);}
 console.log('PQ1_CAPACITY_DOCUMENT_LINKS_AUTHORED '+JSON.stringify({experiences:documentMaximum?1:100,links:100}));
 // Renew synthetic MFA before verification; approval has not yet occurred.
 const stored=(await central.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[db.checker.sid])).rows[0].sess;stored.auth.evidence.authTime=Math.floor(Date.now()/1000);
 await central.coordinator.write([central.coordinator.sessionKey(db.checker.sid)],()=>central.coordinator.pool.query('INSERT INTO "public"."application_session_store" (sess, expire, sid) SELECT $1, to_timestamp($2), $3 ON CONFLICT (sid) DO UPDATE SET sess=$1, expire=to_timestamp($2) RETURNING sid',[stored,stored.auth.absoluteExpiresAt/1000,db.checker.sid]));
 for(const assertion of assertions){if((revision-103)%25===0)console.log('PQ1_CAPACITY_VERIFY_PROGRESS '+(revision-103));await call('verify',{expectedRevision:revision++,verificationId:id(),assertionVersionId:assertion.versionId,methodId:refs.method,validUntil:new Date(Date.now()+1800000).toISOString(),idempotencyKey:id()},draftId,db.checker);}
 console.log('PQ1_CAPACITY_100_VERIFICATIONS_AUTHORED');
 const baseline=await counts();let candidate,itemCount=profileItems.length;
 try{candidate=await call('submit',{expectedRevision:revision,idempotencyKey:id()},draftId);}catch(error){assert.deepEqual(await counts(),baseline);if(documentMaximum)throw error;console.log('PQ1_CAPACITY_ALL_100_REFUSED_WITHOUT_PUBLICATION '+error.code);
  const diagnostic=await db.pool.connect();
  try{await diagnostic.query('BEGIN');await diagnostic.query("SELECT set_config('app.organization_id',$1,true)",[db.org]);
   const history=await require('../../../backend/src/organizationalProfile/editorialSource').loadEditorialHistory(diagnostic,db.org,draftId,revision);
   await assert.rejects(require('../../../backend/src/organizationalProfile/pq1Source').loadPq1Material(diagnostic,db.org,history.at(-1),new Date().toISOString()),{code:'F13_LIMIT_EXCEEDED'});
  }finally{await diagnostic.query('ROLLBACK');diagnostic.release();}
  console.log('PQ1_CAPACITY_ALL_100_CANONICAL_LIMIT_CONFIRMED PASS');
  await call('edit',{expectedRevision:revision++,items:[items[0],items.at(-1)],idempotencyKey:id()},draftId);
  candidate=await call('submit',{expectedRevision:revision,idempotencyKey:id()},draftId);itemCount=2;
 }
 const diagnostic=await db.pool.connect();
 try{await diagnostic.query('BEGIN');await diagnostic.query("SELECT set_config('app.organization_id',$1,true)",[db.org]);
 const source=require('../../../backend/src/organizationalProfile/editorialSource');let historyBytes=2,count=0;
 for await(const row of source.editorialRevisions(diagnostic,db.org,draftId,revision+1)){historyBytes+=Buffer.byteLength(JSON.stringify(row))+(count?1:0);assert.equal(row.revision,++count);}
 assert.equal(count,revision+1);assert(historyBytes>262144);
 const first=await source.loadEditorialRevision(diagnostic,db.org,draftId,1);assert.equal(first.revision,1);assert.equal(first.items.length,profileItems.length);
 console.log('PQ1_CAPACITY_HISTORY_STREAM_OLD_REVISION PASS '+JSON.stringify({revisions:count,historyBytes,pages:Math.ceil(count/25)}));
 }finally{await diagnostic.query('ROLLBACK');diagnostic.release();}
 const approver=await central.user(db.org,id(),id());await central.data.change({organizationId:db.org,membershipId:approver.membershipId,expectedVersion:1,grants:['organization_profile.approve','organization_profile.publish','organization_profile.read','organization_profile.activate','document.read'].map(permission=>({permission,scope:{type:'ORGANIZATION',id:db.org,organizationId:db.org}})),assuranceRequirements:central.requirement});
 const c=await call('candidate',{},candidate.candidateId,approver),v=await call('approve',{concurrencyToken:c.actions[0].concurrencyToken,idempotencyKey:id()},candidate.candidateId,approver),view=await call('version',{},v.versionId,approver);
 await call('publish',{concurrencyToken:view.actions[0].concurrencyToken,idempotencyKey:id()},v.versionId,approver);
 const active=(await db.effective.execute('active',{},approver.request)).active,start=performance.now();
 const result=await db.effective.execute('activate',{versionId:v.versionId,expectedActivationId:active.activationId,expectedGeneration:active.generation,reason:'Full joint capacity fixture',idempotencyKey:id()},approver.request);
 const snapshot=(await db.pool.query('SELECT content FROM organization_profile.pq1_effective_snapshot WHERE snapshot_id=$1',[result.snapshotId])).rows[0].content;
 assert.equal(snapshot.material.items.length,itemCount);assert.equal(snapshot.material.experiences.length,documentMaximum?1:100);for(const name of ['assertions','links','verifications'])assert.equal(snapshot.material[name].length,100);
 console.log('PQ1_CAPACITY_JOINT_COLLECTION_MAX_ACTIVATED PASS '+JSON.stringify({items:itemCount,experiences:documentMaximum?1:100,assertions:100,links:100,verifications:100,bytes:Buffer.byteLength(JSON.stringify(snapshot)),elapsedMs:Math.round(performance.now()-start)}));
 const cr=(await db.pool.query('SELECT r.* FROM opportunity_catalog.criteria_revision r JOIN opportunity_catalog.criteria_set s ON s.organization_id=r.organization_id AND s.head_revision_id=r.revision_id WHERE s.opportunity_id=$1',[db.testOpportunityId])).rows[0];
 const evaluateStart=performance.now(),evaluated=await db.effective.execute('evaluate',{opportunityId:db.testOpportunityId,opportunityRevisionId:cr.opportunity_revision_id,criteriaRevisionId:cr.revision_id,activationId:result.activationId,generation:result.generation,idempotencyKey:id()},db.checker.request);
 const evaluateMs=performance.now()-evaluateStart,readStart=performance.now(),evaluatedView=await db.effective.execute('read',{evaluationId:evaluated.evaluationId},db.checker.request),readMs=performance.now()-readStart;
 assert.equal(evaluatedView.freshness,'CURRENT');assert.equal(evaluatedView.result.globalResult,'INDETERMINATE');assert.equal(evaluatedView.result.identity.snapshotId,result.snapshotId);assert(evaluateMs<10000);assert(readMs<10000);
 console.log('PQ1_CAPACITY_EVALUATE_READ PASS');
 const decision=await db.effective.execute('decide',{evaluationId:evaluated.evaluationId,decision:'KEEP_UNDER_REVIEW',reasonCode:'FURTHER_REVIEW',justification:'Joint capacity decision',criterionIds:[],expectedDecisionId:null,expectedGeneration:0,idempotencyKey:id()},db.checker.request);
 console.log('PQ1_CAPACITY_DECIDE PASS');
 const historyView=await db.effective.execute('decisions',{evaluationId:evaluated.evaluationId,cursor:null},db.checker.request);assert.equal(historyView.items[0].decisionId,decision.decisionId);
 console.log('PQ1_CAPACITY_DOCUMENT_MAX_CONSUME_READ_DECIDE_HISTORY PASS '+JSON.stringify({evaluateMs:Math.round(evaluateMs),readMs:Math.round(readMs)}));

}
module.exports={run};
