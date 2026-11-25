'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
async function run({pool,port,ids,check}) {
 const c=await pool.connect();
 const tenants=new Map();
 try {
  await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  for(const org of [ids.orgA,ids.orgB]) {
   const tenant=randomUUID(),generation=randomUUID(),ref='synthetic-'+tenant,digest='a'.repeat(64);tenants.set(org,tenant);
   await c.query('INSERT INTO public.tenant(tenant_id,organization_id,deployment_mode) VALUES($1,$2,$3)',[tenant,org,'DATABASE_PER_ORGANIZATION']);
   await c.query('INSERT INTO public.tenant_database_generation(database_generation_id,tenant_id,database_ref) VALUES($1,$2,$3)',[generation,tenant,ref]);
   await c.query(`INSERT INTO public.organization_connection_version(tenant_id,connection_version,deployment_mode,database_generation_id,database_ref,credential_ref,region_code,residency_policy_version,observed_system_identifier,binding_digest,version_state,validated_at) VALUES($1,1,'DATABASE_PER_ORGANIZATION',$2,$3,$3,'EU','gate','123',$4,'VALIDATED',now())`,[tenant,generation,ref,tenant.replaceAll('-','').repeat(2)]);
   await c.query(`INSERT INTO public.tenant_workload_binding(tenant_id,workload,current_connection_version,lifecycle_status,compatibility_status,provisioning_status,fence,binding_digest,credential_ref,published_at) VALUES($1,'API',1,'AVAILABLE','COMPATIBLE','READY',1,$2,$3,now())`,[tenant,digest,ref]);
   await c.query(`INSERT INTO public.tenant_workload_connection_version(tenant_id,workload,connection_version,credential_ref,lifecycle_status,compatibility_status,provisioning_status,fence,binding_digest,intent_digest,validated_at,published_at) VALUES($1,'API',1,$2,'AVAILABLE','COMPATIBLE','READY',1,$3,$3,now(),now())`,[tenant,ref,digest]);
   await c.query('INSERT INTO public.tenant_schema_state(tenant_id) VALUES($1)',[tenant]);
  }
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 const raw=new Pool({host:'127.0.0.1',port,user:'c4g_authority_runtime',database:'postgres',max:2});
 try {
  const coordinator=require('../../../backend/src/security/authorityCoordinator').createAuthorityCoordinator({pool:raw,permitSecret:'synthetic-gate-secret-'.repeat(3)});
  const reader=require('../../../backend/src/security/tenantDirectoryReader').createTenantDirectoryReader({coordinator,organizations:[ids.orgA],workload:'API'});
  await check('real authority protocol resolves only configured organization and workload',async()=>{
   const found=await reader.resolveSnapshotByOrganization(ids.orgA,'API');
   assert.equal(found.tenantId,tenants.get(ids.orgA));assert.equal(found.organizationId,ids.orgA);
   assert.equal(Object.hasOwn(found,'password'),false);
   await assert.rejects(reader.resolveSnapshotByOrganization(ids.orgB,'API'),/SCOPE_DENIED/);
   await assert.rejects(reader.resolveSnapshotByOrganization(ids.orgA,'WORKER'),/SCOPE_DENIED/);
   await assert.rejects(raw.query('SELECT * FROM public.tenant_workload_connection_version'),{code:'42501'});
   await assert.rejects(coordinator.pool.query('SELECT * FROM public.global_user'));
  });
 }finally{await raw.end()}
 const reader=require('../../../backend/src/fundingTenders/catalogReader').createCatalogReader({env:{CATALOG_DATABASE_URL:`postgresql://c4g_prod_catalog_read:synthetic@127.0.0.1:${port}/postgres`}});
 try {await check('dedicated catalog reader admits 057 with restricted grants',()=>reader.ready());}finally{await reader.close()}
 const catalog=new Pool({host:'127.0.0.1',port,user:'c4g_prod_catalog_read',database:'postgres'});
 try {await check('catalog excludes private originals and Central personal data',async()=>{
  const c=await catalog.connect();try{
   await c.query('BEGIN READ ONLY');await c.query('SET LOCAL ROLE c4g_catalog_reader');
   await c.query('SELECT opportunity_id FROM opportunity_catalog.opportunity');
   await assert.rejects(c.query('SELECT * FROM opportunity_catalog.pt2030_document_upload'),{code:'42501'});await c.query('ROLLBACK');
   await c.query('BEGIN');await c.query('SET LOCAL ROLE c4g_catalog_reader');
   await assert.rejects(c.query('SELECT * FROM public.global_user'),{code:'42501'});await c.query('ROLLBACK');
  }finally{c.release()}
 });}finally{await catalog.end()}
}
module.exports={run};
