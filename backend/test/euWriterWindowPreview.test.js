'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const preview=require('../scripts/localPlatform/prepareEuWriterWindow');
const old=require('../scripts/localPlatform/prepareOpportunityV2Window');
const {tenantAddition,TENANT_CAPABILITY,PACKAGE_ID}=require('../src/security/opportunityV2MigrationPackage');
const raw=fs.readFileSync(path.resolve(__dirname,'../../context/references/opportunity-v2/evidence/eu-11145.json'));
const id='11111111-1111-4111-8111-111111111111',revision='22222222-2222-4222-8222-222222222222';
const clone=value=>JSON.parse(JSON.stringify(value));
function localState(){const config={host:'localhost',port:5432,centralDatabase:'c4g_central_dev',tenantDatabase:'c4g_tenant_dev',user:'fixture',password:'fixture-only'};const state={phase:'READY',target:{host:config.host,port:config.port,centralDatabase:config.centralDatabase,tenantDatabase:config.tenantDatabase},organizationId:id,tenantId:id,generationId:id,credentials:{database:config.tenantDatabase,tenantId:id},snapshot:{organizationId:id,tenantId:id,schema:{compatibilityState:'COMPATIBLE',currentVersion:tenantAddition.version,schemaFingerprint:tenantAddition.schemaFingerprint,revision:1,verifiedCapabilities:{[TENANT_CAPABILITY]:true}}},funding:{coverage:'durable-v1',source:'live-local'},opportunityActivation:{packageId:PACKAGE_ID,runtime:'authenticated-v2',executor:'bounded-v2'}};return {config,state};}
async function observed(){return old.observeOfficial({fetchImpl:async()=>new Response(raw)});}
function quiesced(){return {family:'EU_FUNDING_TENDERS',state:'QUIESCED',fence:7,queuedRuns:0,pendingRuns:0,otherPendingRuns:0,activeRunLeases:0,activeOutboxLeases:0,activeInboxLeases:0,expiredPendingRuns:0,unrecoverablePendingRuns:0,acceptedV2:1};}
test('043 preparation has only preview mode and reuses historical public capture ports',()=>{
 preview.args(['--preview-only']);for(const values of [[],['--install'],['--preview-only','--resume']])assert.throws(()=>preview.args(values));
 assert.equal(preview.observeOfficial,old.observeOfficial);assert.equal(preview.storeObservation,old.storeObservation);
});
test('043 preparation requires activated042 runtime with writer descriptor absent and exports no secrets',()=>{
 const {config,state}=localState(),summary=preview.runtimeSummary(config,state);
 assert.deepEqual(summary,{writerConfigured:false,activationRuntime:'authenticated-v2',executor:'bounded-v2',coverage:'durable-v1',source:'live-local'});
 assert.equal(JSON.stringify(summary).includes('fixture'),false);
 for(const change of [s=>{s.opportunityEuWriter=null;},s=>{delete s.opportunityActivation;},s=>{s.funding.coverage='other';},s=>{s.funding.source='fixture';},s=>{s.snapshot.schema.currentVersion='033_organizational_opportunity_interests';}]){const changed=clone(state);change(changed);assert.throws(()=>preview.runtimeSummary(config,changed));}
});
test('preparation requires quiescence and zero work; fence comes from persisted control rather than literal3',()=>{
 assert.equal(preview.assertQuiescent(quiesced()).fence,7);
 for(const key of ['queuedRuns','pendingRuns','otherPendingRuns','activeRunLeases','activeOutboxLeases','activeInboxLeases','expiredPendingRuns','unrecoverablePendingRuns'])assert.throws(()=>preview.assertQuiescent({...quiesced(),[key]:1}));
 for(const extra of [{state:'ACTIVE'},{fence:'3'},{fence:0},{writerMode:'CANONICAL_V2'},{acceptedV2:0}])assert.throws(()=>preview.assertQuiescent({...quiesced(),...extra}));
});
test('stored public bytes are rederived through real adapter and tampered candidate/mapping/identity are rejected',async()=>{
 const summary=old.sourceSummary(await observed());await preview.verifyPublicObservation(raw,summary);
 for(const change of [s=>{s.candidateSnapshot.financing.allocations.value[0].money.amount='120001';},s=>{s.mappingDigest='a'.repeat(64);},s=>{s.metadata.externalIdentifier='CASCADE:11146';},s=>{s.metadata.sha256='0'.repeat(64);}]){const altered=clone(summary);change(altered);await assert.rejects(preview.verifyPublicObservation(raw,altered));}
});
test('accepted comparison pins receipt mapping, both digests and CAS; legacy, missing receipt, protection and changed source block',async()=>{
 const summary=old.sourceSummary(await observed()),row={opportunity_id:id,current_revision_id:revision,row_version:'5',lifecycle_state:'ACTIVE',current_schema_version:2,snapshot:clone(summary.candidateSnapshot)};
 const identities=[{namespace:'EU_FUNDING_TENDERS',externalId:'CASCADE:11145'}],metadata=[],resolutions=[],receipts=[{mapping_digest:summary.mappingDigest}];
 const result=preview.acceptedPreview({row,identities,metadata,resolutions,receipts,summary});
 assert.equal(result.preview.items[0].action,'UNCHANGED');assert.equal(result.expected.rowVersion,5);assert.match(result.acceptedBinding.snapshotDigest,/^[a-f0-9]{64}$/);assert.match(result.acceptedBinding.contentDigest,/^[a-f0-9]{64}$/);
 for(const delta of [{row:{...row,row_version:'05'}},{row:{...row,row_version:'9007199254740992'}},{row:{...row,current_schema_version:1}},{receipts:[]},{receipts:[{mapping_digest:'a'.repeat(64)}]},{metadata:[{corrections:{title:'private correction'},conflicts:[]}]},{metadata:[{corrections:{},conflicts:[{title:'conflict'}]}]},{resolutions:[{resolution_id:id,decision_digest:'a'.repeat(64)}]}])assert.throws(()=>preview.acceptedPreview({row,identities,metadata,resolutions,receipts,summary,...delta}));
 const changed=clone(summary);changed.candidateSnapshot.financing.allocations.value[0].money.amount='120001';assert.throws(()=>preview.acceptedPreview({row,identities,metadata,resolutions,receipts,summary:changed}));
});
test('preservation hashes stay in PostgreSQL and relation names cannot inject SQL or escape chosen schemas',async()=>{
 const queries=[],client={query:async(sql,params)=>{queries.push({sql,params});if(sql.includes('pg_catalog.pg_class'))return {rows:[{schema_name:'opportunity_catalog',table_name:'application'}]};return {rows:[{total:2,sha256:'a'.repeat(64)}]};}};
 const result=await preview.tableInventory(client,['opportunity_catalog']);assert.deepEqual(result,{'opportunity_catalog.application':{total:2,sha256:'a'.repeat(64)}});assert.match(queries[1].sql,/sha256/);assert.equal(queries[1].sql.includes('AS row'),false);
 for(const table of [{schema_name:'other',table_name:'application'},{schema_name:'opportunity_catalog',table_name:'x";DROP TABLE application;--'}])await assert.rejects(()=>preview.tableInventory({query:async()=>({rows:[table]})},['opportunity_catalog']));
});
test('Central035 and wrong tenant identity stop before any catalogue or private business read',async()=>{
 const {state}=localState(),queries=[];
 const {manifest,requiredCentralMigrations}=require('../src/security/centralMigrationManifest');
 const ledger=requiredCentralMigrations(manifest).map(row=>({version:row.version,checksum_sha256:row.checksum,irreversible:row.irreversible}));
 const client={query:async(sql)=>{queries.push(sql);if(sql.includes('marker_exists'))return {rows:[{marker_exists:true}]};if(sql.includes('AS matches'))return {rows:[{matches:true}]};if(sql.includes('c4g_schema_migration'))return {rows:ledger};throw Error('UNEXPECTED_BUSINESS_READ');}};
 await assert.rejects(preview.readCentralEvidence(client,state,{}, {currentVersion:'035_funding_source_resolution'}),/EU_WRITER_PREVIEW_CENTRAL_BASELINE/);
 assert.equal(queries.some(sql=>sql.includes('opportunity_catalog')),false);
 const tenantQueries=[];await assert.rejects(preview.readTenantEvidence({query:async sql=>{tenantQueries.push(sql);return {rows:[]};}},state),/OPPORTUNITY_PREVIEW_TENANT_IDENTITY/);assert.equal(tenantQueries.length,1);
});
