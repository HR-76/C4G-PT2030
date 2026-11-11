'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {args,installationPause,validateInstallerProof,applyConfiguration,assertBackupBoundary}=require('../scripts/opportunity-v2-execute-window.cjs');
test('habitual window requires explicit closed invocation',()=>{args(['--execute-window']);for(const a of [[],['--prepare-window'],['--execute-window','--force'],['--execute-window','--database=other']])assert.throws(()=>args(a));});
test('continuous pause resumes on pre-install failure and holds after any unverified installation',async()=>{
 for(const failure of [null,'pause','backup','sql','configuration','health']){
  const calls=[];let held=false;
  const run=installationPause({pause:async()=>{calls.push('pause');if(failure==='pause')throw Error('pause');},perform:async lifecycle=>{calls.push('backup');if(failure==='backup')throw Error('backup');lifecycle.installing();calls.push('sql');if(failure==='sql')throw Error('sql');calls.push('configuration');if(failure==='configuration')throw Error('configuration');lifecycle.ready();},resume:async()=>{calls.push('resume');if(failure==='health')throw Error('health');},hold:()=>{held=true;calls.push('held');}});
  if(failure)await assert.rejects(run);else await run;
  assert.equal(held,['sql','configuration'].includes(failure));
  if(!failure)assert.deepEqual(calls,['pause','backup','sql','configuration','resume']);
  if(['pause','backup'].includes(failure))assert.equal(calls.at(-1),'resume');
 }
});
test('installer proof is closed to completed isolated gate with exact pinned operational inputs',()=>{
 const g={gateType:'OPPORTUNITY_V2_HABITUAL_INSTALLER',status:'PASS',isolated:true,cleanup:true,habitualEnvironmentAccess:false,packageDigest:'a'.repeat(64),checks:[{name:'test',status:'PASS'}],inputHashes:Object.fromEntries(['scripts/opportunity-v2-install.cjs','scripts/opportunity-v2-execute-window.cjs','scripts/opportunity-v2-approve.cjs','backend/scripts/localPlatform/runtime.js','backend/scripts/localPlatform/opportunityV2Runtime.js'].map(x=>[x,'b'.repeat(64)]))};
 assert.equal(validateInstallerProof(g,'a'.repeat(64)),g);
 for(const d of [{status:'RUNNING'},{isolated:false},{cleanup:false},{habitualEnvironmentAccess:true},{gateType:'OTHER'},{checks:[]},{packageDigest:'c'.repeat(64)},{inputHashes:{}}])assert.throws(()=>validateInstallerProof({...g,...d},'a'.repeat(64)));
});
test('configuration writes only exact planned paths after all current bytes match',()=>{
 const seen=[],input=[{relative:'.tmp/local-platform/runtime.json',before:'old',value:{safe:true}},{relative:'.tmp/local-platform/members/worker.json',before:'other',value:{bindings:[]}}];
 const read=file=>file.endsWith('runtime.json')?'old':'other';
 applyConfiguration(input,{read,save:(file,value)=>seen.push([file,value])});assert.equal(seen.length,2);
 assert.throws(()=>applyConfiguration(input,{read:()=> 'drift',save:()=>{throw Error('must not write');}}),/CONFIGURATION_DRIFT/);
 assert.throws(()=>applyConfiguration([...input,{relative:'backend/.env',before:'x',value:{}}],{read,save:()=>{}}));
});
test('installation boundary refuses data/config drift or external sessions since the restored backup',()=>{
 const proof={central:'a',tenant:'b',configuration:{runtime:'c'},externalSessions:0},actual=structuredClone(proof);
 assertBackupBoundary(proof,actual);
 for(const delta of [{central:'drift'},{tenant:'drift'},{configuration:{runtime:'changed'}},{externalSessions:1}])assert.throws(()=>assertBackupBoundary(proof,{...actual,...delta}));
});
