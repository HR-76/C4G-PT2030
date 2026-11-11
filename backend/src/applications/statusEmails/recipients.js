"use strict";
const {event,email,id}=require('./contracts');
// The authority port is server-owned. No caller-provided roles or address lists.
// Re-run for every attempt; never cache an eligibility decision across attempts.
async function selectRecipients(input,{resolve,now=()=>new Date()}={}){
 const snapshot=event(input);
 if(typeof resolve!=='function')throw new TypeError('RECIPIENT_AUTHORITY_REQUIRED');
 const instant=now().getTime();if(!Number.isFinite(instant))throw new TypeError('INVALID_CLOCK');
 const decisions=[], recipients=[],seen=new Set();let unavailable=false;
 for(const membershipId of snapshot.candidateMembershipIds){
  const skip=reason=>decisions.push(Object.freeze({membershipId,reason}));
  let r;try{r=await resolve(Object.freeze({organizationId:snapshot.organizationId,applicationId:snapshot.applicationId,membershipId}));}catch{unavailable=true;skip('UNAVAILABLE');continue;}
  if(!r||r.status==='UNAVAILABLE'){unavailable=true;skip('UNAVAILABLE');continue;}
  if(r.status==='INELIGIBLE'){skip('INELIGIBLE');continue;}
  if(r.status!=='RESOLVED'){unavailable=true;skip('UNAVAILABLE');continue;}
  let userId;try{userId=id(r.userId);}catch{unavailable=true;skip('UNAVAILABLE');continue;}
  const start=Date.parse(r.validFrom),end=r.validUntil===null?Infinity:Date.parse(r.validUntil);
  if(r.organizationId!==snapshot.organizationId||r.applicationId!==snapshot.applicationId||r.membershipId!==membershipId||
   r.organizationActive!==true||r.userActive!==true||r.membershipActive!==true||!Number.isFinite(start)||Number.isNaN(end)||start>instant||end<=instant||
   !(r.isResponsible===true||r.isActiveParticipant===true)||r.canReadApplication!==true||r.canReadOpportunity!==true||
   typeof r.requiresEvaluation!=='boolean'||(r.requiresEvaluation&&r.canReadEvaluation!==true)){skip('INELIGIBLE');continue;}
  const address=email(r.email);
  if(userId===snapshot.actorUserId||(address&&address===snapshot.actorEmail)){skip('AUTHOR');continue;}
  if(!address){skip('NO_ADDRESS');continue;}
  if(seen.has(address)){skip('DUPLICATE_ADDRESS');continue;}
  seen.add(address);recipients.push(Object.freeze({membershipId,userId,email:address}));
 }
 // Fail the whole selection closed on authority outage; partial delivery would
 // make retry/deduplication ambiguous before the persistence stage exists.
 return Object.freeze({status:unavailable?'UNAVAILABLE':'READY',recipients:Object.freeze(unavailable?[]:recipients),decisions:Object.freeze(decisions)});
}
module.exports={selectRecipients};
