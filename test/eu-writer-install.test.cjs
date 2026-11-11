'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const installer=require('../scripts/eu-writer-install.cjs');
const installed=require('../backend/src/security/opportunityV2MigrationPackage');
const {euWriterConfiguration}=require('../backend/src/fundingTenders/euWriter');
const {bindingDigest}=require('../backend/src/security/localTenantCredentialAdapter');
function fixture(){
 const tenantId=randomUUID(),organizationId=randomUUID(),generationId=randomUUID(),installationId=randomUUID();
 const credentials={tenantId,credentialRef:'fixture-api',connectionVersion:1,host:'127.0.0.1',port:5544,database:'fixture_tenant',login:'c4g_local_api',password:'synthetic-private-value',ssl:false};
 const snapshot={organizationId,tenantId,workload:'API',deploymentMode:'DATABASE_PER_ORGANIZATION',provisioningStatus:'READY',connectionState:'AVAILABLE',connectionVersion:1,connectionRevision:2,versionState:'VALIDATED',databaseGenerationId:generationId,databaseRef:credentials.database,credentialRef:credentials.credentialRef,bindingDigest:bindingDigest({...credentials,workload:'API'}),observedSystemIdentifier:'123456789',regionCode:'LOCAL',residencyPolicyVersion:'local-development-v1',fence:1,schema:{compatibilityState:'COMPATIBLE',currentVersion:installed.tenantAddition.version,schemaFingerprint:installed.tenantAddition.schemaFingerprint,revision:2,verifiedCapabilities:{[installed.TENANT_CAPABILITY]:true}}};
 return {phase:'READY',installationId,tenantId,organizationId,generationId,target:{host:credentials.host,port:credentials.port,centralDatabase:'fixture_central',tenantDatabase:'fixture_tenant'},snapshot,credentials,funding:{source:'live-local',coverage:'durable-v1'},opportunityActivation:{packageId:installed.PACKAGE_ID,runtime:'authenticated-v2',executor:'bounded-v2'},sessionSecret:'synthetic-session-secret',unrelated:{keep:['all','data']}};
}
test('043 installer changes only the separate writer descriptor and preserves private inputs by value',()=>{
 const state=fixture(),before=structuredClone(state),after=installer.configurationAfter(state);
 assert.deepEqual(state,before);assert.deepEqual(after.opportunityEuWriter,{packageId:'opportunity-eu-writer-v2',policyVersion:euWriterConfiguration().policyVersion,mappingDigest:euWriterConfiguration().mappingDigest});
 delete after.opportunityEuWriter;assert.deepEqual(after,state);after.unrelated.keep.push('different');assert.deepEqual(state,before);
 for(const change of [s=>s.opportunityEuWriter=null,s=>s.credentials.database='another',s=>s.credentials.host='external.example',s=>s.snapshot.bindingDigest='a'.repeat(64),s=>s.snapshot.schema.currentVersion='033',s=>delete s.opportunityActivation,s=>s.funding.coverage='disabled']){const altered=structuredClone(state);change(altered);assert.throws(()=>installer.validateState(altered));}
});
test('043 preservation captures all old rows and columns, excluding only the new central ledger entry',async()=>{
 const queries=[],client={query:async(sql,values)=>{queries.push({sql,values});if(sql.includes('pg_class'))return {rows:[{nspname:'public',relname:'c4g_schema_migration'},{nspname:'public',relname:'tenant_schema_state'},{nspname:'public',relname:'tenant_directory_event'}]};if(sql.includes('information_schema.columns'))return {rows:[{column_name:'version'},{column_name:'payload'}]};return {rows:[{count:4,digest:'a'.repeat(64)}]};}};
 const inventory=await installer.capture(client,{central:true});assert.equal(inventory.length,3);assert.match(inventory[0].sql,/042_opportunity_eu_source_control_v2/);assert.doesNotMatch(inventory[0].sql,/035_funding/);
 for(const item of inventory.slice(1))assert.equal(item.sql.includes(' WHERE '),false);
 assert.equal(inventory[0].sql.includes('SELECT *'),false);assert.match(inventory[0].sql,/"version","payload"/);
 await installer.assertPreserved({query:async()=>({rows:[{count:4,digest:'a'.repeat(64)}]})},inventory);
 await assert.rejects(installer.assertPreserved({query:async()=>({rows:[{count:5,digest:'a'.repeat(64)}]})},inventory),/INSTALL_DATA_PRESERVATION_FAILED/);
});
test('source baseline may be legacy042 or newly installed043 but never configured, resumed, pending or stale',()=>{
 const source={family:'EU_FUNDING_TENDERS',state:'QUIESCED',fence:9,queuedRuns:0,pendingRuns:0,otherPendingRuns:0,activeRunLeases:0,activeInboxLeases:0,activeOutboxLeases:0,expiredPendingRuns:0,unrecoverablePendingRuns:0,acceptedV2:1};
 assert.equal(installer.sourceBefore(source,9).fence,9);assert.equal(installer.sourceBefore({...source,writerMode:'LEGACY_V1',writerPolicy:null,writerMappingDigest:null,incompatiblePendingRuns:0},9).fence,9);
 for(const extra of [{fence:10},{state:'ACTIVE'},{pendingRuns:1},{activeInboxLeases:1},{otherPendingRuns:1},{writerMode:'CANONICAL_V2'},{writerMode:'LEGACY_V1',writerPolicy:'other',writerMappingDigest:null,incompatiblePendingRuns:0}])assert.throws(()=>installer.sourceBefore({...source,...extra},9));
});
test('head/receipt binding rejects a second identity, changed mapping, unsafe bigint and protected state',()=>{
 const snapshot=require('../context/references/opportunity-v2/examples/eu-11145.json'),id=randomUUID(),revisionId=randomUUID(),mappingDigest=require('../backend/src/opportunities/v2/activationArchive').implementationDigest('EU_FUNDING_TENDERS',snapshot.provenance.mappingVersion);
 const plan={expected:{opportunityId:id,revisionId,rowVersion:5},writer:{mappingDigest},accepted:{contentDigest:require('../backend/src/opportunities/v2/digests').contentDigestV2(snapshot),snapshotDigest:require('../backend/src/opportunities/v2/reconciliation').rawSnapshotDigest(snapshot)}};
 const input={plan,identities:[{opportunity_id:id}],row:{opportunity_id:id,current_revision_id:revisionId,row_version:'5',current_schema_version:2,lifecycle_state:'ACTIVE',content_digest:plan.accepted.contentDigest,snapshot},receipts:[{mapping_digest:mappingDigest}],protectedState:false};
 assert.equal(installer.assertHead(input),true);
 for(const delta of [{identities:[...input.identities,{opportunity_id:randomUUID()}]},{receipts:[]},{receipts:[{mapping_digest:'a'.repeat(64)}]},{row:{...input.row,row_version:'05'}},{row:{...input.row,current_revision_id:randomUUID()}},{protectedState:true}])assert.throws(()=>installer.assertHead({...input,...delta}));
});
test('worker capability probe sets only the dedicated role, checks every helper and rejects human privilege',async()=>{
 const calls=[];let role='fixture_owner',released=false;
 const client={release(){released=true;},async query(sql){calls.push(sql);if(sql.includes('session_user AS login'))return {rows:[{login:'fixture_owner',role:'fixture_owner',database:'fixture_central',can_login:true,superuser:true}]};if(sql.includes('AS forbidden'))return {rows:[{role:'c4g_opportunity_central_runtime',forbidden:false},{role:'c4g_catalog_reader',forbidden:false}]};if(sql.startsWith('SET LOCAL ROLE')){role='c4g_eu_writer_runtime';return {rows:[]};}if(sql.includes('AS signature'))return {rows:installer.HELPERS.map(signature=>({signature,present:true,allowed:true,role}))};return {rows:[]};}};
 const result=await installer.verifyWorkerLogin({connect:async()=>client},'fixture_central');assert.equal(result.superuser,true);assert.equal(result.leastPrivilegeCertified,false);assert.equal(released,true);assert(calls.includes('ROLLBACK'));assert.equal(calls.some(sql=>/^(GRANT|ALTER|INSERT|UPDATE)/.test(sql)),false);
 const denied={...client,query:async sql=>sql.includes('AS forbidden')?{rows:[{role:'c4g_opportunity_central_runtime',forbidden:true},{role:'c4g_catalog_reader',forbidden:false}]}:client.query(sql)};
 await assert.rejects(installer.verifyWorkerLogin({connect:async()=>denied},'fixture_central'),/EU_WRITER_INSTALL_ROLE_BOUNDARY/);
});
