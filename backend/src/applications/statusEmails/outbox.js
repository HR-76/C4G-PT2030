"use strict";
const {randomUUID}=require('node:crypto');
const {validateEnvelope}=require('../../async/envelope');
class StatusOutbox {
 async enqueue(client,{organizationId,logicalId,envelope}){
 const checked=validateEnvelope(envelope,{supports:(t,v,p)=>t==='application.status.notify'&&v===1&&p===1});
 if(envelope.organizationId!==organizationId||envelope.payload.deliveryId!==logicalId)throw Error('STATUS_OUTBOX_CONTEXT_DENIED');
 const result=await client.query('SELECT opportunity_catalog.enqueue_status_delivery($1,$2,$3,$4::jsonb,$5,$6) AS id',[organizationId,logicalId,randomUUID(),JSON.stringify(checked.envelope),checked.contentDigest,envelope.createdAt]);
 return result.rows[0].id;
 }
}
module.exports={StatusOutbox};
