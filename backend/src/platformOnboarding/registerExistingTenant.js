'use strict';
// Explicit installer: publish the already verified physical binding, without
// creating/replacing a database, identity or membership.
async function registerExistingTenant({pool,snapshot,correlationId}){
 const s=snapshot,tenantId=s.tenantId,organizationId=s.organizationId;
 const directory=require('../security/tenantDirectoryRepository').createTenantDirectoryRepository(pool),provisioning=require('../security/tenantProvisioningRepository').createTenantProvisioningRepository(pool),connections=require('../security/tenantConnectionRepository').createTenantConnectionRepository(pool),schema=require('../security/tenantSchemaRepository').createTenantSchemaRepository(pool),workloads=require('../security/tenantWorkloadDirectoryRepository').createTenantWorkloadDirectoryRepository(pool);
 const row=async(sql,values)=>(await pool.query(sql,values)).rows[0],tag=step=>({correlationId,idempotencyKey:correlationId+':register:'+step});
 const prior=await row('SELECT * FROM public.tenant WHERE organization_id=$1',[organizationId]);if(prior&&prior.tenant_id!==tenantId)throw Error('TENANT_BINDING_CONFLICT');
 if(!prior)await directory.createTenant({organizationId,tenantId,...tag('tenant')});
 let p=await row('SELECT * FROM public.organization_provisioning WHERE organization_id=$1',[organizationId]);
 if(!p){await provisioning.start({organizationId,manifestVersion:s.schema.currentVersion,...tag('start')});p=await row('SELECT * FROM public.organization_provisioning WHERE organization_id=$1',[organizationId]);}
 if(!p.tenant_id){await provisioning.assignTenantOnce({organizationId,tenantId,expectedRevision:Number(p.revision),...tag('assign')});p=await row('SELECT * FROM public.organization_provisioning WHERE organization_id=$1',[organizationId]);}
 if(p.tenant_id!==tenantId)throw Error('TENANT_BINDING_CONFLICT');
 if(p.status==='QUEUED'){await provisioning.beginProvisioning({organizationId,expectedRevision:Number(p.revision),...tag('running')});p=await row('SELECT * FROM public.organization_provisioning WHERE organization_id=$1',[organizationId]);}
 if(!await row('SELECT 1 FROM public.tenant_database_generation WHERE database_generation_id=$1',[s.databaseGenerationId]))await connections.createGeneration({tenantId,databaseGenerationId:s.databaseGenerationId,databaseRef:s.databaseRef,...tag('generation')});
 let v=await row('SELECT * FROM public.organization_connection_version WHERE tenant_id=$1 AND connection_version=1',[tenantId]);
 if(!v){await connections.createCandidateVersion({tenantId,databaseGenerationId:s.databaseGenerationId,databaseRef:s.databaseRef,credentialRef:s.credentialRef,regionCode:s.regionCode,residencyPolicyVersion:s.residencyPolicyVersion,...tag('candidate')});v=await row('SELECT * FROM public.organization_connection_version WHERE tenant_id=$1 AND connection_version=1',[tenantId]);}
 if(v.database_generation_id!==s.databaseGenerationId||v.database_ref!==s.databaseRef||v.credential_ref!==s.credentialRef)throw Error('TENANT_BINDING_CONFLICT');
 if(v.version_state==='CANDIDATE')await connections.validateVersion({tenantId,connectionVersion:1,observedSystemIdentifier:s.observedSystemIdentifier,bindingDigest:s.bindingDigest,...tag('validated')});
 if(p.status==='RUNNING'){await provisioning.beginVerification({organizationId,expectedRevision:Number(p.revision),...tag('verify')});p=await row('SELECT * FROM public.organization_provisioning WHERE organization_id=$1',[organizationId]);}
 const sc=await row('SELECT * FROM public.tenant_schema_state WHERE tenant_id=$1',[tenantId]);
 if(sc.compatibility_state==='UNKNOWN')await schema.recordObservation({tenantId,expectedRevision:Number(sc.revision),compatibilityState:'COMPATIBLE',currentVersion:s.schema.currentVersion,targetVersion:s.schema.currentVersion,minimumReadVersion:s.schema.currentVersion,minimumWriteVersion:s.schema.currentVersion,verifiedCapabilities:{...s.schema.verifiedCapabilities,schemaFingerprint:s.schema.schemaFingerprint},...tag('schema')});
 if(p.status==='VERIFYING')await provisioning.markReady({organizationId,expectedRevision:Number(p.revision),...tag('ready')});
 const c=await row('SELECT * FROM public.organization_connection WHERE tenant_id=$1',[tenantId]);if(c.operational_state==='PENDING')await connections.publishVersion({tenantId,connectionVersion:1,expectedRevision:Number(c.revision),...tag('publish')});
 if(!(await workloads.resolvePublished({tenantId,workload:'API'}))){const x={tenantId,workload:'API',connectionVersion:1,credentialRef:s.credentialRef,bindingDigest:s.bindingDigest};await workloads.createCandidate(x);await workloads.validateCandidate({...x,compatibilityStatus:'COMPATIBLE',provisioningStatus:'READY'});await workloads.publishCandidate({...x,expectedFence:0,expectedCurrentVersion:null});}
 const published=await directory.resolveSnapshotByOrganization(organizationId,'API');
 for(const key of ['organizationId','tenantId','databaseGenerationId','databaseRef','credentialRef','bindingDigest','observedSystemIdentifier'])if(published?.[key]!==s[key])throw Error('TENANT_BINDING_CONFLICT');
 if(published.schema.schemaFingerprint!==s.schema.schemaFingerprint)throw Error('TENANT_SCHEMA_CONFLICT');return published;
}
module.exports={registerExistingTenant};
