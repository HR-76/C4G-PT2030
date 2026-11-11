'use strict';
// One public observation and read-only preparation. No migration or acceptance.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash,randomUUID}=require('node:crypto');
const cfg=require('./config'),{target}=require('./prepareOpportunityInterests');
const {readonly,acceptedRecord,assertTenantIdentity}=require('./prepareOpportunityV2');
const {SOURCE,ENDPOINT,LIMITS,createSource}=require('../../src/fundingTenders/source');
const {previewReconciliation}=require('../../src/opportunities/v2/reconciliation');
const {compareSnapshotsV2}=require('../../src/opportunities/v2/digests');
const {implementationDigest}=require('../../src/opportunities/v2/activationArchive');
const hash=value=>createHash('sha256').update(value).digest('hex');
const jsonHash=value=>hash(JSON.stringify(value));
const publicRoot=path.join(cfg.root,'output/opportunity-v2-window');
function args(argv){assert.deepEqual(argv,['--refresh-preview']);}
function ownedFolder(folder){const actual=path.resolve(folder);assert.equal(path.dirname(actual),publicRoot);assert.match(path.basename(actual),/^preview-[a-f0-9-]{36}$/);return actual;}
async function bytes(response,limit=LIMITS.bytes){
 assert(response.ok&&response.body,'OFFICIAL_RESPONSE_REQUIRED');
 assert(Number(response.headers.get('content-length')||0)<=limit,'OFFICIAL_RESPONSE_TOO_LARGE');
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{for(;;){const value=await reader.read();if(value.done)break;length+=value.value.byteLength;assert(length<=limit,'OFFICIAL_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(value.value));}return Buffer.concat(chunks);}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function observeOfficial({fetchImpl=globalThis.fetch}={}){
 const captures=[];
 const source=createSource({enrichmentEnabled:true,canonicalV2Enabled:true,limits:{...LIMITS,results:5,pageSize:5,pages:1,retries:0,totalMs:30000},fetchImpl:async(url,options)=>{
  const parsed=new URL(url);assert.equal(parsed.origin+parsed.pathname,ENDPOINT);assert.equal(options.method,'POST');
  const query=JSON.parse(await options.body.get('query').text());assert.deepEqual(query,{bool:{must:[{term:{type:'8'}},{term:{callccm2Id:'11145'}}]}});
  const response=await fetchImpl(url,options),body=await bytes(response);
  captures.push({body,status:response.status,observedAt:new Date().toISOString()});
  return new Response(body,{status:response.status,headers:{'content-type':'application/json'}});
 }});
 const batch=await source.lookup({externalIdentifier:'CASCADE:11145',source:SOURCE});
 assert.equal(batch.outcome,'FOUND','OFFICIAL_11145_NOT_FOUND');assert.equal(batch.record.externalIdentifier,'CASCADE:11145');assert(batch.canonicalSnapshot);assert.equal(captures.length,1);
 const parsed=JSON.parse(captures[0].body.toString('utf8'));assert.equal(parsed.totalResults??parsed.total,batch.received);
 return {batch,capture:captures[0],metadata:{version:1,source:SOURCE,externalIdentifier:'CASCADE:11145',officialUrl:'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/competitive-calls-cs/11145',endpoint:ENDPOINT,method:'POST',observedAt:captures[0].observedAt,status:captures[0].status,bytes:captures[0].body.length,sha256:hash(captures[0].body),totalResults:batch.received,applicationParameterStored:false}};
}
function sourceSummary(observation){
 // Expected output of the current mapping (v2.1). eu-11145.json stays frozen as the v2.0 artefact.
 const normative=JSON.parse(fs.readFileSync(path.join(cfg.root,'context/references/opportunity-v2/examples/eu-11145-v2.1.json'),'utf8'));
 const comparison=compareSnapshotsV2(normative,observation.batch.canonicalSnapshot);
 return {metadata:observation.metadata,normativeComparison:{sameIdentity:comparison.sameIdentity,changed:comparison.changed,action:comparison.action,changedFields:comparison.changedFields,retainedFields:comparison.retainedFields,conflictFields:comparison.conflictFields,reasonCodes:comparison.reasonCodes,previousDigest:comparison.previousDigest,incomingDigest:comparison.incomingDigest},candidateSnapshot:observation.batch.canonicalSnapshot,mappingDigest:implementationDigest(SOURCE,observation.batch.canonicalSnapshot.provenance.mappingVersion)};
}
function storeObservation(observation){
 fs.mkdirSync(publicRoot,{recursive:true});const folder=path.join(publicRoot,'preview-'+randomUUID());fs.mkdirSync(folder);ownedFolder(folder);
 fs.writeFileSync(path.join(folder,'official-response.json'),observation.capture.body,{flag:'wx'});
 const summary=sourceSummary(observation);fs.writeFileSync(path.join(folder,'official-observation.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
 return {folder,summary};
}
async function readHabitualPreview({folder,summary}){
 ownedFolder(folder);assert.equal(hash(fs.readFileSync(path.join(folder,'official-response.json'))),summary.metadata.sha256);
 const config=cfg.readConfig(),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));target(config,state);
 const {Pool}=require('pg'),options='-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=3000';
 const central=new Pool({...cfg.connection(config,config.centralDatabase),max:1,options}),tenant=new Pool({...cfg.connection(config,config.tenantDatabase),max:1,options});
 try{
  const centralProof=await readonly(central,config.centralDatabase,async client=>{
   const {assertCentralMarker,validateAppliedMigrationLedger}=require('../runCentralMigrations');await assertCentralMarker(client);
   const ledger=(await client.query('SELECT version,checksum_sha256,irreversible FROM public.c4g_schema_migration ORDER BY version')).rows;
   validateAppliedMigrationLedger(ledger);assert.equal(ledger.at(-1).version,'035_funding_source_resolution','WINDOW_BASELINE_CHANGED');
   const fingerprint=await require('../../src/security/centralSchemaManifest').assertCentralSchema(client,ledger.at(-1).version);
   const tenants=(await client.query('SELECT tenant_id,organization_id FROM public.tenant ORDER BY tenant_id')).rows;
   assert.equal(tenants.length,1,'WINDOW_TENANT_SCOPE_CHANGED');assert.equal(tenants[0].tenant_id,state.tenantId);assert.equal(tenants[0].organization_id,state.organizationId);
   const rows=(await client.query(`SELECT o.opportunity_id,o.current_revision_id,o.row_version,o.lifecycle_state,r.snapshot,f.external_identifier,f.corrections,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('resolution_id',x.resolution_id,'decision_digest',x.decision_digest) ORDER BY x.resolution_id),'[]'::jsonb) FROM opportunity_catalog.funding_resolution x WHERE x.opportunity_id=o.opportunity_id) resolutions
    FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id) JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id WHERE f.external_identifier=$1`,['CASCADE:11145'])).rows;
   assert.equal(rows.length,1,'WINDOW_11145_IDENTITY_REQUIRED');const row=rows[0];assert.equal(row.lifecycle_state,'ACTIVE','WINDOW_11145_NOT_ACTIVE');
   const accepted=acceptedRecord(row),candidate={candidateId:'EU_FUNDING_TENDERS:CASCADE:11145',snapshot:summary.candidateSnapshot,mappingDigest:summary.mappingDigest};
   const preview=previewReconciliation({accepted:[accepted],candidates:[candidate]});
   const totals=(await client.query("SELECT count(*)::int total,count(*) FILTER(WHERE r.snapshot->>'schemaVersion'='2')::int v2 FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id")).rows[0];
   const pending=(await client.query("SELECT source_code,status,count(*)::int count FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING') GROUP BY source_code,status ORDER BY source_code,status")).rows;
   return {version:ledger.at(-1).version,fingerprint,ledgerDigest:jsonHash(ledger),configuredTenants:tenants.length,totals,pending,expected:{opportunityId:row.opportunity_id,revisionId:row.current_revision_id,rowVersion:Number(row.row_version)},acceptedSnapshot:row.snapshot,protectedState:{corrections:Object.keys(row.corrections||{}).length,resolutions:row.resolutions.length},preview};
  });
  const tenantProof=await readonly(tenant,config.tenantDatabase,async client=>{
   await assertTenantIdentity(client,state);
   const ledger=(await client.query('SELECT migration_id,ordinal,checksum_sha256,irreversible,resulting_fingerprint FROM c4g_system.schema_migration ORDER BY ordinal')).rows;
   assert.equal(ledger.at(-1).migration_id,'033_organizational_opportunity_interests','WINDOW_TENANT_BASELINE_CHANGED');
   await require('../../src/security/tenantMigrationPreflight').preflightTenantClient(client,{tenantId:state.tenantId,databaseGenerationId:state.generationId},require('../../src/security/tenantMigrationManifest').manifest);
   const {tenantSchemaSnapshot,tenantSchemaFingerprint}=require('../../src/security/tenantSchemaFingerprint'),references={};
   for(const table of ['application','opportunity_interest','organization_opportunity','opportunity_document_binding'])references[table]=(await client.query(`SELECT count(*)::int total,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) preservation_checksum FROM opportunity_catalog.${table} t WHERE organization_id=$1`,[state.organizationId])).rows[0];
   return {version:ledger.at(-1).migration_id,fingerprint:tenantSchemaFingerprint(await tenantSchemaSnapshot(client)),ledgerDigest:require('../../src/security/tenantHistoricalOwnership').ledgerDigest(ledger),references};
  });
  const report={version:'opportunity-11145-window-preview-v1',status:'PREPARED_NOT_APPROVED_NOT_ACTIVATED',observedAt:new Date().toISOString(),readOnly:true,source:summary,central:centralProof,tenant:tenantProof,requiresFreshRevalidation:true,limitations:['This preview is not an activation approval or a distributed maintenance lock.','Source and accepted revision must be revalidated in the execution window.','Private data is represented only by aggregates and preservation checksums.']};
  const file=path.join(folder,'habitual-preview.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});return {report,file};
 }finally{await Promise.allSettled([central.end(),tenant.end()]);}
}
async function main(argv=process.argv.slice(2)){args(argv);const observation=await observeOfficial(),stored=storeObservation(observation),result=await readHabitualPreview(stored);console.log(JSON.stringify({status:result.report.status,sourceChanged:stored.summary.normativeComparison.changed,action:result.report.central.value.preview.items[0].action,evidence:path.relative(cfg.root,result.file)}));return {...result,...stored};}
if(require.main===module)main().catch(()=>{console.error('OPPORTUNITY_WINDOW_PREVIEW_FAILED');process.exitCode=1;});
module.exports={args,ownedFolder,bytes,observeOfficial,sourceSummary,storeObservation,readHabitualPreview,main};
