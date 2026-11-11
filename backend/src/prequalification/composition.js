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
const {createRepository,target}=require('./repository');
const {createWriter}=require('./audit');
const {operations,validate}=require('./contracts');
const {limits,fail}=require('./release');
function createPrequalificationComposition(options){
 const {sessionStore,sessionRegistry,authorityCoordinator:coordinator,authorizationCatalogs:catalogs,tenantRuntimeDependencies:dependencies,
  assurancePolicyVersion:policyVersion,recentMfaRequirement,clock={now:()=>new Date()}}=options;
 const tokens=options.tokenKeys?require('./tokens').createPreviewTokens({keys:options.tokenKeys,currentKeyId:options.tokenKeyId,clock:()=>clock.now().getTime()}):null;
 const policy=require('../authorization/policyEngine').createPolicyEngine({permissionCatalog:catalogs.permissionCatalog,profileCatalog:catalogs.profileCatalog,assurancePolicyVersion:policyVersion,recentMfaRequirement});
 const data=createAuthorityDataRepository({coordinator,catalogs,policyVersion,recentMfaRequirement});
 const authority=createTaxonomySessionAuthority({sessionStore,sessionRegistry,authorityCoordinator:coordinator,...data,policyVersion,clock});
 const scope=new AsyncLocalStorage(),inputs=new WeakMap();
 const auditBase=createEditorialUiAudit({scope,catalogs,clock,policyVersion});
 const auditPort={accept(event){const s=scope.getStore();if(!s)throw Error('PQ1_AUDIT_SCOPE_REQUIRED');const task=(s.auditTail||Promise.resolve()).then(()=>auditBase.accept(event));s.auditTail=task;task.catch(()=>{});return task;}};
 const drain=()=>scope.getStore().auditTail||Promise.resolve();
 const authorization=createTaxonomyAuthorization({exactResourceScope:false,catalogs,...data,assurancePolicyVersion:policyVersion,recentMfaRequirement,clock,authorizationAuditPort:auditPort});
 const guard=coordinator.bindAuthority({sessionAuthority:authority,authorization,operationCatalog:catalogs.operationCatalog,permissionCatalog:catalogs.permissionCatalog,recentMfaRequirement});
 const adapters={};
 const definitions=[...new Set(Object.values(operations))].map(operationCode=>{
  const queryModule=Object.freeze({moduleCode:operationCode+'_PQ1_QUERY',requiresAuditWrite:true,
   async execute({client,input}){try{return await run(client,inputs.get(input));}catch(e){options.onFailure?.(e);throw tenantFailure(e.code||'SERVICE_UNAVAILABLE','TENANT_OPERATION_UNAVAILABLE');}},
   beforeCommit:({client})=>client.query('RESET ROLE'),authorityGuard:Object.freeze({
    assert({client,input}){coordinator.assert(inputs.get(input).guard,client,preparedAuthorityBinding(client).transactionId);},
    async complete({input,outcome}){const s=inputs.get(input);if(s.guard)await coordinator.complete(s.guard,outcome);}})});
  adapters[operationCode]=Object.freeze({operationCode,queryModule});
  return Object.freeze({operationCode,ownerModule:'F13_PQ1_EFFECTIVE',accessMode:[operations.active,operations.read].includes(operationCode)?'READ':'WRITE',workload:'API',workloadClass:'FUNCTIONAL',queryModule,
   compatibleSchemaVersions:Object.freeze(['020_f14_pq1_decisions','021_application_first_slice','022_application_team_tasks']),requiredCapabilities:Object.freeze(['F14_PQ1_DECISIONS','F13_PQ1_ACTIVATION','F14_PQ1_CONSUMPTION','OPPORTUNITY_EVIDENCED_CRITERIA','F7_AUDIT_LEDGER']),allowedCompatibilityStates:Object.freeze(['COMPATIBLE']),readOnlyEligible:false,
   inputSchema:Object.freeze({validate:i=>inputs.has(i)}),resultSchema:Object.freeze({validate:r=>r!==undefined}),requiredPermission:operationCode,
   limits:Object.freeze({maxPageSize:limits.maxPageSize,maxRows:limits.maxRows,maxBytes:limits.maxBytes}),timeoutMs:limits.timeoutMs});
 });
 const runtime=createTenantRuntime({...dependencies,operationCatalog:createAuthorizedTenantOperationCatalog(Object.freeze({catalogVersion:'pq1-effective-v1',operations:Object.freeze(definitions)}),catalogs.operationCatalog)});
 async function run(client,s){
  await client.query('SET LOCAL ROLE c4g_organization_profile_runtime');const context=await authority.resolve(s.handle);s.context=context;
  const org=context.actor.organizationId;await client.query("SELECT set_config('app.organization_id',$1,true)",[org]);
  // Match the domain writer lock order before F5/F7 can reserve the audit stream.
  // Otherwise a concurrent caller can hold/wait on F7 before the source lock.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-P1:' || $1::text,43001301))",[org]);
  return scope.run({client,organizationId:org,sequence:0},async()=>{try{
   const op=operations[s.method],resourceId=s.method==='activate'||s.method==='active'?org:['read','decide','decisions'].includes(s.method)?s.input.evaluationId:s.method==='preview'?s.input.versionId:s.method==='snapshot'?s.input.snapshotId:s.input.opportunityId||org;
   const admitted=await authorization.authorize(op,context,target(resourceId,org,catalogs.operationCatalog.resolve(op).resourceType));await drain();if(!admitted.allowed)fail('NOT_AUTHORIZED');
   const session=await authority.guardIdentity(s.handle);
   const binding=(id,digest)=>({subjectId:context.actor.id,organizationId:org,sessionDigest:session.sessionDigest,operation:'ACTIVATE',resourceId:id,expectedDigest:digest});
   const ui=tokens?{
    issue:(id,digest)=>tokens.issue(binding(id,digest)),verify:(id,digest)=>{if(options.requirePreview)tokens.verify(s.previewToken,binding(id,digest));},
    cursor:(position,method)=>tokens.cursor(position,{subjectId:context.actor.id,organizationId:org,method}),
    openCursor:(cursor,method)=>tokens.openCursor(cursor,{subjectId:context.actor.id,organizationId:org,method}),
    async capability(resource,operation=operations.activate,approval=null){
     if(approval){try{await coordinator.validateEpochs(approval.scopeEpochs);if(approval.validUntil!==null&&(!Number.isSafeInteger(approval.validUntil)||approval.validUntil<=clock.now().getTime()))return {allowed:false,reason:'APPROVAL_STALE'};}catch{return {allowed:false,reason:'APPROVAL_STALE'};}}
     const membership=await data.membershipPort.revalidate(context.actor),snapshot=await data.authorizationDataPort.load(context.actor);
     if(!membership||!snapshot)return {allowed:false,reason:'NOT_AUTHORIZED'};
     const decision=policy.evaluate({actor:context.actor,membership,snapshot,resource,operation:catalogs.operationCatalog.resolve(operation),assuranceEvidence:context.assuranceEvidence,now:clock.now(),exactResourceScope:false});
     return resource.distinctFromActorIds.includes(context.actor.id)?{allowed:false,reason:'SOD_VIOLATION'}:{allowed:decision.allowed,reason:decision.reasonCode};
    }}:null;
   const repo=createRepository({organizationId:org,actor:context.actor,ui,clock:()=>clock.now(),
    audit:createWriter({organizationId:org,actor:context.actor,correlationId:context.correlationId,clock:()=>clock.now()}),
    async protect(args){const protectedDecision=await guard.protect(client,{handle:s.handle,...args});s.guard=protectedDecision.token;await drain();return protectedDecision;}});
   return await repo.run(client,s.method,s.input,s.reconciliation);
  }finally{await drain();}});
 }
 async function attempt(s){const input=Object.freeze({});inputs.set(input,s);try{
  const lease=await runtime.resolve({correlationId:s.context.correlationId,operationAdapter:adapters[operations[s.method]],organizationContext:{organizationId:s.context.actor.organizationId,membershipId:s.context.actor.membershipId,membershipVersion:s.context.actor.membershipVersion}});return await lease.execute(input);
 }catch(e){options.onFailure?.(e);if(e.internalCode==='COMMIT_UNCERTAIN')return {uncertain:true};throw Object.assign(new Error('Prequalification refused'),{code:e.internalCode||e.code||'SERVICE_UNAVAILABLE'});}finally{inputs.delete(input);}}
 return Object.freeze({mfaCategory:options.mfaCategory,async execute(method,input,request){const previewToken=input?.previewToken; if(method==='activate'&&options.requirePreview){input={...input};delete input.previewToken;if(typeof previewToken!=='string')fail('CONCURRENCY_TOKEN_INVALID');}validate(method,input);const handle=await authority.captureAuthenticatedRequest(request),context=await authority.resolve(handle);
  coordinator.registerRecovery(context.actor.organizationId,createTenantAuthorityRecovery(dependencies));
  if(method==='lookup')return require('./recovery').lookup({input,context,handle,authority,data,policy,catalogs,coordinator,dependencies,clock});
  const state={method,input,previewToken,handle,context,reconciliation:false};const result=await attempt(state);if(!result?.uncertain)return result;
  return require('./recovery').recoverCommit({reconcile:()=>coordinator.reconcile(state.guard),
   async refresh(){state.context=await authority.resolve(handle);state.reconciliation=true;state.guard=null;},
   replay:()=>attempt(state)});
 }});
}
module.exports={createPrequalificationComposition};
