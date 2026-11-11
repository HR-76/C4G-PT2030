'use strict';
const {randomUUID}=require('node:crypto');
// Synthetic infrastructure completion for service failure tests. These are real
// central directory repositories, but do not create physical tenant databases.
async function prepareDirectory(pool,organizationId){
 const base='../../../backend/src/security/';
 const directory=require(base+'tenantDirectoryRepository').createTenantDirectoryRepository(pool);
 const provisioning=require(base+'tenantProvisioningRepository').createTenantProvisioningRepository(pool);
 const connections=require(base+'tenantConnectionRepository').createTenantConnectionRepository(pool);
 const schema=require(base+'tenantSchemaRepository').createTenantSchemaRepository(pool);
 const workloads=require(base+'tenantWorkloadDirectoryRepository').createTenantWorkloadDirectoryRepository(pool);
 const tenantId=organizationId,tag=step=>({correlationId:randomUUID(),idempotencyKey:organizationId+':'+step});
 // Return the persisted result after an injected lost acknowledgement.
 if((await pool.query("SELECT 1 FROM public.tenant_workload_binding WHERE tenant_id=$1 AND lifecycle_status='AVAILABLE'",[tenantId])).rowCount)return;
 await directory.createTenant({organizationId,tenantId,...tag('tenant')});
 await provisioning.start({organizationId,manifestVersion:'synthetic-v1',...tag('start')});
 await provisioning.assignTenantOnce({organizationId,tenantId,expectedRevision:1,...tag('assign')});
 await provisioning.beginProvisioning({organizationId,expectedRevision:2,...tag('begin')});
 const generation=randomUUID(),databaseRef='synthetic-'+tenantId;
 await connections.createGeneration({tenantId,databaseGenerationId:generation,databaseRef,...tag('generation')});
 await connections.createCandidateVersion({tenantId,databaseGenerationId:generation,databaseRef,credentialRef:'fixture-api-'+tenantId,regionCode:'EU',residencyPolicyVersion:'fixture-v1',...tag('candidate')});
 await connections.validateVersion({tenantId,connectionVersion:1,observedSystemIdentifier:'synthetic-system',bindingDigest:'synthetic-binding-'+tenantId,...tag('validate')});
 await provisioning.beginVerification({organizationId,expectedRevision:3,...tag('verify')});
 await schema.recordObservation({tenantId,expectedRevision:1,compatibilityState:'COMPATIBLE',currentVersion:'synthetic-v1',targetVersion:'synthetic-v1',minimumReadVersion:'synthetic-v1',minimumWriteVersion:'synthetic-v1',verifiedCapabilities:{serviceFixture:true},...tag('schema')});
 await provisioning.markReady({organizationId,expectedRevision:4,...tag('ready')});
 await connections.publishVersion({tenantId,connectionVersion:1,expectedRevision:1,...tag('publish')});
 const binding={tenantId,workload:'API',connectionVersion:1,credentialRef:'fixture-api-'+tenantId,bindingDigest:'synthetic-binding-'+tenantId};
 await workloads.createCandidate(binding);await workloads.validateCandidate({...binding,compatibilityStatus:'COMPATIBLE',provisioningStatus:'READY'});await workloads.publishCandidate({...binding,expectedFence:0,expectedCurrentVersion:null});
}
module.exports={prepareDirectory};
