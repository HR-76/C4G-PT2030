'use strict';
const assert=require('node:assert/strict'),{randomUUID:id}=require('node:crypto');
async function run({a,b,call,ok,root,evaluationId,control}){
 const path='/api/opportunities/prequalifications/'+evaluationId+'/decisions';
 const original=(await a.pool.query('SELECT result_digest FROM organization_profile.pq1_evaluation WHERE evaluation_id=$1',[evaluationId])).rows[0].result_digest;
 const criterion=(await a.pool.query('SELECT result FROM organization_profile.pq1_evaluation WHERE evaluation_id=$1',[evaluationId])).rows[0].result.lines[0].criterionId;
 let head=null;
 for(const [decision,reasonCode] of [['REQUEST_INFORMATION','INFORMATION_MISSING'],['KEEP_UNDER_REVIEW','FURTHER_REVIEW'],['DISCARD_FROM_ANALYSIS','OTHER_JUSTIFIED']]){
  const body={decision,reasonCode,justification:'Synthetic local decision',criterionIds:decision==='REQUEST_INFORMATION'?[criterion]:[],expectedDecisionId:head?.decisionId||null,expectedGeneration:head?.generation||0,idempotencyKey:id()};
  assert.equal((await call(path,b.checker,body)).status,404);
  const before=(await a.pool.query('SELECT count(*)::int n FROM organization_profile.pq1_decision')).rows[0].n;
  control.setFault('F7_DECIDE');assert.equal((await call(path,a.checker,{...body,idempotencyKey:id()})).status,503);
  assert.equal((await a.pool.query('SELECT count(*)::int n FROM organization_profile.pq1_decision')).rows[0].n,before);
  head=await ok(path,a.checker,body);assert.deepEqual(await ok(path,a.checker,body),head);
  assert.equal((await call(path,a.checker,{...body,idempotencyKey:id()})).status,409);
  assert.equal((await call(path,a.checker,{...body,justification:'Changed'})).status,409);
  const recovered=await ok(root+'/intentions/lookup',a.checker,{operation:'PQ1_DECIDE',resourceId:evaluationId,idempotencyKey:body.idempotencyKey});assert.equal(recovered.status,'CONFIRMED');assert.deepEqual(recovered.receipt,head);
 }
 const history=await ok(path,a.checker);assert.equal(history.items.length,3);assert.equal(history.head.generation,3);assert.equal(history.canDecide,true);
 assert.equal((await call(path,b.checker)).status,404);
 assert.equal((await a.pool.query('SELECT result_digest FROM organization_profile.pq1_evaluation WHERE evaluation_id=$1',[evaluationId])).rows[0].result_digest,original);
 const c=await a.pool.connect();try{await c.query('BEGIN');await assert.rejects(c.query(require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../../../backend/database/tenant/migrations/020_f14_pq1_decisions.down.sql'),'utf8')),/PQ1_DECISION_DOWNGRADE_REQUIRES_EMPTY_DATA/);await c.query('ROLLBACK');await c.query('BEGIN');await c.query('SET LOCAL ROLE c4g_organization_profile_runtime');await c.query("SELECT set_config('app.organization_id',$1,true)",[a.org]);await assert.rejects(c.query('UPDATE organization_profile.pq1_decision SET justification=justification'),{code:'42501'});}finally{await c.query('ROLLBACK');c.release();}
 const racing={decision:'KEEP_UNDER_REVIEW',reasonCode:'FURTHER_REVIEW',justification:'Concurrent synthetic decision',criterionIds:[],expectedDecisionId:head.decisionId,expectedGeneration:head.generation};
 const pause=control.pauseAt('final'),winner=call(path,a.checker,{...racing,idempotencyKey:id()});await pause.reached;
 const loser=call(path,a.submitter,{...racing,idempotencyKey:id()});const end=Date.now()+8000;let blocked=false;
 while(Date.now()<end){blocked=(await a.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%F13-P1:%'")).rowCount>0;if(blocked)break;await new Promise(setImmediate);}
 assert(blocked);pause.release();assert.equal((await winner).status,200);assert.equal((await loser).status,409);
 const auditResources=(await a.pool.query("SELECT event_data->'resource' AS resource FROM audit.event WHERE event_code='PREQUALIFICATION_DECIDED'")).rows;assert.equal(auditResources.length,4);assert(auditResources.every(r=>r.resource.type==='PREQUALIFICATION_EVALUATION'&&r.resource.id===evaluationId));
 const final=await ok(path,a.checker);assert.equal(final.head.generation,4);assert.equal(final.items.length,4);
 console.log('PQ1_DECISION_CONCURRENT_CAS_EXACT_ONE_WINNER PASS');
 console.log('PQ1_DECISIONS_HTTP_AB_THREE_CAS_REPLAY_LOOKUP_F7_IMMUTABLE PASS');
}
module.exports={run};
