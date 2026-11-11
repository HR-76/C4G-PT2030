'use strict';
const assert=require('node:assert/strict'),{randomUUID,randomBytes}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {bootstrap}=require('./executor-11145-fixture.cjs');
const installer=require('../../../scripts/opportunity-v2-install.cjs');
const pkg=require('../../../backend/src/security/opportunityV2MigrationPackage');
async function habitualInstallerProof({central,tenant,connection,report,check,outputDirectory}){
 let fixture,state,stateFiles,result,http,physical;
 report.package={id:pkg.PACKAGE_ID,digest:pkg.packageDigest,centralOrder:pkg.centralEntries.map(entry=>({version:entry.version,checksum:entry.upChecksum,fingerprint:entry.schemaFingerprint})),tenant:{version:pkg.tenantAddition.version,checksum:pkg.tenantAddition.sqlChecksum,fingerprint:pkg.tenantAddition.schemaFingerprint}};
 try{
  await check('INSTALLER_BASELINE_REAL_DIRECTORY_AND_SYNTHETIC_CONFIG',async()=>{
   fixture=await bootstrap(central,tenant);
   const proof=await require('../../../backend/src/security/tenantMigrationPreflight').preflightTenant(tenant,fixture.identity,undefined,{timeoutMs:30000});
   const apiPassword=randomBytes(32).toString('hex'),workerPassword=randomBytes(32).toString('hex');
   await (await require('../../../backend/src/security/localTenantIdentityProvisioner').createLocalTenantIdentityProvisioner(tenant)).reconcile({apiLogin:'c4g_local_api',workerLogin:'c4g_local_worker',apiPassword,workerPassword,apiRoles:['c4g_opportunity_tenant_runtime'],workerRoles:['c4g_import_worker_runtime']});
   await tenant.query('GRANT CONNECT ON DATABASE registered_tenant TO c4g_local_api,c4g_local_worker');
   const credentials={tenantId:fixture.identity.tenantId,workload:'API',connectionVersion:1,credentialRef:'installer-api-'+randomUUID(),host:connection.host,port:connection.port,database:'registered_tenant',login:'c4g_local_api',password:apiPassword,ssl:false};
   const snapshot={organizationId:fixture.organizationId,tenantId:fixture.identity.tenantId,workload:'API',deploymentMode:'DATABASE_PER_ORGANIZATION',provisioningStatus:'READY',connectionVersion:1,connectionState:'READY',connectionRevision:1,versionState:'VALIDATED',databaseGenerationId:fixture.identity.databaseGenerationId,databaseRef:'registered_tenant',credentialRef:credentials.credentialRef,fence:1,regionCode:'LOCAL',residencyPolicyVersion:'local-development-v1',observedSystemIdentifier:proof.systemIdentifier,bindingDigest:require('../../../backend/src/security/localTenantCredentialAdapter').bindingDigest(credentials),schema:{compatibilityState:'COMPATIBLE',currentVersion:proof.currentVersion,minimumReadVersion:proof.compatibility.readVersions[0],minimumWriteVersion:proof.compatibility.writeVersions[0],verifiedCapabilities:{...Object.fromEntries(proof.capabilities.map(value=>[value,true])),schemaFingerprint:proof.schemaFingerprint},schemaFingerprint:proof.schemaFingerprint,revision:2}};
   const installationId=randomUUID(),published=await require('../../../backend/src/platformOnboarding/registerExistingTenant').registerExistingTenant({pool:central,snapshot,correlationId:installationId});
   state={phase:'READY',installationId,organizationId:fixture.organizationId,tenantId:fixture.identity.tenantId,generationId:fixture.identity.databaseGenerationId,target:{host:connection.host,port:connection.port,centralDatabase:'registered_central',tenantDatabase:'registered_tenant'},snapshot:{...published,connectionRevision:1,fence:0},credentials,memberAccess:true,identity:{origin:'http://localhost:3000'},permitSecret:randomBytes(48).toString('hex')};
   stateFiles=[{relative:installer.MEMBERS_FILE,value:{ownershipKey:randomBytes(32).toString('hex'),bindings:[{organizationId:state.organizationId,credentials:structuredClone(credentials),snapshot:structuredClone(published)},{organizationId:randomUUID(),credentials:{fixture:'unchanged'},snapshot:{fixture:'unchanged'}}]}}];
   installer.validateState(state,stateFiles);report.fixture={syntheticPrivateConfiguration:true,realDirectoryPublication:true,legacyRunStatus:'ERROR',tenantId:state.tenantId,generationId:state.generationId};
  });
  const before={central:await installer.capture(central,{central:true,tenantId:state.tenantId}),tenant:await installer.capture(tenant)},original={state:structuredClone(state),stateFiles:structuredClone(stateFiles)};
  await check('INSTALLER_PARTIAL_CENTRAL_COMMIT_FAILS_CLOSED_WITHOUT_CONFIG_WRITE',async()=>{
   await assert.rejects(installer.install({central,tenant,state,stateFiles,checkpoint:async value=>{if(value.stage==='CENTRAL_APPLIED')throw Error('ISOLATED_AFTER_CENTRAL_COMMIT');}}),error=>{assert.equal(error.installationStage,'CENTRAL_APPLIED');assert.equal(error.migrationsMayHaveCommitted,true);report.partialCommit={stage:error.installationStage,requiresConsumersRemainStopped:true,configurationUnchanged:true};return true;});
   assert.equal((await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(central)).currentVersion,pkg.centralEntries.at(-1).version);
   assert.equal((await require('../../../backend/src/security/tenantMigrationPreflight').preflightTenant(tenant,fixture.identity,undefined,{timeoutMs:30000})).currentVersion,pkg.TENANT_BASELINE);
   assert.deepEqual({state,stateFiles},original);await installer.assertPreserved(central,before.central);await installer.assertPreserved(tenant,before.tenant);
  });
  await check('INSTALLER_PROGRESSIVE_RECOVERY_REAL_PUBLISHER_AND_RESTRICTED_CONFIG',async()=>{
   const stages=[];result=await installer.install({central,tenant,state,stateFiles,checkpoint:async value=>stages.push(value)});assert.equal(result.report.status,'PASS');assert.deepEqual(result.report.centralApplied,[]);assert.deepEqual(result.report.tenantApplied,[pkg.tenantAddition.version]);assert.equal(stages.at(-1).stage,'INSTALL_VERIFIED');
   assert.deepEqual({state,stateFiles},original);assert.deepEqual(result.state.credentials,state.credentials);assert.deepEqual(result.stateFiles[0].value.bindings[1],stateFiles[0].value.bindings[1]);assert.deepEqual(result.state.opportunityActivation,installer.ACTIVATION);assert.equal(result.state.snapshot.schema.currentVersion,pkg.tenantAddition.version);
   await installer.assertPreserved(central,before.central);await installer.assertPreserved(tenant,before.tenant);report.installation=result.report;
  });
  await check('INSTALLER_EXACT_REPLAY_NO_SQL_REAPPLY_OR_SCHEMA_REVISION_CHANGE',async()=>{
   const current=(await central.query('SELECT * FROM public.tenant_schema_state WHERE tenant_id=$1',[state.tenantId])).rows[0],events=(await central.query('SELECT count(*)::int n FROM public.tenant_directory_event')).rows[0].n;
   const repeated=await installer.install({central,tenant,state:result.state,stateFiles:result.stateFiles});assert.deepEqual(repeated.report.centralApplied,[]);assert.deepEqual(repeated.report.tenantApplied,[]);assert.deepEqual(repeated.state,result.state);assert.deepEqual(repeated.stateFiles,result.stateFiles);assert.deepEqual((await central.query('SELECT * FROM public.tenant_schema_state WHERE tenant_id=$1',[state.tenantId])).rows[0],current);assert.equal((await central.query('SELECT count(*)::int n FROM public.tenant_directory_event')).rows[0].n,events);report.replay={noNewSchemaObservation:true,noRevisionIncrement:true,noSqlReapplication:true};
  });
  await check('INSTALLER_PHYSICAL_API_BINDING_AND_NORMAL_COORDINATOR_HTTP_ADMISSION',async()=>{
   physical=new Pool({...connection,database:'registered_tenant',user:state.credentials.login,password:state.credentials.password});
   const c=await physical.connect();try{await c.query('BEGIN READ ONLY');const metadata=await require('../../../backend/src/security/tenantRuntimeMetadata').observeTenantRuntimeMetadata(c,fixture.identity);assert.equal(metadata.currentVersion,pkg.tenantAddition.version);assert.equal(metadata.systemIdentifier,result.state.snapshot.observedSystemIdentifier);const verifier=require('../../../backend/src/security/tenantBindingVerifier').createTenantBindingVerifier({async observe(){return {...metadata,schemaVersion:metadata.currentVersion,bindingDigest:require('../../../backend/src/security/localTenantCredentialAdapter').bindingDigest(result.state.credentials)};}});await verifier.verify({client:c,snapshot:result.state.snapshot,requiredCapabilities:[pkg.TENANT_CAPABILITY],correlationId:state.installationId});await c.query('COMMIT');}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
   const transport=require('./executor-11145-transport.cjs').createLive11145Transport({outputDirectory,report});
   http=await require('./habitual-installer-http.cjs').createHttp({central,connection,fixture,report,fetchImpl:transport.fetchImpl});
   const response=await http.request('GET','/api/admin/opportunity-activation/sources/eu');assert.equal(response.state,'ACTIVE');assert.equal(response.fence,1);
   report.runtimeAdmission={physicalApiLogin:true,actualTenantBinding034:true,normalAuthorityCoordinator042:true,coordinatedPersistedSession:true,authenticatedHttpSourceRead:true};
  });
  await check('INSTALLER_LOCAL_SELECTION_PURE_LOGICAL_TARGET_NO_HABITUAL_IO',async()=>{
   const config={host:'localhost',port:5432,centralDatabase:'c4g_central_dev',tenantDatabase:'c4g_tenant_dev'},logical={...result.state,target:config};
   const select=require('../../../backend/scripts/localPlatform/opportunityV2Runtime').opportunityV2RuntimeEnvironment;
   assert.deepEqual(select(config,logical),{OPPORTUNITY_ACTIVATION_RUNTIME:'authenticated-v2',OPPORTUNITY_11145_EXECUTOR:'bounded-v2'});const disabled={...logical};delete disabled.opportunityActivation;assert.deepEqual(select(config,disabled),{OPPORTUNITY_ACTIVATION_RUNTIME:'disabled',OPPORTUNITY_11145_EXECUTOR:'disabled'});assert.throws(()=>select(config,{...logical,opportunityActivation:undefined}));report.localSelection={logicalFixtureOnly:true,explicitFlags:true,defaultDisabled:true};
  });
  await check('INSTALLER_REAL_HTTP_OPERATIONAL_EXECUTE11145_LIVE_ARCHIVE_APPROVAL_ACCEPT',async()=>{
   const normative=require('../../../context/references/opportunity-v2/examples/eu-11145-v2.1.json'),mappingDigest=require('../../../backend/src/opportunities/v2/activationArchive').implementationDigest('EU_FUNDING_TENDERS',normative.provenance.mappingVersion);
   const accepted={...fixture.legacy,identities:[{namespace:'EU_FUNDING_TENDERS',externalId:'CASCADE:11145'}],mappingDigest:null,corrections:{},resolutions:[],privateReferences:[]};
   const preview=require('../../../backend/src/opportunities/v2/reconciliation').previewReconciliation({accepted:[accepted],candidates:[{candidateId:'EU_FUNDING_TENDERS:CASCADE:11145',snapshot:normative,mappingDigest}]});
   const item=preview.items[0],window={kind:'opportunity11145habitualwindow-v1',windowId:randomUUID(),result:'PASS',packageDigest:pkg.packageDigest,completedAt:new Date().toISOString(),expected:{opportunityId:fixture.legacy.opportunityId,revisionId:fixture.legacy.revisionId,rowVersion:1},source:{source:'EU_FUNDING_TENDERS',externalIdentifier:'CASCADE:11145',contentDigest:require('../../../backend/src/opportunities/v2/digests').contentDigestV2(normative),mappingDigest},acceptedBinding:{snapshotDigest:item.accepted.snapshotDigest,protectedStateDigest:item.accepted.protectedStateDigest},installed:{centralVersion:result.report.after.centralVersion,tenantVersion:result.report.after.tenantVersion},backup:{backupId:randomUUID(),result:'PASS',noSourceDrift:true},resume:{health:true}};
   report.operationalWindowFixture={syntheticBackupAndHealthMetadata:true,physicalMigrationEvidence:true,syntheticLegacyPreview:true,noRealPersonApproval:true};
   const stages=[];report.operationalProgress=stages;const execution=await require('../../../scripts/opportunity-v2-approve.cjs').execute11145({window,request:http.request,authenticatedAt:http.authenticatedAt,onProgress:async value=>stages.push(value)});
   assert.equal(execution.accepted.opportunityId,fixture.legacy.opportunityId);assert.equal(execution.source.state,'QUIESCED');assert.equal(execution.source.fence,3);assert.equal(execution.readerParityVerified,true);assert.equal(execution.replayVerified,true);
   const amounts=(await central.query('SELECT amount_canonical,amount::text,currency_state,currency_code FROM opportunity_catalog.revision_allocation_v2 WHERE revision_id=$1',[execution.accepted.revisionId])).rows;assert.equal(amounts.length,1);assert.deepEqual(amounts[0],{amount_canonical:'120000',amount:'120000.00000000',currency_state:'NOT_FOUND',currency_code:null});assert.equal((await central.query('SELECT count(*)::int n FROM opportunity_catalog.revision_deadline_v2 WHERE revision_id=$1',[execution.accepted.revisionId])).rows[0].n,7);
   await installer.assertPreserved(tenant,before.tenant);assert.deepEqual((await central.query('SELECT snapshot FROM opportunity_catalog.revision WHERE revision_id=$1',[fixture.legacy.revisionId])).rows[0].snapshot,fixture.legacy.snapshot);
   const events=(await central.query("SELECT event_data,event_hash FROM audit.event WHERE organization_id IS NULL AND stream_id='PLATFORM:DATA' ORDER BY sequence")).rows.map(row=>({...row.event_data,eventHash:row.event_hash}));assert.equal(require('../../../backend/src/audit/verifier').verifyEvents(events).valid,true);
   report.operationalExecution={...execution,stages,auditEvents:events.length,auditChainValid:true,sqlAmount:amounts[0],cutoffs:7,privateSnapshotsPreserved:true};
  });
  report.packageDigest=pkg.packageDigest;report.final={...result.report.after,configurationWritten:false,habitualAccess:false,identityPreserved:true,privateLinksPreserved:true};
 }finally{await http?.close();await physical?.end();}
}
module.exports={habitualInstallerProof};
