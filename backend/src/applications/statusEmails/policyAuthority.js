"use strict";
const {createPolicyEngine}=require('../../authorization/policyEngine');
const TYPES={APPLICATION_READ:'APPLICATION',OPPORTUNITY_READ:'OPPORTUNITY',F14_PREQUALIFICATION_READ:'PREQUALIFICATION_EVALUATION'};
function createPolicyAuthority({catalogs,policyVersion,recentMfaRequirement,load,resource,now=()=>new Date()}){
 const policy=createPolicyEngine({permissionCatalog:catalogs.permissionCatalog,profileCatalog:catalogs.profileCatalog,assurancePolicyVersion:policyVersion,recentMfaRequirement});
 if(typeof load!=='function'||typeof resource!=='function')throw TypeError('RECIPIENT_POLICY_PORTS_REQUIRED');
 return async({subject,operationCode,resourceId,applicationId})=>{
  if(!Object.hasOwn(TYPES,operationCode))return 'DENY';
  const source=await load(subject);if(!source)return 'DENY';
  const {membership,snapshot}=source;
  if(!membership||!snapshot)throw Error('RECIPIENT_POLICY_UNAVAILABLE');
  if(membership.id!==subject.membershipId||membership.globalUserId!==subject.userId||membership.organizationId!==subject.organizationId||membership.validUntil<=now().getTime())return 'DENY';
  const target=await resource({subject,operationCode,resourceId,applicationId});
  if(!target||target.id!==resourceId||target.organizationId!==subject.organizationId||target.resourceType!==TYPES[operationCode])return 'DENY';
  const actor={type:'HUMAN',id:subject.userId,organizationId:subject.organizationId,membershipId:subject.membershipId,membershipVersion:membership.membershipVersion,authorizationVersion:snapshot.authorizationVersion};
  const scoped={...snapshot,grants:snapshot.grants.filter(g=>(g.resourceId===undefined||g.resourceId===target.id)&&(g.resourceType===undefined||g.resourceType===target.resourceType))};
  return policy.evaluate({actor,membership,snapshot:scoped,operation:catalogs.operationCatalog.resolve(operationCode),resource:target,assuranceEvidence:null,now:now(),exactResourceScope:false}).allowed?'ALLOW':'DENY';
 };
}
module.exports={createPolicyAuthority};
