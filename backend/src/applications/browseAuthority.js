'use strict';
const {createPolicyEngine}=require('../authorization/policyEngine');
// UI capabilities only. Commands still use the coordinated, audited guard.
function createTransitionCapability({catalogs,policyVersion,recentMfaRequirement,data,context,assertCurrent,clock}){
 const policy=createPolicyEngine({permissionCatalog:catalogs.permissionCatalog,profileCatalog:catalogs.profileCatalog,assurancePolicyVersion:policyVersion,recentMfaRequirement});
 let source;
 return async (resource,operationCode='APPLICATION_TRANSITION')=>{
  assertCurrent();
  if(!['APPLICATION_TRANSITION','APPLICATION_EDIT','APPLICATION_WORK_EDIT','APPLICATION_DOCUMENT_EDIT','APPLICATION_REVIEW_DECIDE','DOCUMENT_UPLOAD_INITIATE'].includes(operationCode))return false;
  const operation=catalogs.operationCatalog.resolve(operationCode);
  source ||= Promise.all([data.membershipPort.revalidate(context.actor),data.authorizationDataPort.load(context.actor)]);
  const [membership,snapshot]=await source;assertCurrent();
  if(!membership||!snapshot||membership.globalUserId!==context.actor.id||membership.membershipVersion!==context.actor.membershipVersion||membership.validUntil<=clock.now().getTime())return false;
  if(resource.organizationId!==context.actor.organizationId||resource.resourceType!==operation?.resourceType||resource.distinctFromActorIds.includes(context.actor.id))return false;
  const scoped={...snapshot,grants:snapshot.grants.filter(g=>(g.resourceId===undefined||g.resourceId===resource.id)&&(g.resourceType===undefined||g.resourceType===resource.resourceType))};
  return policy.evaluate({actor:context.actor,membership,snapshot:scoped,operation,resource,assuranceEvidence:context.assuranceEvidence,now:clock.now(),exactResourceScope:false}).allowed;
 };
}
module.exports={createTransitionCapability};
