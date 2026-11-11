'use strict';
const {createAuditEvent}=require('../audit/event'),{createAppendService}=require('../audit/appendService'),{PostgresAppendRepository}=require('../audit/postgresAppendRepository'),{createUuidV7}=require('../audit/uuidV7');
const sql=require('./sql');
function createOnboardingAudit(){const append=createAppendService({appendPort:new PostgresAppendRepository()});return async(client,{actorId,eventCode,key,operationId,resourceType='ONBOARDING_OPERATION',detailCode=eventCode,previousVersion,newVersion})=>{
 const event=createAuditEvent({trustedContext:{scope:'PLATFORM',organizationId:null,tenantId:null,operationAuthority:'CENTRAL',operationCode:'PLATFORM_ONBOARDING',source:'PLATFORM_ONBOARDING',channel:'APPLICATION',synchronous:true},input:{eventCode,actor:{type:'HUMAN',id:actorId,membershipId:null,serviceActorCode:null,supportGrantId:null},subject:null,resource:{type:resourceType,id:operationId},decision:'ACCEPT',outcome:'SUCCESS',observedAt:new Date().toISOString(),correlationId:createUuidV7(),causationId:null,idempotencyKey:key,streamType:'DATA',payload:{detailCode,...(previousVersion?{previousVersion:String(previousVersion),newVersion:String(newVersion)}:{})}}});
 return append.append(event,{query:(statement,values)=>client.query(statement.includes('prepare_append_v1')?sql.auditPrepare:sql.auditAppend,values)});
};}
module.exports={createOnboardingAudit};
