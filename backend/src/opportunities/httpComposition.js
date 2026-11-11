'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { createAppendService } = require('../audit/appendService');
const { PostgresAppendRepository } = require('../audit/postgresAppendRepository');
const { createAuditEvent } = require('../audit/event');
const { createTaxonomySessionAuthority } = require('../security/authenticatedAuthority');
const { createAuthorityDataRepository } = require('../authorization/authorityDataRepository');
const { createTaxonomyAuthorization } = require('../authorization/resourceAuthorization');
const { createTenantRuntime } = require('../security/tenantRuntime');
const { createAuthorizedTenantOperationCatalog } = require('../security/tenantOperationCatalog');
const { isPreparedTenantTransaction, preparedAuthorityBinding, deferPreparedReadAudit, flushPreparedReadAudit } = require('../security/tenantLeaseExecutor');
const { createTenantAuthorityRecovery } = require('../security/tenantAuthorityRecovery');
const { manifest } = require('../security/tenantMigrationManifest');
const { tenantAddition: { version: OPPORTUNITY_V2_SCHEMA_VERSION } } = require('../security/opportunityV2MigrationPackage');
const { tenantFailure } = require('../security/tenantRuntimeErrors');
const { TenantOpportunityRepository } = require('./tenantRepository');
const { createIdentityFactory } = require('./identity');
const { createPostgresOpportunityAuditWriter } = require('./postgresAuditWriter');
const { updateIntentionDigest, createIntentionDigest, lifecycleIntentionDigest } = require('./digests');
const { OpportunityError } = require('./errors');
const { listQuery, editCommand, createCommand, archiveCommand, materialize, mutationReceipt, uuid } = require('./httpContracts');
const OPERATION={dashboardSummary:'OPPORTUNITY_READ',list:'OPPORTUNITY_READ',listForMatching:'OPPORTUNITY_READ',get:'OPPORTUNITY_READ',update:'OPPORTUNITY_PRIVATE_UPDATE',create:'OPPORTUNITY_PRIVATE_CREATE',archive:'OPPORTUNITY_ARCHIVE'};

