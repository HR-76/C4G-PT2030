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
const {createEditorialUiTokens}=require('../organizationalProfile/editorialUiTokens');
const {createAppendService}=require('../audit/appendService');
const {PostgresAppendRepository}=require('../audit/postgresAppendRepository');
const {createAuditEvent}=require('../audit/event');
const {createCriteriaRepository}=require('./repository');
const {digest,fail}=require('./contracts');
const OPS={save:'OPPORTUNITY_CRITERIA_EDIT',confirm:'OPPORTUNITY_CRITERIA_CONFIRM'};
function createCriteriaComposition(options){
 const {sessionStore,sessionRegistry,authorityCoordinator:coordinator,authorizationCatalogs:catalogs,tenantRuntimeDependencies:deps,assurancePolicyVersion:policyVersion,recentMfaRequirement,clock={now:()=>new Date()}}=options;
 const tokens=createEditorialUiTokens({keys:options.tokenKeys,currentKeyId:options.tokenKeyId,clock:()=>clock.now().getTime()});
 const data=createAuthorityDataRepository({coordinator,catalogs,policyVersion,recentMfaRequirement});
 const authority=createTaxonomySessionAuthority({sessionStore,sessionRegistry,authorityCoordinator:coordinator,...data,policyVersion,clock});
 const scope=new AsyncLocalStorage(),inputs=new WeakMap();
 // F5 observational timeout does not cancel its SQL append. Keep append pairs
 // serialized and drain them before issuing subsequent SQL on this transaction.
 const auditBase=createEditorialUiAudit({scope,catalogs,clock,policyVersion});
 const auditPort={accept(event){const state=scope.getStore();if(!state)throw Error('CRITERIA_AUDIT_SCOPE_REQUIRED');const task=(state.auditTail||Promise.resolve()).then(()=>auditBase.accept(event));state.auditTail=task;task.catch(()=>{});return task;}};
 const drainAudit=()=>scope.getStore().auditTail||Promise.resolve();
 const authorization=createTaxonomyAuthorization({exactResourceScope:false,catalogs,...data,assurancePolicyVersion:policyVersion,recentMfaRequirement,clock,authorizationAuditPort:auditPort});
 const guard=coordinator.bindAuthority({sessionAuthority:authority,authorization,operationCatalog:catalogs.operationCatalog,permissionCatalog:catalogs.permissionCatalog,recentMfaRequirement});
 const append=createAppendService({appendPort:new PostgresAppendRepository()});
 function target(id,org,type){return {id,organizationId:org,resourceType:type,status:'ACTIVE',scopeType:'ORGANIZATION',scopeId:null,unitId:null,ancestorUnitIds:[],teamIds:[],distinctFromActorIds:[]};}
 const adapters={};const operations=['OPPORTUNITY_CRITERIA_READ',...Object.values(OPS)].map(operationCode=>{const queryModule=Object.freeze({moduleCode:operationCode+'_QUERY',requiresAuditWrite:true,
 execute:async({client,input})=>{try{return await run(client,inputs.get(input));}catch(e){options.onFailure?.(e);throw tenantFailure(e.code||'SERVICE_UNAVAILABLE','TENANT_OPERATION_UNAVAILABLE');}},beforeCommit:({client})=>client.query('RESET ROLE'),authorityGuard:Object.freeze({assert({client,input}){const s=inputs.get(input);coordinator.assert(s.guard,client,preparedAuthorityBinding(client).transactionId);},async complete({input,outcome}){const s=inputs.get(input);if(s.guard)await coordinator.complete(s.guard,outcome);}})});adapters[operationCode]=Object.freeze({operationCode,queryModule});return Object.freeze({operationCode,ownerModule:'OPPORTUNITY_CRITERIA',accessMode:operationCode==='OPPORTUNITY_CRITERIA_READ'?'READ':'WRITE',workload:'API',workloadClass:'FUNCTIONAL',queryModule,compatibleSchemaVersions:Object.freeze(['017_opportunity_evidenced_criteria','018_f13_pq1_publication','019_f13_pq1_activation','020_f14_pq1_decisions','021_application_first_slice','022_application_team_tasks']),requiredCapabilities:Object.freeze(['OPPORTUNITY_EVIDENCED_CRITERIA','F7_AUDIT_LEDGER']),allowedCompatibilityStates:Object.freeze(['COMPATIBLE']),readOnlyEligible:false,inputSchema:Object.freeze({validate:v=>inputs.has(v)}),resultSchema:Object.freeze({validate:v=>v!==undefined}),requiredPermission:operationCode,limits:Object.freeze({maxPageSize:50,maxRows:100,maxBytes:262144}),timeoutMs:10000});});
 const runtime=createTenantRuntime({...deps,operationCatalog:createAuthorizedTenantOperationCatalog(Object.freeze({catalogVersion:'criteria-v1',operations:Object.freeze(operations)}),catalogs.operationCatalog)});
 async function run(client,s){await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');const context=await authority.resolve(s.handle),org=context.actor.organizationId;s.context=context;
 await client.query("SELECT set_config('app.organization_id',$1,true)",[org]);
 return scope.run({client,organizationId:org,sequence:0},async()=>{try{
 const allowed=async(code,resource)=>{const decision=await authorization.authorize(code,context,resource);await drainAudit();return Boolean(decision.allowed);};
 const oppTarget=target(s.id,org,'OPPORTUNITY');if(!await allowed('OPPORTUNITY_READ',oppTarget))fail('RESOURCE_NOT_AVAILABLE');
 const readTarget=target(s.id,org,'OPPORTUNITY_CRITERIA_SET');if(!await allowed('OPPORTUNITY_CRITERIA_READ',readTarget))fail('NOT_AUTHORIZED');
 const audit=async(c,method,result,input,criteriaDigest)=>{
 const event=createAuditEvent({clock:()=>clock.now(),trustedContext:{organizationId:org,tenantId:org,operationAuthority:'TENANT',operationCode:OPS[method]||'OPPORTUNITY_CRITERIA_READ',source:'API',channel:'APPLICATION',synchronous:true},input:{eventCode:method==='read'?'OPPORTUNITY_CRITERIA_ACCESSED':method==='save'?'OPPORTUNITY_CRITERIA_REVISION_CREATED':'OPPORTUNITY_CRITERIA_REVISION_CONFIRMED',actor:{type:'HUMAN',id:context.actor.id,membershipId:context.actor.membershipId,serviceActorCode:null,supportGrantId:null},subject:null,resource:{type:'OPPORTUNITY_CRITERIA_REVISION',id:result.revisionId||s.id},decision:'ACCEPT',outcome:'SUCCESS',observedAt:clock.now().toISOString(),correlationId:context.correlationId,causationId:null,idempotencyKey:'CRITERIA:'+method+':'+input.requestId,streamType:'DATA',payload:{opportunityId:s.id,opportunityRevisionId:input.opportunityRevisionId,setId:result.setId,criteriaRevisionId:result.revisionId,previousRevisionNumber:input.expectedHeadRevision,newRevisionNumber:result.revisionNumber,contractVersion:'criteria-v1',detailCode:method==='read'?'READ':method==='save'?'SAVED':'CONFIRMED',criteriaDigest}}});await append.append(event,c);};
 const repo=createCriteriaRepository({organizationId:org,actor:context.actor,tokens,audit});
 const loaded=await repo.load(client,s.id,Boolean(OPS[s.method]));
 if(s.revisionId){const r=await repo.revision(client,s.revisionId);if(r.set_id!==loaded.set?.set_id)fail('RESOURCE_NOT_AVAILABLE');}
 const code=OPS[s.method]||'OPPORTUNITY_CRITERIA_READ',resource=target(s.method==='confirm'?s.revisionId:s.id,org,s.method==='confirm'?'OPPORTUNITY_CRITERIA_REVISION':'OPPORTUNITY_CRITERIA_SET');
 const operation=s.method==='save'?'CRITERIA_SAVE':s.method==='confirm'?'CRITERIA_CONFIRM':'CRITERIA_READ';
 const intention=digest({organizationId:org,subjectId:context.actor.id,operation,opportunityId:s.id,revisionId:s.revisionId||null,input:s.input});
 s.guard=(await guard.protect(client,{handle:s.handle,operationCode:code,resource,intention:OPS[s.method]?{operation,key:s.input.requestId,digest:intention}:{operation}})).token;
 await drainAudit();
 const actions={canEdit:await allowed('OPPORTUNITY_CRITERIA_EDIT',readTarget),canConfirm:s.revisionId?await allowed('OPPORTUNITY_CRITERIA_CONFIRM',target(s.revisionId,org,'OPPORTUNITY_CRITERIA_REVISION')):false,reason:null};
 if(loaded.opportunity.lifecycle_state==='ARCHIVED'){actions.canEdit=false;actions.canConfirm=false;actions.reason='STATE_CONFLICT';}
 const result=await repo.run(client,{...s,loaded,actions,intention});
 if(!OPS[s.method])await audit(client,'read',{setId:loaded.set?.set_id||null,revisionId:s.revisionId||null,revisionNumber:null},{opportunityRevisionId:loaded.opportunity.current_revision_id,expectedHeadRevision:null,requestId:context.correlationId},null);
 return result;
 }finally{await drainAudit();}});}
 async function attempt(s){const input=Object.freeze({});inputs.set(input,s);try{const lease=await runtime.resolve({correlationId:s.context.correlationId,operationAdapter:adapters[OPS[s.method]||'OPPORTUNITY_CRITERIA_READ'],organizationContext:{organizationId:s.context.actor.organizationId,membershipId:s.context.actor.membershipId,membershipVersion:s.context.actor.membershipVersion}});return await lease.execute(input);}catch(e){options.onFailure?.(e);if(e.internalCode==='COMMIT_UNCERTAIN')return {uncertain:true};throw Object.assign(new Error('Criteria operation refused'),{code:e.internalCode||e.code||'SERVICE_UNAVAILABLE'});}finally{inputs.delete(input);}}
 return {async execute(method,id,input,revisionId,request){const handle=await authority.captureAuthenticatedRequest(request),context=await authority.resolve(handle);coordinator.registerRecovery(context.actor.organizationId,createTenantAuthorityRecovery(deps));const s={method,id,input,revisionId,handle,context};if(method==='lookup')return require('./recovery').lookup({s,authority,data,catalogs,coordinator,deps,clock,policyVersion,recentMfaRequirement});let result=await attempt(s);if(result?.uncertain){await coordinator.reconcile(s.guard);s.context=await authority.resolve(handle);s.guard=null;result=await attempt(s);if(result?.uncertain)fail('SERVICE_UNAVAILABLE');}return result;}};
}
module.exports={createCriteriaComposition};
