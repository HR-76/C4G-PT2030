'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const central=require('../src/security/centralMigrationManifest');
const tenant=require('../src/security/tenantMigrationManifest');

test('registered opportunity package preserves automatic targets and historical entry identity',()=>{
 const pkg=require('../src/security/opportunityV2MigrationPackage');
 assert.equal(central.manifest.at(-1).version,'035_funding_source_resolution');
 assert.equal(tenant.manifest.at(-1).version,'033_organizational_opportunity_interests');
 assert.equal(central.registeredManifest.at(-1).version,'042_opportunity_eu_source_control_v2');
 assert.equal(tenant.registeredManifest.at(-1).version,'034_application_snapshot_v2');
 assert.equal(central.requiredCentralMigrations().length,central.manifest.length);
 assert.equal(tenant.requiredTenantMigrations().length,tenant.manifest.length);
 for(const [base,registered] of [[central.manifest,central.registeredManifest],[tenant.manifest,tenant.registeredManifest]]){
  assert.ok(Object.isFrozen(registered));base.forEach((entry,i)=>assert.equal(entry,registered[i]));
 }
 assert.equal(pkg.PACKAGE_ID,'opportunity-v2-activation-11145');
 assert.throws(()=>pkg.assertPackageId('latest'),/not registered/);
});

test('registered SQL is pinned, irreversible and connected to measured predecessors',()=>{
 const pkg=require('../src/security/opportunityV2MigrationPackage');
 let predecessor=central.manifest.at(-1);
 for(const entry of pkg.centralEntries){
  assert.equal(entry.requiresPreflightVersion,predecessor.version);
  assert.equal(entry.requiresCatalogSecurityFingerprint,predecessor.catalogSecurityFingerprint);
  assert.equal(central.migrationSql(entry.version,'up').checksum,entry.upChecksum);
  assert.throws(()=>central.migrationSql(entry.version,'up',()=> 'SELECT 1;'),/checksum mismatch/);
  assert.throws(()=>central.migrationSql(entry.version,'down'),/irreversible/);
  predecessor=entry;
 }
 const entry=tenant.registeredManifest.at(-1);
 assert.equal(tenant.migrationSql(entry.version,'up').checksum,entry.sqlChecksum);
 assert.throws(()=>tenant.migrationSql(entry.version,'up',()=> 'SELECT 1;'),/checksum mismatch/);
 assert.throws(()=>tenant.migrationSql(entry.version,'down'),/irreversible/);
 assert.ok(entry.capabilities.includes('APPLICATION_OPPORTUNITY_SNAPSHOT_V2'));
 assert.deepEqual(entry.compatibility.readVersions,[entry.version]);
 assert.equal(tenant.validateTenantMigrationManifest(tenant.registeredManifest),true);
});

test('normal ledgers recognize complete registered package and reject gaps, unknown versions and drift',()=>{
 const {validateAppliedMigrationLedger}=require('../scripts/runCentralMigrations');
 const rows=central.registeredManifest.map(entry=>({version:entry.version,checksum_sha256:central.migrationSql(entry.version,'up').checksum,irreversible:entry.irreversible}));
 assert.equal(validateAppliedMigrationLedger(rows).size,rows.length);
 assert.equal(validateAppliedMigrationLedger(rows.slice(0,central.manifest.length)).size,central.manifest.length);
 assert.throws(()=>validateAppliedMigrationLedger([...rows.slice(0,36),...rows.slice(37)]),/gap/);
 assert.throws(()=>validateAppliedMigrationLedger([...rows,{version:'043_unknown'}]),/Unknown/);
 assert.throws(()=>validateAppliedMigrationLedger(rows.map((r,i)=>i===42?{...r,checksum_sha256:'0'.repeat(64)}:r)),/differs/);
 assert.equal(central.supportsCentralVersion(rows.at(-1).version,'035_funding_source_resolution'),true);
 const tenantRows=tenant.registeredManifest.map(entry=>({migration_id:entry.version,ordinal:entry.ordinal,checksum_sha256:entry.sqlChecksum,irreversible:entry.irreversible,resulting_fingerprint:entry.schemaFingerprint}));
 assert.equal(tenant.validateTenantLedger(tenantRows).currentVersion,'034_application_snapshot_v2');
 assert.throws(()=>tenant.validateTenantLedger(tenantRows.slice(1)),/differs/);
});

