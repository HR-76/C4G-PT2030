'use strict';
// Explicit rehearsal package. Never imported by the APP or active migration CLI.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const base=require('../../../backend/src/security/centralMigrationManifest');
const runner=require('../../../backend/scripts/runCentralMigrations');
const schema=require('../../../backend/src/security/centralSchemaManifest');
const {digest}=require('../../../backend/src/opportunities/catalogRead/model');
const manifest=require('./package.json');
const entries=manifest.entries;
function load(version,direction){
 const entry=entries.find(e=>e.version===version);if(!entry)return base.migrationSql(version,direction);
 if(direction!=='up')throw Error('CATALOG_READ_NO_DESTRUCTIVE_ROLLBACK');
 const sql=fs.readFileSync(path.resolve(__dirname,'../../../backend/database/central/candidates',entry.file),'utf8').replace(/\r\n/g,'\n');
 const checksum=createHash('sha256').update(sql).digest('hex');if(checksum!==entry.upChecksum)throw Error('CATALOG_READ_SQL_CHECKSUM_MISMATCH');
 return {entry,sql,checksum,acceptedChecksums:[checksum]};
}
const {fingerprint}=require('../../../backend/src/opportunities/catalogRead/readSchema');
async function admit(client){
 const measured=await fingerprint(client);if(measured!==manifest.fingerprint)throw Object.assign(Error('CATALOG_READ_SCHEMA_OR_PERMISSION_DRIFT'),{measured});
 const core=schema.schemaFingerprint(await schema.centralSchemaSnapshot(client));
 if(core!==manifest.coreFingerprint)throw Object.assign(Error('CATALOG_READ_CORE_DRIFT'),{measured:core});
 return measured;
}
async function apply(pool){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock($1)',[42420002]);
  const marker=await client.query("SELECT 1 FROM public.c4g_database_identity WHERE product_code='C4G' AND database_role='CENTRAL'");if(marker.rowCount!==1)throw Error('CATALOG_READ_CENTRAL_REQUIRED');
  const all=[...base.prearchiveManifest,...entries];
  const requirements=all.map(e=>{const m=load(e.version,'up');return {version:e.version,irreversible:e.irreversible,acceptedChecksums:m.acceptedChecksums};});
  const rows=(await client.query('SELECT version,checksum_sha256,irreversible FROM public.c4g_schema_migration')).rows;
  const records=runner.validateAppliedMigrationLedger(rows,'catalog read package refused',all,requirements);
  const latest=all.filter(e=>records.has(e.version)).at(-1)?.version;
  if(!['045_opportunity_eu_legacy_prearchive','047_catalog_read_admission_v1',entries.at(-1).version].includes(latest))throw Error('CATALOG_READ_BASELINE_REQUIRED');
  if(latest==='045_opportunity_eu_legacy_prearchive')await schema.assertCentralSchema(client,latest);
  else if(latest==='047_catalog_read_admission_v1'){
   if(await fingerprint(client)!==manifest.previousFingerprint||schema.schemaFingerprint(await schema.centralSchemaSnapshot(client))!==manifest.previousCoreFingerprint)throw Error('CATALOG_READ_PREVIOUS_PACKAGE_DRIFT');
  }else await admit(client);
  const applied=[];
  for(const e of entries)if(!records.has(e.version)){
   const m=load(e.version,'up');await client.query(m.sql);
   await client.query('INSERT INTO public.c4g_schema_migration(version,checksum_sha256,irreversible) VALUES($1,$2,$3)',[e.version,m.checksum,e.irreversible]);applied.push(e.version);
  }
  await admit(client);await client.query('COMMIT');return {applied};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
module.exports={entries,load,fingerprint,admit,apply};
