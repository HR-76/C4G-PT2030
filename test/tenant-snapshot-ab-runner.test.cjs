'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {stagePlan,stageBudgetMs,validateReadinessProof,runSequentialStages,parseArgs,assertReadinessObservation,safeAssertion}=require('./integration/tenant-snapshot-ab/run.cjs');
function observation(){return {schemaVersion:1,observerErrors:[],attempts:Array.from({length:17},(_,index)=>({index,resolved:true,status:index<6||index===6||index===8?200:index===7||index===9?400:index<14?403:401,ms:1})),drains:Array.from({length:9},(_,index)=>({index,resolved:true,limitMs:30000,ms:1}))};}
test('M measures the two tenant034 populations in one043 fixture and retains each block budget',()=>{
  assert.deepEqual(stagePlan('measure-metadata'),[{revision:'043',arm:'AB',kind:'metadata'}]);
  assert.equal(stageBudgetMs(stagePlan('measure-metadata')[0]),300000+25*300000+120000+90000);
});
test('readiness requires tenant equivalence as well as independent Central and HTTP evidence',()=>{
  const identity={id:'ab',sourceSetDigest:'set',manifestSha256:'manifest',harnessDigest:'harness',variants:{A:{sourceSetDigest:'a'},B:{sourceSetDigest:'b'}}};
  const proof={status:'PASS',mode:'readiness',abId:'ab',sourceSetDigest:'set',manifestSha256:'manifest',harnessDigest:'harness',variantDigests:{A:'a',B:'b'},seedDigest:'seed',images:{pg:'pin'},cleanup:true,sourceIntegrityAfter:'PASS',stages:stagePlan('readiness').map((s,index)=>({...s,index,status:'PASS',cleanup:{status:'PASS'},childCleanup:{exitVerified:true},result:{...s,index,mode:'readiness',status:'PASS',cleanup:true,sourceIntegrityAfter:'PASS',equivalence:{status:'PASS'},tenantEquivalence:{status:'PASS'},httpReadiness:{status:'PASS'},httpReadinessObserved:observation()}}))};
  assert.equal(validateReadinessProof(proof,identity,'seed',{pg:'pin'}),true);
  for(const mutation of [p=>delete p.stages[0].result.tenantEquivalence,p=>p.stages[1].result.tenantEquivalence.status='FAIL',p=>p.variantDigests.A='old-baseline',p=>p.stages[1].result=structuredClone(p.stages[0].result),p=>p.stages[3].result.httpReadiness.status='FAIL',p=>delete p.stages[3].result.httpReadinessObserved]){
    const bad=structuredClone(proof);mutation(bad);assert.throws(()=>validateReadinessProof(bad,identity,'seed',{pg:'pin'}));
  }
});
test('H retains all eight ordered arms and readiness failure cannot be bypassed by another mode',()=>{
  assert.deepEqual(stagePlan('measure-http').map(x=>x.arm),['A','B','B','A','A','B','B','A']);
  assert.throws(()=>parseArgs(['--isolated','--measure-http','--manifest','ab.json','--tls-dir','tls']));
  assert.throws(()=>parseArgs(['--isolated','--measure-http','--readiness','--manifest','ab.json','--tls-dir','tls']));
});
test('failed cleanup prevents the next owned fixture',async()=>{
  const report={cleanup:true};let calls=0;
  await assert.rejects(runSequentialStages(stagePlan('measure-http'),report,async()=>{calls++;report.cleanup=false;}),/AB_PREVIOUS_CLEANUP_FAILED/);
  assert.equal(calls,1);
});

test('readiness evidence keeps every control attempt and drain before accepting a measurement proof',()=>{
 assert.equal(typeof assertReadinessObservation,'function');assert.equal(assertReadinessObservation(observation()),true);
 for(const change of [x=>x.attempts.pop(),x=>x.attempts[5].status=503,x=>x.attempts[5].resolved=false,x=>x.drains.pop(),x=>x.drains[0].limitMs=60000,x=>x.attempts[2].ms=NaN,x=>x.observerErrors.push({code:'OBSERVED_ERROR'})]){const bad=observation();change(bad);assert.throws(()=>assertReadinessObservation(bad));}
});
test('assertion diagnostics retain finite scalar comparisons without payload strings or objects',()=>{
 assert.equal(typeof safeAssertion,'function');assert.deepEqual(safeAssertion({actual:503,expected:200,operator:'strictEqual'}),{actual:503,expected:200,operator:'strictEqual'});
 assert.deepEqual(safeAssertion({actual:'secret token',expected:{private:'payload'},operator:'private details'}),{});
 assert.deepEqual(safeAssertion({actual:NaN,expected:false,operator:'deepStrictEqual'}),{expected:false,operator:'deepStrictEqual'});
});
