'use strict';
const VALIDATORS=require('./competencyContracts');
const {isPreparedTenantTransaction}=require('../security/tenantLeaseExecutor');
const {OrganizationalProfileContractError}=require('./errors');
const OPS=Object.freeze({setCompetencies:'F13_COMPETENCY_DRAFT_EDIT',setExperiences:'F13_EXPERIENCE_DRAFT_EDIT',
 attachEvidence:'F13_EVIDENCE_ATTACH',verifyCompetency:'F13_COMPETENCY_VERIFY',readEvidenceLink:'F13_EVIDENCE_LINK_READ'});
function createPreparedCompetencyService({repository,loader,contexts,revalidate,protectAuthorization}){
 return Object.freeze({async execute(client,method,command,context,reconciliation=false){
  if(!contexts.has(context)||!isPreparedTenantTransaction(client,{organizationId:context.organizationId,tenantId:context.organizationId,
   workload:'API',requiredCapabilities:['F13_COMPETENCIES_AND_EXPERIENCE','F7_AUDIT_LEDGER']}))throw new OrganizationalProfileContractError('F13_AUTHORIZATION_REQUIRED');
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-P1:' || $1::text,43001301))",[context.organizationId]);
  const replay=await repository.lockIntention(client,method,command);
  const loaded=await loader.load(client,method,command,replay);
  context=await revalidate(context);
  const decision=await protectAuthorization(client,method,command,context,loaded.resource,loaded.additionalAuthorizations);
  if(!decision.allowed||!decision.evaluation)throw new OrganizationalProfileContractError('F13_AUTHORIZATION_REQUIRED');
  const input=Object.freeze({...command,...decision.trustedContext,resource:loaded.resource,state:loaded.state,authorizationEvidence:decision.evaluation});
  return reconciliation?repository.reconcile(client,method,input):repository[method](client,input);
 }});
}
module.exports={OPS,VALIDATORS,createPreparedCompetencyService};
