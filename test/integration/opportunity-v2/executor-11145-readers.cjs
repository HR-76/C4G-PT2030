'use strict';
const assert=require('node:assert/strict'),{randomUUID,randomBytes}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {transaction}=require('./executor-11145-fixture.cjs');
const {preserved}=require('./registered-package-proof.cjs');
async function verifyReaders({central,tenant,connection,fixture,candidate,accepted,before,report,check}){
 let reader,tenantReader;
 try{await check('EXECUTOR_PHYSICAL_READERS_V1_V2_SQL_AND_TENANT_RLS_PRESERVATION',async()=>{
  const password=randomBytes(32).toString('hex');await central.query(`CREATE ROLE executor_catalog_reader LOGIN PASSWORD '${password}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await central.query('GRANT c4g_catalog_reader TO executor_catalog_reader WITH INHERIT FALSE, SET TRUE');await central.query('GRANT CONNECT ON DATABASE registered_central TO executor_catalog_reader');
  const url=new URL('postgresql://127.0.0.1');url.port=String(connection.port);url.username='executor_catalog_reader';url.password=password;url.pathname='/registered_central';
  reader=require('../../../backend/src/fundingTenders/catalogReader').createCatalogReader({env:{CATALOG_DATABASE_URL:url.toString()}});await reader.ready();
  assert.deepEqual(await reader.revision(fixture.legacy.opportunityId,fixture.legacy.revisionId),fixture.legacy.snapshot);
  assert.deepEqual(await reader.revision(accepted.opportunityId,accepted.revisionId),candidate);
  const detail=await reader.get(accepted.opportunityId);assert.equal(detail.revisionId,accepted.revisionId);assert.equal(detail.readModel.sourceVersion,2);assert.deepEqual(detail.snapshot,candidate);
  assert.deepEqual(detail.readModel.projection.financing.allocations.value,candidate.financing.allocations.value);assert.deepEqual(detail.readModel.projection.schedule.deadlines.value,candidate.schedule.deadlines.value);
  const page=await reader.list();const found=page.items.find(value=>value.opportunityId===accepted.opportunityId);assert(found);assert.equal(found.revisionId,accepted.revisionId);assert.deepEqual(found.readModel.projection.financing,detail.readModel.projection.financing);
  const apiPassword=randomBytes(32).toString('hex'),workerPassword=randomBytes(32).toString('hex');
  const provisioner=await require('../../../backend/src/security/localTenantIdentityProvisioner').createLocalTenantIdentityProvisioner(tenant);
  await provisioner.reconcile({apiLogin:'executor_tenant_api',workerLogin:'executor_tenant_worker',apiPassword,workerPassword,apiRoles:['c4g_opportunity_tenant_runtime'],workerRoles:['c4g_import_worker_runtime']});
  await tenant.query('GRANT CONNECT ON DATABASE registered_tenant TO executor_tenant_api,executor_tenant_worker');
  tenantReader=new Pool({...connection,database:'registered_tenant',user:'executor_tenant_api',password:apiPassword});
  await transaction(tenantReader,'c4g_opportunity_tenant_runtime',fixture.organizationId,async client=>{
   const app=(await client.query('SELECT central_snapshot,central_revision_id,source_interest_id FROM opportunity_catalog.application WHERE application_id=$1',[fixture.links.applicationId])).rows[0];assert.deepEqual(app.central_snapshot,fixture.legacy.snapshot);assert.equal(app.central_revision_id,fixture.legacy.revisionId);assert.equal(app.source_interest_id,fixture.links.interestId);
   const interest=(await client.query('SELECT central_snapshot FROM opportunity_catalog.opportunity_interest WHERE interest_id=$1',[fixture.links.interestId])).rows[0];assert.deepEqual(interest.central_snapshot,fixture.legacy.snapshot);
   assert.equal((await client.query('SELECT scope_id FROM opportunity_catalog.application_unit WHERE application_id=$1',[fixture.links.applicationId])).rows[0].scope_id,fixture.links.unitId);
  });
  await transaction(tenantReader,'c4g_opportunity_tenant_runtime',randomUUID(),async client=>{assert.equal((await client.query('SELECT application_id FROM opportunity_catalog.application WHERE application_id=$1',[fixture.links.applicationId])).rows.length,0);assert.equal((await client.query('SELECT interest_id FROM opportunity_catalog.opportunity_interest WHERE interest_id=$1',[fixture.links.interestId])).rows.length,0);});
  // PostgreSQL retains an empty custom setting after SET LOCAL is reverted on
  // this pooled session. The RLS UUID cast rejects it; it never exposes a row.
  await assert.rejects(transaction(tenantReader,'c4g_opportunity_tenant_runtime',null,client=>client.query('SELECT application_id FROM opportunity_catalog.application WHERE application_id=$1',[fixture.links.applicationId])),error=>error.code==='22P02');
  const client=await tenantReader.connect();let evidence;try{await client.query('BEGIN READ ONLY');evidence=await require('../../../backend/src/security/tenantRuntimeMetadata').observeTenantRuntimeMetadata(client,fixture.identity);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  assert.equal(evidence.currentVersion,report.package.tenantTarget);await preserved(tenant,before.tenant);
  const executable=(await central.query("SELECT n.nspname||'.'||p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND p.prosecdef AND has_function_privilege('c4g_catalog_reader',p.oid,'EXECUTE')")).rows;assert.equal(executable.length,0);
  report.readers={physicalCatalogLogin:true,physicalTenantLogin:true,v1HistoricalSnapshotPreserved:true,v2DetailAndListParity:true,tenantApplicationAndInterestFrozen:true,unitLinksPreserved:true,otherOrganizationHidden:true,missingOrganizationRejected:'22P02',tenantMetadataVersion:evidence.currentVersion,catalogExecutableSecurityDefiners:0};
 });}finally{await reader?.close();await tenantReader?.end();}
}
module.exports={verifyReaders};
