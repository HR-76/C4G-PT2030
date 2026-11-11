'use strict';
const assert=require('node:assert/strict'),{randomUUID:id}=require('node:crypto');
async function run({databases,central,ok,root}){
 const db=databases[0],f=await require('./pq1-consumer-fixture').create(db),p=await ok(root+'/preview',db.checker,{versionId:f.versionId});
 const active=await ok(root+'/activate',db.checker,{versionId:f.versionId,previewToken:p.concurrencyToken,expectedActivationId:p.expectedActivationId,expectedGeneration:p.expectedGeneration,reason:'Unknown is an admissible current partial result',idempotencyKey:id()});
 central.temporalClock.set(Date.parse(f.validUntil));
 try{
  const result=await ok('/api/opportunities/'+f.opportunityId+'/prequalifications',db.checker,{opportunityRevisionId:f.opportunityRevisionId,criteriaRevisionId:f.criteriaRevisionId,activationId:active.activationId,generation:active.generation,idempotencyKey:id()});
  const path='/api/opportunities/prequalifications/'+result.evaluationId,view=await ok(path,db.checker);
  assert.equal(view.freshness,'CURRENT');assert.equal(view.result.lines[0].result,'UNKNOWN');assert.equal(view.result.lines[0].reason,'VERIFICATION_EXPIRED');assert(view.result.lines[0].verificationIds.includes(f.verificationId));
  const key=id(),decision=await ok(path+'/decisions',db.checker,{decision:'REQUEST_INFORMATION',reasonCode:'INFORMATION_MISSING',justification:'Local need for current evidence',criterionIds:[f.criterionId],expectedDecisionId:null,expectedGeneration:0,idempotencyKey:key});
  const history=await ok(path+'/decisions',db.checker);assert.equal(history.items.length,1);assert.equal(history.items[0].evaluationId,result.evaluationId);assert.equal(history.canDecide,true);
  const recovered=await ok(root+'/intentions/lookup',db.checker,{operation:'PQ1_DECIDE',resourceId:result.evaluationId,idempotencyKey:key});assert.equal(recovered.status,'CONFIRMED');assert.deepEqual(recovered.receipt,decision);
  assert.deepEqual((await ok(path,db.checker)).result,view.result);
  console.log('PQ1_EXPIRED_EVIDENCE_UNKNOWN_CURRENT_HUMAN_DECISION_LOOKUP PASS');
 }finally{central.temporalClock.set(null);}
}
module.exports={run};
