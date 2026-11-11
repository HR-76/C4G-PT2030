"use strict";
const {randomUUID}=require('node:crypto');
const {event}=require('./contracts');
const {createEnvelope}=require('../../async/envelope');
const {StatusOutbox}=require('./outbox');
// No production switch: only an explicitly isolated composition may record jobs.
function createProducer({mode='disabled',isolated=false,capture,clock=()=>new Date(),outbox=new StatusOutbox()}={}){
 if(mode==='disabled')return async()=>{};
 if(mode!=='isolated'||isolated!==true||typeof capture!=='function')throw new TypeError('STATUS_EMAIL_PRODUCER_DISABLED');
 return async function record(client,change){
  if(change.kind!=='TRANSITION')return;
  const raw=await capture(client,change),snapshot=event(raw),app=change.application;
  if(snapshot.organizationId!==app.organization_id||snapshot.applicationId!==app.application_id||snapshot.revision!==Number(change.revision)||snapshot.fromStatus!==change.fromStatus||snapshot.toStatus!==app.status||snapshot.title!==app.title)throw new Error('STATUS_EMAIL_CONTEXT_CONFLICT');
  const eventId=randomUUID();
  // No ON CONFLICT suppression: a duplicate outside the receipt path is an error.
  await client.query('INSERT INTO opportunity_catalog.application_status_event(organization_id,event_id,application_id,revision,snapshot) VALUES($1,$2,$3,$4,$5::jsonb)',[snapshot.organizationId,eventId,snapshot.applicationId,snapshot.revision,JSON.stringify(snapshot)]);
  for(const membershipId of snapshot.candidateMembershipIds){
   const deliveryId=randomUUID();
   await client.query('INSERT INTO opportunity_catalog.application_status_delivery(organization_id,delivery_id,event_id,membership_id) VALUES($1,$2,$3,$4)',[snapshot.organizationId,deliveryId,eventId,membershipId]);
   const {envelope}=createEnvelope({trustedContext:{organizationId:snapshot.organizationId,actor:{kind:'SERVICE',serviceActorCode:'APPLICATION_STATUS_NOTIFY'},operation:'application.status.notify',correlationId:eventId,causationId:eventId},job:{type:'application.status.notify',version:1,payloadVersion:1,idempotencyKey:deliveryId},payload:{deliveryId},registry:{supports:(t,v,p)=>t==='application.status.notify'&&v===1&&p===1},clock});
   await outbox.enqueue(client,{organizationId:snapshot.organizationId,logicalId:deliveryId,envelope});
  }
 };
}
module.exports={createProducer};
