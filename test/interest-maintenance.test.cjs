'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {args,acceptableWork,duringPause}=require('../scripts/interest-maintenance.cjs');
test('maintenance refuses alternate modes and active or malformed work counts',()=>{
 args(['--renew-backups']);for(const input of [[],['--apply'],['--renew-backups','--host=other']])assert.throws(()=>args(input));
 assert.equal(acceptableWork({funding:0,execution:0,inbox:0,outbox:0}),true);
 assert.equal(acceptableWork({}),false);
 for(const value of [1,-1,null,'0'])assert.equal(acceptableWork({funding:value}),false);
});
test('maintenance resumes after success and every failure, including partial stop',async()=>{
 for(const failure of [null,'pause','perform']){
  const calls=[],step=name=>async()=>{calls.push(name);if(name===failure)throw Error(name)};
  const promise=duringPause({pause:step('pause'),perform:step('perform'),resume:step('resume')});
  if(failure)await assert.rejects(promise);else await promise;
  assert.deepEqual(calls,failure==='pause'?['pause','resume']:['pause','perform','resume']);
 }
});
test('a failed service resumption never reports success',async()=>{
 await assert.rejects(duringPause({pause:async()=>{},perform:async()=>{},resume:async()=>{throw Error('NOT_READY')}}),/NOT_READY/);
});
