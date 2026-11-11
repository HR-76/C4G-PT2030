'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const pkg=require('../src/security/opportunityV2MigrationPackage');
const {opportunityPreflight}=require('../src/opportunities/preflight');
const {validSnapshot}=require('./support/tenantRuntimeDoubles');
const {snapshotEligible}=require('../src/security/tenantResolver');
const chatSchema=require('../src/security/tenantMigrationManifest').applicationChatManifest.at(-1);
function tablesFor(scope,version){const m=require('../src/security/'+scope+'MigrationManifest');return [...new Set((m.applicationChatManifest||m.registeredManifest).filter(e=>e.version<=version).flatMap(e=>[...m.migrationSql(e.version,'up').sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? opportunity_catalog\.([a-z_][a-z0-9_]*)/gi)].map(match=>match[1])))].sort();}
function pool(scope,version,tables){return {query:async sql=>{
 if(sql==='SHOW server_version_num')return {rows:[{server_version_num:'180001'}]};
 if(sql.includes('FROM public.c4g_schema_migration'))return {rows:[{version}]};
 if(sql.includes('FROM c4g_system.schema_migration'))return {rows:[{migration_id:version}]};
 if(sql.includes('AS table_name'))return {rows:tables.map(table_name=>({table_name}))};
 if(sql.includes('FROM pg_catalog.pg_roles'))return {rows:Array.from({length:3},()=>({rolcanlogin:false,rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolbypassrls:false}))};
 if(sql.includes('pg_get_constraintdef'))return {rows:[{definition:'OPPORTUNITY_CREATED OPPORTUNITY_RECONCILIATION_REQUIRED'}]};
 if(sql.includes('c.relrowsecurity'))return {rows:[{count:tables.length}]};
 if(sql.includes('has_table_privilege'))return {rows:[{allowed:true,destructive:false,foreign_keys:3,indexes:5}]};
 throw Error('Unexpected preflight query');
}};}
test('registered Central042, Tenant034 and Tenant036 preflight require the complete SQL table set and reject drift',async()=>{
 for(const [scope,version]of [['central',pkg.centralEntries.at(-1).version],['tenant',pkg.tenantAddition.version],['tenant',chatSchema.version]]){
  const tables=tablesFor(scope,version);assert(tables.includes(scope==='central'?'eu_source_control_v2':'application_unit'));
  assert.equal((await opportunityPreflight(pool(scope,version,tables),scope)).ready,true);
  for(const changed of [tables.slice(1),[...tables,'unexpected_table'].sort()])await assert.rejects(opportunityPreflight(pool(scope,version,changed),scope),/OPPORTUNITY_SCHEMA_DRIFT/);
  await assert.rejects(opportunityPreflight(pool(scope,'099_unknown',tables),scope),/OPPORTUNITY_SCHEMA_DRIFT/);
 }
});
function contracts(relative,factory){
 const file=path.resolve(__dirname,'../src',relative),native=createRequire(file);let captured;
 const mock={
  '../authorization/authorityDataRepository':{createAuthorityDataRepository:()=>({})},
  '../security/authenticatedAuthority':{createTaxonomySessionAuthority:()=>({})},
  '../authorization/resourceAuthorization':{createTaxonomyAuthorization:()=>({})},
  '../entityAdmission/registrationAuthorization':{createRegistrationAuthorization:()=>({})},
  '../security/tenantRuntime':{createTenantRuntime:({operationCatalog})=>{captured=operationCatalog.operations;return {}; }},
  '../security/tenantOperationCatalog':{createAuthorizedTenantOperationCatalog:value=>value},
  '../organizationalProfile/editorialUiAudit':{createEditorialUiAudit:()=>({})},
  '../organizationalProfile/pq1UiTokens':{createPq1UiTokens:()=>({})},
  '../audit/appendService':{createAppendService:()=>({})},'../audit/postgresAppendRepository':{PostgresAppendRepository:class{}},
  './teamAccess':{createTeamAccessPolicy:()=>()=>({})}
 };
 const module={exports:{}};new Function('require','module','exports',fs.readFileSync(file,'utf8'))(name=>mock[name]||native(name),module,module.exports);
 module.exports[factory]({authorityCoordinator:{bindAuthority:()=>({})},authorizationCatalogs:{operationCatalog:{},permissionCatalog:{}},tenantRuntimeDependencies:{bindingVerifier:{},directoryRepository:{}},telemetry:{observe:()=>{}}});return captured;
}
test('application, directory, interest and private opportunity consumers admit only the explicit additive tenant version with existing capabilities',()=>{
 for(const [file,factory]of [['applications/composition.js','createApplicationComposition'],['organizationDirectory/composition.js','createDirectoryComposition'],['opportunityInterests/composition.js','createOpportunityInterestComposition'],['opportunities/httpComposition.js','createOpportunityHttpComposition']]){
  for(const operation of contracts(file,factory)){
   const capabilities=Object.fromEntries(operation.requiredCapabilities.map(key=>[key,true]));
   const chatSnapshot=validSnapshot({schema:{currentVersion:chatSchema.version,schemaFingerprint:chatSchema.schemaFingerprint,
    verifiedCapabilities:{...capabilities,APPLICATION_TEAM_CHAT:true}}});
   assert.equal(snapshotEligible(chatSnapshot,chatSnapshot.organizationId,operation,{allows:()=>true}),true,operation.operationCode);
   if(operation.operationCode.startsWith('APPLICATION_CHAT_')){
    assert.deepEqual(operation.compatibleSchemaVersions,[chatSchema.version]);
    assert(operation.requiredCapabilities.includes('APPLICATION_TEAM_CHAT'));
    const previous=validSnapshot({schema:{currentVersion:pkg.tenantAddition.version,verifiedCapabilities:capabilities}});
    assert.equal(snapshotEligible(previous,previous.organizationId,operation,{allows:()=>true}),false);
    const drifted=validSnapshot({schema:{...chatSnapshot.schema,schemaFingerprint:'unexpected'}});
    assert.equal(snapshotEligible(drifted,drifted.organizationId,operation,{allows:()=>true}),false);
    continue;
   }
   assert(operation.compatibleSchemaVersions.includes('033_organizational_opportunity_interests'));
   assert(operation.compatibleSchemaVersions.includes(pkg.tenantAddition.version),operation.operationCode);
   const snapshot=validSnapshot({schema:{currentVersion:pkg.tenantAddition.version,verifiedCapabilities:capabilities}});
   assert.equal(snapshotEligible(snapshot,snapshot.organizationId,operation,{allows:()=>true}),true);
   assert.equal(snapshotEligible(validSnapshot({schema:{currentVersion:'035_unknown',verifiedCapabilities:capabilities}}),snapshot.organizationId,operation,{allows:()=>true}),false);
   assert.equal(snapshotEligible(validSnapshot({schema:{currentVersion:pkg.tenantAddition.version,verifiedCapabilities:{}}}),snapshot.organizationId,operation,{allows:()=>true}),false);
  }
 }
});
test('dashboard private opportunity admission resolves Tenant034 and still checks membership and physical binding',async()=>{
 const {createTenantResolver}=require('../src/security/tenantResolver');
 const operation=contracts('opportunities/httpComposition.js','createOpportunityHttpComposition').find(entry=>entry.operationCode==='OPPORTUNITY_READ');
 const snapshot=validSnapshot({schema:{currentVersion:pkg.tenantAddition.version,verifiedCapabilities:Object.fromEntries(operation.requiredCapabilities.map(key=>[key,true]))}});
 const adapter={operationCode:operation.operationCode,queryModule:operation.queryModule};
 let membership=true,bindings=0,allocations=0;
 const lease={execute:async()=>({total:0,open:0,closing_soon:0,sources:[],recent:[]})};
 const resolver=createTenantResolver({
  membershipRepository:{revalidateContext:async context=>membership?context:null},
  directoryRepository:{resolveSnapshotByOrganization:async()=>snapshot},
  operationCatalog:{resolveAdapter:value=>value===adapter?operation:null},
  credentialProvider:{resolve:async()=>({dispose:async()=>{}})},
  bindingVerifier:{verify:async({snapshot:actual,requiredCapabilities})=>{assert.equal(actual,snapshot);assert.deepEqual(requiredCapabilities,operation.requiredCapabilities);bindings++;}},
  poolManager:{acquire:async()=>{allocations++;return {client:{},deadline:Date.now()+10000,release:async()=>{}};}},
  leaseExecutor:{issue:({operation:actual})=>{assert.equal(actual,operation);return lease;}},
  regionPolicy:{allows:()=>true},clock:{now:()=>Date.now()},scheduler:{setTimeout,clearTimeout}
 });
 const input={organizationContext:{organizationId:snapshot.organizationId,membershipId:'member-1',membershipVersion:1},operationAdapter:adapter,correlationId:'dashboard-admission-test'};
 assert.equal(await resolver.resolve(input),lease);
 assert.equal(bindings,1);assert.equal(allocations,1);
 membership=false;
 await assert.rejects(resolver.resolve(input),error=>error.internalCode==='ORGANIZATION_MISMATCH');
 assert.equal(bindings,1);assert.equal(allocations,1);
});

