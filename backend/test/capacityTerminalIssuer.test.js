'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createCapacityTerminalIssuer}=require('../src/async/capacityTerminalIssuer');
const binding=Object.freeze({organizationId:'11111111-1111-4111-8111-111111111111',tenantId:'22222222-2222-4222-8222-222222222222',databaseGenerationId:'33333333-3333-4333-8333-333333333333',rootExecutionId:'44444444-4444-4444-8444-444444444444',executionId:'55555555-5555-4555-8555-555555555555',jobType:'document.scan',generation:2,authorityEpoch:3,contentDigest:'a'.repeat(64),bindingDigest:'b'.repeat(64)});
const target=Object.freeze({organizationId:binding.organizationId,rootExecutionId:binding.rootExecutionId});
function setup({observation={...binding,outcome:'SUCCESS'},failAt=0,falseAt=0,appendStatus='APPENDED',reservation=binding}={}){
 const calls=[];let checks=0;
 const authority={async withReservationGuard(input,work){calls.push('lock');assert.deepEqual(input,target);return work({reservation,async assertCurrent(){calls.push('validate');checks++;if(checks===failAt)throw Error('stale');return checks!==falseAt;},async append(evidence){calls.push('append');assert.deepEqual(evidence,observation);return {status:appendStatus};}});}};
 const tenant={async observeVerified(input){calls.push('tenant');assert.deepEqual(input,binding);return observation;}};
 return {issuer:createCapacityTerminalIssuer({authority,tenant}),calls};
}
test('records only after locked authority, verified tenant read and authority revalidation',async()=>{
 const {issuer,calls}=setup();assert.deepEqual(await issuer.issue(target),{status:'RECORDED'});
 assert.deepEqual(calls,['lock','validate','tenant','validate','append']);
});
test('does not append on stale authority, mismatched observation or wrong reservation',async()=>{
 for(const options of [{failAt:1},{failAt:2},{falseAt:1},{falseAt:2},{observation:{...binding,authorityEpoch:4,outcome:'SUCCESS'}},{reservation:{...binding,organizationId:'66666666-6666-4666-8666-666666666666'}}]){
  const {issuer,calls}=setup(options);await assert.rejects(issuer.issue(target),/CAPACITY_TERMINAL_UNAVAILABLE/);assert.equal(calls.includes('append'),false);
 }
});
test('refuses caller-supplied proof and incomplete trusted ports',async()=>{
 const {issuer,calls}=setup();await assert.rejects(issuer.issue({...target,outcome:'SUCCESS'}),/CAPACITY_TERMINAL_INPUT_INVALID/);assert.deepEqual(calls,[]);
 assert.throws(()=>createCapacityTerminalIssuer({authority:{},tenant:{}}),TypeError);
 let accessed=false;const bad={rootExecutionId:target.rootExecutionId};Object.defineProperty(bad,'organizationId',{enumerable:true,get(){accessed=true;return target.organizationId;}});
 await assert.rejects(issuer.issue(bad),/CAPACITY_TERMINAL_INPUT_INVALID/);assert.equal(accessed,false);
});
test('does not report success if the authority transaction fails after append',async()=>{
 const calls=[];
 const authority={async withReservationGuard(_input,work){await work({reservation:binding,async assertCurrent(){return true;},async append(){calls.push('append');return {status:'APPENDED'};}});throw Error('commit unconfirmed');}};
 const tenant={async observeVerified(){return {...binding,outcome:'SUCCESS'};}};
 await assert.rejects(createCapacityTerminalIssuer({authority,tenant}).issue(target),/CAPACITY_TERMINAL_UNAVAILABLE/);
 assert.deepEqual(calls,['append']);
});
test('does not report success if the evidence port does not confirm storage',async()=>{
 const {issuer}=setup({appendStatus:'UNKNOWN'});await assert.rejects(issuer.issue(target),/CAPACITY_TERMINAL_UNAVAILABLE/);
});
test('an idempotent duplicate must return the same bound terminal evidence',async()=>{
 for(const mismatch of [false,true]){
  const authority={async withReservationGuard(_input,work){return work({reservation:binding,async assertCurrent(){return true;},async append(){return {status:'DUPLICATE',evidence:{...binding,executionId:mismatch?'66666666-6666-4666-8666-666666666666':binding.executionId,outcome:'SUCCESS'}};}});}};
  const tenant={async observeVerified(){return {...binding,outcome:'SUCCESS'};}};
  const result=createCapacityTerminalIssuer({authority,tenant}).issue(target);
  if(mismatch)await assert.rejects(result,/CAPACITY_TERMINAL_UNAVAILABLE/);else assert.deepEqual(await result,{status:'RECORDED'});
 }
});
