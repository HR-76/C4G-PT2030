'use strict';
const crypto=require('node:crypto');
const {createEnvelopeV2,createTrustedObservability}=require('../async/envelope');
const {OutboxRepository}=require('../async/outboxRepository');
const {JOB_TYPE}=require('./jobs');

function createOpportunityImportF9JobPort({registry,outboxRepository=new OutboxRepository(),clock=()=>new Date(),id=crypto.randomUUID}){
 if(!registry||typeof registry.supports!=='function'||!registry.supports(JOB_TYPE,1,1)||!outboxRepository||typeof outboxRepository.enqueueLineage!=='function')throw new TypeError('Import F9 job port is invalid.');
 return Object.freeze({async enqueue(client,input){
  if(!client||!input||input.type!==JOB_TYPE)throw new TypeError('Import F9 enqueue is invalid.');
  const executionId=id();
  const validated=createEnvelopeV2({trustedContext:{organizationId:input.organizationId,actor:{kind:'HUMAN',id:input.actor.id,membershipId:input.actor.membershipId,membershipVersion:input.actor.membershipVersion},operation:'opportunity.import.confirm',correlationId:input.correlationId,causationId:input.correlationId},job:{type:JOB_TYPE,version:1,payloadVersion:1,idempotencyKey:input.idempotencyKey},payload:{importId:input.importId},registry,observability:createTrustedObservability({traceparent:null,tracestate:null}),clock,id:()=>executionId});
  return outboxRepository.enqueueLineage(client,{organizationId:input.organizationId,logicalId:input.idempotencyKey,envelope:validated.envelope,lineage:{deliveryKind:'INITIAL',attempt:1,rootExecutionId:executionId,previousExecutionId:null,contentDigest:validated.contentDigest,envelopeDigest:validated.envelopeDigest,replayRequestId:null}});
 }});
}
module.exports={createOpportunityImportF9JobPort};
