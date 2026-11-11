'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseArgs,stagePlan,stageBudgetMs,validateReadinessProof,cleanEnvironment,cleanupAll,runSequentialStages}=require('./integration/central-snapshot-ab/run.cjs');
test('execution is explicitly isolated and measurement requires matching proof',()=>{
  assert.throws(()=>parseArgs([]));
  assert.throws(()=>parseArgs(['--isolated','--measure-http','--manifest','ab.json','--tls-dir','tls']));
  const x=parseArgs(['--isolated','--readiness','--manifest','ab.json','--tls-dir','tls']);assert.equal(x.mode,'readiness');
  assert.throws(()=>parseArgs(['--isolated','--readiness','--manifest','ab.json','--tls-dir','tls','--force']));
});
test('M uses two separate revisions and six pairs are delegated to the common collector',()=>{
  assert.deepEqual(stagePlan('measure-metadata'),[{revision:'043',arm:'AB',kind:'metadata'},{revision:'042',arm:'AB',kind:'metadata'}]);
});
test('H preserves AB BA AB BA, a fresh fixture per arm, and unchanged budgets',()=>{
  const p=stagePlan('measure-http');assert.equal(p.length,8);
  assert.deepEqual(p.map(x=>x.arm),['A','B','B','A','A','B','B','A']);
  assert.deepEqual(p.map(x=>x.pairIndex),[0,0,1,1,2,2,3,3]);
  assert(p.every(x=>x.revision==='043'&&x.kind==='http'));
  assert.equal(stageBudgetMs({kind:'http'}),300000+7*180000+120000+90000);
});
test('readiness must include both equivalence revisions and real HTTP for both arms',()=>{
  const identity={id:'ab-id',sourceSetDigest:'d',manifestSha256:'m',harnessDigest:'h',variants:{A:{sourceSetDigest:'a'},B:{sourceSetDigest:'b'}}};
  const proof={status:'PASS',mode:'readiness',abId:'ab-id',sourceSetDigest:'d',manifestSha256:'m',harnessDigest:'h',variantDigests:{A:'a',B:'b'},seedDigest:'seed',images:{p:'image'},cleanup:true,sourceIntegrityAfter:'PASS',stages:stagePlan('readiness').map((stage,index)=>({...stage,index,status:'PASS',cleanup:{status:'PASS'},childCleanup:{exitVerified:true},result:{...stage,index,mode:'readiness',status:'PASS',cleanup:true,sourceIntegrityAfter:'PASS',equivalence:{status:'PASS'},httpReadiness:{status:'PASS'}}}))};
  assert.equal(validateReadinessProof(proof,identity,'seed',{p:'image'}),true);
  for(const mutate of [p=>p.stages.pop(),p=>p.variantDigests.B='other',p=>p.stages[2].result.httpReadiness.status='FAIL',p=>p.stages[0].result.equivalence.status='FAIL',p=>p.stages[0].childCleanup.exitVerified=false]){const bad=structuredClone(proof);mutate(bad);assert.throws(()=>validateReadinessProof(bad,identity,'seed',{p:'image'}));}
  for(const mutate of [p=>p.stages[1].result=structuredClone(p.stages[0].result),p=>p.stages[3].result=structuredClone(p.stages[2].result),p=>p.stages[0].result.mode='equivalence']){const bad=structuredClone(proof);mutate(bad);assert.throws(()=>validateReadinessProof(bad,identity,'seed',{p:'image'}),'cross-stage result substitution must be refused');}
});
test('child environment excludes test database opt-ins and Node preloads',()=>{
  const original={PATH:'safe',NODE_OPTIONS:'preload',NODE_PATH:'other',F7_CENTRAL_DATABASE_URL:'hidden',C4G_HTTP_SQL_TEST:'1'};
  const env=cleanEnvironment(original,{EU_TRIAL_RUN:'run'});assert.equal(env.PATH,'safe');assert.equal(env.EU_TRIAL_RUN,'run');assert.equal(env.TZ,'UTC');
  for(const k of ['NODE_OPTIONS','NODE_PATH','F7_CENTRAL_DATABASE_URL','C4G_HTTP_SQL_TEST'])assert.equal(Object.hasOwn(env,k),false);
  assert.equal(original.NODE_OPTIONS,'preload');
});
test('cleanup tries all actions after failures and an expired cooperative budget',async()=>{
  const visited=[];const errors=await cleanupAll([async()=>{visited.push(1);throw Error('FAILED');},async()=>{visited.push(2);},async()=>{visited.push(3);}],{check(){throw Object.assign(Error('EXPIRED'),{code:'EXPIRED'});}});
  assert.deepEqual(visited,[1,2,3]);assert(errors.length>=3);
});
test('failed cleanup prevents creating the next arm fixture',async()=>{
  const report={cleanup:true,stages:[]};let createLabCalls=0;
  await assert.rejects(runSequentialStages(stagePlan('measure-http'),report,async()=>{createLabCalls++;report.cleanup=false;}),/AB_PREVIOUS_CLEANUP_FAILED/);
  assert.equal(createLabCalls,1);
});
