'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {args,acceptableWork,duringPause,validGate,release}=require('../scripts/opportunity-v2-window.cjs');
const idle=()=>({central:{funding:0,execution:0,inbox:0,outbox:0,published:0,admissionCompletion:0,admissionIdentity:0,onboarding:0,members:0},tenant:{inbox:0,outbox:0,published:0}});
test('11145 window refuses application modes, alternate targets and pending work',()=>{
 args(['--prepare-window']);for(const input of [[],['--apply'],['--prepare-window','--host=other']])assert.throws(()=>args(input));
 assert.equal(acceptableWork(idle()),true);
 for(const scope of ['central','tenant'])for(const key of Object.keys(idle()[scope]))for(const value of [1,-1,'0',null]){const counts=idle();counts[scope][key]=value;assert.equal(acceptableWork(counts),false);}
 for(const scope of ['central','tenant']){const counts=idle();delete counts[scope];assert.equal(acceptableWork(counts),false);}
 assert.equal(acceptableWork({...idle(),extra:0}),false);
});

test('all locked clients are rolled back and released before resume even when cleanup fails',async()=>{
 const calls=[],firstError=Error('rollback failed');
 const clients=[{query:async()=>{calls.push('rollback1');throw firstError;},release:error=>{assert.equal(error,firstError);calls.push('discard1');}},
  {query:async()=>{calls.push('rollback2');},release:()=>calls.push('release2')}];
 await assert.rejects(duringPause({pause:async()=>{},perform:()=>release(clients),resume:async()=>calls.push('resume')}),AggregateError);
 assert.deepEqual(calls,['rollback1','discard1','rollback2','release2','resume']);
});
test('preparation always resumes after partial stop or backup failure',async()=>{
 for(const failure of [null,'pause','perform']){const calls=[],step=name=>async()=>{calls.push(name);if(failure===name)throw Error(name);};const value=duringPause({pause:step('pause'),perform:step('perform'),resume:step('resume')});if(failure)await assert.rejects(value);else await value;assert.deepEqual(calls,failure==='pause'?['pause','resume']:['pause','perform','resume']);}
});
test('window cannot report success after failed health recovery or an unvalidated package gate',async()=>{
 await assert.rejects(duringPause({pause:async()=>{},perform:async()=>{},resume:async()=>{throw Error('health');}}),/health/);
 const valid={gateType:'OPPORTUNITY_V2_REGISTERED_PACKAGE',status:'PASS',cleanup:true,habitualEnvironmentAccess:false,packageDigest:'a'.repeat(64),checks:[{name:'registered package',status:'PASS'}],inputHashes:{'scripts/opportunity-v2-window.cjs':'b'.repeat(64)}};assert.equal(validGate(valid),valid.packageDigest);
 for(const delta of [{status:'FAIL'},{cleanup:false},{habitualEnvironmentAccess:true},{packageDigest:null},{gateType:'OTHER'},{checks:[]},{checks:[{status:'FAIL'}]},{inputHashes:{}},{inputHashes:{'../outside':'a'.repeat(64)}},{inputHashes:{'input':'bad'}}])assert.throws(()=>validGate({...valid,...delta}));
});