test('registered runners require explicit package and deny dependency substitution',()=>{
 const {applyRegisteredCentralPackage}=require('../scripts/runCentralMigrations');
 const {createRegisteredTenantMigrationRunner}=require('../src/security/tenantMigrationRunner');
 assert.equal(typeof applyRegisteredCentralPackage,'function');
 assert.throws(()=>createRegisteredTenantMigrationRunner({packageId:'latest'}),/not registered/);
 assert.throws(()=>createRegisteredTenantMigrationRunner({packageId:'opportunity-v2-activation-11145',runPreflight:()=>true}),/dependencies/);
});

test('registered fingerprints and reader admission keep baseline and only final package reader version',()=>{
 const schema=require('../src/security/centralSchemaManifest');
 const reader=require('../src/security/catalogReaderSchema');
 assert.equal(schema.EXPECTED_CENTRAL_SCHEMA_SHA256,central.manifest.at(-1).schemaFingerprint);
 for(const entry of central.registeredManifest)assert.equal(schema.EXPECTED_CENTRAL_SCHEMA_SHA256_BY_VERSION[entry.version],entry.schemaFingerprint);
 assert.equal(reader.admittedReaderVersion(central.registeredManifest.at(-1).schemaFingerprint,central.registeredManifest),'042_opportunity_eu_source_control_v2');
 assert.throws(()=>reader.admittedReaderVersion(central.registeredManifest.at(-2).schemaFingerprint,central.registeredManifest),/DRIFT/);
});

test('ordinary central migration entry point applies no package SQL on baseline or complete registered state',async()=>{
 const {applyCentralMigrations}=require('../scripts/runCentralMigrations');
 for(const entries of [central.manifest,central.registeredManifest]){
  const queries=[];
  const rows=entries.map(entry=>({version:entry.version,checksum_sha256:central.migrationSql(entry.version,'up').checksum,irreversible:entry.irreversible}));
  const client={async query(sql){queries.push(sql);
   if(sql.includes('pg_try_advisory'))return{rows:[{acquired:true}]};
   if(sql.includes('marker_exists'))return{rows:[{marker_exists:true}]};
   if(sql.includes('AS matches'))return{rows:[{matches:true}]};
   if(sql.includes('SELECT version, checksum_sha256'))return{rows};
   return{rows:[]};},release(){}};
  assert.deepEqual(await applyCentralMigrations({connect:async()=>client}),[]);
  assert.equal(queries.includes('COMMIT'),true);
  assert.equal(queries.some(sql=>sql.includes('INSERT INTO public.c4g_schema_migration')),false);
  assert.equal(queries.some(sql=>sql.includes('CREATE TABLE opportunity_catalog.')),false);
 }
});

test('registered package refuses missing/wrong baseline before SQL and rollback preserves the ledger',async()=>{
 const {applyRegisteredCentralPackage}=require('../scripts/runCentralMigrations');
 const entries=central.manifest.slice(0,-1),queries=[];
 const rows=entries.map(entry=>({version:entry.version,checksum_sha256:central.migrationSql(entry.version,'up').checksum,irreversible:entry.irreversible}));
 const client={async query(sql){queries.push(sql);
  if(sql.includes('pg_try_advisory'))return{rows:[{acquired:true}]};
  if(sql.includes('marker_exists'))return{rows:[{marker_exists:true}]};
  if(sql.includes('AS matches'))return{rows:[{matches:true}]};
  if(sql.includes('SELECT version, checksum_sha256'))return{rows};return{rows:[]};},release(){}};
 await assert.rejects(()=>applyRegisteredCentralPackage({connect:async()=>client},'opportunity-v2-activation-11145'),/baseline mismatch/);
 assert.ok(queries.includes('ROLLBACK'));assert.ok(!queries.includes('COMMIT'));
 assert.equal(queries.some(sql=>sql.includes('INSERT INTO public.c4g_schema_migration')),false);
});

