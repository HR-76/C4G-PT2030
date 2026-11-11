'use strict';
// Explicit local activation only. --check performs public reads and writes a
// reviewable plan; --apply requires its digest and never targets another DB.
const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {Pool}=require('pg');
const cfg=require('./config');
const {preflightCentral}=require('../../src/security/centralMigrationPreflight');
const {applyCentralMigrationsWithManifest}=require('../runCentralMigrations');
const {manifest,migrationSql}=require('../../src/security/centralMigrationManifest');
const {createFundingRepository}=require('../../src/fundingTenders/repository');
const {createResolutionService}=require('../../src/fundingTenders/resolutions');
const {createSource}=require('../../src/fundingTenders/source');
const {decisions}=require('../../src/fundingTenders/resolutionPack');
const {canonicalize}=require('../../src/organizationalProfile/canonicalization');
const VERSION='035_funding_source_resolution';
const PREVIOUS_RUN='0be7b4aa-5a37-4de6-9221-b380147341f4';
const evidenceFolder=path.resolve(__dirname,'../../../output/funding-resolution-local-20261029');
const planFile=path.join(evidenceFolder,'plan.json');
const digest=value=>createHash('sha256').update(canonicalize(value)).digest('hex');
function fail(code){throw Error(code);}
async function main(){
 const args=process.argv.slice(2),apply=args[0]==='--apply';
 if(!(args.length===1&&args[0]==='--check')&&!(apply&&args.length===3&&args[1]==='--expected-digest'&&/^[a-f0-9]{64}$/.test(args[2])))fail('ACTIVATION_ARGUMENT_INVALID');
 const config=cfg.readConfig();
 if(config.host!=='localhost'||config.port!==5432||config.centralDatabase!=='c4g_central_dev')fail('LOCAL_TARGET_REQUIRED');
 const state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json'),'utf8'));
 if(state.phase!=='READY'||state.funding?.source!=='live-local'||state.funding?.coverage!=='durable-v1')fail('LOCAL_RUNTIME_REQUIRED');
 fs.mkdirSync(evidenceFolder,{recursive:true});
 const pool=new Pool(cfg.connection(config,config.centralDatabase)),source=createSource({fetchImpl:fetch});
 const repository=createFundingRepository({pool,coverageEnabled:true,refreshEnabled:true,resolutionEnabled:true});
 try{
  async function baseline(){
   const ready=await preflightCentral(pool);
   if(!['034_funding_temporal_refresh',VERSION].includes(ready.currentVersion))fail('ACTIVATION_PREDECESSOR_UNEXPECTED');
   return repository.transaction(async client=>{
    const actor=(await client.query('SELECT requested_by FROM opportunity_catalog.funding_run WHERE run_id=$1',[PREVIOUS_RUN])).rows[0]?.requested_by;
    if(!actor)fail('AUTHORIZED_OPERATOR_NOT_FOUND');
    await repository.administrator(client,actor);
    if((await client.query("SELECT 1 FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING') LIMIT 1")).rowCount)fail('ACTIVE_COLLECTION_MUST_FINISH');
    const revisions=(await client.query('SELECT revision_id,snapshot FROM opportunity_catalog.revision ORDER BY revision_id')).rows.map(r=>({revisionId:r.revision_id,digest:digest(r.snapshot)}));
    const identities=(await client.query('SELECT external_identifier,opportunity_id FROM opportunity_catalog.funding_identity ORDER BY external_identifier')).rows;
    const memberships=(await client.query('SELECT count(*)::int n FROM public.organization_membership')).rows[0].n;
    const selected=(await client.query(`SELECT f.external_identifier AS "externalIdentifier",o.opportunity_id AS "opportunityId",o.current_revision_id AS "revisionId",o.row_version::int AS "rowVersion",o.closing_date::text AS "closingDate",f.source_review AS "sourceReview"
      FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id) WHERE f.external_identifier=ANY($1::text[]) ORDER BY f.external_identifier`,[decisions.map(d=>d.externalIdentifier)])).rows;
    if(selected.length!==6)fail('RESOLUTION_IDENTITY_MISSING');
    return {version:ready.currentVersion,actor,revisions,identities,memberships,selected};
   },true);
  }
  const before=await baseline();
  const fresh=[];
  for(const d of decisions){
   const batch=await source.lookup({externalIdentifier:d.externalIdentifier});
   if(!require('../../src/fundingTenders/resolutions').verifiedLookup(batch,d.externalIdentifier,d.expectedFingerprint))fail('FUNDING_RESOLUTION_EVIDENCE_CHANGED');
   fresh.push({externalIdentifier:d.externalIdentifier,observedAt:batch.observedAt,sourceFingerprint:batch.evidence.fingerprint});
  }
  if(!apply){
   const body={schemaVersion:1,requestId:randomUUID(),baseline:before,decisionDigest:digest(decisions.map(({evidence,...d})=>d))};
   const plan={...body,digest:digest(body),observations:fresh};
   fs.writeFileSync(planFile,JSON.stringify(plan,null,2));
   console.log(JSON.stringify({status:'READY_FOR_LOCAL_APPROVAL',version:before.version,digest:plan.digest,identities:before.identities.length,revisions:before.revisions.length,memberships:before.memberships,changes:before.selected.map(row=>({...row,proposedClosingDate:decisions.find(d=>d.externalIdentifier===row.externalIdentifier).fields.closingDate})),freshEvidenceMatches:true}));
   return;
  }
  const plan=JSON.parse(fs.readFileSync(planFile,'utf8'));
  const {digest:expected,observations,...body}=plan;
  if(expected!==args[2]||digest(body)!==expected||!body.requestId||body.decisionDigest!==digest(decisions.map(({evidence,...d})=>d))||digest(before)!==digest(body.baseline))fail('LOCAL_ACTIVATION_PLAN_STALE');
  await applyCentralMigrationsWithManifest(pool,manifest.filter(entry=>entry.version<=VERSION),migrationSql);
  if((await preflightCentral(pool)).currentVersion!==VERSION)fail('ACTIVATION_VERIFICATION_FAILED');
  const service=createResolutionService({pool,repository,source,decisions}),prepared=await service.prepare(before.actor);
  const expectedRevisions=before.selected.map(({externalIdentifier,revisionId})=>({externalIdentifier,revisionId}));
  if(digest(expectedRevisions)!==digest(prepared.items.map(({externalIdentifier,revisionId})=>({externalIdentifier,revisionId}))))fail('LOCAL_ACTIVATION_PLAN_STALE');
  const command={requestId:body.requestId,expectedDigest:prepared.digest,expectedRevisions};
  fs.writeFileSync(path.join(evidenceFolder,'command.json'),JSON.stringify(command,null,2));
  const applied=await service.apply(before.actor,command);
  const after=await baseline();
  const priorPreserved=before.revisions.every(r=>after.revisions.some(a=>a.revisionId===r.revisionId&&a.digest===r.digest));
  if(!priorPreserved||digest(before.identities)!==digest(after.identities)||before.memberships!==after.memberships||after.revisions.length!==before.revisions.length+6)fail('LOCAL_PRESERVATION_CHECK_FAILED');
  const details=[];
  for(const row of after.selected){const value=await repository.get(row.opportunityId);if(value.sourceReview!==null||value.temporal.state!=='CLOSED'||value.snapshot.sourceResolution?.sourceFingerprint!==decisions.find(d=>d.externalIdentifier===row.externalIdentifier).expectedFingerprint)fail('LOCAL_RESOLUTION_CHECK_FAILED');details.push({externalIdentifier:row.externalIdentifier,revisionId:value.revisionId,closingDate:value.snapshot.closingDate,temporal:value.temporal,sourceResolution:value.snapshot.sourceResolution,sourceTemporal:value.snapshot.sourceTemporal});}
  const summary=await repository.dashboardSummary(new Date().toISOString().slice(0,10));
  const verification={status:'PASS',version:after.version,applied,oldRevisionsPreserved:before.revisions.length,identities:after.identities.length,revisions:after.revisions.length,memberships:after.memberships,details,summary,restartRequired:true};
  fs.writeFileSync(path.join(evidenceFolder,'verification.json'),JSON.stringify(verification,null,2));
  console.log(JSON.stringify({status:'LOCAL_RESOLUTIONS_APPLIED',version:after.version,resolutions:applied.items.length,identities:after.identities.length,revisions:after.revisions.length,oldRevisionsPreserved:before.revisions.length,summary,restartRequired:true}));
 }finally{await pool.end();}
}
main().catch(error=>{console.error(/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:error.code||'LOCAL_RESOLUTION_ACTIVATION_FAILED');process.exitCode=1;});
