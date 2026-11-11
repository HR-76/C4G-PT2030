'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../../..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function baseline(){
 const file=require.resolve('../../../backend/src/security/tenantSchemaFingerprint');
 const bytes=fs.readFileSync(path.join(root,'test/integration/dashboard-tenant-cost/fixtures/tenantSchemaFingerprint-before.cjs'));
 assert.equal(hash(bytes),'d0baa7265dbf86ada926fe783cf52d110f84dbdbbfe415c1df4ab07f89a972bf');
 const loaded=new Module(file,module);loaded.filename=file;loaded.paths=Module._nodeModulePaths(path.dirname(file));loaded._compile(bytes.toString('utf8'),file);return loaded.exports;
}
async function metadataProof({tenant,identity,report,check}){
 const old=baseline(),current=require('../../../backend/src/security/tenantSchemaFingerprint');
 const entry=require('../../../backend/src/security/opportunityV2MigrationPackage').tenantAddition;
 const entries=require('../../../backend/src/security/tenantMigrationManifest').registeredManifest;
 const {preflightTenantClient}=require('../../../backend/src/security/tenantMigrationPreflight');
 await check('EU_RECONCILIATION_TENANT034_METADATA_BYTES_AND_FRESH_DRIFT',async()=>{
  const client=await tenant.connect(),observations=[];let baselineFingerprint;
  const compare=async label=>{let commands=0;const counted={query(...args){commands++;return client.query(...args);}};
   const before=await old.tenantSchemaSnapshot(counted),oldCommands=commands;commands=0;const after=await current.tenantSchemaSnapshot(counted);
   assert.equal(JSON.stringify(after),JSON.stringify(before),label);const fingerprint=current.tenantSchemaFingerprint(after);assert.equal(fingerprint,old.tenantSchemaFingerprint(before));observations.push({label,oldCommands,currentCommands:commands,fingerprint});return fingerprint;
  };
  try{
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');baselineFingerprint=await compare('baseline034');assert.equal(baselineFingerprint,entry.schemaFingerprint);
   assert.equal((await preflightTenantClient(client,identity,entries)).currentVersion,entry.version);await compare('freshRepeat034');await client.query('ROLLBACK');
   for(const [label,sql]of [['acl','GRANT DELETE ON organizational_scope.scope TO c4g_organizational_scope_runtime'],['rls','ALTER TABLE organizational_scope.scope NO FORCE ROW LEVEL SECURITY']]){
    await client.query('BEGIN');await client.query(sql);assert.notEqual(await compare(label+'Drift'),baselineFingerprint);
    await assert.rejects(preflightTenantClient(client,identity,entries));await client.query('ROLLBACK');
    await client.query('BEGIN READ ONLY');assert.equal(await compare(label+'Rollback'),baselineFingerprint);await client.query('ROLLBACK');
   }
   report.tenantMetadataCurrent={baselineSha256:'d0baa7265dbf86ada926fe783cf52d110f84dbdbbfe415c1df4ab07f89a972bf',candidateSha256:hash(fs.readFileSync(require.resolve('../../../backend/src/security/tenantSchemaFingerprint'))),sameClientTransaction:true,bytesEqual:true,freshAclAndRlsDriftDetected:true,normalPreflightRejectedDrift:true,rollbackRestored:true,observations,performanceClaim:false};
  }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
 });
}
module.exports={baseline,metadataProof};
