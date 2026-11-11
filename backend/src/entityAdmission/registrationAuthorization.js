'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {createEditorialUiAudit}=require('../organizationalProfile/editorialUiAudit');
const {createTaxonomyAuthorization}=require('../authorization/resourceAuthorization');
const {resource}=require('../organizationDirectory/repository');
function createRegistrationAuthorization({catalogs,data,policyVersion,recentMfaRequirement,clock={now:()=>new Date()}}){
 const scope=new AsyncLocalStorage(),audit=createEditorialUiAudit({scope,catalogs,clock,policyVersion,operationAuthority:'CENTRAL'});
 const authorization=createTaxonomyAuthorization({exactResourceScope:false,catalogs,...data,assurancePolicyVersion:policyVersion,recentMfaRequirement,clock,authorizationAuditPort:audit});
 return (client,context,organizationId)=>{
  // F5 decisions are organization-scoped Central audit events, not platform invitations.
  return scope.run({client,organizationId,sequence:0},async()=>Boolean((await authorization.authorize('ORGANIZATION_DIRECTORY_EDIT',context,resource(organizationId))).allowed));
 };
}
module.exports={createRegistrationAuthorization};
