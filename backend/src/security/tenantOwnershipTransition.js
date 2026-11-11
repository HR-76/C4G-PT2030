'use strict';
const {BASELINE,isHistoricalOwnershipLedger,ledgerDigest}=require('./tenantHistoricalOwnership');
const {tenantSchemaSnapshot,tenantSchemaFingerprint}=require('./tenantSchemaFingerprint');
const {preflightTenantClient}=require('./tenantMigrationPreflight');
const refuse=()=>{throw Error('TENANT_OWNERSHIP_BASELINE_REFUSED');};
// Explicit installer operation. Never called by API/worker startup.
async function transitionTenantOwnership(client,expected){
  await client.query('BEGIN');
  try{
    await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'");
    await client.query('SELECT pg_advisory_xact_lock(43000001)');
    await client.query('LOCK TABLE c4g_system.schema_migration IN SHARE MODE');
    const rows=(await client.query('SELECT migration_id,ordinal,checksum_sha256,irreversible,resulting_fingerprint FROM c4g_system.schema_migration ORDER BY ordinal')).rows;
    if(!isHistoricalOwnershipLedger(rows))refuse();
    const snapshot=await tenantSchemaSnapshot(client),before=tenantSchemaFingerprint(snapshot);
    if(![BASELINE.fingerprint,BASELINE.canonicalFingerprint].includes(before))refuse();
    const changed=before!==BASELINE.canonicalFingerprint;
    if(changed){
      const simulated=structuredClone(snapshot);
      const functions=simulated.functions.filter(f=>f.schema_name==='async_exec'&&f.function_name==='guard_outbox_lineage_v1'&&f.identity_arguments==='');
      if(functions.length!==1||functions[0].owner_name!=='c4g_f12_admin')refuse();
      functions[0].owner_name='c4g_tenant_owner';
      if(tenantSchemaFingerprint(simulated)!==BASELINE.canonicalFingerprint)refuse();
      await client.query('ALTER FUNCTION async_exec.guard_outbox_lineage_v1() OWNER TO c4g_tenant_owner');
    }
    const evidence=await preflightTenantClient(client,expected);
    if(evidence.currentVersion!==BASELINE.version||evidence.schemaFingerprint!==BASELINE.canonicalFingerprint)refuse();
    const afterRows=(await client.query('SELECT migration_id,ordinal,checksum_sha256,irreversible,resulting_fingerprint FROM c4g_system.schema_migration ORDER BY ordinal')).rows;
    if(ledgerDigest(afterRows)!==ledgerDigest(rows))refuse();
    const transactionId=(await client.query('SELECT txid_current()::text AS id')).rows[0].id;
    await client.query('COMMIT');
    return {operation:'TENANT_030_CANONICAL_LINEAGE_OWNER_V1',changed,before,after:evidence.schemaFingerprint,
      ledgerDigest:ledgerDigest(rows),transactionId,evidence};
  }catch(error){try{await client.query('ROLLBACK');}catch{/* keep the original failure */}throw error;}
}
module.exports={transitionTenantOwnership};
