'use strict';
// Read-only 042/034 preparation. It has no migration, source-control mutation,
// collection enqueue, approval or acceptance port.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const cfg=require('./config'),{target}=require('./prepareOpportunityInterests');
const previous=require('./prepareOpportunityV2Window');
const {readonly,acceptedRecord,assertTenantIdentity}=require('./prepareOpportunityV2');
const {opportunityV2RuntimeEnvironment}=require('./opportunityV2Runtime');
const {createSource,SOURCE,LIMITS,ENDPOINT}=require('../../src/fundingTenders/source');
const {previewReconciliation,rawSnapshotDigest}=require('../../src/opportunities/v2/reconciliation');
const {contentDigestV2,compareSnapshotsV2}=require('../../src/opportunities/v2/digests');
const {cloneData}=require('../../src/opportunities/v2/data');
const {preflightCentral}=require('../../src/security/centralMigrationPreflight');
const {registeredManifest:centralManifest}=require('../../src/security/centralMigrationManifest');
const {registeredManifest:tenantManifest}=require('../../src/security/tenantMigrationManifest');
const writerPackage=require('../../src/security/opportunityEuWriterMigrationPackage');
const CENTRAL='042_opportunity_eu_source_control_v2',TENANT='034_application_snapshot_v2';
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PRIVATE_FILES=Object.freeze(['backend/.env','.tmp/local-platform/runtime.json','.tmp/local-platform/admissions/worker.json','.tmp/local-platform/members/worker.json','.tmp/local-platform/members/http.json','.tmp/local-platform/members/c4g-activation.properties','.tmp/f2-integration/.env']);
const TENANT_BUSINESS_SCHEMAS=Object.freeze(['c4g_app','document_storage','opportunity_catalog','organizational_scope','organization_profile']);
const hash=value=>createHash('sha256').update(value).digest('hex'),jsonHash=value=>hash(JSON.stringify(value));
function fail(code){throw Object.assign(Error(code),{code});}
function args(argv){if(!Array.isArray(argv)||argv.length!==1||argv[0]!=='--preview-only')fail('EU_WRITER_PREVIEW_ONLY_REQUIRED');}
function runtimeSummary(config,state){
 target(config,state);
 const activation=opportunityV2RuntimeEnvironment(config,state);
 if(Object.hasOwn(state,'opportunityEuWriter')||activation.OPPORTUNITY_ACTIVATION_RUNTIME!=='authenticated-v2'||activation.OPPORTUNITY_11145_EXECUTOR!=='bounded-v2'||state.funding?.coverage!=='durable-v1'||state.funding?.source!=='live-local')fail('EU_WRITER_PREVIEW_RUNTIME_INVALID');
 return {writerConfigured:false,activationRuntime:activation.OPPORTUNITY_ACTIVATION_RUNTIME,executor:activation.OPPORTUNITY_11145_EXECUTOR,coverage:state.funding.coverage,source:state.funding.source};
}
function configDigests(){
 const result=PRIVATE_FILES.filter(file=>fs.existsSync(path.join(cfg.root,file))).map(file=>({file,sha256:hash(fs.readFileSync(path.join(cfg.root,file)))}));
 if(!result.some(row=>row.file==='backend/.env')||!result.some(row=>row.file==='.tmp/local-platform/runtime.json'))fail('EU_WRITER_PREVIEW_CONFIG_MISSING');
 return result;
}
function assertQuiescent(raw){
 const value=cloneData(raw,{maxBytes:8192});
 const counters=['queuedRuns','pendingRuns','otherPendingRuns','activeRunLeases','activeOutboxLeases','activeInboxLeases','expiredPendingRuns','unrecoverablePendingRuns'];
 if(!value||value.family!==SOURCE||value.state!=='QUIESCED'||!Number.isSafeInteger(value.fence)||value.fence<1||counters.some(key=>value[key]!==0)||!Number.isSafeInteger(value.acceptedV2)||value.acceptedV2<1||Object.hasOwn(value,'writerMode'))fail('EU_WRITER_PREVIEW_NOT_QUIESCENT');
 return Object.fromEntries(['family','state','fence',...counters,'acceptedV2'].map(key=>[key,value[key]]));
}
async function verifyPublicObservation(raw,input){
 const summary=cloneData(input,{maxBytes:1024*1024,maxDepth:40}),meta=summary?.metadata;
 if(!Buffer.isBuffer(raw)||raw.length>LIMITS.bytes||!meta||meta.source!==SOURCE||meta.externalIdentifier!=='CASCADE:11145'||meta.endpoint!==ENDPOINT||meta.method!=='POST'||meta.status!==200||meta.bytes!==raw.length||meta.sha256!==hash(raw)||!SHA.test(summary.mappingDigest||'')||!Number.isFinite(Date.parse(meta.observedAt))||new Date(meta.observedAt).toISOString()!==meta.observedAt)fail('EU_WRITER_PREVIEW_PUBLIC_BINDING');
 const observedAt=summary.candidateSnapshot?.provenance?.observations?.[0]?.observedAt;
 if(!Number.isFinite(Date.parse(observedAt))||new Date(observedAt).toISOString()!==observedAt)fail('EU_WRITER_PREVIEW_PUBLIC_BINDING');
 const source=createSource({enrichmentEnabled:true,canonicalV2Enabled:true,clock:()=>Date.parse(observedAt),limits:{...LIMITS,results:5,pageSize:5,pages:1,retries:0,totalMs:30000},fetchImpl:async()=>new Response(raw,{status:200})});
 const batch=await source.lookup({externalIdentifier:'CASCADE:11145',source:SOURCE});
 if(batch.outcome!=='FOUND'||batch.received!==meta.totalResults||!batch.canonicalSnapshot)fail('EU_WRITER_PREVIEW_PUBLIC_BINDING');
 assert.deepEqual(batch.canonicalSnapshot,summary.candidateSnapshot,'EU_WRITER_PREVIEW_PUBLIC_BINDING');
 const derived=previous.sourceSummary({batch,metadata:meta});
 assert.deepEqual(derived,summary,'EU_WRITER_PREVIEW_PUBLIC_BINDING');
 if(derived.normativeComparison.changed||!derived.normativeComparison.sameIdentity||derived.normativeComparison.action!=='UNCHANGED')fail('EU_WRITER_PREVIEW_NORMATIVE_CHANGED');
 return summary;
}
function acceptedPreview({row,identities,metadata,resolutions,receipts,summary}){
 if(!row||!UUID.test(row.opportunity_id||'')||!UUID.test(row.current_revision_id||'')||! /^(?:[1-9][0-9]*)$/.test(String(row.row_version))||!Number.isSafeInteger(Number(row.row_version))||row.lifecycle_state!=='ACTIVE'||row.current_schema_version!==2||row.snapshot?.schemaVersion!==2)fail('EU_WRITER_PREVIEW_11145_HEAD_INVALID');
 if(!Array.isArray(identities)||!identities.some(i=>i.namespace===SOURCE&&i.externalId==='CASCADE:11145')||!Array.isArray(receipts)||!receipts.length||receipts.some(r=>r.mapping_digest!==summary.mappingDigest))fail('EU_WRITER_PREVIEW_11145_BINDING_INVALID');
 const corrections=Object.assign({},...metadata.map(m=>m.corrections||{})),conflicts=metadata.flatMap(m=>m.conflicts||[]);
 const protectedState={corrections:Object.keys(corrections).length,conflicts:conflicts.length,resolutions:resolutions.length};
 if(Object.values(protectedState).some(count=>count!==0))fail('EU_WRITER_PREVIEW_PROTECTED_HEAD');
 const accepted=acceptedRecord({...row,identities,mapping_digest:receipts[0].mapping_digest,corrections,resolutions});
 const preview=previewReconciliation({accepted:[accepted],candidates:[{candidateId:'EU_FUNDING_TENDERS:CASCADE:11145',snapshot:summary.candidateSnapshot,mappingDigest:summary.mappingDigest}]});
 const item=preview.items[0],comparison=compareSnapshotsV2(row.snapshot,summary.candidateSnapshot);
 if(item.action!=='UNCHANGED'||item.reasonCodes.length||comparison.changed||!comparison.sameIdentity)fail('EU_WRITER_PREVIEW_ACCEPTED_CHANGED');
 if(row.content_digest!==undefined&&row.content_digest!==contentDigestV2(row.snapshot))fail('EU_WRITER_PREVIEW_11145_HEAD_INVALID');
 return {expected:{opportunityId:row.opportunity_id,revisionId:row.current_revision_id,rowVersion:Number(row.row_version)},acceptedSnapshot:row.snapshot,acceptedBinding:item.accepted,preview,protectedState,identities,
  comparison:{sameIdentity:comparison.sameIdentity,changed:comparison.changed,action:comparison.action,acceptedContentDigest:item.accepted.contentDigest,incomingContentDigest:item.candidate.contentDigest,acceptedSnapshotDigest:rawSnapshotDigest(row.snapshot),incomingSnapshotDigest:rawSnapshotDigest(summary.candidateSnapshot),snapshotEqual:rawSnapshotDigest(row.snapshot)===rawSnapshotDigest(summary.candidateSnapshot)}};
}
async function tableInventory(client,schemas){
 assert(Array.isArray(schemas)&&schemas.length&&schemas.every(s=>/^[a-z][a-z0-9_]*$/.test(s)));
 const tables=(await client.query("SELECT n.nspname AS schema_name,c.relname AS table_name FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[]) AND c.relkind='r' ORDER BY n.nspname,c.relname",[schemas])).rows,result={};
 for(const table of tables){
  if(!schemas.includes(table.schema_name)||! /^[a-z][a-z0-9_]*$/.test(table.table_name))fail('EU_WRITER_PREVIEW_RELATION_INVALID');
  const value=(await client.query(`SELECT count(*)::int AS total,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' ORDER BY encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex') AS sha256 FROM "${table.schema_name}"."${table.table_name}" t`)).rows[0];
  if(!value||!Number.isSafeInteger(value.total)||value.total<0||!SHA.test(value.sha256||''))fail('EU_WRITER_PREVIEW_INVENTORY_INVALID');
  result[table.schema_name+'.'+table.table_name]={total:value.total,sha256:value.sha256};
 }
 return result;
}
async function readCentralEvidence(client,state,summary,admission){
 const {assertCentralMarker,validateAppliedMigrationLedger}=require('../runCentralMigrations');await assertCentralMarker(client);
 const ledger=(await client.query('SELECT version,checksum_sha256,irreversible FROM public.c4g_schema_migration ORDER BY version')).rows;
 validateAppliedMigrationLedger(ledger);if(ledger.at(-1)?.version!==CENTRAL||admission.currentVersion!==CENTRAL)fail('EU_WRITER_PREVIEW_CENTRAL_BASELINE');
 const fingerprint=await require('../../src/security/centralSchemaManifest').assertCentralSchema(client,CENTRAL);
 if(fingerprint!==admission.fingerprint||fingerprint!==centralManifest.at(-1).schemaFingerprint)fail('EU_WRITER_PREVIEW_CENTRAL_BASELINE');
 const tenants=(await client.query('SELECT tenant_id,organization_id FROM public.tenant ORDER BY tenant_id')).rows;
 if(tenants.length!==1||tenants[0].tenant_id!==state.tenantId||tenants[0].organization_id!==state.organizationId)fail('EU_WRITER_PREVIEW_TENANT_SCOPE');
 const sourceControl=assertQuiescent((await client.query('SELECT opportunity_catalog.eu_source_state_v2() AS state')).rows[0]?.state);
 const pending=(await client.query("SELECT source_code,status,count(*)::int AS count FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING') GROUP BY source_code,status ORDER BY source_code,status")).rows;
 if(pending.length)fail('EU_WRITER_PREVIEW_PENDING_WORK');
 const matches=(await client.query('SELECT opportunity_id FROM opportunity_catalog.funding_identity WHERE external_identifier=$1 UNION SELECT opportunity_id FROM opportunity_catalog.source_identity_v2 WHERE source_namespace=$2 AND external_identifier=$1',['CASCADE:11145',SOURCE])).rows;
 if(matches.length!==1)fail('EU_WRITER_PREVIEW_11145_IDENTITY');
 const opportunityId=matches[0].opportunity_id;
 const rows=(await client.query('SELECT o.opportunity_id,o.current_revision_id,o.row_version,o.lifecycle_state,o.current_schema_version,o.content_digest,r.snapshot FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id AND r.opportunity_id=o.opportunity_id WHERE o.opportunity_id=$1',[opportunityId])).rows;
 if(rows.length!==1)fail('EU_WRITER_PREVIEW_11145_IDENTITY');
 const identities=(await client.query('SELECT source_namespace AS namespace,external_identifier AS "externalId" FROM opportunity_catalog.source_identity_v2 WHERE opportunity_id=$1 ORDER BY source_namespace,external_identifier',[opportunityId])).rows;
 const metadata=(await client.query('SELECT external_identifier,corrections,conflicts FROM opportunity_catalog.funding_identity WHERE opportunity_id=$1 ORDER BY external_identifier',[opportunityId])).rows;
 const resolutions=(await client.query('SELECT resolution_id,decision_digest FROM opportunity_catalog.funding_resolution WHERE opportunity_id=$1 ORDER BY resolution_id',[opportunityId])).rows;
 const receipts=(await client.query('SELECT mapping_digest FROM opportunity_catalog.accepted_receipt_v2 WHERE opportunity_id=$1 AND revision_id=$2 ORDER BY recorded_at DESC,request_id DESC',[opportunityId,rows[0].current_revision_id])).rows;
 const accepted=acceptedPreview({row:rows[0],identities,metadata,resolutions,receipts,summary});
 const totals=(await client.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE o.current_schema_version=1)::int AS v1,count(*) FILTER(WHERE o.current_schema_version=2)::int AS v2,count(*) FILTER(WHERE o.lifecycle_state='ARCHIVED')::int AS archived FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id AND r.opportunity_id=o.opportunity_id")).rows[0];
 const preservation=await tableInventory(client,['opportunity_catalog']);
 return {version:CENTRAL,fingerprint,ledgerDigest:jsonHash(ledger),configuredTenants:tenants.length,totals,pending,sourceControl,...accepted,preservation};
}
async function readTenantEvidence(client,state){
 await assertTenantIdentity(client,state);
 const proof=await require('../../src/security/tenantMigrationPreflight').preflightTenantClient(client,{tenantId:state.tenantId,databaseGenerationId:state.generationId},tenantManifest);
 if(proof.currentVersion!==TENANT||proof.schemaFingerprint!==tenantManifest.at(-1).schemaFingerprint)fail('EU_WRITER_PREVIEW_TENANT_BASELINE');
 const ledger=(await client.query('SELECT migration_id,ordinal,checksum_sha256,irreversible,resulting_fingerprint FROM c4g_system.schema_migration ORDER BY ordinal')).rows;
 if(ledger.at(-1)?.migration_id!==TENANT)fail('EU_WRITER_PREVIEW_TENANT_BASELINE');
 const preservation=await tableInventory(client,TENANT_BUSINESS_SCHEMAS),references={};
 for(const table of ['application','opportunity_interest','organization_opportunity','opportunity_document_binding']){const value=preservation['opportunity_catalog.'+table];if(!value)fail('EU_WRITER_PREVIEW_TENANT_REFERENCE_MISSING');references[table]=value;}
 return {version:TENANT,fingerprint:proof.schemaFingerprint,ledgerDigest:require('../../src/security/tenantHistoricalOwnership').ledgerDigest(ledger),preflight:{passed:true},references,preservation};
}
async function readHabitualPreview({folder,summary}){
 previous.ownedFolder(folder);
 const responseFile=path.join(folder,'official-response.json'),observationFile=path.join(folder,'official-observation.json');
 for(const file of [folder,responseFile,observationFile])if(fs.lstatSync(file).isSymbolicLink())fail('EU_WRITER_PREVIEW_PATH_INVALID');
 const stored=JSON.parse(fs.readFileSync(observationFile,'utf8'));assert.deepEqual(stored,summary,'EU_WRITER_PREVIEW_PUBLIC_BINDING');
 summary=await verifyPublicObservation(fs.readFileSync(responseFile),stored);
 const beforeConfig=configDigests(),config=cfg.readConfig(),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json'),'utf8')),runtime=runtimeSummary(config,state);
 const {Pool}=require('pg'),options='-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=3000';
 const central=new Pool({...cfg.connection(config,config.centralDatabase),max:1,options}),tenant=new Pool({...cfg.connection(config,config.tenantDatabase),max:1,options});
 try{
  const admission=await preflightCentral(central);if(admission.currentVersion!==CENTRAL||admission.postgresMajor!==18)fail('EU_WRITER_PREVIEW_CENTRAL_BASELINE');
  const centralProof=await readonly(central,config.centralDatabase,client=>readCentralEvidence(client,state,summary,admission));
  const tenantProof=await readonly(tenant,config.tenantDatabase,client=>readTenantEvidence(client,state));
  assert.deepEqual(configDigests(),beforeConfig,'EU_WRITER_PREVIEW_CONFIG_CHANGED');
  const report={version:'opportunity-eu-writer-window-preview-v1',status:'PREPARED_NOT_APPROVED_NOT_ACTIVATED',observedAt:new Date().toISOString(),readOnly:true,
   package:{packageId:writerPackage.PACKAGE_ID,packageDigest:writerPackage.packageDigest},source:summary,central:centralProof,tenant:tenantProof,runtime:{...runtime,configDigests:beforeConfig},requiresFreshRevalidation:true,
   limitations:['Read-only per-database snapshots are not a distributed maintenance lock, backup, approval or source resume.','The public observation is limited to CASCADE:11145; it does not certify other source opportunities or a later full coverage cycle.','Snapshot digests bind evidence provenance; semantic equality does not require identical capture timestamps.','Private business rows remain in PostgreSQL; only per-table counts and SHA-256 preservation checksums are exported.','Tenant operational queues, sessions and audit are outside this business inventory and require the separate full backup/restoration proof.','Central042 and tenant034, source fence, accepted head, policy/mapping, configuration and live authority must be freshly revalidated before any later execution.']};
  const file=path.join(folder,'writer-habitual-preview.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});return {report,file};
 }finally{await Promise.allSettled([central.end(),tenant.end()]);}
}
async function main(argv=process.argv.slice(2)){args(argv);const observation=await previous.observeOfficial(),stored=previous.storeObservation(observation),result=await readHabitualPreview(stored);console.log(JSON.stringify({status:result.report.status,centralVersion:result.report.central.value.version,tenantVersion:result.report.tenant.value.version,sourceFence:result.report.central.value.sourceControl.fence,evidence:path.relative(cfg.root,result.file)}));return {...result,...stored};}
if(require.main===module)main().catch(()=>{console.error('EU_WRITER_WINDOW_PREVIEW_FAILED');process.exitCode=1;});
module.exports={args,observeOfficial:previous.observeOfficial,storeObservation:previous.storeObservation,runtimeSummary,assertQuiescent,verifyPublicObservation,acceptedPreview,tableInventory,readCentralEvidence,readTenantEvidence,readHabitualPreview,main};
