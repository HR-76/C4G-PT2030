'use strict';
const contracts=require('./authoringContracts');
const {isPreparedTenantTransaction}=require('../security/tenantLeaseExecutor');
const {OrganizationalProfileContractError}=require('./errors');
const OPS=Object.freeze({createDraft:'F13_PROFILE_DRAFT_CREATE',editDraft:'F13_PROFILE_DRAFT_EDIT',submitDraft:'F13_PROFILE_SUBMIT'});
const VALIDATORS=Object.freeze({createDraft:contracts.validateCreate,editDraft:contracts.validateEdit,submitDraft:contracts.validateSubmit});
function createPreparedAuthoringService({repository,loader,contexts,revalidate,protectAuthorization}){
 return Object.freeze({async execute(client,method,command,context,reconciliation=false){
  if(!contexts.has(context)||typeof protectAuthorization!=='function'||!isPreparedTenantTransaction(client,
   {organizationId:context.organizationId,tenantId:context.organizationId,workload:'API',requiredCapabilities:['F13_PROFILE_AUTHORING','F7_AUDIT_LEDGER']}))
   throw new OrganizationalProfileContractError('F13_AUTHORIZATION_REQUIRED');
  // F13-P1 scope mutex precedes draft/idempotency locks and scope row locks.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-P1:' || $1::text,43001301))",[context.organizationId]);
  const replay=await repository.lockIntention(client,method,{...command,...context});
  const resource=await loader.load(client,method,command,replay);
  context=await revalidate(context);
  const decision=await protectAuthorization(client,method,command,context,resource);
  if(!decision.allowed||!decision.evaluation)throw new OrganizationalProfileContractError('F13_AUTHORIZATION_REQUIRED');
  const authorized=Object.freeze({...command,...decision.trustedContext,resource,authorizationEvidence:decision.evaluation});
  return reconciliation?repository.reconcile(client,method,authorized):repository[method](client,authorized);
 }});
}
module.exports={OPS,VALIDATORS,createPreparedAuthoringService};
