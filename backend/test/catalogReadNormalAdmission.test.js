const test=require('node:test'),assert=require('node:assert/strict');
const {catalogReadRuntimeEnvironment:env}=require('../scripts/localPlatform/catalogReadRuntime');
const {createCatalogReadConnection}=require('../src/opportunities/catalogRead/functionalConnection');
const m=require('../src/security/centralMigrationManifest'),s=require('../src/security/centralSchemaManifest');
test('048 registered, intermediate schemas inadmissible, default migrator unchanged',()=>{
 assert.equal(m.prearchiveManifest.at(-1).version,'045_opportunity_eu_legacy_prearchive');assert.equal(m.catalogReadManifest.at(-1).version,'048_catalog_read_service_v1');assert.equal(m.manifest.at(-1).version,'035_funding_source_resolution');
 for(const e of m.catalogReadManifest.slice(-3,-1))assert.equal(s.EXPECTED_CENTRAL_SCHEMA_SHA256_BY_VERSION[e.version],undefined);
 for(const e of m.catalogReadManifest.slice(-3))assert.equal(m.migrationSql(e.version,'up').checksum,e.upChecksum);
});
test('duplicate admissible fingerprints remain refused',()=>assert.throws(()=>s.schemaFingerprintsForManifest([{version:'a',schemaFingerprint:'a'.repeat(64)},{version:'b',schemaFingerprint:'a'.repeat(64)}]),/Duplicate/));
test('configuration OFF does not create runtime and refuses exposure',async()=>{
 for(const state of [{},{catalogRead:{mode:'disabled',firstAccess:'organization-administrator'}}]){
 assert.equal(env(state).CATALOG_READ_RUNTIME,'disabled');const c=createCatalogReadConnection({mode:env(state).CATALOG_READ_RUNTIME,createRuntime(){assert.fail();}});assert.equal(await c.ready(),true);
 let status,body;c.router({},{status(v){status=v;return this;},set(){return this;},json(v){body=v;}});assert.equal(status,503);assert.equal(body.error.code,'CATALOG_UNAVAILABLE');await c.close();
 }
});
test('configuration refuses activation, unknown keys, and platform admin access',()=>{for(const config of [null,[],{mode:'controlled'},{mode:'disabled',firstAccess:'platform-admin'},{mode:'disabled',password:'synthetic'},{mode:'disabled',reactivateSources:true}])assert.throws(()=>env({catalogRead:config}));});
