"use strict";
const {id}=require('./contracts');
// All ports are server-owned and called afresh. authorize receives the recipient
// identity, never the transition author or the service actor.
function createRecipientAuthority({identity,application,authorize}){
 if([identity,application,authorize].some(p=>typeof p!=='function'))throw TypeError('RECIPIENT_AUTHORITY_PORTS_REQUIRED');
 return async({organizationId,applicationId,membershipId})=>{
  const org=id(organizationId),appId=id(applicationId),member=id(membershipId);
  const person=await identity({organizationId:org,membershipId:member});
  if(!person)return {status:'INELIGIBLE'};
  if(person.organizationId!==org||person.membershipId!==member)throw Error('RECIPIENT_CONTEXT_CONFLICT');
  const app=await application({organizationId:org,applicationId:appId,membershipId:member});
  if(!app)return {status:'INELIGIBLE'};
  if(app.organizationId!==org||app.applicationId!==appId)throw Error('RECIPIENT_CONTEXT_CONFLICT');
  const subject={organizationId:org,membershipId:member,userId:id(person.userId)};
  async function read(operationCode,resourceId){const decision=await authorize({subject,operationCode,resourceId,applicationId:appId});if(!decision||!['ALLOW','DENY'].includes(decision))throw Error('RECIPIENT_AUTHORITY_UNAVAILABLE');return decision==='ALLOW';}
  return {...person,status:'RESOLVED',applicationId:appId,isResponsible:app.responsibleMembershipId===member,isActiveParticipant:app.activeParticipant===true,
   canReadApplication:await read('APPLICATION_READ',appId),canReadOpportunity:await read('OPPORTUNITY_READ',app.opportunityId||org),requiresEvaluation:!!app.evaluationId,
   canReadEvaluation:app.evaluationId?await read('F14_PREQUALIFICATION_READ',app.evaluationId):false};
 };
}
module.exports={createRecipientAuthority};
