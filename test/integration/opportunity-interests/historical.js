'use strict';
// Fixture construction only on the gate-owned disposable database. Never imported
// by application/installer code, and never used against the habitual environment.
const assert=require('node:assert/strict');
const fixture=require('../../../backend/test/fixtures/tenant030HistoricalLedger.json');
const {BASELINE,isHistoricalOwnershipLedger}=require('../../../backend/src/security/tenantHistoricalOwnership');
const {tenantSchemaSnapshot,tenantSchemaFingerprint}=require('../../../backend/src/security/tenantSchemaFingerprint');
const {preflightTenant,preflightTenantClient}=require('../../../backend/src/security/tenantMigrationPreflight');
const {createTenantMigrationRunner}=require('../../../backend/src/security/tenantMigrationRunner');
const {manifest,migrationSql}=require('../../../backend/src/security/tenantMigrationManifest');
const ledgerSql='SELECT migration_id,ordinal,checksum_sha256,irreversible,resulting_fingerprint FROM c4g_system.schema_migration ORDER BY ordinal';
async function initialize(pool,expected,baseline){
 assert.equal(baseline.at(-1).version,BASELINE.version);
 const client=await pool.connect();try{
  await client.query('BEGIN');
  const actual=(await client.query(ledgerSql)).rows;assert.equal(actual.length,fixture.length);
  assert.equal(tenantSchemaFingerprint(await tenantSchemaSnapshot(client)),BASELINE.canonicalFingerprint);
  // Reconstruct the historical evidence in the synthetic fixture before the
  // preservation baseline is recorded. This is not a migration/repair strategy.
  await client.query('SET LOCAL ROLE c4g_tenant_owner');
  await client.query('ALTER TABLE c4g_system.schema_migration DISABLE TRIGGER schema_migration_append_only');
  for(const row of fixture){
   const source=actual.find(item=>item.migration_id===row.migration_id);assert(source);assert.equal(source.checksum_sha256,row.checksum_sha256);
   await client.query('UPDATE c4g_system.schema_migration SET resulting_fingerprint=$2 WHERE migration_id=$1',[row.migration_id,row.resulting_fingerprint]);
  }
  await client.query('ALTER TABLE c4g_system.schema_migration ENABLE TRIGGER schema_migration_append_only');
  await client.query('RESET ROLE');
  assert(isHistoricalOwnershipLedger((await client.query(ledgerSql)).rows));
  await preflightTenantClient(client,expected,baseline);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 return (await pool.query('SELECT to_jsonb(t) AS row FROM c4g_system.schema_migration t ORDER BY ordinal')).rows.map(item=>item.row);
}
async function refuseDrift(pool,expected,baseline){
 for(const kind of ['LEDGER','SCHEMA']){
  const client=await pool.connect();try{
   await client.query('BEGIN');
   if(kind==='SCHEMA')await client.query('ALTER FUNCTION async_exec.guard_outbox_lineage_v1() OWNER TO c4g_f12_admin');
   else{
    await client.query('SET LOCAL ROLE c4g_tenant_owner');await client.query('ALTER TABLE c4g_system.schema_migration DISABLE TRIGGER schema_migration_append_only');
    await client.query("UPDATE c4g_system.schema_migration SET resulting_fingerprint=repeat('a',64) WHERE ordinal=5");
    await client.query('ALTER TABLE c4g_system.schema_migration ENABLE TRIGGER schema_migration_append_only');await client.query('RESET ROLE');
   }
   await assert.rejects(preflightTenantClient(client,expected,baseline),error=>error.internalCode===(kind==='LEDGER'?'TENANT_LEDGER_MISMATCH':'TENANT_SCHEMA_FINGERPRINT_MISMATCH'));
  }finally{await client.query('ROLLBACK');client.release();}
 }
 await preflightTenant(pool,expected,baseline,{timeoutMs:15000});
}
async function rollbackUpgrade(pool,input,baseline,preserved){
 const before=await preserved(),seen=[],sqlVersions=new Map(manifest.filter(e=>e.ordinal>30).map(e=>[migrationSql(e.version,'up').sql,e.version]));
 const failingPool={async connect(){const client=await pool.connect();return {async query(...args){
  const version=sqlVersions.get(args[0]);if(version){seen.push(version);if(version.startsWith('033_'))throw Error('SYNTHETIC_033_FAILURE');}
  return client.query(...args);
 },release:error=>client.release(error)};}};
 const runner=createTenantMigrationRunner({pool:failingPool,observationPublisher:{async publish(){assert.fail('failed upgrade cannot publish');}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}});
 await assert.rejects(runner.migrate(input),error=>error.internalCode==='TENANT_MIGRATION_MIGRATION_SQL_FAILED');
 assert.deepEqual(seen,['031_application_document_transport','032_document_worker_runtime','033_organizational_opportunity_interests']);
 assert.deepEqual(await preserved(),before);
 assert.equal(tenantSchemaFingerprint(await tenantSchemaSnapshot(pool)),BASELINE.canonicalFingerprint);
 await preflightTenant(pool,{tenantId:input.tenantId,databaseGenerationId:input.databaseGenerationId},baseline,{timeoutMs:15000});
}
function oldData(values){
 const copy=structuredClone(values);delete copy['c4g_system.schema_migration'];
 for(const table of ['opportunity_catalog.application','opportunity_catalog.application_change'])for(const row of copy[table]||[]){
  for(const key of ['source_interest_id','source_interest_revision','unit_ids','unit_snapshot'])delete row[key];
 }
 return copy;
}
module.exports={initialize,refuseDrift,rollbackUpgrade,oldData};
