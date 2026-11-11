'use strict';
const {createAppendService}=require('../audit/appendService');
const {createAuditEvent}=require('../audit/event');
const {PostgresAppendRepository}=require('../audit/postgresAppendRepository');
function createPostgresOpportunityAuditWriter({authority,organizationId,tenantId=null,clock=()=>new Date(),uuid,telemetryPort=null}){
 if(!['CENTRAL','ORGANIZATION'].includes(authority)||typeof organizationId!=='string'||(authority==='ORGANIZATION'&&typeof tenantId!=='string'))throw new TypeError('Opportunity audit authority is invalid.');
 const service=createAppendService({appendPort:new PostgresAppendRepository(),telemetryPort});
 return Object.freeze({async append(client,input){if(!client||!input||!input.actor||typeof input.operationCode!=='string')throw new TypeError('Opportunity audit transaction is invalid.');const actor=input.actor.type==='SERVICE'?{type:'SERVICE',id:input.actor.reference,membershipId:null,serviceActorCode:input.actor.reference,supportGrantId:null}:{type:'HUMAN',id:input.actor.reference,membershipId:input.actor.membershipId,serviceActorCode:null,supportGrantId:null};const candidate=createAuditEvent({trustedContext:{organizationId,tenantId:authority==='ORGANIZATION'?tenantId:null,operationAuthority:authority==='CENTRAL'?'CENTRAL':'TENANT',operationCode:input.operationCode,source:'API',channel:'APPLICATION',synchronous:true},input:{eventCode:input.eventCode,actor,subject:null,resource:input.resourceId?{type:'OPPORTUNITY',id:input.resourceId}:null,decision:'ACCEPT',outcome:'SUCCESS',observedAt:clock().toISOString(),correlationId:input.correlationId,causationId:input.causationId||null,idempotencyKey:input.idempotencyKey,streamType:'DATA',payload:{detailCode:input.detailCode,catalogVersion:'f12-events-v1'}},clock,uuid});return service.append(candidate,client);}});
}
module.exports={createPostgresOpportunityAuditWriter};
