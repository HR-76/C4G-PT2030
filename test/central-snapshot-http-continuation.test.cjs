'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PINS,fullPlan,remainingPlan,validateFailedParent,classifyCompletedStage,continueStages,claimOnce,parseArgs}=require('../scripts/continue-central-snapshot-ab-http.cjs');
const identity={id:PINS.id,sourceSetDigest:'sources',manifestSha256:PINS.manifestSha256,harnessDigest:'harness',variants:{A:{sourceSetDigest:'a'},B:{sourceSetDigest:'b'}},protocol:{seedDigest:'seed',images:{test:'image'}}};
function bindings(){return{abId:identity.id,sourceSetDigest:'sources',manifestSha256:PINS.manifestSha256,harnessDigest:'harness',variantDigests:{A:'a',B:'b'},seedDigest:'seed'};}
function entry(index,status='PASS'){
  const stage=fullPlan()[index],partial=status==='FAIL',result={...stage,...bindings(),index,mode:'measure-http',status,cleanup:true,sourceIntegrityAfter:'PASS',httpReadiness:{status:'PASS'},http:{status,attempts:Array.from({length:partial?28:36},()=>({status:200})),warmups:Array.from({length:partial?6:7},()=>({status:200})),scenarios:[]}};
  if(partial)result.http.warmups[5]={replica:index,scenario:'dashboard-c4-two-tenants',tenant:0,status:503,code:'SERVICE_UNAVAILABLE'};
  return {...stage,index,status,result,...(partial?{processFailure:{code:'FUNCTIONAL_CHILD_FAILED'}}:{}),childCleanup:{terminated:false,exitVerified:true},cleanup:{status:'PASS',resources:[{removed:true},{removed:true}]}};
}
function parent(){return{...bindings(),mode:'measure-http',status:'FAIL',cleanup:true,sourceIntegrityAfter:'PASS',images:identity.protocol.images,stages:[0,1,2,3,4].map(i=>entry(i,i===4?'FAIL':'PASS'))};}
test('continuation can only plan the untouched original stages 5B,6B,7A',()=>{
  const source=parent();assert.equal(validateFailedParent(source,identity),true);
  assert.deepEqual(remainingPlan().map(s=>[s.index,s.arm]),[[5,'B'],[6,'B'],[7,'A']]);
  for(const mutate of [p=>p.status='PASS',p=>p.stages.pop(),p=>p.stages[4].index=5,p=>p.stages[4].result.arm='B',p=>p.stages[4].result.http.warmups[5].status=200,p=>p.cleanup=false]){const bad=structuredClone(source);mutate(bad);assert.throws(()=>validateFailedParent(bad,identity));}
});
test('a completed HTTP failure is eligible only after child exit and owned cleanup',()=>{
  const failed=entry(5,'FAIL');assert.equal(classifyCompletedStage(failed,identity),'WORKLOAD_FAIL');
  for(const mutate of [s=>s.cleanup.status='FAIL',s=>s.cleanup.resources[0].removed=false,s=>s.childCleanup.exitVerified=false,s=>s.childCleanup.terminated=true,s=>s.result.cleanup=false,s=>s.result.sourceIntegrityAfter='FAIL',s=>s.result.httpReadiness.status='FAIL',s=>delete s.result.http]){const bad=structuredClone(failed);mutate(bad);assert.throws(()=>classifyCompletedStage(bad,identity));}
});
test('a PASS report cannot hide a failed child process or orchestration failure',()=>{
  for(const field of ['processFailure','failure']){const broken=entry(5);broken[field]={code:'FUNCTIONAL_CHILD_FAILED'};assert.throws(()=>classifyCompletedStage(broken,identity));}
  const failed=entry(5,'FAIL');failed.processFailure={code:'UNEXPECTED_PROCESS_FAILURE'};assert.throws(()=>classifyCompletedStage(failed,identity));
  const crashed=entry(5,'FAIL');crashed.failure={code:'UNEXPECTED_ORCHESTRATION_FAILURE'};assert.throws(()=>classifyCompletedStage(crashed,identity));
});
test('safe workload failures retain FAIL and continue remaining stages without a retry',async()=>{
  const report={status:'FAIL',campaignStatus:'FAIL',campaignCompleteness:'INCOMPLETE',continuationStatus:'RUNNING',stages:[],cleanup:true},visited=[];
  await continueStages({report,identity,runStage:async stage=>{visited.push(stage.index);return entry(stage.index,stage.index===6?'FAIL':'PASS');}});
  assert.deepEqual(visited,[5,6,7]);assert.equal(report.status,'FAIL');assert.equal(report.campaignStatus,'FAIL');assert.equal(report.campaignCompleteness,'INCOMPLETE');assert.equal(report.continuationStatus,'COMPLETED');
  assert.deepEqual(report.workloadFailureIndices,[6]);assert.equal(report.stages[1].status,'FAIL');
});
test('cleanup or setup failures stop before the next createLab',async()=>{
  for(const kind of ['cleanup','setup']){
    const report={status:'FAIL',stages:[],cleanup:true},visited=[];
    await assert.rejects(continueStages({report,identity,runStage:async stage=>{visited.push(stage.index);const x=entry(stage.index);if(kind==='cleanup')x.cleanup.status='FAIL';else delete x.result.httpReadiness;return x;}}));
    assert.deepEqual(visited,[5]);assert.equal(report.status,'FAIL');assert.equal(report.continuationStatus,'STOPPED');
  }
});
test('an atomic claim refuses a second invocation for the failed source report',t=>{
  const root=fs.mkdtempSync(path.join(__dirname,'.continuation-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'evidence'));
  const file=claimOnce(root,PINS.failedSha256,{runId:'first'}),before=fs.readFileSync(file);
  assert.throws(()=>claimOnce(root,PINS.failedSha256,{runId:'second'}));assert.deepEqual(fs.readFileSync(file),before);
});
test('CLI requires explicit continuation and the approved script hash, with no stage override',()=>{
  const args=['--isolated','--continue-http','--manifest','ab.json','--tls-dir','tls','--readiness-report','ready.json','--failed-report','fail.json','--source-sha','a'.repeat(64)];
  assert.equal(parseArgs(args)['source-sha'],'a'.repeat(64));assert.throws(()=>parseArgs(args.slice(0,-2)));assert.throws(()=>parseArgs([...args,'--start-index','4']));
});
