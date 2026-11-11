'use strict';
const {createAppendService}=require('../audit/appendService');
const {PostgresAppendRepository}=require('../audit/postgresAppendRepository');
const {createAuditEvent}=require('../audit/event');
const {fail}=require('./release');
function createWriter({organizationId,actor,correlationId,clock=()=>new Date()}){
 const append=createAppendService({appendPort:new PostgresAppendRepository()});
 return async(client,{operationCode,eventCode,resourceId,key,digest})=>{
  const event=createAuditEvent({clock,trustedContext:{organizationId,tenantId:organizationId,operationAuthority:'TENANT',operationCode,source:'API',channel:'APPLICATION',synchronous:true},input:{eventCode,
   actor:{type:'HUMAN',id:actor.id,membershipId:actor.membershipId,serviceActorCode:null,supportGrantId:null},subject:null,
   resource:{type:operationCode==='F13_PROFILE_READ'?'PROFILE_PROJECTION':eventCode==='PROFILE_COHORT_ACTIVATED'?'PROFILE_ACTIVATION_COHORT':'PREQUALIFICATION_EVALUATION',id:resourceId},
   decision:'ACCEPT',outcome:'SUCCESS',observedAt:clock().toISOString(),correlationId,causationId:null,idempotencyKey:operationCode+':'+key,streamType:'DATA',
   payload:{detailCode:'PQ1',semanticDigest:digest}}});
  const out=await append.append(event,client);if(!out||!['APPENDED','DUPLICATE','ACCEPTED'].includes(out.status))fail('AUDIT_UNAVAILABLE');
 };
}
module.exports={createWriter};