test('document API and worker accept Tenant034 and Tenant036 while the API still verifies the physical binding and commit fence',async()=>{
 const {createDocumentApiPool,REQUIRED}=require('../src/documents/apiTenantPool'),worker=require('../src/config/documentWorkerInfrastructure');
 assert(worker.SCHEMA_VERSIONS.includes(pkg.tenantAddition.version));assert.equal(worker.SCHEMA_VERSION,'032_document_worker_runtime');
 const snapshot=validSnapshot({fence:1,schema:{currentVersion:pkg.tenantAddition.version,verifiedCapabilities:Object.fromEntries(REQUIRED.map(k=>[k,true]))}});let verified=0,queries=0;
 const runtime={directoryRepository:{resolveSnapshotByOrganization:async()=>snapshot},regionPolicy:{allows:()=>true},credentialProvider:{resolve:async()=>({})},
  poolManager:{synchronizeFence(){},getFence:()=>1,acquire:async()=>({client:{query:async()=>{queries++;return {rows:[]};}},fence:1,deadline:Date.now()+10000,release:async()=>{}})},
  bindingVerifier:{verify:async({requiredCapabilities})=>{assert.deepEqual(requiredCapabilities,REQUIRED);verified++;}}};
 const client=await createDocumentApiPool({organizationId:snapshot.organizationId,runtime}).connect();await client.query('COMMIT');await client.release();assert.equal(verified,1);assert.equal(queries,1);
 const upgraded=validSnapshot({fence:1,schema:{currentVersion:chatSchema.version,schemaFingerprint:chatSchema.schemaFingerprint,
  verifiedCapabilities:{...snapshot.schema.verifiedCapabilities,APPLICATION_TEAM_CHAT:true}}});
 assert(worker.SCHEMA_VERSIONS.includes(chatSchema.version));
 runtime.directoryRepository.resolveSnapshotByOrganization=async()=>upgraded;
 const upgradedClient=await createDocumentApiPool({organizationId:upgraded.organizationId,runtime}).connect();
 await upgradedClient.query('COMMIT');await upgradedClient.release();assert.equal(verified,2);assert.equal(queries,2);
 runtime.directoryRepository.resolveSnapshotByOrganization=async()=>validSnapshot({schema:{currentVersion:pkg.tenantAddition.version,verifiedCapabilities:{}}});
 await assert.rejects(createDocumentApiPool({organizationId:snapshot.organizationId,runtime}).connect(),/DOCUMENT_API_BINDING_UNAVAILABLE/);assert.equal(verified,2);
});
