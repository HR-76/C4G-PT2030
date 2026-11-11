'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('EU writer has a separate explicit package and preserves the accepted 11145 package',()=>{
 const pkg=require('../src/security/opportunityEuWriterMigrationPackage');
 const old=require('../src/security/opportunityV2MigrationPackage');
 const m=require('../src/security/centralMigrationManifest');
 assert.equal(old.packageDigest,'4f83267f1c2d3f41c604453f3489136397f661fbc06a99de8b79ed2980674e7a');
 assert.equal(m.manifest.at(-1).version,'035_funding_source_resolution');
 assert.equal(m.registeredManifest.at(-1).version,'042_opportunity_eu_source_control_v2');
 assert.equal(pkg.CENTRAL_BASELINE,m.registeredManifest.at(-1).version);
 assert.equal(pkg.PACKAGE_ID,'opportunity-eu-writer-v2');
 assert.equal(m.writerManifest.at(-1).version,'043_opportunity_eu_writer_v2');
 assert.equal(m.writerManifest.at(-1),pkg.entry);
 assert.equal(m.knownManifest.find(entry=>entry.version===pkg.entry.version),pkg.entry);
 assert.throws(()=>pkg.assertPackageId(old.PACKAGE_ID),/not registered/);
 assert.equal(typeof require('../scripts/runCentralMigrations').applyRegisteredEuWriterPackage,'function');
});
test('reader schema admission preserves 042 and admits only the complete measured writer package',()=>{
 const m=require('../src/security/centralMigrationManifest'),reader=require('../src/security/catalogReaderSchema');
 for(const entry of [m.registeredManifest.at(-1),m.knownManifest.at(-1)])assert.equal(reader.admittedReaderVersion(entry.schemaFingerprint,m.knownManifest),entry.version);
 assert.throws(()=>reader.admittedReaderVersion(m.registeredManifest.at(-2).schemaFingerprint,m.knownManifest),/DRIFT/);
 assert.equal(require('../src/security/centralSchemaManifest').EXPECTED_CENTRAL_SCHEMA_SHA256,m.manifest.at(-1).schemaFingerprint);
});
test('writer SQL and helper authority fingerprint are pinned and irreversible',()=>{
 const pkg=require('../src/security/opportunityEuWriterMigrationPackage'),m=require('../src/security/centralMigrationManifest');
 assert.equal(m.migrationSql(pkg.entry.version,'up').checksum,pkg.entry.upChecksum);
 assert.throws(()=>m.migrationSql(pkg.entry.version,'up',()=> 'SELECT 1;'),/checksum mismatch/);
 assert.throws(()=>m.migrationSql(pkg.entry.version,'down'),/irreversible/);
 for(const field of ['schemaFingerprint','authoritySecurityFingerprint','catalogSecurityFingerprint','euWriterSecurityFingerprint']){assert.match(pkg.entry[field],/^[a-f0-9]{64}$/);assert.notEqual(pkg.entry[field],'0'.repeat(64));}
});
test('ordinary migrations never install043 and writer package refuses035 before executing SQL',async()=>{
 const m=require('../src/security/centralMigrationManifest'),r=require('../scripts/runCentralMigrations');
 for(const entries of [m.manifest,m.registeredManifest,m.knownManifest]){
  const statements=[],rows=entries.map(entry=>({version:entry.version,checksum_sha256:m.migrationSql(entry.version,'up').checksum,irreversible:entry.irreversible}));
  const client={async query(sql){statements.push(sql);if(sql.includes('marker_exists'))return{rows:[{marker_exists:true}]};if(sql.includes('AS matches'))return{rows:[{matches:true}]};if(sql.includes('SELECT version, checksum_sha256'))return{rows};return{rows:[]};},release(){}};
  const pool={connect:async()=>client};assert.deepEqual(await r.applyCentralMigrations(pool),[]);
  assert(!statements.some(sql=>sql.includes('INSERT INTO public.c4g_schema_migration')));
  if(entries===m.manifest)await assert.rejects(r.applyRegisteredEuWriterPackage(pool,'opportunity-eu-writer-v2'),/baseline mismatch/);
 }
});
test('writer gate requires owned isolated invocation and pins its concrete production dependencies',()=>{
 const gate=require('../../test/integration/opportunity-v2/eu-writer-gate.cjs');
 gate.parseArgs(['--isolated','--eu-writer']);gate.parseArgs(['--isolated','--measure-eu-writer']);
 for(const args of [[],['--eu-writer'],['--isolated','--eu-writer','--database=external'],['--isolated','--latest']])assert.throws(()=>gate.parseArgs(args),/EXPLICIT_ISOLATED/);
 const hashes=gate.inputHashes();
 for(const file of ['backend/src/security/opportunityEuWriterMigrationPackage.js','backend/src/security/euWriterSecurityManifest.js','backend/database/central/candidates/opportunity_eu_writer_v2.up.sql','backend/src/config/fundingTendersWorker.js','backend/src/productionComposition.js','backend/scripts/localPlatform/worker.js','frontend/src/api/api.js','context/references/opportunity-v2/evidence/eu-11145.json','test/integration/opportunity-v2/eu-writer-worker-proof.cjs'])assert.match(hashes[file],/^[a-f0-9]{64}$/);
});
