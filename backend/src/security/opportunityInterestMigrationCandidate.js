'use strict';
// Preparation/probe only. Nothing here changes the active migration manifest,
// produces branded tenant evidence, or admits a schema to the application.
const fs=require('node:fs'),path=require('node:path');
const {manifest,migrationSql,checksumSql,validateTenantMigrationManifest}=require('./tenantMigrationManifest');
const {assertNoTransactionControl}=require('./sqlTransactionControl');
const VERSION='033_organizational_opportunity_interests';
const BASELINE='032_document_worker_runtime';
function source(){
 const file=path.resolve(__dirname,`../../database/tenant/migrations/${VERSION}.up.sql`);
 const sql=fs.readFileSync(file,'utf8');assertNoTransactionControl(sql);
 return Object.freeze({version:VERSION,sql,checksum:checksumSql(sql)});
}
function baseline(){
 const entries=Object.freeze(manifest.filter(entry=>entry.ordinal<=32));
 if(entries.at(-1)?.version!==BASELINE)throw Error('INTEREST_CANDIDATE_BASELINE_MISMATCH');
 validateTenantMigrationManifest(entries,migrationSql);return entries;
}
function measuredCandidate(schemaFingerprint){
 if(typeof schemaFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(schemaFingerprint))throw Error('INTEREST_MEASURED_FINGERPRINT_REQUIRED');
 const entries=baseline(),material=source();
 if(entries.some(entry=>entry.schemaFingerprint===schemaFingerprint))throw Error('INTEREST_CANDIDATE_FINGERPRINT_UNCHANGED');
 const entry=Object.freeze({version:VERSION,ordinal:33,irreversible:true,sqlChecksum:material.checksum,schemaFingerprint,
  capabilities:Object.freeze([...entries.at(-1).capabilities,'ORGANIZATIONAL_OPPORTUNITY_INTERESTS']),
  compatibility:Object.freeze({readVersions:Object.freeze([VERSION]),writeVersions:Object.freeze([VERSION])})});
 const candidateEntries=Object.freeze([...entries,entry]);
 const loadMigration=(version,direction)=>{
  if(version!==VERSION)return migrationSql(version,direction);
  if(direction!=='up')throw Error('INTEREST_CANDIDATE_NO_DESTRUCTIVE_DOWN');
  const current=source();if(current.checksum!==material.checksum)throw Error('INTEREST_CANDIDATE_SOURCE_CHANGED');
  return Object.freeze({entry,sql:current.sql,checksum:current.checksum});
 };
 validateTenantMigrationManifest(candidateEntries,loadMigration);
 return Object.freeze({entry,entries:candidateEntries,loadMigration});
}
function registeredCandidate(){
 const entry=manifest.find(item=>item.version===VERSION),material=source();
 if(!entry||manifest.at(-1)!==entry||entry.sqlChecksum!==material.checksum)throw Error('INTEREST_REGISTERED_MANIFEST_REQUIRED');
 validateTenantMigrationManifest();return entry;
}
module.exports={VERSION,BASELINE,source,baseline,measuredCandidate,registeredCandidate};
