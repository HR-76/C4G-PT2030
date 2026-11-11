'use strict';
const {createAppendService}=require('../audit/appendService');
const {PostgresAppendRepository}=require('../audit/postgresAppendRepository');
const {createAuditEvent}=require('../audit/event');

function createOpportunityImportAudit({organizationId,tenantId,clock=()=>new Date(),uuid}){
 if(typeof organizationId!=='string'||typeof tenantId!=='string')throw new TypeError('Import audit authority is invalid.');
 const appendService=createAppendService({appendPort:new PostgresAppendRepository()});
 return Object.freeze({async append(client,input){
  if(!client||!input?.context?.actor||typeof input.importId!=='string')throw new TypeError('Import audit transaction is invalid.');
  const actor=input.context.actor;
  const candidate=createAuditEvent({trustedContext:{organizationId,tenantId,operationAuthority:'TENANT',operationCode:input.operationCode,source:input.context.source||'API',channel:input.context.channel||'APPLICATION',synchronous:true,catalogVersion:'f12-import-events-v3'},input:{eventCode:input.eventCode,actor:{type:'HUMAN',id:actor.id,membershipId:actor.membershipId,serviceActorCode:null,supportGrantId:null},subject:null,resource:{type:'OPPORTUNITY_IMPORT',id:input.importId},decision:'ACCEPT',outcome:'SUCCESS',observedAt:clock().toISOString(),correlationId:input.context.correlationId,causationId:input.context.causationId||null,idempotencyKey:input.idempotencyKey,streamType:'DATA',payload:{detailCode:input.detailCode,catalogVersion:'f12-import-events-v3'}},clock,uuid});
  return appendService.append(candidate,client);
 }});
}
module.exports={createOpportunityImportAudit};
