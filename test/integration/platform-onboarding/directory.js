'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
async function prepare({central,tenants,runtime}){
 const pool=central.pool;
 const directory=require('../../../backend/src/security/tenantDirectoryRepository').createTenantDirectoryRepository(pool);
 const provisioning=require('../../../backend/src/security/tenantProvisioningRepository').createTenantProvisioningRepository(pool);
 const connections=require('../../../backend/src/security/tenantConnectionRepository').createTenantConnectionRepository(pool);
 const schema=require('../../../backend/src/security/tenantSchemaRepository').createTenantSchemaRepository(pool);
 const workloads=require('../../../backend/src/security/tenantWorkloadDirectoryRepository').createTenantWorkloadDirectoryRepository(pool);
 for(const [n,t] of tenants.entries()){
  const s=t.snapshot,tag=step=>({correlationId:randomUUID(),idempotencyKey:'onboarding-'+n+'-'+step});
  const create={organizationId:t.org,tenantId:t.org,...tag('tenant')};await directory.createTenant(create);await directory.createTenant(create);
  const start={organizationId:t.org,manifestVersion:s.schema.currentVersion,...tag('start')};await provisioning.start(start);await provisioning.start(start);
  await provisioning.assignTenantOnce({organizationId:t.org,tenantId:t.org,expectedRevision:1,...tag('assign')});
  await provisioning.beginProvisioning({organizationId:t.org,expectedRevision:2,...tag('running')});
  // Failure and retry of B do not create another tenant or change A.
  let revision=3;
  if(n===1){await provisioning.markFailed({organizationId:t.org,expectedRevision:revision++,reasonCode:'PROOF_RETRY',...tag('failed')});await provisioning.retryFailed({organizationId:t.org,expectedRevision:revision++,...tag('retry')});await provisioning.beginProvisioning({organizationId:t.org,expectedRevision:revision++,...tag('running-again')});}
  await connections.createGeneration({tenantId:t.org,databaseGenerationId:t.gen,databaseRef:t.name,...tag('generation')});
  await connections.createCandidateVersion({tenantId:t.org,databaseGenerationId:t.gen,databaseRef:t.name,credentialRef:s.credentialRef,regionCode:s.regionCode,residencyPolicyVersion:s.residencyPolicyVersion,...tag('candidate')});
  await connections.validateVersion({tenantId:t.org,connectionVersion:1,observedSystemIdentifier:s.observedSystemIdentifier,bindingDigest:s.bindingDigest,...tag('validated')});
  await assert.rejects(()=>connections.publishVersion({tenantId:t.org,connectionVersion:1,expectedRevision:1,...tag('premature')}));
  await provisioning.beginVerification({organizationId:t.org,expectedRevision:revision++,...tag('verifying')});
  await schema.recordObservation({tenantId:t.org,expectedRevision:1,compatibilityState:'COMPATIBLE',currentVersion:s.schema.currentVersion,targetVersion:s.schema.currentVersion,minimumReadVersion:s.schema.currentVersion,minimumWriteVersion:s.schema.currentVersion,verifiedCapabilities:{...s.schema.verifiedCapabilities,schemaFingerprint:s.schema.schemaFingerprint},...tag('schema')});
  await provisioning.markReady({organizationId:t.org,expectedRevision:revision,...tag('ready')});
  await connections.publishVersion({tenantId:t.org,connectionVersion:1,expectedRevision:1,...tag('publish')});
  for(const workload of ['API','WORKER']){
   const input={tenantId:t.org,workload,connectionVersion:1,credentialRef:workload==='API'?s.credentialRef:'proof-worker-'+n,bindingDigest:workload==='API'?s.bindingDigest:'proof-worker-binding-'+n};
   await workloads.createCandidate(input);await workloads.validateCandidate({...input,compatibilityStatus:'COMPATIBLE',provisioningStatus:'READY'});await workloads.publishCandidate({...input,expectedFence:0,expectedCurrentVersion:null});
  }
  t.snapshot=await directory.resolveSnapshotByOrganization(t.org,'API');assert.equal(t.snapshot.databaseRef,t.name);assert.equal(t.snapshot.provisioningStatus,'READY');assert.equal(t.snapshot.connectionState,'AVAILABLE');assert.equal(t.snapshot.schema.schemaFingerprint,s.schema.schemaFingerprint);
  await t.pool.query(`GRANT CONNECT ON DATABASE ${t.name} TO c4g_ubi_isolated_worker_${n}`);
 }
 // Replace the shared test resolver object, so actual HTTP services read the persisted directory.
 runtime.directoryRepository.resolveSnapshotByOrganization=org=>directory.resolveSnapshotByOrganization(org,'API');
 for(const [n,t] of tenants.entries()){
  const other=tenants[1-n];const c=t.credentials;
  const foreign=new Pool({host:c.host,port:c.port,user:c.login,password:c.password,database:other.name});try{await assert.rejects(()=>foreign.query('SELECT 1'),e=>e.code==='42501');}finally{await foreign.end();}
  const rows=(await t.pool.query('SELECT has_database_privilege($1,$2,\'CONNECT\') own,has_database_privilege($1,$3,\'CONNECT\') other',[`c4g_ubi_isolated_worker_${n}`,t.name,other.name])).rows[0];assert.deepEqual(rows,{own:true,other:false});
 }
 assert.equal((await pool.query('SELECT count(*)::int n FROM public.tenant')).rows[0].n,2);
 return {persistentDirectory:true,secondTenantRetry:true,prematurePublishDenied:true,apiPhysicalCrossConnectDenied:true,workerConnectIsolation:true};
}
module.exports={prepare};
