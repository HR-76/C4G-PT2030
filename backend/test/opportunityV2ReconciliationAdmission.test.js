'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const VERSION='044_opportunity_eu_expired_reconciliation';
test('EU writer capability admits explicit044 without admitting arbitrary later schemas',async()=>{
 const {assertEuWriterCapability}=require('../src/fundingTenders/euWriterConfig');let calls=0;
 const pool={query:async()=>{calls++;return {rows:[{ready:true}]};}};
 for(const version of ['043_opportunity_eu_writer_v2',VERSION])assert.equal(await assertEuWriterCapability(pool,version),true);
 assert.equal(calls,2);
 for(const version of ['042_opportunity_eu_source_control_v2','045_unknown',VERSION+'x'])await assert.rejects(assertEuWriterCapability(pool,version),/EU_WRITER_SCHEMA_REQUIRED/);
 assert.equal(calls,2);
 await assert.rejects(assertEuWriterCapability({query:async()=>({rows:[{ready:false}]})},VERSION),/EU_WRITER_SCHEMA_REQUIRED/);
});
test('reader044 requires verified admission and retains exact restricted v2 grants',async()=>{
 const schema=require('../src/security/centralSchemaManifest'),readerSchema=require('../src/security/catalogReaderSchema');
 const {assertReaderSession}=require('../src/security/catalogReaderSecurity');
 const derived=['revision_allocation_v2','revision_financial_detail_v2','revision_concept_v2','revision_allocation_concept_v2','revision_deadline_v2'];
 let extra=false;const client={async query(sql,values){
  if(sql.includes('session_user=current_user'))return {rows:[{reset:true,limited:true,membership:true}]};
  if(sql.includes('p.prosecdef')){assert.deepEqual(values[1],['opportunity','revision','funding_identity',...derived]);return {rows:[{excess:extra}]};}
  if(sql.includes(' AS excess'))return {rows:[{excess:false}]};
  if(sql.includes('a.is_grantable'))return {rows:derived.map(relname=>({relname,owner:'c4g_opportunity_central_owner',privilege_type:'SELECT',is_grantable:false}))};
  throw Error('Unexpected reader044 query');
 }};
 const original=schema.assertCentralSchemaForVersions;schema.assertCentralSchemaForVersions=async(_client,versions)=>{assert(versions.includes(VERSION));return {version:VERSION};};
 try{
  await assert.rejects(assertReaderSession(client,{version:VERSION}),/CATALOG_READER_SCHEMA_ADMISSION_REQUIRED/);
  const admission=await readerSchema.createReaderSchemaAdmission(client);await assertReaderSession(client,admission);
  extra=true;await assert.rejects(assertReaderSession(client,admission),/CATALOG_READER_ROLE_EXCESS_PRIVILEGES/);
 }finally{schema.assertCentralSchemaForVersions=original;}
});
test('bounded11145 capability keeps normal preflight for042/043/044 and rejects unknown versions',async()=>{
 const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
 const file=require.resolve('../src/opportunities/v2/collector11145'),loaded=new Module(file,module);loaded.filename=file;loaded.paths=Module._nodeModulePaths(path.dirname(file));
 let version=VERSION,calls=0,failure=false;const original=loaded.require.bind(loaded);
 loaded.require=name=>name==='../../security/centralMigrationPreflight'?{async preflightCentral(){calls++;if(failure)throw Error('PHYSICAL_DRIFT');return {currentVersion:version};}}:original(name);
 loaded._compile(fs.readFileSync(file,'utf8'),file);
 for(version of ['042_opportunity_eu_source_control_v2','043_opportunity_eu_writer_v2',VERSION])assert.equal(await loaded.exports.assertCollector11145Package({}),true);
 version='045_unknown';await assert.rejects(loaded.exports.assertCollector11145Package({}),{code:'OPPORTUNITY_V2_NOT_CONFIGURED'});
 version=VERSION;failure=true;await assert.rejects(loaded.exports.assertCollector11145Package({}),{code:'OPPORTUNITY_V2_NOT_CONFIGURED'});assert.equal(calls,5);
});
test('normal central schema admission verifies the separate044 helper security evidence',async()=>{
 const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{createHash}=require('node:crypto');
 const snapshot={tables:[],columns:[],constraints:[],indexes:[]},expected=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
 const entry={version:VERSION,schemaFingerprint:expected,euRunReconciliationSecurityFingerprint:'b'.repeat(64)};
 const file=require.resolve('../src/security/centralSchemaManifest'),loaded=new Module(file,module);loaded.filename=file;loaded.paths=Module._nodeModulePaths(path.dirname(file));
 const original=loaded.require.bind(loaded);let calls=0,drift=false;
 loaded.require=name=>name==='./centralMigrationManifest'?{manifest:[entry],knownManifest:[entry]}:name==='./catalogReaderSecurity'?{catalogReaderSnapshot:async()=>null}:name==='./euRunReconciliationSecurityManifest'?{async assertEuRunReconciliationSecurity(_client,value){calls++;assert.equal(value,entry.euRunReconciliationSecurityFingerprint);if(drift)throw Object.assign(Error('DRIFT'),{code:'EU_RECONCILIATION_SECURITY_DRIFT'});}}:original(name);
 loaded._compile(fs.readFileSync(file,'utf8'),file);
 const client={query:async()=>({rows:[{...snapshot,triggers:[],triggerFunctions:[],authoritySequence:[]}]})};
 assert.equal(await loaded.exports.assertCentralSchema(client,VERSION),expected);assert.equal(calls,1);
 drift=true;await assert.rejects(loaded.exports.assertCentralSchema(client,VERSION),{code:'EU_RECONCILIATION_SECURITY_DRIFT'});assert.equal(calls,2);
});
test('catalog preflight044 requires exactly the cumulative catalog and both reconciliation tables',async()=>{
 const {opportunityPreflight}=require('../src/opportunities/preflight');
 const tables=['duplicate_candidate','idempotency_record','opportunity','provenance','revision','funding_run','funding_run_item','funding_identity','funding_observation','funding_cycle','funding_batch','funding_cycle_seen','funding_refresh_target','funding_resolution',
 'funding_candidate_v2','manual_v2_candidate','pt2030_plan_preview','pt2030_plan_identity','pt2030_plan_revision','pt2030_plan_import','pt2030_plan_observation',
 'source_identity_v2','source_observation_v2','revision_evidence_v2','revision_allocation_v2','revision_financial_detail_v2','revision_concept_v2','revision_allocation_concept_v2','revision_deadline_v2','accepted_receipt_v2',
 'activation_plan_v2','activation_decision_v2','eu_source_control_v2','eu_source_control_receipt_v2','eu_writer_execution_v2','eu_writer_permit_v2','eu_writer_decision_v2'];
 const added=['eu_expired_reconciliation_v1','eu_expired_permit_v1'];
 function pool(version,names){return {async query(sql){
  if(sql==='SHOW server_version_num')return {rows:[{server_version_num:'180006'}]};
  if(sql.includes('FROM public.c4g_schema_migration'))return {rows:[{version}]};
  if(sql.includes('AS table_name'))return {rows:[...names].sort().map(table_name=>({table_name}))};
  if(sql.includes('FROM pg_catalog.pg_roles'))return {rows:Array.from({length:3},()=>({rolcanlogin:false,rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolbypassrls:false}))};
  if(sql.includes('pg_get_constraintdef'))return {rows:[{definition:'OPPORTUNITY_CREATED OPPORTUNITY_RECONCILIATION_REQUIRED'}]};
  throw Error('Unexpected catalog preflight query');
 }};}
 assert.equal((await opportunityPreflight(pool('043_opportunity_eu_writer_v2',tables),'central')).ready,true);
 assert.equal((await opportunityPreflight(pool(VERSION,[...tables,...added]),'central')).ready,true);
 assert.equal((await opportunityPreflight(pool('045_opportunity_eu_legacy_prearchive',[...tables,...added,'eu_legacy_prearchive_use_v1']),'central')).ready,true);
 await assert.rejects(opportunityPreflight(pool('045_opportunity_eu_legacy_prearchive',[...tables,...added]),'central'),/OPPORTUNITY_SCHEMA_DRIFT/);
 for(const names of [tables,[...tables,added[0]],[...tables,...added,'unexpected']])await assert.rejects(opportunityPreflight(pool(VERSION,names),'central'),/OPPORTUNITY_SCHEMA_DRIFT/);
});
test('separate reconciliation gate pins the current collector, frozen comparator and security regressions',()=>{
 const gate=require('../../test/integration/opportunity-v2/eu-reconciliation-gate.cjs');
 gate.parseArgs(['--isolated','--eu-reconciliation']);gate.parseArgs(['--isolated','--measure-eu-reconciliation']);
 for(const args of [[],['--eu-reconciliation'],['--isolated','--eu-writer'],['--isolated','--eu-reconciliation','--database=habitual']])assert.throws(()=>gate.parseArgs(args),/EXPLICIT_ISOLATED/);
 const hashes=gate.inputHashes();for(const file of ['backend/src/security/tenantSchemaFingerprint.js','backend/test/tenantSafetySnapshotBatch.test.js','backend/test/tenantSchemaCatalogBatch.test.js','backend/test/support/tenantSchemaLegacyQueries.json','test/integration/dashboard-tenant-cost/fixtures/tenantSchemaFingerprint-before.cjs','test/integration/opportunity-v2/tenant-metadata-current-proof.cjs','context/features/repository-cleanup.md','context/references/opportunity-v2/expired-run-reconciliation-contract.md'])assert.match(hashes[file],/^[a-f0-9]{64}$/);
 assert.equal(hashes['backend/src/apiBootstrap.js'],undefined);
 require('../../test/integration/opportunity-v2/eu-writer-gate.cjs').parseArgs(['--isolated','--eu-writer']);
});
