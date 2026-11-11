'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {tenantAddition:{version:OPPORTUNITY_V2_SCHEMA_VERSION}}=require('../security/opportunityV2MigrationPackage');
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
const {createApplicationRepository,resource}=require('./repository');
const {createResponsibleAuthority}=require('./responsibleAuthority');
const {uuid,command,query,fail}=require('./contracts');
const {parse:createWorkInput,createWorkRepository}=require('./work');
const {parse:createDocumentInput,createApplicationDocumentsRepository}=require('./documentsReview');
const {parse:createPartnerInput,createPartnersRepository}=require('./partners');
const {parse:createAlertInput,createAlertsRepository}=require('./alerts');
const {parse:createNoticeInput,createNoticesRepository}=require('./notices');
const READ_AUDIT_METHODS=Object.freeze({browse:'APPLICATION_BROWSE',report:'APPLICATION_REPORT',dashboardContext:'APPLICATION_DASHBOARD'});
const operation=(code,access)=>{
 if(!/^[A-Z][A-Z0-9_]*$/.test(code)||!['read','write'].includes(access))throw new TypeError('Invalid application operation descriptor.');
 return Object.freeze({code,access});
};
const OPERATIONS=Object.freeze({
 unitOptions:operation('APPLICATION_READ','read'),
 dashboardContext:operation('APPLICATION_READ','read'),
 report:operation('APPLICATION_READ','read'),reportExport:operation('APPLICATION_READ','read'),
 noticesContext:operation('NOTIFICATION_READ','read'),noticesHistory:operation('ORGANIZATION_NOTICE_READ','read'),noticesGet:operation('ORGANIZATION_NOTICE_READ','read'),noticesSend:operation('ORGANIZATION_NOTICE_SEND','write'),
 alertsList:operation('NOTIFICATION_READ','read'),alertsRead:operation('NOTIFICATION_ACK','write'),alertsReadAll:operation('NOTIFICATION_ACK','write'),alertsRefresh:operation('NOTIFICATION_SYNC','write'),
 partnersGet:operation('APPLICATION_READ','read'),partnersHistory:operation('APPLICATION_READ','read'),partnersBrowse:operation('APPLICATION_READ','read'),partnerCreate:operation('APPLICATION_EDIT','write'),partnerEdit:operation('APPLICATION_EDIT','write'),partnerRemove:operation('APPLICATION_EDIT','write'),
 create:operation('APPLICATION_CREATE','write'),edit:operation('APPLICATION_EDIT','write'),transition:operation('APPLICATION_TRANSITION','write'),get:operation('APPLICATION_READ','read'),history:operation('APPLICATION_READ','read'),list:operation('APPLICATION_READ','read'),browse:operation('APPLICATION_READ','read'),opportunitySummaries:operation('APPLICATION_READ','read'),responsibles:operation('APPLICATION_READ','read'),
 workGet:operation('APPLICATION_WORK_READ','read'),workHistory:operation('APPLICATION_WORK_READ','read'),participantAdd:operation('APPLICATION_WORK_EDIT','write'),participantRemove:operation('APPLICATION_WORK_EDIT','write'),taskCreate:operation('APPLICATION_WORK_EDIT','write'),taskEdit:operation('APPLICATION_WORK_EDIT','write'),taskComplete:operation('APPLICATION_WORK_EDIT','write'),taskCancel:operation('APPLICATION_WORK_EDIT','write'),
 documentCandidates:operation('APPLICATION_DOCUMENT_READ','read'),documentGet:operation('APPLICATION_DOCUMENT_READ','read'),documentHistory:operation('APPLICATION_DOCUMENT_READ','read'),documentDownload:operation('APPLICATION_DOCUMENT_READ','read'),documentTransportAccess:operation('APPLICATION_DOCUMENT_EDIT','write'),documentLink:operation('APPLICATION_DOCUMENT_EDIT','write'),documentRemove:operation('APPLICATION_DOCUMENT_EDIT','write'),reviewRequest:operation('APPLICATION_DOCUMENT_EDIT','write'),reviewDecide:operation('APPLICATION_REVIEW_DECIDE','write')
});
async function acquireApplicationMutationLock(client,method,organizationId){
 const descriptor=OPERATIONS[method];
 if(!descriptor)throw new TypeError('Unknown application operation.');
 if(descriptor.access==='read')return false;
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended('APPLICATION:' || $1::text,43002101))",[organizationId]);
 return true;
}
function createApplicationComposition({sessionStore,sessionRegistry,authorityCoordinator:coordinator,centralPool,authorizationCatalogs:catalogs,
 assurancePolicyVersion:policyVersion,recentMfaRequirement,tenantRuntimeDependencies:dependencies,tokenKeys,tokenKeyId,centralOrigin=null,centralCurrent=null,
 clock={now:()=>new Date()},onFailure=()=>{}}){
 const data=createAuthorityDataRepository({coordinator,catalogs,policyVersion,recentMfaRequirement});
 const authority=createTaxonomySessionAuthority({sessionStore,sessionRegistry,authorityCoordinator:coordinator,...data,policyVersion,clock});
 const scope=new AsyncLocalStorage(),inputs=new WeakMap(),tokens=createPq1UiTokens({keys:tokenKeys,currentKeyId:tokenKeyId,clock:()=>clock.now().getTime()});
 const baseAudit=createEditorialUiAudit({scope,catalogs,clock,policyVersion});
 const auditPort={accept(event){const s=scope.getStore();if(!s)throw Error('APPLICATION_AUDIT_SCOPE_REQUIRED');const task=(s.auditTail||Promise.resolve()).then(()=>baseAudit.accept(event));s.auditTail=task;task.catch(()=>{});return task}};
 const drain=()=>scope.getStore()?.auditTail||Promise.resolve();
 const snapshotForResource=require('./teamAccess').createTeamAccessPolicy({operationCatalog:catalogs.operationCatalog,
  currentClient(org){const current=scope.getStore();if(!current||current.organizationId!==org)throw Error('APPLICATION_TEAM_CONTEXT_REQUIRED');return current.client}});
 const authorization=createTaxonomyAuthorization({exactResourceScope:false,catalogs,...data,assurancePolicyVersion:policyVersion,recentMfaRequirement,clock,authorizationAuditPort:auditPort,snapshotForResource,
  withAuthorityReads:work=>scope.getStore()?.method==='partnersBrowse'?coordinator.withAuthority(work):work()});
 const guard=coordinator.bindAuthority({sessionAuthority:authority,authorization,operationCatalog:catalogs.operationCatalog,permissionCatalog:catalogs.permissionCatalog,recentMfaRequirement});
 const append=createAppendService({appendPort:new PostgresAppendRepository()});
 const adapters={};
  const uniqueOperations=new Map();
  for(const descriptor of Object.values(OPERATIONS)){
   const previous=uniqueOperations.get(descriptor.code);
   if(previous&&previous.access!==descriptor.access)throw new TypeError('Application operation access is inconsistent.');
   uniqueOperations.set(descriptor.code,descriptor);
  }
  const entries=[...uniqueOperations.values()].map(descriptor=>{
   const operationCode=descriptor.code;
  const queryModule=Object.freeze({moduleCode:`${operationCode}_FIRST_SLICE`,requiresAuditWrite:true,
   async execute({client,input}){try{return await run(client,inputs.get(input))}catch(error){onFailure(error);throw tenantFailure(error.code||'SERVICE_UNAVAILABLE','TENANT_OPERATION_UNAVAILABLE')}},
   beforeCommit:({client})=>client.query('RESET ROLE'),authorityGuard:Object.freeze({assert({client,input}){const s=inputs.get(input);coordinator.assert(s.guard,client,preparedAuthorityBinding(client).transactionId)},
    async complete({input,outcome}){const s=inputs.get(input);if(s?.guard)await coordinator.complete(s.guard,outcome)}})});
  adapters[operationCode]=Object.freeze({operationCode,queryModule});
  const work=operationCode.startsWith('APPLICATION_WORK_'),documents=operationCode.startsWith('APPLICATION_DOCUMENT_')||operationCode==='APPLICATION_REVIEW_DECIDE';
   return Object.freeze({operationCode,ownerModule:'APPLICATION_FIRST_SLICE',accessMode:descriptor.access.toUpperCase(),
   workload:'API',workloadClass:'FUNCTIONAL',queryModule,compatibleSchemaVersions:Object.freeze([...(centralOrigin?['024_application_central_origin']:documents?['023_application_documents_review']:work?['022_application_team_tasks','023_application_documents_review']:['021_application_first_slice','022_application_team_tasks','023_application_documents_review']),'025_organization_directory','026_personal_profile','027_application_lifecycle','028_application_partners','029_application_alerts','030_organization_notices','031_application_document_transport','032_document_worker_runtime','033_organizational_opportunity_interests',OPPORTUNITY_V2_SCHEMA_VERSION]),
   requiredCapabilities:Object.freeze(['APPLICATION_FIRST_SLICE',...(operationCode.startsWith('ORGANIZATION_NOTICE_')?['ORGANIZATION_NOTICES']:[]),...(centralOrigin?['APPLICATION_CENTRAL_ORIGIN']:[]),...(work?['APPLICATION_TEAM_TASKS']:[]),...(documents?['APPLICATION_DOCUMENT_REVIEW','F11_PRIVATE_DOCUMENT_STORAGE']:[]),'F12_PRIVATE_CATALOG_READ','F7_AUDIT_LEDGER','F4_RUNTIME_METADATA_ACCESS']),
   allowedCompatibilityStates:Object.freeze(['COMPATIBLE']),readOnlyEligible:false,inputSchema:Object.freeze({validate:v=>inputs.has(v)}),
   resultSchema:Object.freeze({validate:v=>v!==undefined}),requiredPermission:operationCode,
   limits:Object.freeze({maxPageSize:25,maxRows:10000,maxBytes:operationCode==='NOTIFICATION_READ'?2097152:1048576}),timeoutMs:10000});
 });
 const runtime=createTenantRuntime({...dependencies,operationCatalog:createAuthorizedTenantOperationCatalog(Object.freeze({catalogVersion:'application-first-slice-v1',operations:Object.freeze(entries)}),catalogs.operationCatalog)});
 async function audit(client,s,entry){
  const event=createAuditEvent({clock:()=>clock.now(),trustedContext:{organizationId:s.context.actor.organizationId,tenantId:s.context.actor.organizationId,
   operationAuthority:'TENANT',operationCode:entry.operationCode,catalogVersion:'f13-editorial-events-v1',source:'API',channel:'APPLICATION',synchronous:true},
   input:{eventCode:entry.eventCode,actor:{type:'HUMAN',id:s.context.actor.id,membershipId:s.context.actor.membershipId,serviceActorCode:null,supportGrantId:null},
    subject:null,resource:{type:entry.resourceType||'APPLICATION',id:entry.resourceId},decision:'ACCEPT',outcome:'SUCCESS',observedAt:clock.now().toISOString(),
    correlationId:s.context.correlationId,causationId:null,idempotencyKey:`${entry.auditPrefix|| (entry.operationCode==='APPLICATION_WORK_EDIT'?'APP_WORK':entry.operationCode.startsWith('APPLICATION_DOCUMENT_')||entry.operationCode==='APPLICATION_REVIEW_DECIDE'?'APP_DOC':'APP')}:${entry.idempotencyKey}`,streamType:'DATA',payload:{detailCode:entry.eventCode}}});
  await append.append(event,client);
 }
 async function run(client,s){
  await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
  const context=await authority.resolve(s.handle);s.context=context;const org=context.actor.organizationId;
  await client.query("SELECT set_config('app.organization_id',$1,true),set_config('app.membership_id',$2,true),set_config('app.notice_admin','false',true)",[org,context.actor.membershipId]);
   await acquireApplicationMutationLock(client,s.method,org);
  return scope.run({client,organizationId:org,method:s.method,...(READ_AUDIT_METHODS[s.method]?{tenantId:preparedAuthorityBinding(client).tenantId}:{}),
   sequence:0,readAuditPolicy:READ_AUDIT_METHODS[s.method]||null},async()=>{try{
   const responsibles=createResponsibleAuthority({coordinator,organizationId:org,
    assertAuthorized:()=>coordinator.assert(s.guard,client,preparedAuthorityBinding(client).transactionId)});
   const decisions=new Map();
   const alerts=createAlertsRepository({organizationId:org,actor:context.actor,
    activeRecipients:async(ids,exclude)=>{if(!ids.length)return [];return (await centralPool.query(`SELECT m.id FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id JOIN public.organization o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.id=ANY($2::uuid[]) AND m.global_user_id<>$3 AND m.status='ACTIVE' AND u.status='ACTIVE' AND o.status='ACTIVE' AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())`,[org,ids,exclude])).rows.map(r=>r.id)},
    audit:(c,e)=>audit(c,s,e),
    authorize:async(op,target)=>{const d=await authorization.authorize(op,context,target);await drain();if(!d.allowed&&/AUDIT|UNAVAILABLE|STALE|MEMBERSHIP|POLICY_INVALID/.test(d.reasonCode))fail('SERVICE_UNAVAILABLE');return d.allowed},
    protect:async args=>{const d=await guard.protect(client,{handle:s.handle,...args});s.guard=d.token;await drain();return d}});
   if(s.method.startsWith('notices')){
    const notices=createNoticesRepository({organizationId:org,actor:context.actor,cursor:tokens,audit:(c,e)=>audit(c,s,e),
     protect:async args=>{const d=await guard.protect(client,{handle:s.handle,...args});s.guard=d.token;await drain();return d},
     canManage:async()=>{
      const current=await data.authorizationDataPort.load(context.actor);if(!current)fail('SERVICE_UNAVAILABLE');if(current.profileCode!=='ORG_ADMIN')return false;
      const d=await authorization.authorize('ORGANIZATION_NOTICE_READ',context,resource(org,org,'ORGANIZATION_NOTICE'));await drain();
      if(!d.allowed&&/AUDIT|UNAVAILABLE|STALE|MEMBERSHIP|POLICY_INVALID/.test(d.reasonCode))fail('SERVICE_UNAVAILABLE');return d.allowed;
     },
     recipients:async ids=>{const rows=(await centralPool.query(`SELECT m.id,u.display_name FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id JOIN public.organization o ON o.id=m.organization_id
      WHERE m.organization_id=$1 AND ($2::uuid[] IS NULL OR m.id=ANY($2)) AND m.status='ACTIVE' AND u.status='ACTIVE' AND o.status='ACTIVE'
      AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()) ORDER BY u.display_name,m.id LIMIT 1001`,[org,ids])).rows;
      if(rows.length>1000)fail('LIMIT_EXCEEDED');return rows.map(r=>({membershipId:r.id,name:r.display_name}));}
    });return await notices[s.method](client,s.id,s.input);
   }
   if(s.method.startsWith('alerts'))return await alerts[s.method](client,s.id,s.input);
   if(s.method==='dashboardContext'){
    const directoryResource=require('../organizationDirectory/repository').resource;
    const additionalAuthorizations=[{operationCode:'OPPORTUNITY_READ',resource:resource(org,org,'OPPORTUNITY')},...(s.input.unitsAvailable?[
     {operationCode:'ORGANIZATION_DIRECTORY_READ',resource:directoryResource(org)},
     {operationCode:'ORGANIZATIONAL_SCOPE_READ',resource:directoryResource(org,org,'ORGANIZATIONAL_SCOPE')}]:[])];
    const decision=await guard.protect(client,{handle:s.handle,operationCode:'APPLICATION_READ',resource:resource(org,org),intention:{operation:'APPLICATION_DASHBOARD_CONTEXT'},additionalAuthorizations});s.guard=decision.token;await drain();
    return {organizationId:org};
   }
   let reportChecks=[];
   if(['report','reportExport'].includes(s.method)){
    const directoryResource=require('../organizationDirectory/repository').resource;
    const checks=[{operationCode:'ORGANIZATION_DIRECTORY_READ',resource:directoryResource(org)},{operationCode:'ORGANIZATIONAL_SCOPE_READ',resource:directoryResource(org,org,'ORGANIZATIONAL_SCOPE')}];
    let allowed=true;
    for(const check of checks){const d=await authorization.authorize(check.operationCode,context,check.resource);await drain();if(!d.allowed){if(/AUDIT|UNAVAILABLE|STALE|MEMBERSHIP|POLICY_INVALID/.test(d.reasonCode))fail('SERVICE_UNAVAILABLE');allowed=false}}
    if(allowed)reportChecks=checks;
   }
   const assertCurrent=()=>coordinator.assert(s.guard,client,preparedAuthorityBinding(client).transactionId);
   const readAuthority=require('./readAuthority').createReadAuthority({catalogs,policyVersion,recentMfaRequirement,data,context,assertCurrent,clock});
   const capability=require('./browseAuthority').createTransitionCapability({catalogs,policyVersion,recentMfaRequirement,data,context,assertCurrent,clock});
   const repository=createApplicationRepository({organizationId:org,actor:context.actor,cursor:tokens,centralOrigin,centralCurrent,notify:alerts.notify,
    readAuthority,transitionCapability:id=>capability(resource(id,org)),
    responsibleDirectory:async()=>{
     assertCurrent();
     const rows=(await centralPool.query(`SELECT m.id,u.display_name FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id WHERE m.organization_id=$1 ORDER BY m.id LIMIT 10001`,[org])).rows;
     if(rows.length>10000)fail('LIMIT_EXCEEDED');assertCurrent();
     return new Map(rows.map(row=>[row.id,row.display_name]));
    },
    reportDirectory:async c=>{
     if(!reportChecks.length)return null;
     coordinator.assert(s.guard,c,preparedAuthorityBinding(c).transactionId);
     const rows=(await c.query(`WITH population AS (
      SELECT pu.scope_id,count(*)::int AS people FROM organizational_scope.person p
      LEFT JOIN organizational_scope.person_unit pu ON pu.organization_id=p.organization_id AND pu.person_id=p.person_id AND pu.is_primary
      WHERE p.organization_id=$1 AND p.active GROUP BY pu.scope_id)
      SELECT s.scope_id,s.label,s.parent_scope_id,s.lifecycle,COALESCE(p.people,0) AS people FROM organizational_scope.scope s
      LEFT JOIN population p ON p.scope_id=s.scope_id WHERE s.organization_id=$1 AND s.scope_type='UNIT'
      UNION ALL SELECT NULL,'Sem unidade atribuída',NULL,NULL,COALESCE((SELECT people FROM population WHERE scope_id IS NULL),0)
      ORDER BY label,scope_id LIMIT 1002`,[org])).rows;
     if(rows.length>1001)fail('LIMIT_EXCEEDED');
     return {units:rows.map(u=>({unitId:u.scope_id,label:u.label,parentUnitId:u.parent_scope_id,lifecycle:u.lifecycle,people:u.people}))};
    },
    responsibleNames:responsibles.names,
    verifyResponsible:responsibles.validate,audit:(c,entry)=>audit(c,s,entry),
    authorize:async(op,target)=>{
     const key=JSON.stringify([op,target]);
     if(['browse','report','reportExport','partnersBrowse'].includes(s.method)&&decisions.has(key)){coordinator.assert(s.guard,client,preparedAuthorityBinding(client).transactionId);return decisions.get(key)}
     const decision=await authorization.authorize(op,context,target);await drain();
     if(['browse','report','reportExport','partnersBrowse'].includes(s.method)&&!decision.allowed&&/AUDIT|UNAVAILABLE|STALE|MEMBERSHIP|POLICY_INVALID/.test(decision.reasonCode))fail('SERVICE_UNAVAILABLE');
     decisions.set(key,decision.allowed);return decision.allowed},
    protect:async args=>{const report=['report','reportExport'].includes(s.method);const decision=await guard.protect(client,{handle:s.handle,...args,...(report?{intention:{operation:'APPLICATION_REPORT'},additionalAuthorizations:[...(args.additionalAuthorizations||[]),...reportChecks]}:{})});s.guard=decision.token;await drain();return decision}});
   const workRepository=createWorkRepository({organizationId:org,actor:context.actor,cursor:tokens,notify:alerts.notify,
    verifyResponsible:responsibles.validate,audit:(c,entry)=>audit(c,s,entry),
    protect:async args=>{const decision=await guard.protect(client,{handle:s.handle,...args});s.guard=decision.token;await drain();return decision}});
   const documentsRepository=createApplicationDocumentsRepository({organizationId:org,actor:context.actor,cursor:tokens,
    audit:(c,entry)=>audit(c,s,entry),authorize:async(op,target)=>{const decision=await authorization.authorize(op,context,target);await drain();return decision.allowed},
    protect:async args=>{const decision=await guard.protect(client,{handle:s.handle,...args});s.guard=decision.token;await drain();return decision}});
   const partnersRepository=createPartnersRepository({organizationId:org,actor:context.actor,cursor:tokens,audit:(c,entry)=>audit(c,s,entry),
    protect:async args=>{const decision=await guard.protect(client,{handle:s.handle,...args});s.guard=decision.token;await drain();return decision},
    authorize:async(op,target)=>{const key=JSON.stringify([op,target]);if(decisions.has(key)){coordinator.assert(s.guard,client,preparedAuthorityBinding(client).transactionId);return decisions.get(key)}
     const decision=await authorization.authorize(op,context,target);await drain();if(!decision.allowed&&/AUDIT|UNAVAILABLE|STALE|MEMBERSHIP|POLICY_INVALID/.test(decision.reasonCode))fail('SERVICE_UNAVAILABLE');decisions.set(key,decision.allowed);return decision.allowed;}});
   if(s.method.startsWith('partner'))return await partnersRepository[s.method](client,s.id,s.input);
   if(s.method==='responsibles'){
    const decision=await guard.protect(client,{handle:s.handle,operationCode:'APPLICATION_READ',resource:resource(org,org)});s.guard=decision.token;await drain();
    return await responsibles.list(s.input.cursor);
   }
   if(s.method.startsWith('work')||s.method.startsWith('participant')||s.method.startsWith('task'))return await workRepository[s.method](client,s.id,s.input);
   if(s.method.startsWith('document')||s.method.startsWith('review'))return await documentsRepository[s.method](client,s.id,s.input);
   return await repository[s.method](client,...(['edit','transition','get','history'].includes(s.method)?[s.id,...(['edit','transition','history'].includes(s.method)?[s.input]:[])]:[s.input]));
  }finally{await drain()}});
 }
 async function attempt(s){const input=Object.freeze({});inputs.set(input,s);try{
  const lease=await runtime.resolve({correlationId:s.context.correlationId,operationAdapter:adapters[OPERATIONS[s.method].code],
   organizationContext:{organizationId:s.context.actor.organizationId,membershipId:s.context.actor.membershipId,membershipVersion:s.context.actor.membershipVersion}});
  return await lease.execute(input);
 }catch(error){onFailure(error);if(error.internalCode==='COMMIT_UNCERTAIN')return{uncertain:true};throw Object.assign(new Error('Application refused'),{code:error.internalCode||error.code||'SERVICE_UNAVAILABLE'})}
 finally{inputs.delete(input)}}
 return Object.freeze({async execute(method,raw,id,request){
  const input=method.startsWith('notices')?createNoticeInput(method,raw):method.startsWith('alerts')?createAlertInput(method,raw):method.startsWith('partner')?createPartnerInput(method,raw):method.startsWith('work')||method.startsWith('participant')||method.startsWith('task')?createWorkInput(method,raw):method.startsWith('document')||method.startsWith('review')?createDocumentInput(method,raw):['create','edit','transition'].includes(method)?command(method,raw):query(method,raw);
  const exactId=id?uuid(id):null;
  // Share only this adjacent validation point; finish before tenant admission.
  const {handle,context}=await coordinator.withAuthority(async()=>{
   const handle=await authority.captureAuthenticatedRequest(request);
   const context=await authority.resolve(handle);
   return {handle,context};
  });
  const expectedOrganization=request.headers?.['x-c4g-organization'];
  if(expectedOrganization!==undefined&&uuid(expectedOrganization)!==context.actor.organizationId)fail('RESOURCE_NOT_AVAILABLE');
  coordinator.registerRecovery(context.actor.organizationId,createTenantAuthorityRecovery(dependencies));
  const s={method,input,id:exactId,handle,context,guard:null};let result=await attempt(s);
  if(result?.uncertain){await coordinator.reconcile(s.guard);s.context=await authority.resolve(handle);s.guard=null;result=await attempt(s);if(result?.uncertain)fail('SERVICE_UNAVAILABLE')}
  return result;
 }});
}
module.exports={createApplicationComposition,APPLICATION_OPERATIONS:OPERATIONS,acquireApplicationMutationLock};
