'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {bootstrap,policyVersion,recentMfaRequirement}=require('./executor-11145-fixture.cjs');
const {httpRuntime}=require('./eu-writer-http.cjs');
const {snapshot,preserved}=require('./registered-package-proof.cjs');
const pkg=require('../../../backend/src/security/opportunityEuWriterMigrationPackage');
async function measure(central,report){
 const schema=require('../../../backend/src/security/centralSchemaManifest');
 const authority=require('../../../backend/src/security/authoritySecurityManifest');
 const catalog=require('../../../backend/src/security/catalogSecurityManifest');
 const writer=require('../../../backend/src/security/euWriterSecurityManifest');
 const raw=fs.readFileSync(path.resolve(__dirname,'../../../backend/database/central/candidates/opportunity_eu_writer_v2.up.sql'),'utf8').replace(/\r\n/g,'\n');
 const client=await central.connect();
 try{
  await client.query('BEGIN');
  await client.query(raw);
  report.measurement={version:pkg.entry.version,upChecksum:createHash('sha256').update(raw).digest('hex'),
   schemaFingerprint:schema.schemaFingerprint(await schema.centralSchemaSnapshot(client)),
   authoritySecurityFingerprint:authority.digest(await authority.authoritySecuritySnapshot(client)),
   catalogSecurityFingerprint:catalog.digest(await catalog.catalogSecuritySnapshot(client)),
   euWriterSecurityFingerprint:writer.digest(await writer.euWriterSecuritySnapshot(client))};
  await client.query('ROLLBACK');
 }catch(error){report.sqlDiagnostic={code:error.code,position:error.position,internalPosition:error.internalPosition,where:error.where,line:error.position?raw.slice(0,Number(error.position)).split('\n').length:null};await client.query('ROLLBACK');throw error;}finally{client.release();}
}
async function euWriterProof({central,tenant,connection,report,check,outputDirectory,measureOnly=false}){
 const fixture=await bootstrap(central,tenant);
 fixture.legacyReview=await require('./eu-writer-fixture.cjs').legacyReviewFixture(central,fixture);
 const before={central:await snapshot(central,{central:true}),tenant:await snapshot(tenant)};
 await require('./registered-package-migration.cjs').migrateAndVerify({central,tenant,identity:fixture.identity,report,check,before,preserved});
 if(measureOnly){
  await check('EU_WRITER_CANDIDATE_MEASUREMENT_ROLLBACK_ONLY',()=>measure(central,report));
  assert.equal((await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(central)).currentVersion,pkg.CENTRAL_BASELINE);
  report.measurementOnly=true;return;
 }
 let http,collected,accepted,candidate,operationalInstallation;
 const windowApproval=require('./writer-window-approval-gate.cjs'),writerWindowWorkspaceRoot=windowApproval.workspace(outputDirectory);
 const live=require('./executor-11145-transport.cjs').createLive11145Transport({outputDirectory,report});
 try{
 await check('EU_WRITER_BASELINE042_REAL_11145_HUMAN_ACCEPTANCE_AND_LEGACY_RESUME_REFUSAL',async()=>{
  http=await httpRuntime({central,connection,fixture,report,fetchImpl:live.fetchImpl,writerWindowWorkspaceRoot});
  const command=async(method,url,body,status=200)=>{const response=await http.request(fixture.actor,method,url,body);assert.equal(response.status,status,JSON.stringify(response));return response.data;};
  collected=await command('POST','/calls/11145/collect',{requestId:randomUUID(),expectedSourceFence:1},201);
  await command('POST','/sources/eu/suspend',{requestId:randomUUID(),expectedFence:1});
  await command('POST','/sources/eu/quiesce',{requestId:randomUUID(),expectedFence:2});
  const plan=await command('POST','/calls/11145/plans',{requestId:randomUUID(),runId:collected.runId},201);
  const approved=await command('POST','/plans/'+plan.planId+'/approve',{requestId:randomUUID(),planDigest:plan.planDigest});
  accepted=await command('POST','/calls/11145/plans/'+plan.planId+'/accept',{requestId:randomUUID(),planDigest:plan.planDigest,fence:approved.fence,sourceFence:3});
  const refusal=await http.request(fixture.actor,'POST','/sources/eu/resume',{requestId:randomUUID(),expectedFence:3});assert.equal(refusal.status,409);
  assert.equal(refusal.data.error.code,'OPPORTUNITY_V2_EU_LEGACY_RESUME_BLOCKED');
  candidate=(await central.query('SELECT snapshot FROM opportunity_catalog.revision WHERE revision_id=$1',[accepted.revisionId])).rows[0].snapshot;
  report.initialAcceptance={...accepted,livePublicTransport:true,normalAuthorityCoordinator:true,syntheticSession:true,realOidcProvider:false};
 });
 await windowApproval.windowApprovalProof({central,tenant,fixture,http,candidate,accepted,report,check,workspaceRoot:writerWindowWorkspaceRoot});
 await check('EU_WRITER_REGISTERED043_BASELINE_AND_REPLAY',async()=>{
  const prefix=(await central.query('SELECT * FROM public.c4g_schema_migration ORDER BY version')).rows;
  const migration=require('../../../backend/scripts/runCentralMigrations');
  await check('EU_WRITER_HABITUAL_INSTALLER043_PRESERVATION_AND_PHYSICAL_BINDINGS',async()=>{operationalInstallation=await require('./eu-writer-install-proof.cjs').installProof({central,tenant,connection,fixture,report,check,workspaceRoot:writerWindowWorkspaceRoot});});
  const ready=await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(central);
  assert.equal(ready.currentVersion,pkg.entry.version);assert.equal(ready.fingerprint,pkg.entry.schemaFingerprint);
  assert.deepEqual((await central.query('SELECT * FROM public.c4g_schema_migration WHERE version<>$1 ORDER BY version',[pkg.entry.version])).rows,prefix);
  assert.deepEqual(await migration.applyRegisteredEuWriterPackage(central,pkg.PACKAGE_ID),[]);
  assert.deepEqual(await migration.applyCentralMigrations(central),[]);
  await preserved(tenant,before.tenant);
  report.activationPackage=report.package;
  report.package={id:pkg.PACKAGE_ID,digest:pkg.packageDigest,entry:pkg.entry,baseline:pkg.CENTRAL_BASELINE,prefixPreserved:true,tenantTarget:'034_application_snapshot_v2'};
 });
 await check('EU_WRITER_HELPER_DEFINITION_AND_PUBLIC_EXECUTE_DRIFT_DENIED',async()=>{
  const security=require('../../../backend/src/security/euWriterSecurityManifest'),c=await central.connect();
  try{
   await c.query('BEGIN');await c.query('ALTER FUNCTION opportunity_catalog.assert_eu_writer_permit_v2(uuid) COST 101');
   await assert.rejects(security.assertEuWriterSecurity(c,pkg.entry.euWriterSecurityFingerprint),{code:'EU_WRITER_SECURITY_DRIFT'});await c.query('ROLLBACK');
   await c.query('BEGIN');await c.query('GRANT EXECUTE ON FUNCTION opportunity_catalog.assert_eu_writer_permit_v2(uuid) TO PUBLIC');
   await assert.rejects(security.assertEuWriterSecurity(c,pkg.entry.euWriterSecurityFingerprint),{code:'EU_WRITER_SECURITY_DRIFT'});await c.query('ROLLBACK');
   await security.assertEuWriterSecurity(c,pkg.entry.euWriterSecurityFingerprint);
  }finally{await c.query('ROLLBACK').catch(()=>{});c.release();}
 });
 await http.close();http=null;
 await require('./eu-writer-worker-proof.cjs').workerProof({central,tenant,connection,fixture,report,check,outputDirectory,before});
 report.packageDigest=pkg.packageDigest;
 return {fixture,before,state:operationalInstallation.state};
 }finally{await http?.close();}
}
module.exports={euWriterProof,measure};
