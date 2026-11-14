'use strict';
const {createAuthorityDataRepository}=require('../authorization/authorityDataRepository');
const {createTaxonomySessionAuthority}=require('../security/authenticatedAuthority');
const {createCustomerBillingRepository}=require('./repository');
const {uuid,fail}=require('../platformBilling/contracts');

function canRead(snapshot, organizationId) {
  if(!snapshot || snapshot.organizationId!==organizationId) return false;
  return snapshot.profileCode==='ORG_ADMIN' || snapshot.grants.some(grant =>
    grant.permission==='billing.read' && !grant.resourceId && !grant.resourceType &&
    grant.scope?.type==='ORGANIZATION' && grant.scope.id===organizationId && grant.scope.organizationId===organizationId);
}
function createCustomerBillingService({coordinator,authority,authorizationDataPort,repository=createCustomerBillingRepository(),centralPool,clock=()=>new Date()}) {
  return {async execute(method,raw,id,request) {
    return coordinator.withAuthority(async()=>{
      const handle=await authority.captureAuthenticatedRequest(request), trusted=await authority.resolve(handle);
      const org=trusted.actor.organizationId;
      if(uuid(request.headers?.['x-c4g-organization'])!==org) fail('CONTEXT_CHANGED');
      const allowed=canRead(await authorizationDataPort.load(trusted.actor),org);
      if(method!=='access' && !allowed) fail('NOT_AUTHORIZED');
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'}).format(clock());
      let result;
      if(method==='access') result={canRead:allowed};
      else if(method==='authorizePdf') result={organizationId:org};
      else {
        if(!['list','summary','detail','account'].includes(method)) fail('INVALID_INPUT');
        const client=await centralPool.connect();
        try {
          await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
          await client.query("SET LOCAL statement_timeout='5s'");
          if(method==='list') result=await repository.list(client,org,raw,today);
          else if(method==='summary') result=await repository.summary(client,org,today);
          else if(method==='account') result=await repository.account(client,org);
          else result=await repository.detail(client,org,id,today);
          await client.query('COMMIT');
        }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
        finally{client.release()}
      }
      const final=await authority.resolve(handle);
      if(method!=='access' && !canRead(await authorizationDataPort.load(final.actor),org)) fail('NOT_AUTHORIZED');
      return result;
    });
  }};
}
function createCustomerBillingComposition({sessionStore,sessionRegistry,authorityCoordinator:coordinator,authorizationCatalogs:catalogs,assurancePolicyVersion:policyVersion,recentMfaRequirement,centralPool}) {
  const data=createAuthorityDataRepository({coordinator,catalogs,policyVersion,recentMfaRequirement});
  const authority=createTaxonomySessionAuthority({sessionStore,sessionRegistry,authorityCoordinator:coordinator,...data,policyVersion});
  return createCustomerBillingService({coordinator,authority,centralPool,...data});
}
module.exports={canRead,createCustomerBillingService,createCustomerBillingComposition};
