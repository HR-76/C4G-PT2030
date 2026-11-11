'use strict';
const {types:{isProxy}}=require('node:util');
const {matchesTerminalBinding}=require('./capacityTerminalBinding');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BINDING_KEYS=Object.freeze(['organizationId','tenantId','databaseGenerationId','rootExecutionId','executionId','jobType','generation','authorityEpoch','contentDigest','bindingDigest']);
function copyClosed(value,keys){
 if(!value||typeof value!=='object'||isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)return null;
 const descriptors=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(descriptors).length!==keys.length||keys.some(key=>!descriptors[key]?.enumerable||!Object.hasOwn(descriptors[key],'value')))return null;
 return Object.freeze(Object.fromEntries(keys.map(key=>[key,descriptors[key].value])));
}
function failure(code){return Object.assign(new Error(code),{code});}
// Candidate orchestration only. withReservationGuard must hold a real root lock
// through commit, assertCurrent must revalidate authority, and observeVerified
// must verify the physical tenant and read protected terminal evidence. These
// ports are not implemented or wired by this module.
function createCapacityTerminalIssuer({authority,tenant}={}){
 if(typeof authority?.withReservationGuard!=='function'||typeof tenant?.observeVerified!=='function')throw new TypeError('Capacity terminal issuer ports are required.');
 return Object.freeze({async issue(input){
  let target;
  try{target=copyClosed(input,['organizationId','rootExecutionId']);}catch{target=null;}
  if(!target||!UUID.test(target.organizationId||'')||!UUID.test(target.rootExecutionId||''))throw failure('CAPACITY_TERMINAL_INPUT_INVALID');
  let called=false,recorded=false;
  try{
   await authority.withReservationGuard(target,async guard=>{
    if(called)throw Error('GUARD_REUSED');called=true;
    if(!guard||typeof guard.assertCurrent!=='function'||typeof guard.append!=='function')throw Error('GUARD_INVALID');
    const expected=copyClosed(guard.reservation,BINDING_KEYS);
    if(!expected||expected.organizationId!==target.organizationId||expected.rootExecutionId!==target.rootExecutionId
       ||!matchesTerminalBinding(expected,Object.freeze({...expected,outcome:'SUCCESS'})))throw Error('RESERVATION_INVALID');
    if(await guard.assertCurrent()!==true)throw Error('AUTHORITY_NOT_CURRENT');
    const observed=copyClosed(await tenant.observeVerified(expected),[...BINDING_KEYS,'outcome']);
    if(!observed||!matchesTerminalBinding(expected,observed))throw Error('EVIDENCE_MISMATCH');
    if(await guard.assertCurrent()!==true)throw Error('AUTHORITY_NOT_CURRENT');
    const result=await guard.append(observed);
    if(!result||!(result.status==='APPENDED'||(result.status==='DUPLICATE'&&matchesTerminalBinding(expected,result.evidence))))throw Error('EVIDENCE_NOT_STORED');
    recorded=true;
   });
   if(!recorded)throw Error('GUARD_NOT_COMMITTED');
   return Object.freeze({status:'RECORDED'});
  }catch{throw failure('CAPACITY_TERMINAL_UNAVAILABLE');}
 }});
}
module.exports={createCapacityTerminalIssuer};
