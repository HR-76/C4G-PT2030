'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
async function measure(central,report){
 const pkg=require('../../../backend/src/security/opportunityEuReconciliationMigrationPackage');
 const schema=require('../../../backend/src/security/centralSchemaManifest'),authority=require('../../../backend/src/security/authoritySecurityManifest'),catalog=require('../../../backend/src/security/catalogSecurityManifest'),writer=require('../../../backend/src/security/euWriterSecurityManifest'),reconciliation=require('../../../backend/src/security/euRunReconciliationSecurityManifest');
 const raw=fs.readFileSync(path.resolve(__dirname,'../../../backend/database/central/candidates/opportunity_eu_expired_reconciliation.up.sql'),'utf8').replace(/\r\n/g,'\n');
 const client=await central.connect();
 try{
  await client.query('BEGIN');await client.query(raw);
  report.measurement={version:pkg.entry.version,upChecksum:createHash('sha256').update(raw).digest('hex'),schemaFingerprint:schema.schemaFingerprint(await schema.centralSchemaSnapshot(client)),authoritySecurityFingerprint:authority.digest(await authority.authoritySecuritySnapshot(client)),catalogSecurityFingerprint:catalog.digest(await catalog.catalogSecuritySnapshot(client)),euWriterSecurityFingerprint:writer.digest(await writer.euWriterSecuritySnapshot(client)),euRunReconciliationSecurityFingerprint:reconciliation.digest(await reconciliation.euRunReconciliationSecuritySnapshot(client))};
  await client.query('ROLLBACK');
 }catch(error){report.sqlDiagnostic={code:error.code,position:error.position,internalPosition:error.internalPosition,where:error.where,line:error.position?raw.slice(0,Number(error.position)).split('\n').length:null};await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
async function reconciliationProof({central,tenant,connection,report,check,outputDirectory,measureOnly=false}){
 const baseline=await require('./eu-writer-proof.cjs').euWriterProof({central,tenant,connection,report,check,outputDirectory});
 if(measureOnly){await require('./tenant-metadata-current-proof.cjs').metadataProof({tenant,identity:baseline.fixture.identity,report,check});await check('EU_RECONCILIATION044_CANDIDATE_MEASUREMENT_ROLLBACK',()=>measure(central,report));assert.equal((await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(central)).currentVersion,'043_opportunity_eu_writer_v2');report.measurementOnly=true;return;}
 const workspaceRoot=require('./eu-reconciliation-plan-fixture.cjs').workspace(outputDirectory);
 const pending=await require('./eu-reconciliation-fixture.cjs').expiredFixture({central,tenant,connection,report,check,workspaceRoot});
 try{
  await require('./tenant-metadata-current-proof.cjs').metadataProof({tenant,identity:baseline.fixture.identity,report,check});
  await pending.quiesce();
  await require('./eu-reconciliation-http-proof.cjs').prematureProof({central,pending,workspaceRoot,report,check});
  await pending.expired();
  await require('./eu-reconciliation-http-proof.cjs').httpProof({central,tenant,connection,baseline,pending,workspaceRoot,report,check});
 }finally{await pending.close();}
}
module.exports={measure,reconciliationProof};
