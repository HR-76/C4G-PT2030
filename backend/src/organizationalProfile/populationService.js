'use strict';
const VALIDATORS=require('./populationContracts');
const {isPreparedTenantTransaction}=require('../security/tenantLeaseExecutor');
const {OrganizationalProfileContractError}=require('./errors');
const OPS=Object.freeze(Object.fromEntries(Object.keys(VALIDATORS).map(method=>[method,'F13_POPULATION_'+method.toUpperCase()])));
const STATES=Object.freeze({create:'DRAFT',edit:'DRAFT',submit:'SUBMITTED',verify:'VERIFIED',reject:'REJECTED',dispute:'DISPUTED',revoke:'REVOKED'});
const ORIGINS=Object.freeze({edit:['DRAFT'],submit:['DRAFT'],verify:['SUBMITTED'],reject:['SUBMITTED'],dispute:['VERIFIED'],revoke:['VERIFIED','DISPUTED']});
function effectiveState(row,now){return ['VERIFIED','DISPUTED'].includes(row.state)&&row.valid_until!==null&&new Date(row.valid_until).getTime()<now?'EXPIRED':row.state;}
function createPreparedPopulationService({repository,loader,contexts,revalidate,protectAuthorization}){return Object.freeze({async execute(client,method,command,context,reconciliation=false){
 if(!contexts.has(context)||!isPreparedTenantTransaction(client,{organizationId:context.organizationId,tenantId:context.organizationId,workload:'API',requiredCapabilities:['F13_TERRITORIES_AND_POPULATIONS','F7_AUDIT_LEDGER']}))throw new OrganizationalProfileContractError('F13_AUTHORIZATION_REQUIRED');
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-P1:' || $1::text,43001301))",[context.organizationId]);
 const replay=await repository.lockIntention(client,method,command),loaded=await loader.load(client,method,command,replay,repository.intention(method,command));
 context=await revalidate(context);const decision=await protectAuthorization(client,method,command,context,loaded.resource,loaded.additionalAuthorizations);
 if(!decision.allowed||!decision.evaluation)throw new OrganizationalProfileContractError('F13_AUTHORIZATION_REQUIRED');
 loaded.validate();
 const input=Object.freeze({...command,...decision.trustedContext,resource:loaded.resource,state:loaded.state,authorizationEvidence:decision.evaluation});
 return reconciliation?repository.reconcile(client,method,input):repository[method](client,input);
}});}
module.exports={OPS,VALIDATORS,STATES,ORIGINS,effectiveState,createPreparedPopulationService};
