'use strict';
const {createAppendService}=require('../audit/appendService');
const {createAuditEvent}=require('../audit/event');
const {PostgresAppendRepository}=require('../audit/postgresAppendRepository');
const {createUuidV7}=require('../audit/uuidV7');
function createReplayAuditWriter({clock=()=>new Date(),uuid=()=>createUuidV7({now:()=>clock().getTime()}),telemetryPort=null}={}){
 const service=createAppendService({appendPort:new PostgresAppendRepository(),telemetryPort});
 return Object.freeze({async append(client,input){if(!client||!input||!['ASYNC_REPLAY_REQUESTED','ASYNC_REPLAY_APPROVED'].includes(input.eventCode))throw new TypeError('Replay audit input is invalid.');const candidate=createAuditEvent({trustedContext:{organizationId:input.organizationId,tenantId:null,operationAuthority:'CENTRAL',operationCode:input.eventCode==='ASYNC_REPLAY_REQUESTED'?'ASYNC_JOB_REPLAY':'ASYNC_JOB_REPLAY_APPROVE',source:'WORKER',channel:'APPLICATION',synchronous:true},input:{eventCode:input.eventCode,actor:{type:'HUMAN',id:input.actorId,membershipId:input.membershipId,serviceActorCode:null,supportGrantId:null},subject:null,resource:{type:'ASYNC_EXECUTION',id:input.resourceId},decision:'ACCEPT',outcome:'SUCCESS',observedAt:clock().toISOString(),correlationId:input.correlationId,causationId:null,idempotencyKey:input.idempotencyKey,streamType:'ASYNC',payload:{detailCode:input.detailCode,policyVersion:'f12-replay-policy-v1'}},clock,uuid});return service.append(candidate,client);}});
}
module.exports={createReplayAuditWriter};
