'use strict';
const {createPolicyEngine}=require('../authorization/policyEngine');
const {resource}=require('./repository');
const {fail}=require('./contracts');

// Compile the existing policy for resources with no unit/team scope metadata.
// Values come only from the current central snapshot, never from HTTP input.
function compileReadAuthority({catalogs,policyVersion,recentMfaRequirement,context,membership,snapshot,now,includeWork=false}){
 const actor=context.actor,org=actor.organizationId;
 if(!membership||!snapshot||membership.globalUserId!==actor.id||membership.membershipVersion!==actor.membershipVersion||membership.validUntil<=now.getTime()
  ||snapshot.authorizationVersion!==actor.authorizationVersion||snapshot.membershipVersion!==actor.membershipVersion)fail('SERVICE_UNAVAILABLE');
 const policy=createPolicyEngine({permissionCatalog:catalogs.permissionCatalog,profileCatalog:catalogs.profileCatalog,assurancePolicyVersion:policyVersion,recentMfaRequirement});
 const teamOnly=actor.type==='HUMAN'&&snapshot.profileCode==='CONTRIBUTOR';
 function selector(code,type){
  const operation=catalogs.operationCatalog.resolve(code);
  if(!operation||operation.resourceType!==type)fail('SERVICE_UNAVAILABLE');
  const ids=new Set([org]);
  for(const grant of snapshot.grants){if(grant.resourceId)ids.add(grant.resourceId);if(grant.scope?.type==='RESOURCE')ids.add(grant.scope.id);}
  if(snapshot.supportGrant?.scopeType==='RESOURCE')ids.add(snapshot.supportGrant.scopeId);
  let probe='00000000-0000-4000-8000-000000000000';
  while(ids.has(probe))probe=require('node:crypto').randomUUID();
  function allowed(id){
   const target=resource(id,org,type),grants=snapshot.grants.filter(g=>(g.resourceId===undefined||g.resourceId===id)&&(g.resourceType===undefined||g.resourceType===type));
   if(teamOnly)grants.push({permission:operation.permission,resourceId:id,resourceType:type,
    scope:{type:id===org||code==='F14_PREQUALIFICATION_READ'?'ORGANIZATION':'RESOURCE',id:id===org||code==='F14_PREQUALIFICATION_READ'?org:id,organizationId:org}});
   return policy.evaluate({actor,membership,snapshot:{...snapshot,grants},operation,resource:target,assuranceEvidence:context.assuranceEvidence,now,exactResourceScope:false}).allowed;
  }
  // Explicit bindings are evaluated separately, even when a profile grants broad access.
  return {all:allowed(probe),ids:[...ids].filter(allowed)};
 }
 return {...(includeWork?{work:selector('APPLICATION_WORK_READ','APPLICATION')}:{}),teamOnly,membershipId:actor.membershipId,application:selector('APPLICATION_READ','APPLICATION'),
  opportunity:selector('OPPORTUNITY_READ','OPPORTUNITY'),evaluation:selector('F14_PREQUALIFICATION_READ','PREQUALIFICATION_EVALUATION'),
  version:[actor.membershipVersion,actor.authorizationVersion]};
}
function createReadAuthority({data,assertCurrent,...options}){
 let pending;
 return async()=>{
  assertCurrent();pending ||= Promise.all([data.membershipPort.revalidate(options.context.actor),data.authorizationDataPort.load(options.context.actor)]);
  const [membership,snapshot]=await pending;assertCurrent();
  return compileReadAuthority({...options,membership,snapshot,now:options.clock.now()});
 };
}
module.exports={compileReadAuthority,createReadAuthority};
