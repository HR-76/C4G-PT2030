'use strict';
const {reviewerEligible}=require('./assignedReviewEligibility');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=()=>{throw Object.assign(new Error('REVIEWER_NOT_ELIGIBLE'),{code:'REVIEWER_NOT_ELIGIBLE'});};

// This port returns evidence to the coordinator; it neither assigns a review
// nor grants access. Its caller must supply trusted resources and a real policy.
function createAssignedReviewEvidence({coordinator,load,evaluate,versions,scopeForResource=({snapshot})=>snapshot,now=Date.now}) {
 if(typeof coordinator?.withAuthority!=='function'||typeof coordinator.snapshotEpochs!=='function'||typeof coordinator.validateEpochs!=='function'
  ||typeof load!=='function'||typeof evaluate!=='function'||!versions)throw new TypeError('REVIEWER_AUTHORITY_PORTS_REQUIRED');
 return async function evidence({requester,subjectId,membershipId,application,opportunity,evaluation=null,documents,intentionDigest}) {
  const org=requester?.organizationId;
  if(!uuid.test(org||'')||!uuid.test(requester?.id||'')||!uuid.test(subjectId||'')||!uuid.test(membershipId||'')
   ||!uuid.test(application?.id||'')||application.organizationId!==org||application.resourceType!=='APPLICATION'
   ||!uuid.test(opportunity?.id||'')||opportunity.organizationId!==org||opportunity.resourceType!=='OPPORTUNITY'
   ||(evaluation&&(!uuid.test(evaluation.id||'')||evaluation.organizationId!==org||evaluation.resourceType!=='PREQUALIFICATION_EVALUATION'))
   ||!Array.isArray(documents)||documents.length<1||documents.length>20
   ||documents.some(item=>!uuid.test(item?.id||'')||item.organizationId!==org||item.resourceType!=='DOCUMENT')
   ||!/^[a-f0-9]{64}$/.test(intentionDigest||''))fail();
  return coordinator.withAuthority(async()=>{
   const scope=['POLICY',`ORG:${org}`,`SUBJECT:${subjectId}`,`MEMBER:${membershipId}`].sort();
   const scopeEpochs=await coordinator.snapshotEpochs(scope);
   const source=await load({organizationId:org,subjectId,membershipId});
   const membership=source?.membership,snapshot=source?.snapshot;
   const actor={type:'HUMAN',id:subjectId,organizationId:org,membershipId,membershipVersion:membership?.membershipVersion,authorizationVersion:snapshot?.authorizationVersion};
   const instant=now();
   if(!membership||!snapshot||membership.status!=='ACTIVE'||membership.globalUserId!==subjectId||subjectId===requester.id)fail();
   const decisions=new Map();
   const checks=[['APPLICATION_READ',application],['APPLICATION_REVIEW_DECIDE',application],
    ...documents.map(item=>['DOCUMENT_READ',item]),['OPPORTUNITY_READ',opportunity],
    ...(evaluation?[['F14_PREQUALIFICATION_READ',evaluation]]:[])];
   for(const [operation,target] of checks){
    const scoped=await scopeForResource({actor,snapshot,resource:target,operationCode:operation});
    decisions.set(operation+':'+target.id,evaluate(operation,target,{actor,membership,snapshot:scoped,now:instant}));
   }
   const check=(operation,target)=>decisions.get(operation+':'+target.id);
   if(!reviewerEligible({requester,candidate:{actor,membership,snapshot},application,documents,evaluate:check,now:instant})
    ||check('OPPORTUNITY_READ',opportunity)?.allowed!==true
    ||(evaluation&&check('F14_PREQUALIFICATION_READ',evaluation)?.allowed!==true))fail();
   await coordinator.validateEpochs(scopeEpochs);
   return Object.freeze({...versions,subjectId,membershipId,applicationId:application.id,intentionDigest,scopeEpochs,
    validUntil:Number.isFinite(membership.validUntil)?membership.validUntil:null});
  });
 };
}
module.exports={createAssignedReviewEvidence};
