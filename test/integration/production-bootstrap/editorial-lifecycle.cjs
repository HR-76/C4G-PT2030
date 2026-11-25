'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {PROFILE_CODE}=require('../../../backend/scripts/productionBootstrap/tenant');
const {createMemberProjection}=require('../../../backend/src/platformOnboarding/memberProjection');
const {createDeletionProjection}=require('../../../backend/src/platformDirectory/deletionProjection');

async function run({central,tenant,config,credentials,connection,check}){
 const snapshot=await require('../../../backend/src/security/tenantDirectoryRepository').createTenantDirectoryRepository(central).resolveSnapshotByOrganization(config.organization.id,'API');
 const tenantCredentials={tenantId:config.tenant.id,credentialRef:config.tenant.credentialRef,connectionVersion:1,
  host:config.target.host,port:config.target.port,database:config.target.tenantDatabase,login:config.tenant.apiLogin,password:credentials.tenantApi,ssl:Boolean(config.target.ssl)};
 const allowedResidency=[{regionCode:config.tenant.regionCode,policyVersion:config.tenant.residencyPolicyVersion}];
 const poolOptions={host:connection.host,port:connection.port,database:config.target.tenantDatabase,user:config.tenant.apiLogin,password:credentials.tenantApi,ssl:config.target.ssl,max:1,connectionTimeoutMillis:5000};
 const raw=new Pool(poolOptions),otherOrg=randomUUID();
 const runtime=require('../../../backend/src/config/opportunityRuntime').createConfiguredOpportunityRuntime({centralPool:{query(){throw Error('NO_CENTRAL_FALLBACK');}},editorialEnabled:true,
  env:{OPPORTUNITY_API_CREDENTIALS_JSON:JSON.stringify([tenantCredentials]),OPPORTUNITY_ALLOWED_RESIDENCY_JSON:JSON.stringify(allowedResidency)}});
 const bindings=[{organizationId:config.organization.id,credentials:tenantCredentials,snapshot}];
 const createPool=options=>new Pool({...options,ssl:config.target.ssl,connectionTimeoutMillis:5000});
 const options={bindings,allowedResidency,tenantApiProfile:PROFILE_CODE,createPool};
 const invited={operationId:randomUUID(),organizationId:config.organization.id,globalUserId:randomUUID(),membershipId:randomUUID(),input:{adminName:'Synthetic invited member',adminEmail:'editorial-member@example.invalid'}};
 try{
  await check('editorial/PQ1 API profile validates actual bound login and reads its product tables',async()=>{
   const client=await raw.connect();
   try{
    await runtime.bindingVerifier.verify({client,snapshot,requiredCapabilities:['ACCOUNT_IDENTITY_ERASURE'],correlationId:randomUUID(),phase:'PREPARATION'});
    await client.query('BEGIN');await client.query("SELECT set_config('app.organization_id',$1,true)",[config.organization.id]);await client.query('SET LOCAL ROLE c4g_organization_profile_runtime');
    for(const table of ['editorial_version','pq1_version','pq1_activation','pq1_decision'])assert.ok((await client.query(`SELECT count(*)::int AS n FROM organization_profile.${table}`)).rows[0].n>=0);
    await client.query('ROLLBACK');
   }finally{await client.query('ROLLBACK');client.release();}
  });
  await check('editorial and PQ1 writes obey tenant RLS and cannot create privileged access',async()=>{
   const client=await raw.connect(),key=randomUUID();
   try{
    await client.query('BEGIN');await client.query("SELECT set_config('app.organization_id',$1,true)",[config.organization.id]);await client.query('SET LOCAL ROLE c4g_organization_profile_runtime');
    for(const [table,operation] of [['editorial_idempotency_record','EDITORIAL_SUBMIT'],['pq1_idempotency_record','PQ1_SUBMIT']]){
     await client.query(`INSERT INTO organization_profile.${table}(organization_id,operation,idempotency_key,intention_digest,result_projection) VALUES($1,$2,$3,$4,'{}')`,[config.organization.id,operation,key,'e'.repeat(64)]);
     assert.equal((await client.query(`SELECT count(*)::int AS n FROM organization_profile.${table} WHERE idempotency_key=$1`,[key])).rows[0].n,1);
    }
    await client.query("SELECT set_config('app.organization_id',$1,true)",[otherOrg]);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM organization_profile.editorial_idempotency_record WHERE idempotency_key=$1',[key])).rows[0].n,0);
    await client.query('SAVEPOINT forbidden');
    await assert.rejects(client.query("INSERT INTO organization_profile.pq1_idempotency_record(organization_id,operation,idempotency_key,intention_digest,result_projection) VALUES($1,'PQ1_SUBMIT',$2,$3,'{}')",[config.organization.id,randomUUID(),'f'.repeat(64)]),{code:'42501'});
    await client.query('ROLLBACK TO SAVEPOINT forbidden');await client.query('ROLLBACK');
    await assert.rejects(client.query('SET ROLE c4g_organization_profile_owner'),{code:'42501'});
   }finally{await client.query('ROLLBACK');client.release();}
  });
  await check('member projection works with the editorial profile and retries without duplication',async()=>{
   const projection=createMemberProjection(options);
   assert.equal((await projection.ensure(invited)).projected,true);assert.equal((await projection.ensure(invited)).projected,true);
   assert.equal((await tenant.query('SELECT count(*)::int AS n FROM organizational_scope.person_profile WHERE membership_id=$1',[invited.membershipId])).rows[0].n,1);
   await assert.rejects(projection.ensure({...invited,operationId:randomUUID(),organizationId:otherOrg}),/ONBOARDING_NOT_READY/);
  });
  await check('deletion projection admits the same editorial profile and erases idempotently',async()=>{
   const projection=createDeletionProjection(options),request={...invited,requestId:randomUUID()};
   assert.deepEqual(await projection.ready(),{ready:true});
   assert.equal((await projection.anonymize(request)).anonymized,true);assert.equal((await projection.anonymize(request)).anonymized,true);
   const person=(await tenant.query('SELECT name,email,active FROM organizational_scope.person WHERE organization_id=$1 AND person_id=$2',[invited.organizationId,invited.membershipId])).rows[0];
   assert.deepEqual(person,{name:'Utilizador eliminado',email:'',active:false});
   await assert.rejects(projection.anonymize({...request,organizationId:otherOrg}),/PROJECTION_DELETION_UNCONFIRMED/);
  });
  await check('minimal selectors and extra capability grants are refused by production lifecycle validators',async()=>{
   const minimal=createDeletionProjection({...options,tenantApiProfile:'minimal-v1'});
   await assert.rejects(minimal.ready(),error=>error.code==='TENANT_NOT_AVAILABLE'&&error.internalCode==='TENANT_UNREACHABLE');
   await tenant.query('GRANT c4g_document_runtime TO c4g_tenant_api_capabilities WITH SET TRUE, INHERIT FALSE, ADMIN FALSE');
   try{await assert.rejects(createDeletionProjection(options).ready(),error=>error.code==='TENANT_NOT_AVAILABLE'&&error.internalCode==='TENANT_UNREACHABLE');}
   finally{await tenant.query('REVOKE c4g_document_runtime FROM c4g_tenant_api_capabilities');}
   assert.deepEqual(await createDeletionProjection(options).ready(),{ready:true});
  });
 }finally{await raw.end();await runtime.poolManager.closeAll();}
}
module.exports={run};
