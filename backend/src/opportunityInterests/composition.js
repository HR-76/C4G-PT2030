'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {createAuthorityDataRepository}=require('../authorization/authorityDataRepository');
const {createTaxonomySessionAuthority}=require('../security/authenticatedAuthority');
const {createTaxonomyAuthorization}=require('../authorization/resourceAuthorization');
const {createTenantRuntime}=require('../security/tenantRuntime');
const {createAuthorizedTenantOperationCatalog}=require('../security/tenantOperationCatalog');
const {preparedAuthorityBinding}=require('../security/tenantLeaseExecutor');
const {createTenantAuthorityRecovery}=require('../security/tenantAuthorityRecovery');
const {tenantFailure}=require('../security/tenantRuntimeErrors');
const {createEditorialUiAudit}=require('../organizationalProfile/editorialUiAudit');
const {createPq1UiTokens}=require('../organizationalProfile/pq1UiTokens');
const {createAuditEvent}=require('../audit/event');
const {createAppendService}=require('../audit/appendService');
const {PostgresAppendRepository}=require('../audit/postgresAppendRepository');
const {createOpportunityInterestRepository}=require('./repository');
const {parse,uuid,fail}=require('./contracts');
const SCHEMA_VERSIONS=Object.freeze(['033_organizational_opportunity_interests',require('../security/opportunityV2MigrationPackage').tenantAddition.version]);
const OPERATIONS=Object.freeze({READ:'OPPORTUNITY_INTEREST_READ',REGISTER:'OPPORTUNITY_INTEREST_REGISTER',MANAGE:'OPPORTUNITY_INTEREST_MANAGE'});
const operation=method=>method==='register'?OPERATIONS.REGISTER:['edit','archive'].includes(method)?OPERATIONS.MANAGE:OPERATIONS.READ;
function createOpportunityInterestComposition({sessionStore,sessionRegistry,authorityCoordinator:coordinator,authorizationCatalogs:catalogs,
 assurancePolicyVersion:policyVersion,recentMfaRequirement,tenantRuntimeDependencies:dependencies,tokenKeys,tokenKeyId,
 centralOrigin,centralCurrent,clock={now:()=>new Date()},onFailure=()=>{}}){
 const data=createAuthorityDataRepository({coordinator,catalogs,policyVersion,recentMfaRequirement});
 const authority=createTaxonomySessionAuthority({sessionStore,sessionRegistry,authorityCoordinator:coordinator,...data,policyVersion,clock});
 const scope=new AsyncLocalStorage(),inputs=new WeakMap(),tokens=createPq1UiTokens({keys:tokenKeys,currentKeyId:tokenKeyId,clock:()=>clock.now().getTime()});
 const baseAudit=createEditorialUiAudit({scope,catalogs,clock,policyVersion});
 const auditPort={accept(event){const active=scope.getStore();if(!active)throw Error('INTEREST_AUDIT_SCOPE_REQUIRED');const task=(active.auditTail||Promise.resolve()).then(()=>baseAudit.accept(event));active.auditTail=task;task.catch(()=>{});return task;}};
 const drain=()=>scope.getStore()?.auditTail||Promise.resolve();
 const authorization=createTaxonomyAuthorization({exactResourceScope:false,catalogs,...data,assurancePolicyVersion:policyVersion,recentMfaRequirement,clock,authorizationAuditPort:auditPort,
  withAuthorityReads:work=>coordinator.withAuthority(work)});
 const guard=coordinator.bindAuthority({sessionAuthority:authority,authorization,operationCatalog:catalogs.operationCatalog,permissionCatalog:catalogs.permissionCatalog,recentMfaRequirement});
 const append=createAppendService({appendPort:new PostgresAppendRepository()}),adapters={};
 const entries=Object.values(OPERATIONS).map(operationCode=>{
  const queryModule=Object.freeze({moduleCode:operationCode,requiresAuditWrite:true,
   async execute({client,input}){try{return await run(client,inputs.get(input));}catch(error){onFailure(error);
    const code=['23505','23503','23514'].includes(error.code)?'STATE_CONFLICT':error.publicCode||error.code||'SERVICE_UNAVAILABLE';
    throw tenantFailure(code,'TENANT_OPERATION_UNAVAILABLE');}},
   beforeCommit:({client})=>client.query('RESET ROLE'),authorityGuard:Object.freeze({
    assert({client,input}){const state=inputs.get(input);coordinator.assert(state.guard,client,preparedAuthorityBinding(client).transactionId);},
    async complete({input,outcome}){const state=inputs.get(input);if(state?.guard)await coordinator.complete(state.guard,outcome);}})});
  adapters[operationCode]=Object.freeze({operationCode,queryModule});
  return Object.freeze({operationCode,ownerModule:'ORGANIZATIONAL_OPPORTUNITY_INTERESTS',accessMode:operationCode===OPERATIONS.READ?'READ':'WRITE',
   workload:'API',workloadClass:'FUNCTIONAL',queryModule,compatibleSchemaVersions:SCHEMA_VERSIONS,
   requiredCapabilities:Object.freeze(['ORGANIZATIONAL_OPPORTUNITY_INTERESTS','F13_P1_ORGANIZATIONAL_SCOPE','F7_AUDIT_LEDGER','F4_RUNTIME_METADATA_ACCESS']),
   allowedCompatibilityStates:Object.freeze(['COMPATIBLE']),readOnlyEligible:false,inputSchema:Object.freeze({validate:value=>inputs.has(value)}),
   resultSchema:Object.freeze({validate:value=>value!==undefined}),requiredPermission:operationCode,
   // Detail/history may contain up to 25 immutable notes and unit snapshots.
   // The catalogue list intentionally omits snapshots/notes from its DTO.
   limits:Object.freeze({maxPageSize:1000,maxRows:10000,maxBytes:4194304}),timeoutMs:10000});
 });
 const runtime=createTenantRuntime({...dependencies,operationCatalog:createAuthorizedTenantOperationCatalog(Object.freeze({catalogVersion:'organizational-opportunity-interests-v1',operations:Object.freeze(entries)}),catalogs.operationCatalog)});
 async function audit(client,state,entry){
  const actor=state.context.actor;
  const event=createAuditEvent({clock:()=>clock.now(),trustedContext:{organizationId:actor.organizationId,tenantId:actor.organizationId,
   operationAuthority:'TENANT',operationCode:entry.operationCode,catalogVersion:'f13-editorial-events-v1',source:'API',channel:'APPLICATION',synchronous:true},
   input:{eventCode:entry.eventCode,actor:{type:'HUMAN',id:actor.id,membershipId:actor.membershipId,serviceActorCode:null,supportGrantId:null},
    subject:null,resource:{type:'OPPORTUNITY_INTEREST',id:entry.resourceId},decision:'ACCEPT',outcome:'SUCCESS',observedAt:clock.now().toISOString(),
    correlationId:state.context.correlationId,causationId:null,idempotencyKey:`INTEREST:${entry.idempotencyKey}`,streamType:'DATA',payload:{detailCode:entry.eventCode}}});
  await append.append(event,client);
 }
 async function run(client,state){
  await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
  state.context=await authority.resolve(state.handle);const org=state.context.actor.organizationId;
  await client.query("SELECT set_config('app.organization_id',$1,true),set_config('app.membership_id',$2,true)",[org,state.context.actor.membershipId]);
  // Read observations are persisted at finalization, before the unchanged fresh
  // authority checks. Writes and critical/denied evidence remain immediate.
  const readPolicy=operation(state.method)===OPERATIONS.READ?'OPPORTUNITY_INTEREST_BROWSE':null;
  return scope.run({client,organizationId:org,sequence:0,readAuditPolicy:readPolicy,...(readPolicy?{tenantId:preparedAuthorityBinding(client).tenantId}:{})},async()=>{try{
   const repository=createOpportunityInterestRepository({organizationId:org,actor:state.context.actor,cursor:tokens,centralOrigin,centralCurrent,
    authorize:async(code,target)=>{
     const decision=await authorization.authorize(code,state.context,target);await drain();
     if(!decision.allowed&&/AUDIT|UNAVAILABLE|STALE|MEMBERSHIP|POLICY_INVALID|SESSION_INVALID/.test(decision.reasonCode))fail('SERVICE_UNAVAILABLE');
     return decision.allowed;},
    protect:async args=>{const decision=await guard.protect(client,{handle:state.handle,...args});state.guard=decision.token;await drain();return decision;},
    audit:(connection,entry)=>audit(connection,state,entry)});
   return await repository[state.method](client,state.input,state.id);
  }finally{await drain();}});
 }
 async function attempt(state){
  const input=Object.freeze({});inputs.set(input,state);
  try{const lease=await runtime.resolve({correlationId:state.context.correlationId,operationAdapter:adapters[operation(state.method)],
   organizationContext:{organizationId:state.context.actor.organizationId,membershipId:state.context.actor.membershipId,membershipVersion:state.context.actor.membershipVersion}});
   return await lease.execute(input);
  }catch(error){onFailure(error);if(error.internalCode==='COMMIT_UNCERTAIN')return {uncertain:true};
   throw Object.assign(new Error('Opportunity interest unavailable'),{code:error.internalCode||error.code||'SERVICE_UNAVAILABLE'});
  }finally{inputs.delete(input);}
 }
 async function executeCurrent(method,input,exactId,request){
  const {handle,context}=await coordinator.withAuthority(async()=>{const handle=await authority.captureAuthenticatedRequest(request);return {handle,context:await authority.resolve(handle)};});
  const expectedOrg=request.headers?.['x-c4g-organization'];if(expectedOrg!==undefined&&uuid(expectedOrg)!==context.actor.organizationId)fail('RESOURCE_NOT_AVAILABLE');
  coordinator.registerRecovery(context.actor.organizationId,createTenantAuthorityRecovery(dependencies));
  const state={method,input,id:exactId,handle,context,guard:null};let result=await attempt(state);
  if(result?.uncertain){await coordinator.reconcile(state.guard);state.context=await authority.resolve(handle);state.guard=null;result=await attempt(state);if(result?.uncertain)fail('SERVICE_UNAVAILABLE');}
  return result;
 }
 return Object.freeze({async execute(method,raw,id,request){
  const input=parse(method,raw),exactId=id?uuid(id):null;
  // A concurrent login can advance the subject epoch without revoking this
  // session. Only catalogue reads can restart with a fresh authority handle.
  const catalogRead=method==='context'||method==='summaries';
  for(let retry=0;;retry++){
   try{return await executeCurrent(method,input,exactId,request);}
   catch(error){
    if(!catalogRead||retry>=3||!['AUTHORITY_STALE','AUTHORITY_WRITE_PENDING'].includes(error.code))throw error;
    await new Promise(resolve=>setTimeout(resolve,100*2**retry));
   }
  }
 }});
}
module.exports={createOpportunityInterestComposition,OPPORTUNITY_INTEREST_SCHEMA_VERSIONS:SCHEMA_VERSIONS,OPPORTUNITY_INTEREST_OPERATIONS:OPERATIONS};