test('tenant publisher does not admit a forged new capability while keeping baseline target unchanged',async()=>{
 const {createTenantSchemaObservationPublisher}=require('../src/security/tenantSchemaObservationPublisher');
 const writes=[],publisher=createTenantSchemaObservationPublisher({recordObservation:async x=>writes.push(x)});
 const request={expectedRevision:1,correlationId:'package-test',idempotencyKey:'package-test'};
 const evidence=entry=>({tenantId:'synthetic',currentVersion:entry.version,schemaFingerprint:entry.schemaFingerprint,capabilities:entry.capabilities});
 await publisher.publish({...request,evidence:evidence(tenant.manifest.at(-1))});
 assert.equal(writes[0].targetVersion,tenant.manifest.at(-1).version);
 await assert.rejects(()=>publisher.publish({...request,evidence:evidence(tenant.registeredManifest.at(-1))}),/evidence is invalid/);
 assert.equal(writes.length,1);
});

test('ordinary tenant migration preserves the selected target before and after explicit package installation',async()=>{
 const {createTenantMigrationRunner}=require('../src/security/tenantMigrationRunner');
 for(const entries of [tenant.manifest,tenant.registeredManifest]){
  const current=entries.at(-1),queries=[],publications=[],observedEntries=[];
  const evidence={currentVersion:current.version,schemaFingerprint:current.schemaFingerprint};
  const rows=entries.map(entry=>({migration_id:entry.version,ordinal:entry.ordinal,checksum_sha256:entry.sqlChecksum,irreversible:entry.irreversible,resulting_fingerprint:entry.schemaFingerprint}));
  const client={async query(sql){queries.push(sql);
   if(sql.includes('pg_try_advisory'))return{rows:[{acquired:true}]};
   if(sql.includes('to_regclass'))return{rows:[{marker_exists:true,ledger_exists:true}]};
   if(sql.includes('SELECT migration_id'))return{rows};return{rows:[]};},release(){}};
  const observe=async(_client,_expected,list)=>{observedEntries.push(list);return evidence;};
  const runner=createTenantMigrationRunner({pool:{connect:async()=>client},observationPublisher:{publish:async value=>publications.push(value)},
   timeoutMs:1000,scheduler:{setTimeout,clearTimeout},runPreflight:observe,runPreflightClient:observe});
  const result=await runner.migrate({tenantId:'test-tenant',databaseGenerationId:'test-generation',expectedRevision:1,correlationId:'test-correlation',idempotencyKey:'test-idempotency'});
  assert.deepEqual(result.appliedVersions,[]);
  assert.equal(publications[0].evidence.currentVersion,current.version);
  assert.equal(observedEntries.at(-1).at(-1).version,current.version);
  assert.equal(queries.some(sql=>sql.includes('INSERT INTO c4g_system.schema_migration')),false);
 }
});

test('normal Central preflight refuses a partially installed registered package before authority admission',async()=>{
 const {preflightCentral}=require('../src/security/centralMigrationPreflight');
 const rows=central.registeredManifest.slice(0,-1).map(entry=>({version:entry.version,checksum_sha256:central.migrationSql(entry.version,'up').checksum,irreversible:entry.irreversible}));
 const queries=[],client={async query(sql){queries.push(sql);
  if(sql.includes('server_version_num'))return{rows:[{server_version_num:'180006'}]};
  if(sql.includes('marker_exists'))return{rows:[{marker_exists:true}]};
  if(sql.includes('AS matches'))return{rows:[{matches:true}]};
  if(sql.includes('SELECT version, checksum_sha256'))return{rows};return{rows:[]};},release(){}};
 await assert.rejects(()=>preflightCentral({connect:async()=>client}),/package is incomplete/);
 assert.ok(queries.includes('ROLLBACK'));assert.ok(!queries.includes('COMMIT'));
});
