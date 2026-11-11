'use strict';
// Opt-in EU writer. This policy never converts a review into human approval.
const {isDeepStrictEqual}=require('node:util');
const {deepFreeze}=require('../opportunities/v2/data');
const {validateSnapshotV2}=require('../opportunities/v2/validation');
const {compareSnapshotsV2}=require('../opportunities/v2/digests');
const {implementationDigest,hash}=require('../opportunities/v2/activationArchive');
const {createCandidateArchiveV2}=require('./candidateRepositoryV2');
const {createAcceptedOpportunityV2Repository}=require('../opportunities/v2/acceptedRepository');
const {createEuWriterAuthorityV2}=require('../opportunities/v2/euWriterAuthority');
const {createEuWriterAuditV2}=require('../opportunities/v2/euWriterAudit');
const POLICY='eu-existing-v2.0',MODE='CANONICAL_V2',SERVICE='FUNDING_TENDERS_CENTRAL';
const EU=Object.freeze(['EU_FUNDING_TENDERS','CORDIS','ERASMUS']);
function fail(code='OPPORTUNITY_V2_EU_WRITER_INVALID'){throw Object.assign(new Error(code),{code});}
function euWriterConfiguration(){return deepFreeze({policyVersion:POLICY,mappingDigest:hash({version:'eu-writer-mapping-v2.1',
 type1:implementationDigest('EU_FUNDING_TENDERS','eu-funding-type1-v2.1'),type2:implementationDigest('EU_FUNDING_TENDERS','eu-funding-type2-v2.1'),type8:implementationDigest('EU_FUNDING_TENDERS','eu-funding-type8-v2.1')})});}
function assertEuWriterConfiguration(value){const expected=euWriterConfiguration();if(!isDeepStrictEqual(value,expected))fail();return expected;}
const populated=value=>Array.isArray(value)?value.length>0:value&&typeof value==='object'?Object.keys(value).length>0:Boolean(value);
function conflicts(value){return value&&typeof value==='object'&&(value.state==='CONFLICT'||Object.values(value).some(conflicts));}
function evaluateEuWriterPolicy({accepted,snapshot,mappingDigest,identityConflict=false}){
 const incoming=validateSnapshotV2(snapshot),reasons=new Set();let changed=true;
 if(identityConflict)reasons.add('AMBIGUOUS_ACCEPTED_IDENTITY');
 if(!accepted)reasons.add('NEW_IDENTITY_REQUIRES_REVIEW');
 else{
  if(accepted.snapshot?.schemaVersion!==2)reasons.add('LEGACY_MIGRATION_REQUIRES_REVIEW');
  else{const compared=compareSnapshotsV2(accepted.snapshot,incoming);changed=compared.changed;for(const code of compared.reasonCodes)reasons.add(code);}
  if(accepted.mappingDigest!==mappingDigest)reasons.add(accepted.mappingDigest?'MAPPING_IMPLEMENTATION_CHANGED':'MAPPING_BASELINE_UNAVAILABLE');
  if(accepted.lifecycleState!=='ACTIVE')reasons.add('LIFECYCLE_REQUIRES_REVIEW');
  if(populated(accepted.corrections))reasons.add('EDITORIAL_CORRECTIONS_REQUIRE_REVIEW');
  if(populated(accepted.resolutions)||accepted.snapshot?.sourceResolution)reasons.add('SOURCE_RESOLUTION_REQUIRES_REVIEW');
  if(populated(accepted.conflicts))reasons.add('EDITORIAL_CONFLICTS_REQUIRE_REVIEW');
 }
 if(conflicts(incoming))reasons.add('UNRESOLVED_CONFLICT');
 if(incoming.sourceRecords.some(s=>s.role!=='PROGRAMME_METADATA'&&s.namespace!=='EU_FUNDING_TENDERS'))reasons.add('SOURCE_IDENTITY_CHANGED');
 return deepFreeze({decision:reasons.size?'REVIEW':'ACCEPTED',outcome:reasons.size?'REVIEW':changed?'UPDATED':'UNCHANGED',reasonCodes:[...reasons].sort()});
}

