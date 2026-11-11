'use strict';
// Internal F4 observation only. Never accepts SQL or returns a functional client.
const {preflightTenantClient}=require('./tenantMigrationPreflight');
const {tenantSchemaSnapshot,tenantSchemaFingerprint}=require('./tenantSchemaFingerprint');
const {allRegisteredMigrations:manifest}=require('./tenantMigrationManifest');
function closed(value,keys){return value&&Object.getPrototypeOf(value)===Object.prototype
  &&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)
    &&Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'));}
// Inside one HTTP request a successful observation of the same database, tenant
// and generation is reused (context/decisions/request-scoped-central-admission.md).
// The binding verifier still checks the login, its roles and the physical
// database on every phase. Workers and scripts have no request scope.
function observeTenantRuntimeMetadata(client,expected,{observe=observeFreshTenantMetadata}={}){
  return require('./requestAdmissionScope').admitWithinRequest(
    `tenant:${client.host}:${client.port}/${client.database}:${expected.tenantId}:${expected.databaseGenerationId}`,()=>observe(client,expected));
}
async function observeFreshTenantMetadata(client,expected){
  const observedFingerprint=tenantSchemaFingerprint(await tenantSchemaSnapshot(client));
  const pinned=manifest.find(entry=>entry.schemaFingerprint===observedFingerprint);
  if(!pinned?.capabilities.includes('F4_RUNTIME_METADATA_ACCESS'))throw new Error('F4_METADATA_DRIFT');
  const previous=(await client.query('SELECT current_user AS role')).rows[0]?.role;
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(previous||''))throw new Error('F4_METADATA_ROLE_INVALID');
  let metadata;
  try{
    await client.query('SET LOCAL ROLE c4g_f4_metadata_executor');
    metadata=(await client.query('SELECT c4g_system.runtime_metadata_v1($1::uuid,$2::uuid) AS metadata',
      [expected.tenantId,expected.databaseGenerationId])).rows[0]?.metadata;
  }finally{
    // A failed SQL transaction must be rolled back/discarded by F4; never reused.
    await client.query('RESET ROLE');
  }
  const restored=(await client.query('SELECT current_user AS role')).rows[0]?.role;
  if(restored!==previous)throw new Error('F4_METADATA_ROLE_RESTORE_FAILED');
  if(!closed(metadata,['marker','ledger','flags'])
    ||!closed(metadata.marker,['product_code','database_role','marker_format_version','tenant_id','database_generation_id','identity_revision'])
    ||metadata.marker.product_code!=='C4G'||metadata.marker.database_role!=='TENANT'||metadata.marker.marker_format_version!==1
    ||metadata.marker.identity_revision!==1||metadata.marker.tenant_id!==expected.tenantId||metadata.marker.database_generation_id!==expected.databaseGenerationId
    ||!closed(metadata.flags,['legacy_drained','v1_complete'])||typeof metadata.flags.legacy_drained!=='boolean'||typeof metadata.flags.v1_complete!=='boolean'
    ||!Array.isArray(metadata.ledger)||metadata.ledger.length>manifest.length||metadata.ledger.some(row=>
      !closed(row,['migration_id','ordinal','checksum_sha256','irreversible','resulting_fingerprint'])||typeof row.migration_id!=='string'
      ||!Number.isSafeInteger(row.ordinal)||row.ordinal<0||typeof row.irreversible!=='boolean'
      ||!/^[a-f0-9]{64}$/.test(row.checksum_sha256)||!/^[a-f0-9]{64}$/.test(row.resulting_fingerprint)))throw new Error('F4_METADATA_INVALID');
  const inspection={async query(sql,values){
    if(/FROM c4g_system\.tenant_identity/.test(sql))return{rows:[metadata.marker],rowCount:1};
    if(/FROM c4g_system\.schema_migration/.test(sql))return{rows:metadata.ledger,rowCount:metadata.ledger.length};
    if(sql.includes('AS legacy_drained')){
      const safe=sql.slice(0,sql.indexOf('NOT EXISTS(SELECT 1 FROM async_exec.outbox'));
      const prefix=safe.trimEnd().replace(/,$/,'');
      const result=await client.query(prefix,values);
      return{rows:[{...result.rows[0],...metadata.flags}],rowCount:1};
    }
    return client.query(sql,values);
  }};
  return preflightTenantClient(inspection,expected);
}
module.exports={observeTenantRuntimeMetadata};