// Application-only boundary. Neither handles, adapters nor prepared clients are returned over HTTP.
function createOpportunityHttpComposition({ sessionStore, sessionRegistry, authorityCoordinator,
  authorizationCatalogs, assurancePolicyVersion, recentMfaRequirement, tenantRuntimeDependencies,
  authorizationAuditPort, telemetry, clock={now:()=>new Date()}, auditWriterFactory=createPostgresOpportunityAuditWriter,
  onFailure=()=>{} }) {
  if (!tenantRuntimeDependencies?.bindingVerifier || !tenantRuntimeDependencies?.directoryRepository || !telemetry?.observe)
    throw new TypeError('F12 HTTP requires explicit F4 runtime dependencies.');
  const data=createAuthorityDataRepository({coordinator:authorityCoordinator,policyVersion:assurancePolicyVersion,
    catalogs:authorizationCatalogs,recentMfaRequirement});
  const authority=createTaxonomySessionAuthority({sessionStore,sessionRegistry,authorityCoordinator,
    membershipPort:data.membershipPort,authorizationDataPort:data.authorizationDataPort,policyVersion:assurancePolicyVersion,clock});
  const auditScope=new AsyncLocalStorage(),appendService=createAppendService({appendPort:new PostgresAppendRepository()});
  const decisionAudit=authorizationAuditPort||{async accept(event){
    const state=auditScope.getStore();if(!state)throw new Error('F12_AUDIT_TRANSACTION_REQUIRED');
    try{
      const candidate=createAuditEvent({trustedContext:{organizationId:state.context.actor.organizationId,tenantId:state.tenantId,
        operationAuthority:'TENANT',operationCode:event.operationCode,source:'API',channel:'APPLICATION',synchronous:true},
        input:{eventCode:event.eventType,actor:{type:'HUMAN',id:event.actorId,membershipId:event.membershipId,
          serviceActorCode:null,supportGrantId:null},subject:null,resource:event.resourceId?{type:'OPPORTUNITY',id:event.resourceId}:null,
          decision:event.result==='ALLOW'?'ALLOW':'DENY',outcome:event.result==='ALLOW'?'SUCCESS':'DENIED',
          observedAt:clock.now().toISOString(),correlationId:event.correlationId,causationId:null,
          idempotencyKey:`F5:${event.operationCode}:${event.correlationId}:${event.result}`,streamType:'DATA',
          payload:{detailCode:event.reasonCode,policyVersion:event.policyVersion||assurancePolicyVersion,catalogVersion:event.catalogVersion||authorizationCatalogs.operationCatalog.version,
            ...(event.assuranceLevel?{assuranceLevel:event.assuranceLevel}:{})}},clock:()=>clock.now()});
      if(state.method==='dashboardSummary') {
        if(deferPreparedReadAudit(state.client,'OPPORTUNITY_DASHBOARD',candidate))return 'TRANSACTION_PENDING';
        await flushPreparedReadAudit(state.client);
      }
      await appendService.append(candidate,state.client);return 'ACCEPTED';
    }catch(error){state.auditFailed=true;onFailure(error);throw error;}
  }};
  const authorization=createTaxonomyAuthorization({catalogs:authorizationCatalogs,membershipPort:data.membershipPort,
    authorizationDataPort:data.authorizationDataPort,authorizationAuditPort:decisionAudit,assurancePolicyVersion,recentMfaRequirement,clock,
    exactResourceScope:false});
  const guardPort=authorityCoordinator.bindAuthority({sessionAuthority:authority,authorization,
    operationCatalog:authorizationCatalogs.operationCatalog,permissionCatalog:authorizationCatalogs.permissionCatalog,recentMfaRequirement});
  const inputs=new WeakMap(), repositories=new Map();
  function repository(organizationId,tenantId) {
    const key=`${organizationId}:${tenantId}`;
    if (!repositories.has(key)) repositories.set(key,new TenantOpportunityRepository({organizationId,
      // There is deliberately no standalone connection path. Only F4's client may enter.
      pool:{connect(){throw new Error('F12_PREPARED_CLIENT_REQUIRED');}},identityFactory:createIdentityFactory(),
      auditWriter:auditWriterFactory({authority:'ORGANIZATION',organizationId,tenantId,clock:()=>clock.now()})}));
    return repositories.get(key);
  }
  const resource=(id,organizationId)=>Object.freeze({id,organizationId,resourceType:'OPPORTUNITY',status:'ACTIVE',
    scopeType:id===organizationId?'ORGANIZATION':'RESOURCE',scopeId:id,
    distinctFromActorIds:Object.freeze([]),unitId:null,teamIds:Object.freeze([]),ancestorUnitIds:Object.freeze([])});
  function dto(record) {
    const rowVersion=Number(record.rowVersion),revisionNumber=Number(record.revisionNumber);
    if(!Number.isSafeInteger(rowVersion)||rowVersion<1||!Number.isSafeInteger(revisionNumber)||revisionNumber<1)
      throw new OpportunityError('OPPORTUNITY_UNAVAILABLE');
    return {...record,rowVersion,revisionNumber};
  }
  async function execute(client,state) {
    const {context,handle,method,command,tenantId}=state,organizationId=context.actor.organizationId;
    if (!isPreparedTenantTransaction(client,{organizationId,tenantId,workload:'API',requiredCapabilities:['F12_PRIVATE_CATALOG_READ','F7_AUDIT_LEDGER','F4_RUNTIME_METADATA_ACCESS']}))
      throw new OpportunityError('OPPORTUNITY_UNAVAILABLE');
    const repo=repository(organizationId,tenantId);
    return repo.withTransactionClient(client,()=>auditScope.run({...state,client},async()=>{
      let current=null,full=null,materializationError=null;
      if(!['dashboardSummary','list','listForMatching','create'].includes(method)) {
        current=(await client.query(`SELECT opportunity_id::text AS id,current_revision_id::text AS revision_id,lifecycle_state
          FROM opportunity_catalog.opportunity WHERE organization_id=$1 AND opportunity_id=$2${['update','archive'].includes(method)?' FOR UPDATE':''}`,
        [organizationId,command.opportunityId])).rows[0];
        if(!current)throw new OpportunityError('OPPORTUNITY_NOT_FOUND');
      }
      const target=resource(current?.id||organizationId,organizationId);
      if(method==='update') {
        const base=(await client.query(`SELECT snapshot FROM opportunity_catalog.revision
          WHERE organization_id=$1 AND opportunity_id=$2 AND row_version=$3`,
        [organizationId,command.opportunityId,command.expectedRowVersion])).rows[0];
        // Authorize even a stale/missing base, before disclosing CAS state.
        if(base)try{full=materialize(command,base.snapshot,clock.now().toISOString());}
        catch(error){materializationError=error;}
      }
      const sourceOperation={create:'CREATE',update:'UPDATE',archive:'ARCHIVE'}[method];
      const intention=method==='create'?{operation:'F12_CREATE',key:command.requestId,digest:createIntentionDigest(command,'ORGANIZATION',organizationId)}:
        method==='archive'?{operation:'F12_ARCHIVE',key:command.requestId,digest:lifecycleIntentionDigest(command,'ORGANIZATION',organizationId)}:
        full?{operation:'F12_UPDATE',key:full.requestId,digest:updateIntentionDigest(full,'ORGANIZATION',organizationId)}:{operation:'F12_READ'};
      const protectedDecision=await guardPort.protect(client,{handle,operationCode:OPERATION[method],resource:target,intention});
      state.guard=protectedDecision.token;
      if(auditScope.getStore().auditFailed)throw new OpportunityError('OPPORTUNITY_UNAVAILABLE');
      const trusted=protectedDecision.decision.trustedContext;
      const mutationContext={actor:{type:'HUMAN',reference:trusted.actor.id},audit:{membershipId:trusted.actor.membershipId,correlationId:trusted.correlationId}};
      if(state.reconciliation&&sourceOperation){
        const stored=await client.query(`SELECT request_digest FROM opportunity_catalog.idempotency_record
          WHERE organization_id=$1 AND operation=$2 AND request_id=$3`,[organizationId,sourceOperation,command.requestId]);
        if(stored.rowCount!==1)throw new OpportunityError('OPPORTUNITY_UNAVAILABLE');
      }
      if(method==='dashboardSummary')return require('../applications/opportunitySummary').opportunitySummary(client,{organizationId,today:command.today,...(command.asOf?{asOf:command.asOf}:{})});
      if(method==='listForMatching') {
        const result=await repo.list(command);
        if(!result.items.length)return result;
        const ids=result.items.map(item=>item.opportunityId);
        const snapshots=await client.query(`SELECT o.opportunity_id::text AS "opportunityId",r.snapshot
          FROM opportunity_catalog.opportunity o
          JOIN opportunity_catalog.revision r ON r.organization_id=o.organization_id AND r.revision_id=o.current_revision_id
          WHERE o.organization_id=$1 AND o.opportunity_id=ANY($2::uuid[])`,[organizationId,ids]);
        const byId=new Map(snapshots.rows.map(row=>[row.opportunityId,row.snapshot]));
        if(byId.size!==ids.length||ids.some(id=>!byId.has(id)))throw new OpportunityError('OPPORTUNITY_UNAVAILABLE');
        return {...result,items:result.items.map(item=>({...dto(item),snapshot:byId.get(item.opportunityId)}))};
      }
      if(method==='list') {const result=await repo.list(command);
        const canCreate=await authorization.authorize('OPPORTUNITY_PRIVATE_CREATE',trusted,target);
        if(auditScope.getStore().auditFailed)throw new OpportunityError('OPPORTUNITY_UNAVAILABLE');
        return {...result,items:result.items.map(dto),permissions:{create:canCreate.allowed}};}
      if(method==='create')return mutationReceipt(await repo.create(command,mutationContext));
      if(method==='archive')return mutationReceipt(await repo.changeLifecycle(command,{...mutationContext,
        lifecycleProvenance:{schemaVersion:1,sourceType:'ORGANIZATION_MANUAL',sourceNamespace:'F12_HTTP_AUTHORING',observedAt:clock.now().toISOString()}}));
      if(method==='update') {
        // Disclose merged-state validation only after the real F5 decision.
        if(materializationError)throw materializationError;
        if(!full)throw new OpportunityError('OPPORTUNITY_STALE_REVISION');
        if(!['DRAFT','ACTIVE','STALE'].includes(current.lifecycle_state))throw new OpportunityError('OPPORTUNITY_STALE_REVISION');
        const result=await repo.update(full,mutationContext);
        return mutationReceipt(result);
      }
      const head=await repo.get(command.opportunityId);
      const stored=(await client.query(`SELECT snapshot FROM opportunity_catalog.revision
        WHERE organization_id=$1 AND revision_id=$2`,[organizationId,head.revisionId])).rows[0];
      if(!stored)throw new OpportunityError('OPPORTUNITY_NOT_FOUND');
      const mutable=['DRAFT','ACTIVE','STALE'].includes(head.lifecycleState);
      const editable=mutable?await authorization.authorize('OPPORTUNITY_PRIVATE_UPDATE',trusted,target):{allowed:false};
      const archivable=mutable?await authorization.authorize('OPPORTUNITY_ARCHIVE',trusted,target):{allowed:false};
      if(auditScope.getStore().auditFailed)throw new OpportunityError('OPPORTUNITY_UNAVAILABLE');
      return {...dto(head),snapshot:stored.snapshot,permissions:{edit:editable.allowed,archive:archivable.allowed}};
    }));
  }
  const adapters={};
  const entries=Object.freeze([...new Set(Object.values(OPERATION))].map(code=>{
    const write=code!=='OPPORTUNITY_READ';
    const queryModule=Object.freeze({moduleCode:`F12_HTTP_${code}`,requiresAuditWrite:true,
      async execute({client,input}){try{return await execute(client,inputs.get(input));}
        catch(error){onFailure(error);throw tenantFailure(error.code==='AUTHORITY_DENIED'?'OPPORTUNITY_NOT_FOUND':error.code||'OPPORTUNITY_UNAVAILABLE','TENANT_OPERATION_UNAVAILABLE');}},
      beforeCommit:({client})=>client.query('RESET ROLE'),
      authorityGuard:Object.freeze({assert({client,input}){const state=inputs.get(input);
        authorityCoordinator.assert(state.guard,client,preparedAuthorityBinding(client).transactionId);},
        async complete({input,outcome}){const state=inputs.get(input);if(state?.guard)await authorityCoordinator.complete(state.guard,outcome);}})});
    adapters[code]=Object.freeze({operationCode:code,queryModule});
    return Object.freeze({operationCode:code,requiredPermission:code,ownerModule:'F12_PRIVATE_HTTP_RUNTIME',
      accessMode:write?'WRITE':'READ',workload:'API',workloadClass:'FUNCTIONAL',queryModule,
      compatibleSchemaVersions:Object.freeze([...manifest.filter(entry=>entry.capabilities.includes('F4_RUNTIME_METADATA_ACCESS')).map(entry=>entry.version),OPPORTUNITY_V2_SCHEMA_VERSION]),
      requiredCapabilities:Object.freeze(['F12_PRIVATE_CATALOG_READ',...(write?['F12_PRIVATE_CATALOG_WRITE']:[]),'F7_AUDIT_LEDGER','F4_RUNTIME_METADATA_ACCESS']),
      allowedCompatibilityStates:Object.freeze(['COMPATIBLE']),readOnlyEligible:false,
      inputSchema:Object.freeze({validate:value=>inputs.has(value)}),resultSchema:Object.freeze({validate:value=>value!==undefined}),
      limits:Object.freeze({maxPageSize:100,maxRows:100,maxBytes:1048576}),timeoutMs:10000});
  }));
  const runtime=createTenantRuntime({...tenantRuntimeDependencies,operationCatalog:createAuthorizedTenantOperationCatalog(
    Object.freeze({catalogVersion:'f12-private-http-v1',operations:entries}),authorizationCatalogs.operationCatalog)});
  async function attempt(state) {
    const input=Object.freeze({});inputs.set(input,state);
    try {
      const lease=await runtime.resolve({organizationContext:{organizationId:state.context.actor.organizationId,
        membershipId:state.context.actor.membershipId,membershipVersion:state.context.actor.membershipVersion},
        operationAdapter:adapters[OPERATION[state.method]],correlationId:state.context.correlationId});
      return await lease.execute(input);
    } catch(error) {
      onFailure(error);
      if(error.internalCode==='COMMIT_UNCERTAIN')return{uncertain:true};
      throw new OpportunityError(error.internalCode?.startsWith('OPPORTUNITY_')?error.internalCode:'OPPORTUNITY_UNAVAILABLE');
    } finally {inputs.delete(input);}
  }
  async function run(method,command,request) {
    return telemetry.observe(['update','create','archive'].includes(method)?`opportunity.${method}`:'opportunity.read',async()=>{
      let handle,context;
      try{({handle,context}=await authorityCoordinator.withAuthority(async()=>{
        const handle=await authority.captureAuthenticatedRequest(request);
        const context=await authority.resolve(handle);
        return {handle,context};
      }));}
      catch(error){onFailure(error);throw new OpportunityError(
        error.code==='AUTHORITY_REQUIRED'?'OPPORTUNITY_AUTHORIZATION_REQUIRED':'OPPORTUNITY_UNAVAILABLE');}
      const snapshot=await tenantRuntimeDependencies.directoryRepository.resolveSnapshotByOrganization(context.actor.organizationId,'API');
      if(!snapshot?.tenantId)throw new OpportunityError('OPPORTUNITY_UNAVAILABLE');
      authorityCoordinator.registerRecovery(snapshot.tenantId,createTenantAuthorityRecovery(tenantRuntimeDependencies));
      const state={method,command,context,handle,tenantId:snapshot.tenantId};
      const result=await attempt(state);
      if(!result?.uncertain)return result;
      await authorityCoordinator.reconcile(state.guard);
      state.context=await authority.resolve(handle);state.reconciliation=true;state.guard=null;
      const reconciled=await attempt(state);
      if(reconciled?.uncertain)throw new OpportunityError('OPPORTUNITY_UNAVAILABLE');
      return reconciled;
    });
  }
  return Object.freeze({list:(query,request)=>run('list',listQuery(query),request),
    dashboardSummary:(today,request,asOf)=>run('dashboardSummary',{today,...(asOf?{asOf}:{})},request),
    listForMatching:(query,request)=>run('listForMatching',listQuery(query),request),
    get:(id,request)=>run('get',{opportunityId:uuid(id)},request),
    update:(id,body,request)=>run('update',editCommand(id,body),request),
    create:(body,request)=>run('create',createCommand(body,clock.now().toISOString()),request),
    archive:(id,body,request)=>run('archive',archiveCommand(id,body),request)});
}
module.exports={createOpportunityHttpComposition};
