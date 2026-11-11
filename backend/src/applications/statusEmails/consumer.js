"use strict";
const {id,payload}=require('./contracts');
const {selectRecipients}=require('./recipients');
const {render}=require('./template');
const {isSimulatedTransport}=require('./transport');
const {createJobRegistry}=require('../../async/jobRegistry');
const {result}=require('../../async/jobResult');
function createSimulatedConsumer({isolated=false,organizationId,store,resolve,transport,publicOrigin,now=()=>new Date()}){
 const org=id(organizationId);
 if(isolated!==true||!isSimulatedTransport(transport)||typeof resolve!=='function'||!store)throw TypeError('SIMULATED_CONSUMER_REQUIRED');
 async function handler(job){
  if(job.organizationId!==org||job.jobType!=='application.status.notify'||job.jobVersion!==1||job.payloadVersion!==1||job.operation!=='application.status.notify'||job.actor?.kind!=='SERVICE'||job.actor.serviceActorCode!=='APPLICATION_STATUS_NOTIFY')return result('AUTHORIZATION_REVOKED');
  const {deliveryId}=payload(job.payload);
  const current=await store.load(org,deliveryId);if(!current)return result('PERMANENT','DELIVERY_NOT_FOUND');
  if(['ACCEPTED','SKIPPED','FAILED'].includes(current.state))return result('SUCCESS');
  const selection=await selectRecipients(current.snapshot,{resolve,now});
  if(selection.status!=='READY')return result('RETRYABLE','AUTHORITY_UNAVAILABLE');
  const recipient=selection.recipients.find(r=>r.membershipId===current.membershipId);
  if(!recipient){
   // Never erase uncertainty from a previous attempt after revocation.
   if(current.attempted)return result('PERMANENT','RECONCILIATION_REQUIRED');
   await store.skip(org,deliveryId,selection.decisions.find(d=>d.membershipId===current.membershipId)?.reason||'INELIGIBLE');return result('SUCCESS');
  }
  const template=render(current.snapshot,{publicOrigin});
  const message={to:recipient.email,subject:template.subject,html:template.html,text:template.text};
  const reserved=await store.reserve(org,deliveryId,message,now());
  if(reserved.status==='TERMINAL')return result('SUCCESS');
  if(reserved.status==='HOLD')return result('PERMANENT','RECONCILIATION_REQUIRED');
  if(reserved.status!=='RESERVED')return result('RETRYABLE','DELIVERY_BUSY');
  // Recheck after reservation, immediately before simulated irreversible effect.
  const fresh=await selectRecipients(current.snapshot,{resolve,now});
  const allowed=fresh.recipients.find(r=>r.membershipId===current.membershipId);
  if(fresh.status!=='READY'||!allowed||allowed.email!==message.to||job.signal?.aborted){
   await store.finish(org,deliveryId,reserved.fence,'UNKNOWN','AUTHORITY_CHANGED');
   return result('RETRYABLE','AUTHORITY_CHANGED');
  }
  if(typeof job.assertFence==='function')await job.assertFence();
  let sent;try{sent=await transport.send(reserved.message,`${org}/${deliveryId}`,job.signal);}catch{sent={status:'UNKNOWN'};}
  const state=sent.status==='ACCEPTED'?'ACCEPTED':sent.status==='PERMANENT_REJECTED'?'FAILED':'UNKNOWN';
  const saved=await store.finish(org,deliveryId,reserved.fence,state,sent.reason||sent.status);
  if(!saved)return result('RETRYABLE','STALE_DELIVERY_FENCE');
  return state==='UNKNOWN'?result('RETRYABLE','DELIVERY_UNCERTAIN'):result('SUCCESS');
 }
 const registry=createJobRegistry([{type:'application.status.notify',version:1,payloadVersion:1,handler}]);
 return Object.freeze({handler,registry});
}
module.exports={createSimulatedConsumer};
