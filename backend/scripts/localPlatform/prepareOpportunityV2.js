'use strict';
// Inspection only: no apply mode, no migration runner, no application writer.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const cfg=require('./config');
const {target}=require('./prepareOpportunityInterests');
const {previewReconciliation}=require('../../src/opportunities/v2/reconciliation');
const {namespaceForIdentity}=require('../../src/fundingTenders/sourceIdentity');
const {readOpportunitySnapshot}=require('../../src/opportunities/v2/compatibility');
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function args(values){if(values.length!==1||values[0]!=='--preview-real')throw Error('OPPORTUNITY_PREVIEW_READ_ONLY_REQUIRED');}
async function readonly(pool,database,work){
 const client=await pool.connect();try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const row=(await client.query("SELECT current_database() AS database,current_setting('transaction_read_only') AS read_only,current_setting('server_version_num') AS server_version_num,transaction_timestamp() AS observed_at")).rows[0];
  assert.equal(row.database,database);assert.equal(row.read_only,'on');
  return {observation:{readOnly:true,postgresVersion:Number(row.server_version_num),observedAt:row.observed_at.toISOString()},value:await work(client)};
 }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
}
function acceptedRecord(row){
 const identities=[...(row.identities||[])],namespace=namespaceForIdentity(row.external_identifier);
 if(row.external_identifier&&!identities.some(i=>i.namespace===namespace&&i.externalId===row.external_identifier))identities.push({namespace,externalId:row.external_identifier});
 return {opportunityId:row.opportunity_id,revisionId:row.current_revision_id,rowVersion:Number(row.row_version),snapshot:row.snapshot,identities,mappingDigest:row.mapping_digest||null,corrections:row.corrections||{},resolutions:row.resolutions||[],privateReferences:[]};
}
async function assertTenantIdentity(client,state){
 const rows=(await client.query('SELECT product_code,database_role,marker_format_version,tenant_id::text,database_generation_id::text,identity_revision FROM c4g_system.tenant_identity')).rows;
 const row=rows[0];
 if(rows.length!==1||row.product_code!=='C4G'||row.database_role!=='TENANT'||Number(row.marker_format_version)!==1||Number(row.identity_revision)!==1||row.tenant_id!==state.tenantId||row.database_generation_id!==state.generationId)throw Object.assign(Error('OPPORTUNITY_PREVIEW_TENANT_IDENTITY'),{code:'OPPORTUNITY_PREVIEW_TENANT_IDENTITY'});
}
function summarize(candidates,accepted){
 const preview=previewReconciliation({accepted,candidates});
 const sources={};for(const item of preview.items){const source=item.identities[0].namespace;sources[source]??={total:0,NEW:0,UNCHANGED:0,CHANGE_REQUIRES_APPROVAL:0,BLOCKED:0};sources[source].total++;sources[source][item.action]++;}
 return {preview,sources};
}
function publicEuFields(snapshot){
 const projection=readOpportunitySnapshot(snapshot).projection;
 return {title:projection.description.title,programmes:projection.programmes,parties:projection.parties,schedule:projection.schedule,status:projection.status,financing:projection.financing,relatedProject:projection.relatedProject,legacy:{fundingRange:projection.legacy.fundingRange,funderName:projection.legacy.funderName,openingDate:projection.legacy.openingDate,closingDate:projection.legacy.closingDate,callReference:projection.legacy.callReference}};
}
async function main(values=process.argv.slice(2)){
 args(values);const config=cfg.readConfig(),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));target(config,state);
 const {Pool}=require('pg');
 const pool=database=>new Pool({...cfg.connection(config,database),max:1,options:'-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=3000'});
 const central=pool(config.centralDatabase),tenant=pool(config.tenantDatabase);
 try{
  const corpus=await require('../../../test/integration/opportunity-v2/reconciliation-proof.cjs').buildCorpus();
  // The manual S6 example is synthetic and must never become a real-data candidate.
  const candidates=corpus.candidates.filter(c=>!c.candidateId.startsWith('C4G_MANUAL:'));
  const externalIds=candidates.flatMap(c=>c.snapshot.sourceRecords.filter(s=>s.role!=='PROGRAMME_METADATA').map(s=>s.externalId));
  const centralObservation=await readonly(central,config.centralDatabase,async client=>{
   const {assertCentralMarker,validateAppliedMigrationLedger}=require('../../scripts/runCentralMigrations');
   await assertCentralMarker(client);
   const ledger=(await client.query('SELECT version,checksum_sha256,irreversible FROM public.c4g_schema_migration ORDER BY version')).rows;
   validateAppliedMigrationLedger(ledger,'preview refused');const version=ledger.at(-1).version;
   const fingerprint=await require('../../src/security/centralSchemaManifest').assertCentralSchema(client,version);
   const tables=['funding_candidate_v2','pt2030_plan_revision','manual_v2_candidate','source_identity_v2','accepted_receipt_v2','activation_plan_v2'];
   const archiveAvailability={};for(const name of tables){const present=(await client.query('SELECT to_regclass($1) IS NOT NULL AS present',['opportunity_catalog.'+name])).rows[0].present;archiveAvailability[name]={present};if(present)archiveAvailability[name].rows=Number((await client.query('SELECT count(*) AS n FROM opportunity_catalog.'+name)).rows[0].n);}
   const totals=(await client.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE o.lifecycle_state='ARCHIVED')::int AS archived,count(*) FILTER(WHERE r.snapshot->>'schemaVersion'='2')::int AS v2 FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id")).rows[0];
   const fundingSources=(await client.query("SELECT CASE WHEN external_identifier LIKE 'INTERREG_EUROPE:%' THEN 'INTERREG_EUROPE' WHEN external_identifier LIKE 'POCTEP:%' THEN 'POCTEP' ELSE 'EU_FUNDING_TENDERS' END AS source,count(*)::int AS count,count(*) FILTER(WHERE corrections<>'{}'::jsonb)::int AS corrected,count(*) FILTER(WHERE conflicts<>'[]'::jsonb)::int AS conflicted FROM opportunity_catalog.funding_identity GROUP BY 1 ORDER BY 1")).rows;
   const sourceJoin=archiveAvailability.source_identity_v2.present?' OR o.opportunity_id IN(SELECT opportunity_id FROM opportunity_catalog.source_identity_v2 WHERE external_identifier=ANY($1::text[]))':'';
   const rows=(await client.query(`SELECT o.opportunity_id,o.current_revision_id,o.row_version,o.lifecycle_state,r.snapshot,f.external_identifier,f.corrections,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('resolution_id',x.resolution_id,'decision_digest',x.decision_digest) ORDER BY x.resolution_id),'[]'::jsonb) FROM opportunity_catalog.funding_resolution x WHERE x.opportunity_id=o.opportunity_id) AS resolutions
    FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id LEFT JOIN opportunity_catalog.funding_identity f ON f.opportunity_id=o.opportunity_id
    WHERE f.external_identifier=ANY($1::text[])${sourceJoin} ORDER BY o.opportunity_id`,[externalIds])).rows;
   if(archiveAvailability.source_identity_v2.present)for(const row of rows){row.identities=(await client.query('SELECT source_namespace AS namespace,external_identifier AS "externalId" FROM opportunity_catalog.source_identity_v2 WHERE opportunity_id=$1 ORDER BY source_namespace,external_identifier',[row.opportunity_id])).rows;row.mapping_digest=(await client.query('SELECT mapping_digest FROM opportunity_catalog.accepted_receipt_v2 WHERE revision_id=$1 ORDER BY recorded_at DESC,request_id DESC LIMIT 1',[row.current_revision_id])).rows[0]?.mapping_digest;}
   const accepted=rows.map(acceptedRecord),reconciliation=summarize(candidates,accepted);
   const runs=(await client.query("SELECT source_code,status,count(*)::int AS count FROM opportunity_catalog.funding_run WHERE status IN('QUEUED','RUNNING') GROUP BY source_code,status ORDER BY source_code,status")).rows;
   const eu=rows.find(row=>row.external_identifier==='CASCADE:11145');
   return {version,fingerprint,ledgerDigest:sha(ledger),totals,fundingSources,archiveAvailability,runs,matchedAccepted:accepted.length,matchedArchived:rows.filter(r=>r.lifecycle_state==='ARCHIVED').map(r=>r.opportunity_id),
    operationalBlockers:reconciliation.preview.items.filter(i=>rows.some(r=>r.opportunity_id===i.accepted?.opportunityId&&r.lifecycle_state==='ARCHIVED')).map(i=>({candidateId:i.candidateId,code:'ACCEPTED_OPPORTUNITY_ARCHIVED'})),
    protectedRows:rows.map(r=>({opportunityId:r.opportunity_id,corrections:Object.keys(r.corrections||{}).length,resolutions:r.resolutions.length})).filter(r=>r.corrections||r.resolutions),
    eu11145:{present:Boolean(eu),schemaVersion:eu?.snapshot.schemaVersion||null,opportunityId:eu?.opportunity_id||null,revisionId:eu?.current_revision_id||null,current:eu?publicEuFields(eu.snapshot):null,normative:publicEuFields(candidates.find(c=>c.candidateId==='EU_FUNDING_TENDERS:CASCADE:11145').snapshot)},
    ...reconciliation};
  });
  const tenantObservation=await readonly(tenant,config.tenantDatabase,async client=>{
   await assertTenantIdentity(client,state);
   const ledger=(await client.query('SELECT migration_id,ordinal,checksum_sha256,irreversible,resulting_fingerprint FROM c4g_system.schema_migration ORDER BY ordinal')).rows;
   const {tenantSchemaSnapshot,tenantSchemaFingerprint}=require('../../src/security/tenantSchemaFingerprint');
   const fingerprint=tenantSchemaFingerprint(await tenantSchemaSnapshot(client));
   await require('../../src/security/tenantMigrationPreflight').preflightTenantClient(client,{tenantId:state.tenantId,databaseGenerationId:state.generationId},require('../../src/security/tenantMigrationManifest').manifest);
   const preflight={passed:true};
   const references={};
   for(const table of ['application','opportunity_interest']){
    // SQL hashes and aggregates only: private snapshots, notes and people never leave PostgreSQL.
    const row=(await client.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE central_opportunity_id IS NOT NULL)::int AS central_references,count(*) FILTER(WHERE central_snapshot->>'schemaVersion'='2')::int AS v2_snapshots,coalesce(max(octet_length(central_snapshot::text)),0)::int AS max_snapshot_bytes,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS preservation_checksum FROM opportunity_catalog.${table} t WHERE organization_id=$1`,[state.organizationId])).rows[0];
    references[table]=row;
   }
   for(const table of ['organization_opportunity','opportunity_document_binding'])references[table]=(await client.query(`SELECT count(*)::int AS total,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS preservation_checksum FROM opportunity_catalog.${table} t WHERE organization_id=$1`,[state.organizationId])).rows[0];
   return {version:ledger.at(-1).migration_id,fingerprint,ledgerDigest:require('../../src/security/tenantHistoricalOwnership').ledgerDigest(ledger),preflight,references};
  });
  const report={version:'opportunity-activation-readonly-preview-v1',status:'PREPARED_NOT_APPROVED_NOT_ACTIVATED',observedAt:new Date().toISOString(),scope:'REAL_ACCEPTED_CATALOG_VS_191_PUBLIC_NORMATIVE_CANDIDATES',readOnly:true,sourceCollectionPerformed:false,syntheticManualExcluded:true,workbookSha256:corpus.workbookSha256,mappingEvidence:corpus.mappingEvidence,central:centralObservation,tenant:tenantObservation,
   limitations:['Normative captures are dated 2026-10-30, not a fresh source harvest.','Only identities present in the normative corpus are reconciled; other catalogue entries are not deleted or certified.','Per-database repeatable-read observations are not a distributed maintenance lock.','No source is approved or activated by this report.','Private data is represented by aggregate counts and preservation checksums only.']};
  const dir=path.join(cfg.root,'output','opportunity-v2-activation');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'real-preview.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,centralVersion:report.central.value.version,tenantVersion:report.tenant.value.version,totalAccepted:report.central.value.totals,matched:report.central.value.matchedAccepted,counts:report.central.value.preview.counts,report:path.relative(cfg.root,file)}));return report;
 }finally{await Promise.allSettled([central.end(),tenant.end()]);}
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({code:'OPPORTUNITY_REAL_PREVIEW_FAILED',diagnostic:/^[A-Z0-9_]{3,100}$/.test(e.internalCode||e.code||'')?e.internalCode||e.code:'REDACTED'}));process.exitCode=1;});
module.exports={args,readonly,acceptedRecord,assertTenantIdentity,summarize,main};
