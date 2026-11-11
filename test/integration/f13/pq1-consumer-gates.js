'use strict';
const assert=require('node:assert/strict'),{randomUUID:id}=require('node:crypto');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function until(test){const end=Date.now()+8000;while(Date.now()<end){if(await test())return;await new Promise(setImmediate);}throw Error('DETERMINISTIC_BARRIER_NOT_REACHED');}
async function run({databases,central,call,ok,root,control}){
 const db=databases[0];
 // Renew only synthetic evidence, under the existing session writer. No epoch bypass.
 for(const actor of [db.maker,db.checker,db.submitter]){
  const sess=(await central.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[actor.sid])).rows[0].sess;sess.auth.evidence.authTime=Math.floor(Date.now()/1000);
  await central.coordinator.write([central.coordinator.sessionKey(actor.sid)],()=>central.coordinator.pool.query('INSERT INTO "public"."application_session_store" (sess, expire, sid) SELECT $1, to_timestamp($2), $3 ON CONFLICT (sid) DO UPDATE SET sess=$1, expire=to_timestamp($2) RETURNING sid',[sess,sess.auth.absoluteExpiresAt/1000,actor.sid]));
 }
 const f=await require('./pq1-consumer-fixture').create(db);
 const preview=await ok(root+'/preview',db.checker,{versionId:f.versionId});
 const active=await ok(root+'/activate',db.checker,{versionId:f.versionId,previewToken:preview.concurrencyToken,expectedActivationId:preview.expectedActivationId,expectedGeneration:preview.expectedGeneration,reason:'Synthetic verified evidence',idempotencyKey:id()});
 const input=()=>({opportunityRevisionId:f.opportunityRevisionId,criteriaRevisionId:f.criteriaRevisionId,activationId:active.activationId,generation:active.generation,idempotencyKey:id()});
 const evalPath='/api/opportunities/'+f.opportunityId+'/prequalifications';
 const result=await ok(evalPath,db.checker,input()),resultPath='/api/opportunities/prequalifications/'+result.evaluationId;
 assert.equal((await ok(resultPath,db.checker)).result.lines[0].result,'SATISFIED');
 const decision=()=>({decision:'KEEP_UNDER_REVIEW',reasonCode:'FURTHER_REVIEW',justification:'Synthetic review',criterionIds:[],expectedDecisionId:null,expectedGeneration:0,idempotencyKey:id()});
 const effects=async()=> (await db.pool.query(`SELECT (SELECT count(*) FROM organization_profile.pq1_evaluation) AS evaluations,(SELECT count(*) FROM organization_profile.pq1_decision) AS decisions,(SELECT count(*) FROM organization_profile.pq1_effective_receipt) AS receipts,(SELECT count(*) FROM audit.event WHERE event_code IN ('PREQUALIFICATION_EVALUATED','PREQUALIFICATION_DECIDED')) AS events`)).rows[0];
 async function actor(){const a=await central.user(db.org,id(),id());const grants=['prequalification.evaluate','prequalification.read','prequalification.decide','organization_profile.read','opportunity.read','opportunity.criteria.read','document.read'].map(permission=>({permission,scope:{type:'ORGANIZATION',id:db.org,organizationId:db.org}}));a.version=await central.data.change({organizationId:db.org,membershipId:a.membershipId,expectedVersion:1,grants,assuranceRequirements:central.requirement});a.grants=grants;control.register(a);return a;}
 // F11 denial is a refusal, never a competency UNKNOWN or a disclosed result.
 const denied=await actor();await central.data.change({organizationId:db.org,membershipId:denied.membershipId,expectedVersion:denied.version,grants:denied.grants.filter(g=>g.permission!=='document.read'),assuranceRequirements:central.requirement});
 const beforeF11=await effects();assert.equal((await call(evalPath,denied,input())).status,403);assert.equal((await call(resultPath,denied)).status,403);assert.equal((await call(resultPath+'/decisions',denied,decision())).status,403);assert.deepEqual(await effects(),beforeF11);
 console.log('PQ1_F11_USED_EVIDENCE_EVALUATE_READ_DECIDE_REFUSAL PASS');
 // The final guard sees a controlled instant after actual writes, not a timer race.
 const expiry=Date.parse(f.validUntil);
 for(const method of ['evaluate','decide'])for(const delta of [-1,0,1]){
  const a=await actor();const evaluated=method==='decide'?await ok(evalPath,db.checker,input()):null;const before=await effects();let finalObserved=false;central.temporalClock.set(expiry-1000);control.atFinal(()=>{finalObserved=true;central.temporalClock.set(expiry+delta);});
  const body=method==='evaluate'?input():decision();
  try{const r=await call(method==='evaluate'?evalPath:'/api/opportunities/prequalifications/'+evaluated.evaluationId+'/decisions',a,body);
   if(delta<0){assert(r.status<300,JSON.stringify(r));if(method==='decide')await assert.rejects(db.pool.query('UPDATE organization_profile.pq1_decision SET justification=justification'),/F13_AUTHORING_APPEND_ONLY/);}
   else {assert(r.status>=400,JSON.stringify(r));assert.deepEqual(await effects(),before);}
   assert.equal(finalObserved,true);
  }finally{central.temporalClock.set(null);control.atFinal(null);}
  console.log('PQ1_COMMIT_DEADLINE_'+method+'_'+delta+' PASS');
 }
 central.temporalClock.set(expiry);try{const old=await ok(resultPath,db.checker);assert.equal(old.freshness,'UNAVAILABLE');assert.equal(old.result.lines[0].result,'SATISFIED');const fresh=await ok(evalPath,db.checker,input());const view=await ok('/api/opportunities/prequalifications/'+fresh.evaluationId,db.checker);assert.equal(view.result.lines[0].result,'UNKNOWN');assert.equal(view.freshness,'CURRENT');}finally{central.temporalClock.set(null);}
 console.log('PQ1_EXACT_EXPIRY_HISTORICAL_SATISFIED_NEW_UNKNOWN PASS');
 // Both authority orders, with observable WAITING metadata instead of sleeps.
 for(const method of ['evaluate','decide'])for(const kind of ['grant','membership','session'])for(const revokeFirst of [true,false]){
  const a=await actor();let evaluationId=result.evaluationId;
  if(method==='decide')evaluationId=(await ok(evalPath,db.checker,input())).evaluationId;
  const path=method==='evaluate'?evalPath:'/api/opportunities/prequalifications/'+evaluationId+'/decisions';
  const body=method==='evaluate'?input():decision(),before=await effects(),pause=control.pauseAt(revokeFirst?'source':'final');
  const operation=call(path,a,body);await pause.reached;
  const revocation=kind==='grant'?central.data.change({organizationId:db.org,membershipId:a.membershipId,expectedVersion:a.version,grants:[],assuranceRequirements:central.requirement}):kind==='membership'?require('../../../backend/src/security/membershipRepository').createMembershipRepository(central.pool,central.coordinator).changeStatus({membershipId:a.membershipId,status:'REMOVED'}):central.registry.revokeSession(a.sid);
  let completed=false;const writer=revocation.finally(()=>{completed=true;});writer.catch(()=>{});
  if(revokeFirst)await writer;
  else {await until(async()=> (await central.pool.query("SELECT 1 FROM public.authority_write_request WHERE state='WAITING' AND scope_keys && $1::text[]",[[`MEMBER:${a.membershipId}`,central.coordinator.sessionKey(a.sid)]])).rowCount>0);assert.equal(completed,false);}
  pause.release();const response=await operation;await writer;
  if(revokeFirst){assert(response.status>=400,JSON.stringify(response));assert.deepEqual(await effects(),before);}else assert(response.status<300,JSON.stringify(response));
  assert((await call(path,a,body)).status>=400);
  console.log('PQ1_REVOCATION_'+method+'_'+kind+'_'+(revokeFirst?'FIRST':'AFTER')+' PASS');
 }
 // Actual source writer holds the same F13-P1 gate as consumption.
 const pause=control.pauseAt('final'),evaluating=call(evalPath,db.checker,input());await pause.reached;
 const started=deferred();const writerClient=await db.pool.connect();await writerClient.query('BEGIN');const pid=(await writerClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 const locking=writerClient.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-P1:' || $1::text,43001301))",[db.org]).then(()=>started.resolve());
 await until(async()=> (await db.pool.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[pid])).rows[0].blocked);pause.release();assert((await evaluating).status<300);await locking;await writerClient.query('ROLLBACK');writerClient.release();
 const revokedReached=deferred(),releaseRevoke=deferred();db.controls.beforeCommit=async()=>{revokedReached.resolve();await releaseRevoke.promise;};
 const revoking=db.pq1.execute('revoke',{concurrencyToken:f.revokeToken,reasonCode:'VERIFICATION_ERROR',idempotencyKey:id()},f.verificationId,db.submitter.request,id());await revokedReached.promise;
 const refusal=call(resultPath+'/decisions',db.checker,decision());
 await until(async()=> (await db.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%F13-P1:%'")).rowCount>0);
 releaseRevoke.resolve();await revoking;assert.equal((await refusal).status,409);

 const revoked=await ok(resultPath,db.checker);assert.equal(revoked.freshness,'UNAVAILABLE');assert.equal(revoked.result.lines[0].result,'SATISFIED');
 assert.equal((await call(resultPath+'/decisions',db.checker,decision())).status,409);
 const afterRevoke=await ok(evalPath,db.checker,input());assert.equal((await ok('/api/opportunities/prequalifications/'+afterRevoke.evaluationId,db.checker)).result.lines[0].result,'UNKNOWN');
 console.log('PQ1_SOURCE_LOCK_REVOCATION_CURRENT_HISTORICAL_SEPARATION PASS');
 // F11 physical-state changes serialize against the exact used document version.
 for(const documentFirst of [true,false]){
  const c=await db.pool.connect();await c.query('BEGIN');const pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const before=await effects();let operation,block,mutation;
  if(documentFirst){await c.query("UPDATE document_storage.document_version SET state='QUARANTINED',scan_state='ERROR' WHERE version_id=$1",[f.documentVersionId]);operation=call(evalPath,db.checker,input());await until(async()=> (await db.pool.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[pid])).rowCount>0);await c.query('COMMIT');}
  else {block=control.pauseAt('final');operation=call(evalPath,db.checker,input());await block.reached;mutation=c.query("UPDATE document_storage.document_version SET state='QUARANTINED',scan_state='ERROR' WHERE version_id=$1",[f.documentVersionId]);await until(async()=> (await db.pool.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[pid])).rows[0].blocked);block.release();}
  const r=await operation;
  if(documentFirst){assert(r.status>=400);assert.deepEqual(await effects(),before);}else{assert(r.status<300,JSON.stringify(r));await mutation;await c.query('COMMIT');}
  c.release();assert((await call(resultPath,db.checker)).status>=400);
  await db.pool.query("UPDATE document_storage.document_version SET state='AVAILABLE',scan_state='CLEAN' WHERE version_id=$1",[f.documentVersionId]);
  console.log('PQ1_F11_STATE_'+(documentFirst?'FIRST':'AFTER')+' PASS');
 }

 // Capacity is an independent phase; do not repeat valid consumer gates.
}
module.exports={run};
