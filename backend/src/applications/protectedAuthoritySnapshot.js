'use strict';
const {fail}=require('./contracts');
// Constructed inside one tenant operation, never shared with guard preparation.
// A live prepared guard fences authority writers for this actor/organization.
function createProtectedAuthoritySnapshot({actor,data,withAuthority,assertCurrent,clock}){
 const identity=JSON.stringify(actor);let pending;
 function assertActor(value){assertCurrent();if(JSON.stringify(value)!==identity)fail('SERVICE_UNAVAILABLE')}
 function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
 async function load(value){
  assertActor(value);
  pending ||= withAuthority(async()=>{
   assertActor(value);
   const membership=await data.membershipPort.revalidate(value);
   const snapshot=membership?.status==='ACTIVE'?await data.authorizationDataPort.load(value):null;
   assertActor(value);
   return freeze(structuredClone({membership,snapshot}));
  });
  const result=await pending;assertActor(value);
  if(result.membership&&!(result.membership.validUntil>clock.now().getTime()))fail('SERVICE_UNAVAILABLE');
  return result;
 }
 return Object.freeze({
  membershipPort:Object.freeze({async revalidate(value){return (await load(value)).membership}}),
  authorizationDataPort:Object.freeze({async load(value){return (await load(value)).snapshot}})
 });
}
module.exports={createProtectedAuthoritySnapshot};
