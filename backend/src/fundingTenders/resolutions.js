'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {canonicalize}=require('../organizationalProfile/canonicalization');
const {validateSnapshot}=require('../opportunities/contracts');
const {validateSourceResolution}=require('../opportunities/sourceResolution');
const {validateTemporal}=require('../opportunities/temporal');
const {date}=require('../opportunities/normalization');
const {CentralOpportunityRepository}=require('../opportunities/centralRepository');
const {createIdentityFactory}=require('../opportunities/identity');
const {createPlatformAudit}=require('./audit');
const {verifyEvidence}=require('./sourceEvidence');
const IDS=Object.freeze(['CEF-T-2021-AFIFCOEN-WORKS-LNG','CEF-T-2021-AFIFCOEN-WORKS-ZE','CEF-T-2021-AFIFGEN-UNITS','CEF-T-2021-AFIFGEN-WORKS-LNG','ERASMUS-EDU-2022-ECHE-CERT-FP','ESC-HUMAID-2021-QUAL-LABEL-FP']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const TEMPORAL=['openingDate','closingDate','sourceTemporal'];
function fail(code='FUNDING_RESOLUTION_INVALID'){throw Object.assign(new Error(code),{code});}
const hash=value=>createHash('sha256').update(canonicalize(value)).digest('hex');
const same=(a,b)=>canonicalize(a??null)===canonicalize(b??null);
function decisionProjection(d){return {externalIdentifier:d.externalIdentifier,expectedFingerprint:d.expectedFingerprint,fields:d.fields,reason:d.reason,note:d.note,sources:d.sources};}
function publicMetadata(d,id,time){return validateSourceResolution({schemaVersion:1,resolutionId:id,decidedAt:time,sourceFingerprint:d.expectedFingerprint,reason:d.reason,note:d.note,sources:d.sources});}
function validateDecisions(input){
 if(!Array.isArray(input)||input.length!==IDS.length||!same(input.map(d=>d?.externalIdentifier).sort(),IDS))fail();
 return input.map(d=>{
  if(!d||Object.getPrototypeOf(d)!==Object.prototype||Object.keys(d).some(k=>!['id','externalIdentifier','expectedFingerprint','evidence','fields','reason','note','sources'].includes(k))||!HASH.test(d.expectedFingerprint)||!verifyEvidence(d.evidence)||d.evidence.externalIdentifier!==d.externalIdentifier||d.evidence.fingerprint!==d.expectedFingerprint)fail();
  if(!d.fields||Object.keys(d.fields).sort().join(',')!=='closingDate,sourceTemporal')fail();
  date(d.fields.closingDate);validateTemporal(d.fields.sourceTemporal);
  publicMetadata(d,randomUUID(),'2026-01-01T00:00:00.000Z');
  return JSON.parse(JSON.stringify(d));
 }).sort((a,b)=>a.externalIdentifier.localeCompare(b.externalIdentifier));
}
function resolvedSnapshot(row,decision,metadata){
 for(const key of TEMPORAL){
  if(Object.hasOwn(row.corrections||{},key)||!same(row.snapshot[key],row.last_source_fields[key]))fail('FUNDING_RESOLUTION_MANUAL_CONFLICT');
 }
 return validateSnapshot({...row.snapshot,...decision.fields,sourceResolution:metadata});
}
function verifiedLookup(batch,id,fingerprint){
 return Boolean(batch&&['FOUND','CONFLICT'].includes(batch.outcome)&&!batch.limited&&Number.isFinite(Date.parse(batch.observedAt))&&verifyEvidence(batch.evidence)&&batch.evidence.externalIdentifier===id&&batch.evidence.fingerprint===fingerprint&&batch.received===batch.evidence.variants.length);
}
// Only an archive explicitly referenced by the current immutable snapshot can
// override conflicting lookup variants. An old decision cannot silently revive.
function enrichedResolutionFields(fields,evidence,observedAt){
 const {extractEnrichment}=require('./enrichment');
 const {retainEnrichmentObservation}=require('../opportunities/sourceEnrichment');
 return require('./merge').boundedSourceFields({...fields,sourceEnrichment:retainEnrichmentObservation(fields.sourceEnrichment,extractEnrichment(evidence.variants,{externalIdentifier:evidence.externalIdentifier,observedAt:new Date(observedAt).toISOString()}))});
}
async function retainResolution(client,id,batch,{enrichmentEnabled=false}={}){
 const row=(await client.query(`SELECT f.last_source_fields,r.snapshot,d.resolution_id,d.source_fingerprint
 FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id)
 JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id
 LEFT JOIN opportunity_catalog.funding_resolution d ON d.resolution_id::text=r.snapshot->'sourceResolution'->>'resolutionId' AND d.opportunity_id=o.opportunity_id AND d.external_identifier=f.external_identifier
 WHERE f.external_identifier=$1 FOR UPDATE OF f,o`,[id])).rows[0];
 if(!row?.snapshot?.sourceResolution)return batch;
 const existing=row.snapshot.sourceResolution;
 if(row.resolution_id===existing.resolutionId&&row.source_fingerprint===existing.sourceFingerprint&&verifiedLookup(batch,id,row.source_fingerprint)){
  const fields=enrichmentEnabled?enrichedResolutionFields(row.last_source_fields,batch.evidence,batch.observedAt):row.last_source_fields;
  const {conflictReasons:_discarded,...rest}=batch;
  return {...rest,outcome:'FOUND',record:{externalIdentifier:id,fields,sourceResolutionId:row.resolution_id}};
 }
 if(['ABSENT','ERROR'].includes(batch.outcome))return {...batch,record:undefined};
 const prior=batch.outcome==='CONFLICT'?require('./conflictDiagnostics').validate('CONFLICT',batch.conflictReasons):[];
 const reasons=require('./conflictDiagnostics').validate('CONFLICT',[
  ...prior.filter(reason=>reason!=='UNCLASSIFIED_SOURCE_CONFLICT'),'PROTECTED_RESOLUTION_CHANGED']);
 return {...batch,outcome:'CONFLICT',conflictReasons:reasons,record:undefined};
}
// Staged JSON survives process restarts, so rederive the only permitted overlay
// from the immutable archive rather than trusting a sourceResolutionId alone.
async function verifyResolvedFields(client,{identity,previous,stored,observedAt,enrichmentEnabled=false,requireArchive=false}){
 if(typeof requireArchive!=='boolean')return false;
 const equal=same(stored.source_fields,identity.last_source_fields);
 if(equal&&!requireArchive)return true;
 if(!enrichmentEnabled&&!requireArchive)return false;
 const metadata=previous.snapshot.sourceResolution;
 const archive=(await client.query(`SELECT resolution_id,source_fingerprint,evidence FROM opportunity_catalog.funding_resolution
 WHERE resolution_id=$1 AND opportunity_id=$2 AND external_identifier=$3`,[metadata.resolutionId,identity.opportunity_id,stored.external_identifier])).rows[0];
 if(!archive||archive.resolution_id!==metadata.resolutionId||archive.source_fingerprint!==metadata.sourceFingerprint||!verifyEvidence(archive.evidence)||archive.evidence.externalIdentifier!==stored.external_identifier||archive.evidence.fingerprint!==metadata.sourceFingerprint)return false;
 // A canonical-candidate exemption requires the immutable P2 proof, even when
 // no legacy field changed. Equality alone does not establish that proof.
 if(equal)return true;
 if(!enrichmentEnabled)return false;
 try{return same(stored.source_fields,enrichedResolutionFields(identity.last_source_fields,archive.evidence,observedAt));}catch{return false;}
}
function createResolutionService({repository,source,decisions,pool,catalog:catalogOverride,audit=createPlatformAudit(),clock=()=>new Date()}){
 const reviewed=validateDecisions(decisions),packDigest=hash(reviewed.map(decisionProjection));
 const catalog=catalogOverride||new CentralOpportunityRepository({pool,identityFactory:createIdentityFactory()});
 function enabled(userId){if(repository.resolutionSupported!==true)fail('FUNDING_WORKER_UPGRADE_REQUIRED');if(!UUID.test(userId))fail('FUNDING_FORBIDDEN');}
 async function fresh(){
  const observations=[];
  for(const d of reviewed){const batch=await source.lookup({externalIdentifier:d.externalIdentifier});if(!verifiedLookup(batch,d.externalIdentifier,d.expectedFingerprint))fail('FUNDING_RESOLUTION_EVIDENCE_CHANGED');observations.push(batch);}
  return observations;
 }
 async function load(client,lock=false){
  const rows=(await client.query(`SELECT f.*,o.current_revision_id,o.row_version,r.snapshot,d.decision_digest,d.resolution_id AS active_resolution_id,d.applied_revision_id
 FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id)
 JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id
 LEFT JOIN opportunity_catalog.funding_resolution d ON d.resolution_id::text=r.snapshot->'sourceResolution'->>'resolutionId' AND d.opportunity_id=o.opportunity_id AND d.external_identifier=f.external_identifier
 WHERE f.external_identifier=ANY($1::text[]) ORDER BY f.external_identifier${lock?' FOR UPDATE OF f,o':''}`,[IDS])).rows;
  if(rows.length!==reviewed.length)fail('FUNDING_RESOLUTION_IDENTITY_MISSING');
  return rows;
 }
 function projection(rows){
  const states=reviewed.map(d=>{
   const row=rows.find(r=>r.external_identifier===d.externalIdentifier);if(!row)fail('FUNDING_RESOLUTION_IDENTITY_MISSING');
   const alreadyApplied=row.decision_digest===hash(decisionProjection(d))&&row.active_resolution_id===row.snapshot.sourceResolution?.resolutionId;
   resolvedSnapshot(row,d,publicMetadata(d,randomUUID(),'2026-01-01T00:00:00.000Z'));
   return {externalIdentifier:d.externalIdentifier,opportunityId:row.opportunity_id,revisionId:row.current_revision_id,rowVersion:Number(row.row_version),sourceFingerprint:d.expectedFingerprint,closingDate:d.fields.closingDate,alreadyApplied};
  });
  const digest=hash({version:1,packDigest,states,bindings:rows.map(row=>({externalIdentifier:row.external_identifier,snapshot:row.snapshot,source:row.last_source_fields,corrections:row.corrections,sourceReview:row.source_review??null}))});
  return {schemaVersion:1,digest,items:states};
 }
 async function prepare(userId){
  enabled(userId);
  await repository.transaction(client=>repository.administrator(client,userId),true);
  await fresh();
  return repository.transaction(async client=>{await repository.administrator(client,userId);return projection(await load(client));},true);
 }
 function command(userId,input){
  if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).sort().join(',')!=='expectedDigest,expectedRevisions,requestId'||!UUID.test(input.requestId)||!HASH.test(input.expectedDigest)||!Array.isArray(input.expectedRevisions)||input.expectedRevisions.length!==IDS.length)fail();
  const refs=input.expectedRevisions.map(r=>{if(!r||Object.keys(r).sort().join(',')!=='externalIdentifier,revisionId'||!IDS.includes(r.externalIdentifier)||!UUID.test(r.revisionId))fail();return {...r};}).sort((a,b)=>a.externalIdentifier.localeCompare(b.externalIdentifier));
  if(!same(refs.map(r=>r.externalIdentifier),IDS))fail();
  return {...input,expectedRevisions:refs,commandDigest:hash({userId,packDigest,requestId:input.requestId,expectedDigest:input.expectedDigest,expectedRevisions:refs})};
 }
 function result(rows,replayed){return {schemaVersion:1,replayed,items:rows.map(r=>({externalIdentifier:r.external_identifier,opportunityId:r.opportunity_id,resolutionId:r.resolution_id,revisionId:r.applied_revision_id})).sort((a,b)=>a.externalIdentifier.localeCompare(b.externalIdentifier))};}
 async function prior(client,userId,c){
  const rows=(await client.query('SELECT * FROM opportunity_catalog.funding_resolution WHERE request_id=$1 ORDER BY external_identifier',[c.requestId])).rows;
  if(!rows.length)return null;
  if(rows.length!==IDS.length||!same(rows.map(r=>r.external_identifier),IDS)||rows.some(r=>r.decided_by!==userId||r.batch_digest!==c.expectedDigest||r.command_digest!==c.commandDigest))fail('IDEMPOTENCY_CONFLICT');
  return result(rows,true);
 }
 async function locked(client,userId){
  await repository.administrator(client,userId,true);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('EU_FUNDING_TENDERS',150001))");
 }
 async function apply(userId,input){
  enabled(userId);const c=command(userId,input);
  // Completed replay needs current authority, never a second network operation.
  const replay=await repository.transaction(async client=>{await locked(client,userId);return prior(client,userId,c);});
  if(replay)return replay;
  const observations=await fresh();
  return repository.transaction(async client=>{
   await locked(client,userId);const repeated=await prior(client,userId,c);if(repeated)return repeated;
   if((await client.query("SELECT run_id FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING') LIMIT 1")).rows.length)fail('FUNDING_BUSY');
   const rows=await load(client,true),prepared=projection(rows);
   if(!same(c.expectedRevisions,prepared.items.map(i=>({externalIdentifier:i.externalIdentifier,revisionId:i.revisionId}))))fail('FUNDING_RESOLUTION_STALE_REVISION');
   if(c.expectedDigest!==prepared.digest)fail('FUNDING_RESOLUTION_STALE_DIGEST');
   const allApplied=prepared.items.every(i=>i.alreadyApplied);
   if(allApplied&&rows.every(row=>row.source_review==null))return result(rows.map(r=>({...r,resolution_id:r.active_resolution_id})),true);
   if(!allApplied&&prepared.items.some(i=>i.alreadyApplied))fail('FUNDING_RESOLUTION_PARTIAL_REPLAY');
   // A new, explicitly reviewed command may resolve a reopened source warning.
   // Preserve the first decision and record a new atomic batch of six revisions;
   // replay of its original request was handled above and never clears warnings.
   const decidedAt=clock().toISOString(),applied=[];
   for(let index=0;index<reviewed.length;index++){
    const d=reviewed[index],row=rows.find(r=>r.external_identifier===d.externalIdentifier),resolutionId=randomUUID();
    const snapshot={...resolvedSnapshot(row,d,publicMetadata(d,resolutionId,decidedAt)),provenanceId:randomUUID()};
    const requestKey=hash({requestId:c.requestId,externalIdentifier:d.externalIdentifier});
    const updated=await catalog.withTransactionClient(client,()=>catalog.update({schemaVersion:1,requestId:requestKey,opportunityId:row.opportunity_id,expectedRowVersion:Number(row.row_version),snapshot,provenance:{schemaVersion:1,sourceType:'C4G_MANUAL',sourceNamespace:'FUNDING_SOURCE_RESOLUTION',externalIdentifier:d.externalIdentifier,observedAt:decidedAt}},{actor:{type:'HUMAN',reference:userId}}));
    await client.query('RESET ROLE');
    await client.query(`INSERT INTO opportunity_catalog.funding_resolution(resolution_id,request_id,batch_digest,command_digest,decision_digest,external_identifier,opportunity_id,previous_revision_id,applied_revision_id,source_fingerprint,evidence,decision,decided_by,decided_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[resolutionId,c.requestId,c.expectedDigest,c.commandDigest,hash(decisionProjection(d)),d.externalIdentifier,row.opportunity_id,row.current_revision_id,updated.revisionId,d.expectedFingerprint,d.evidence,decisionProjection(d),userId,decidedAt]);
    await client.query('UPDATE opportunity_catalog.funding_identity SET last_source_fields=$2,source_review=NULL,source_reviewed_at=$3 WHERE external_identifier=$1',[d.externalIdentifier,{...row.last_source_fields,...d.fields},observations[index].observedAt]);
    await audit(client,{actor:{type:'HUMAN',id:userId},eventCode:'OPPORTUNITY_REVISION_CREATED',requestId:requestKey,resourceId:row.opportunity_id,detailCode:'FUNDING_SOURCE_RESOLVED'});
    applied.push({external_identifier:d.externalIdentifier,opportunity_id:row.opportunity_id,resolution_id:resolutionId,applied_revision_id:updated.revisionId});
   }
   return result(applied,false);
  });
 }
 return {prepare,apply};
}
module.exports={IDS,createResolutionService,resolvedSnapshot,retainResolution,verifiedLookup,verifyResolvedFields};
