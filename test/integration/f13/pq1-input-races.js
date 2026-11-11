'use strict';
const assert=require('node:assert/strict'),{randomUUID:id}=require('node:crypto');
async function until(work){const end=Date.now()+8000;while(Date.now()<end){if(await work())return;await new Promise(setImmediate);}throw Error('INPUT_RACE_BARRIER_NOT_REACHED');}
async function run({databases,call,ok,root,control}){
 const a=databases[0],opportunityId=a.testOpportunityId;
 let active=await a.effective.execute('activate',{versionId:a.versionId,expectedActivationId:null,expectedGeneration:0,reason:'Input race baseline',idempotencyKey:id()},a.checker.request);
 const current=async()=>(await a.pool.query('SELECT r.* FROM opportunity_catalog.criteria_revision r JOIN opportunity_catalog.criteria_set s ON s.organization_id=r.organization_id AND s.head_revision_id=r.revision_id WHERE s.opportunity_id=$1',[opportunityId])).rows[0];
 const input=async()=>{const c=await current();return {opportunityRevisionId:c.opportunity_revision_id,criteriaRevisionId:c.revision_id,activationId:active.activationId,generation:active.generation,idempotencyKey:id()};};
 const path='/api/opportunities/'+opportunityId+'/prequalifications';
 const effects=async()=>(await a.pool.query("SELECT (SELECT count(*) FROM organization_profile.pq1_evaluation) n,(SELECT count(*) FROM audit.event WHERE event_code='PREQUALIFICATION_EVALUATED') events")).rows[0];
 async function changeCriteria(){const c=await current();const saved=await a.criteria.execute('save',opportunityId,{requestId:id(),expectedHeadRevision:Number(c.revision_number),opportunityRevisionId:c.opportunity_revision_id,sources:c.content.sources,criteria:c.content.criteria.map(x=>({...x,interpretationText:x.interpretationText+' revised'}))},null,a.maker.request);await a.criteria.execute('confirm',opportunityId,{requestId:id(),expectedHeadRevision:saved.revisionNumber,opportunityRevisionId:c.opportunity_revision_id},saved.revisionId,a.checker.request);}
 async function changeActivation(){active=await a.effective.execute('activate',{versionId:a.versionId,expectedActivationId:active.activationId,expectedGeneration:active.generation,reason:'Input race new generation',idempotencyKey:id()},a.submitter.request);}
 for(const kind of ['criteria','activation'])for(const writerFirst of [false,true]){
  const body=await input(),before=await effects(),pause=control.pauseAt(writerFirst?'source':'final');
  const operation=call(path,a.checker,body);await pause.reached;
  const writer=kind==='criteria'?changeCriteria():changeActivation();
  try{
   if(writerFirst){await writer;pause.release();assert.equal((await operation).status,409);assert.deepEqual(await effects(),before);}
   else {await until(async()=>(await a.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).rowCount>0);pause.release();const result=await operation;assert(result.status<300,JSON.stringify(result));await writer;const old=await ok('/api/opportunities/prequalifications/'+result.value.evaluationId,a.checker);assert.equal(old.freshness,'REVIEW_REQUIRED');assert.equal((await call('/api/opportunities/prequalifications/'+result.value.evaluationId+'/decisions',a.checker,{decision:'KEEP_UNDER_REVIEW',reasonCode:'FURTHER_REVIEW',justification:'Stale decision must refuse',criterionIds:[],expectedDecisionId:null,expectedGeneration:0,idempotencyKey:id()})).status,409);}
  }finally{pause.release();}
  console.log('PQ1_INPUT_RACE_'+kind+'_'+(writerFirst?'FIRST':'AFTER')+' PASS');
 }
}
module.exports={run};