function createEuWriterV2({pool,configuration}){
 const config=assertEuWriterConfiguration(configuration),authority=createEuWriterAuthorityV2(config),archive=createCandidateArchiveV2();
 const bindings=new WeakMap(),audit=createEuWriterAuditV2();
 function execution(row,value){if(!value)fail('OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED');return {runId:row.run_id,runFence:Number(row.fence),sourceFence:Number(row.eu_source_fence),executionId:value.executionId,inboxFence:value.inboxFence,workerId:value.workerId,consumer:value.consumer};}
 function assertRun(row){if(!EU.includes(row.source_code)||row.eu_writer_mode!==MODE||row.eu_writer_policy!==config.policyVersion||row.eu_writer_mapping_digest!==config.mappingDigest)fail('OPPORTUNITY_V2_EU_WRITER_MODE_MISMATCH');}
 async function authorize(client,context){const binding=bindings.get(context);if(!binding||binding.client!==client)fail('OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED');return authority.assertCurrent(client,binding.permit);}
 async function verifyPolicy(client,{input,preview,receipt,context}){
  const binding=bindings.get(context);if(!binding||binding.client!==client||hash(input)!==binding.commandDigest||input.approvalDigest!==binding.previewDigest||preview&&preview.previewDigest!==binding.previewDigest||receipt&&receipt.approval_digest!==binding.previewDigest)fail('OPPORTUNITY_V2_EU_WRITER_POLICY_STALE');
  const checked=await archive.verify(client,{run:binding.run,externalIdentifier:binding.externalIdentifier,required:true});
  if(checked.payloadDigest!==binding.payloadDigest)fail('OPPORTUNITY_V2_EU_WRITER_POLICY_STALE');
  return authority.assertCurrent(client,binding.permit);
 }
 const accepted=createAcceptedOpportunityV2Repository({pool,authorize,verifyApproval:verifyPolicy,audit:async(client,event)=>{
  await authorize(client,event.context);
  const binding=bindings.get(event.context);
  await audit(client,{...binding.audit,requestId:event.requestId,result:{...event.result,outcome:binding.outcome,reasonCodes:[]}});
 }});
 async function loadCurrent(client,snapshot,stored){
  const identities=snapshot.sourceRecords.filter(s=>s.role!=='PROGRAMME_METADATA'),ids=new Set();
  for(const s of [...identities].sort((a,b)=>a.externalId.localeCompare(b.externalId)))await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,620061))',[s.namespace+':'+s.externalId]);
  for(const s of identities){
   for(const row of (await client.query('SELECT opportunity_id FROM opportunity_catalog.source_identity_v2 WHERE source_namespace=$1 AND external_identifier=$2',[s.namespace,s.externalId])).rows)ids.add(row.opportunity_id);
   for(const row of (await client.query('SELECT opportunity_id FROM opportunity_catalog.funding_identity WHERE external_identifier=$1',[s.externalId])).rows)ids.add(row.opportunity_id);
  }
  // P3's legacy topic alias can identify a different cascade opportunity. A
  // provider URL is only a conflict signal here; it never creates a new link.
  const cascadeKey=require('./identity').cascadeKeyFromUrl(stored.source_fields?.officialUrl);
  if(cascadeKey&&cascadeKey!==stored.external_identifier)return {accepted:null,identityConflict:true};
  if(cascadeKey&&stored.source_fields?.callReference){
   const legacy=(await client.query('SELECT opportunity_id,last_source_fields FROM opportunity_catalog.funding_identity WHERE external_identifier=$1',[stored.source_fields.callReference])).rows;
   if(legacy.some(row=>require('./identity').cascadeKeyFromUrl(row.last_source_fields?.officialUrl)&&!ids.has(row.opportunity_id)))return {accepted:null,identityConflict:true};
  }
  if(ids.size!==1)return {accepted:null,identityConflict:ids.size>1};
  const opportunityId=[...ids][0],row=(await client.query('SELECT o.*,r.snapshot FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id AND r.opportunity_id=o.opportunity_id WHERE o.opportunity_id=$1 FOR UPDATE OF o',[opportunityId])).rows[0];
  if(!row)fail('OPPORTUNITY_V2_EU_WRITER_IDENTITY_INVALID');
  const metadata=(await client.query('SELECT external_identifier,corrections,conflicts FROM opportunity_catalog.funding_identity WHERE opportunity_id=$1 FOR UPDATE',[opportunityId])).rows;
  const resolutions=(await client.query('SELECT resolution_id,decision_digest FROM opportunity_catalog.funding_resolution WHERE opportunity_id=$1 ORDER BY resolution_id',[opportunityId])).rows;
  const mapping=(await client.query('SELECT mapping_digest FROM opportunity_catalog.accepted_receipt_v2 WHERE revision_id=$1 ORDER BY recorded_at DESC,request_id DESC LIMIT 1',[row.current_revision_id])).rows[0];
  return {identityConflict:false,accepted:{opportunityId,revisionId:row.current_revision_id,rowVersion:Number(row.row_version),snapshot:row.snapshot,lifecycleState:row.lifecycle_state,mappingDigest:mapping?.mapping_digest||null,
   corrections:Object.assign({},...metadata.map(m=>m.corrections)),conflicts:metadata.flatMap(m=>m.conflicts||[]),resolutions}};
 }
 async function apply(client,row,stored,value){
  assertRun(row);const checked=await archive.verify(client,{run:row,externalIdentifier:stored.external_identifier,required:true}),snapshot=checked.canonicalSnapshot;
  const mappingDigest=implementationDigest('EU_FUNDING_TENDERS',snapshot.provenance.mappingVersion),current=await loadCurrent(client,snapshot,stored);
  const policy=evaluateEuWriterPolicy({...current,snapshot,mappingDigest});
  const expected=current.accepted?{opportunityId:current.accepted.opportunityId,revisionId:current.accepted.revisionId,rowVersion:current.accepted.rowVersion}:null;
  const intent={version:POLICY,runId:row.run_id,externalIdentifier:stored.external_identifier,payloadDigest:checked.payloadDigest,mappingDigest:config.mappingDigest,decision:policy.decision,expected,reasonCodes:policy.reasonCodes};
  const intentDigest=hash(intent),prior=(await client.query('SELECT * FROM opportunity_catalog.eu_writer_decision_v2 WHERE run_id=$1 AND external_identifier=$2',[row.run_id,stored.external_identifier])).rows[0];
  if(prior){if(prior.intent_digest!==intentDigest)fail('OPPORTUNITY_V2_IDEMPOTENCY_CONFLICT');await authority.assertExecution(client,execution(row,value));return prior.result;}
  const permit=await authority.authorize(client,execution(row,value),{externalIdentifier:stored.external_identifier,payloadDigest:checked.payloadDigest,...(expected||{opportunityId:null,revisionId:null,rowVersion:null}),decision:policy.decision});
  let result={outcome:'REVIEW',opportunityId:expected?.opportunityId||null,revisionId:expected?.revisionId||null,rowVersion:expected?.rowVersion||null,reasonCodes:policy.reasonCodes};
  const requestId=hash({operation:'EU_WRITER_V2',runId:row.run_id,externalIdentifier:stored.external_identifier});
  const auditBinding={runId:row.run_id,externalIdentifier:stored.external_identifier,intentDigest,execution:execution(row,value),policyVersion:config.policyVersion,mappingDigest:config.mappingDigest,payloadDigest:checked.payloadDigest,expected,decision:policy.decision};
  if(policy.decision==='ACCEPTED'){
   const context=Object.freeze({}),command={requestId,candidateId:'funding:'+hash({kind:'FUNDING',runId:row.run_id,externalIdentifier:stored.external_identifier}),snapshot,mappingDigest,expected};
   const binding={client,permit,run:row,externalIdentifier:stored.external_identifier,payloadDigest:checked.payloadDigest,audit:auditBinding,outcome:policy.outcome};bindings.set(context,binding);
   try{
    const preview=await accepted.previewInTransaction(client,command,context);
    if(preview.items[0]?.action!== (policy.outcome==='UNCHANGED'?'UNCHANGED':'CHANGE_REQUIRES_APPROVAL')||preview.items[0].reasonCodes.length)fail('OPPORTUNITY_V2_EU_WRITER_POLICY_STALE');
    command.approvalDigest=preview.previewDigest;binding.previewDigest=preview.previewDigest;binding.commandDigest=hash(command);
    const saved=await accepted.acceptInTransaction(client,command,context);result={...saved,outcome:policy.outcome,reasonCodes:[]};
   }finally{bindings.delete(context);}
   await client.query(`INSERT INTO opportunity_catalog.funding_identity(external_identifier,opportunity_id,last_source_fields,corrections,conflicts,observed_at,last_run_id,source_review,source_reviewed_at) VALUES($1,$2,$3,'{}','[]',$4,$5,NULL,$4)
    ON CONFLICT(external_identifier) DO UPDATE SET last_source_fields=EXCLUDED.last_source_fields,observed_at=EXCLUDED.observed_at,last_run_id=EXCLUDED.last_run_id,source_review=NULL,source_reviewed_at=EXCLUDED.source_reviewed_at`,[stored.external_identifier,result.opportunityId,stored.source_fields,row.observed_at,row.run_id]);
   await client.query('INSERT INTO opportunity_catalog.funding_observation VALUES($1,$2,$3,$4,$5,$6,$7)',[row.run_id,stored.external_identifier,result.opportunityId,result.revisionId,row.observed_at,stored.source_fields,'[]']);
  }else await audit(client,{...auditBinding,requestId,result});
  await client.query('INSERT INTO opportunity_catalog.eu_writer_decision_v2(run_id,external_identifier,policy_version,mapping_digest,payload_digest,intent_digest,decision,reason_codes,expected,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[row.run_id,stored.external_identifier,config.policyVersion,config.mappingDigest,checked.payloadDigest,intentDigest,policy.decision,JSON.stringify(policy.reasonCodes),expected,result]);
  await client.query('UPDATE opportunity_catalog.funding_run_item SET result=$3,opportunity_id=$4 WHERE run_id=$1 AND external_identifier=$2',[row.run_id,stored.external_identifier,result.outcome,result.opportunityId]);
  const counter={UPDATED:'updated_count',UNCHANGED:'unchanged_count',REVIEW:'review_count'}[result.outcome];
  await client.query(`UPDATE opportunity_catalog.funding_run SET ${counter}=${counter}+1 WHERE run_id=$1`,[row.run_id]);
  await authority.assertCurrent(client,permit);return result;
 }
 async function assertExecution(client,row,value){assertRun(row);return authority.assertExecution(client,execution(row,value));}
 async function claim(client,row,value){assertRun(row);const context=execution(row,value);delete context.runFence;const current=(await client.query('SELECT opportunity_catalog.eu_source_state_v2() AS state')).rows[0]?.state;context.sourceFence=current?.fence;return authority.claimRun(client,context);}
 async function releaseRetry(client,row,value){assertRun(row);return authority.releaseRetry(client,execution(row,value));}
 return Object.freeze({configuration:config,archive,apply,assertExecution,assertRun,claim,releaseRetry});
}
module.exports={POLICY,MODE,EU,euWriterConfiguration,assertEuWriterConfiguration,evaluateEuWriterPolicy,createEuWriterV2};
