'use strict';
// Disposable PostgreSQL and synthetic configuration only. Uses the real normal
// directory publication and the operational043 installer, without file writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,randomBytes}=require('node:crypto');
const pkg=require('../../../backend/src/security/opportunityEuWriterMigrationPackage');
const installed=require('../../../backend/src/security/opportunityV2MigrationPackage');
async function configurationFixture({central,tenant,connection,fixture}){
 const proof=await require('../../../backend/src/security/tenantMigrationPreflight').preflightTenant(tenant,fixture.identity,undefined,{timeoutMs:30000});
 assert.equal(proof.currentVersion,installed.tenantAddition.version);
 const apiPassword=randomBytes(32).toString('hex'),workerPassword=randomBytes(32).toString('hex');
 await (await require('../../../backend/src/security/localTenantIdentityProvisioner').createLocalTenantIdentityProvisioner(tenant)).reconcile({apiLogin:'c4g_writer_api',workerLogin:'c4g_writer_worker',apiPassword,workerPassword,apiRoles:['c4g_opportunity_tenant_runtime'],workerRoles:['c4g_import_worker_runtime']});
 await tenant.query('GRANT CONNECT ON DATABASE registered_tenant TO c4g_writer_api,c4g_writer_worker');
 const credentials={tenantId:fixture.identity.tenantId,workload:'API',connectionVersion:1,credentialRef:'writer-api-'+randomUUID(),host:connection.host,port:connection.port,database:'registered_tenant',login:'c4g_writer_api',password:apiPassword,ssl:false};
 const snapshot={organizationId:fixture.organizationId,tenantId:fixture.identity.tenantId,workload:'API',deploymentMode:'DATABASE_PER_ORGANIZATION',provisioningStatus:'READY',connectionVersion:1,connectionState:'READY',connectionRevision:1,versionState:'VALIDATED',databaseGenerationId:fixture.identity.databaseGenerationId,databaseRef:'registered_tenant',credentialRef:credentials.credentialRef,fence:1,regionCode:'LOCAL',residencyPolicyVersion:'local-development-v1',observedSystemIdentifier:proof.systemIdentifier,bindingDigest:require('../../../backend/src/security/localTenantCredentialAdapter').bindingDigest(credentials),schema:{compatibilityState:'COMPATIBLE',currentVersion:proof.currentVersion,minimumReadVersion:proof.compatibility.readVersions[0],minimumWriteVersion:proof.compatibility.writeVersions[0],verifiedCapabilities:{...Object.fromEntries(proof.capabilities.map(value=>[value,true])),schemaFingerprint:proof.schemaFingerprint},schemaFingerprint:proof.schemaFingerprint,revision:2}};
 const installationId=randomUUID(),published=await require('../../../backend/src/platformOnboarding/registerExistingTenant').registerExistingTenant({pool:central,snapshot,correlationId:installationId});
 return {phase:'READY',installationId,organizationId:fixture.organizationId,tenantId:fixture.identity.tenantId,generationId:fixture.identity.databaseGenerationId,
  target:{host:connection.host,port:connection.port,centralDatabase:'registered_central',tenantDatabase:'registered_tenant'},snapshot:published,credentials,memberAccess:true,identity:{origin:'http://localhost:3000'},permitSecret:randomBytes(48).toString('hex'),
  funding:{coverage:'durable-v1',source:'live-local'},opportunityActivation:{packageId:installed.PACKAGE_ID,runtime:'authenticated-v2',executor:'bounded-v2'}};
}
async function installProof({central,tenant,connection,fixture,report,check,workspaceRoot}){
 const installer=require('../../../scripts/eu-writer-install.cjs');
 const state=await configurationFixture({central,tenant,connection,fixture}),original=structuredClone(state);
 const plan=JSON.parse(fs.readFileSync(path.join(workspaceRoot,'output/opportunity-eu-writer-window-'+report.windowApproval.receipt.windowId,'plan.json'),'utf8'));
 const receipt=report.windowApproval.receipt,loaded={plan,planDigest:receipt.planDigest};
 // Shape fixture only. The event, current persisted authority and its SQL locks
 // are real; no OIDC-provider claim is inferred from this synthetic envelope.
 const approval={status:'PASS',windowId:plan.windowId,planDigest:receipt.planDigest,sessionFabricated:false,scope:'PREPARATION_ONLY',authentication:{provider:'OIDC',administrator:true,actorId:fixture.actor.id},result:{approval:receipt,replayVerified:true,sourceUnchanged:true}};
 const {verifyApprovalInDatabase}=require('../../../scripts/eu-writer-execute-window.cjs');
 const stages=[];
 await check('EU_WRITER_EXECUTION_CHECKS_REAL_AUDIT_RECEIPT_AND_CURRENT_AUTHORITY',async()=>{
  const client=await central.connect();try{
   await client.query('BEGIN');const current=await verifyApprovalInDatabase(client,approval,loaded);assert.equal(current.recentAdministrator,true);assert.equal(current.sessionExported,false);await client.query('ROLLBACK');
   await client.query('BEGIN');const changed=structuredClone(approval);changed.result.approval.eventHash='f'.repeat(64);await assert.rejects(verifyApprovalInDatabase(client,changed,loaded));await client.query('ROLLBACK');
   await client.query('BEGIN');await client.query("UPDATE public.platform_admin_assignment SET status='REVOKED' WHERE id=$1",[fixture.actor.assignmentId]);await assert.rejects(verifyApprovalInDatabase(client,approval,loaded));await client.query('ROLLBACK');
   report.operationalWriterAuthority={realAuditReceipt:true,realSessionAndAdministrator:true,forgedReceiptDenied:true,revokedAdministratorDenied:true,syntheticApprovalEnvelope:true,realOidcProvider:false,sessionExported:false};
  }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
 });
 await check('EU_WRITER_INSTALLER_REJECTS_CHANGED_HEAD_AND_CONFIGURATION_BEFORE_APPLY',async()=>{
  const wrong=structuredClone(plan);wrong.expected.rowVersion++;
  await assert.rejects(installer.install({central,tenant,state,plan:wrong}));
  assert.equal((await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(central)).currentVersion,pkg.CENTRAL_BASELINE);
  const changed=structuredClone(state);changed.credentials.credentialRef+='-changed';await assert.rejects(installer.install({central,tenant,state:changed,plan}));
  assert.equal((await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(central)).currentVersion,pkg.CENTRAL_BASELINE);assert.deepEqual(state,original);
 });
 await check('EU_WRITER_INSTALLER_PRECOMMIT_FAILURE_PRESERVES042_AND_CONFIGURATION',async()=>{
  let reached=false;await assert.rejects(installer.install({central,tenant,state,plan,checkpoint:async value=>{if(value.stage==='PRECHECK_PASSED'){reached=true;throw Error('ISOLATED_BEFORE_WRITER_MIGRATION');}}}));assert.equal(reached,true);
  assert.equal((await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(central)).currentVersion,pkg.CENTRAL_BASELINE);assert.deepEqual(state,original);
 });
 let result;const authorityClient=await central.connect();try{await authorityClient.query('BEGIN');await verifyApprovalInDatabase(authorityClient,approval,loaded);result=await installer.install({central,tenant,state,plan,checkpoint:async value=>stages.push(value)});await verifyApprovalInDatabase(authorityClient,approval,loaded);await authorityClient.query('COMMIT');}catch(error){await authorityClient.query('ROLLBACK').catch(()=>{});throw error;}finally{authorityClient.release();}
 assert.equal(result.report.status,'PASS');assert.deepEqual(state,original);
 const capability=require('../../../backend/src/fundingTenders/euWriter').euWriterConfiguration();assert.deepEqual(result.state.opportunityEuWriter,{packageId:pkg.PACKAGE_ID,...capability});
 const restored=structuredClone(result.state);delete restored.opportunityEuWriter;assert.deepEqual(restored,state);
 assert.equal((await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(central)).currentVersion,pkg.entry.version);
 assert.equal((await require('../../../backend/src/security/tenantMigrationPreflight').preflightTenant(tenant,fixture.identity,undefined,{timeoutMs:30000})).currentVersion,installed.tenantAddition.version);
 const replay=await installer.install({central,tenant,state,plan});assert.equal(replay.report.status,'PASS');assert.deepEqual(replay.state,result.state);assert.deepEqual(state,original);
 assert.deepEqual(require('../../../backend/scripts/localPlatform/euWriterRuntime').euWriterRuntimeEnvironment(result.state,{OPPORTUNITY_ACTIVATION_RUNTIME:'authenticated-v2'}),{OPPORTUNITY_EU_WRITER:'canonical-v2',FUNDING_TENDERS_ENRICHMENT:'verified-v1'});
 report.operationalWriterInstallation={...result.report,stages,replayVerified:true,syntheticConfiguration:true,normalDirectoryPublication:true,physicalTenantApiLogin:true,onlyWriterDescriptorAdded:true,configurationWritten:false,habitualAccess:false};
 return {state:result.state,plan,report:result.report};
}
module.exports={configurationFixture,installProof};
