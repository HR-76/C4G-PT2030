'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../../..');
const {createAcceptedOpportunityV2Repository}=require('../../../backend/src/opportunities/v2/acceptedRepository');
const {validateSnapshotV2}=require('../../../backend/src/opportunities/v2/validation');
const {contentDigestV2}=require('../../../backend/src/opportunities/v2/digests');
const {inspectPlanXlsxV2}=require('../../../backend/src/portugal2030/planXlsxV2');
const eu=JSON.parse(fs.readFileSync(path.join(root,'context/references/opportunity-v2/examples/eu-11145.json'),'utf8'));
const mappingDigest=createHash('sha256').update('S6 isolated normative fixture mapping').digest('hex');
const expected=result=>({opportunityId:result.opportunityId,revisionId:result.revisionId,rowVersion:result.rowVersion});
const input=(snapshot,prior=null)=>({requestId:randomUUID(),candidateId:randomUUID(),snapshot,mappingDigest,expected:prior?expected(prior):null});
async function sqlRejected(pool,sql,params=[],role='c4g_opportunity_central_runtime'){
 const client=await pool.connect();let error;
 try{await client.query('BEGIN');await client.query('SET LOCAL ROLE '+role);try{await client.query(sql,params);await client.query('SET CONSTRAINTS ALL IMMEDIATE');}catch(e){error=e;}await client.query('ROLLBACK');}finally{client.release();}
 assert.ok(error,'Expected SQL rejection');return error.code;
}
async function persistenceProof({pool,check,report}){
 const approvals=new Set(),records={},actor=randomUUID(),legacy={opportunityId:randomUUID(),revisionId:randomUUID(),rowVersion:1};
 let authority=true,approval=true,failAudit=false,revokeAfterAudit=false;
 const historySnapshot={schemaVersion:1,title:'Historical EU opportunity',funderName:'Historical funder',provenanceId:randomUUID(),lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1'};
 const repo=createAcceptedOpportunityV2Repository({pool,authorize:async()=>authority,verifyApproval:async(_client,{input})=>approval&&approvals.has(input.approvalDigest),
  audit:async(client,event)=>{await client.query('INSERT INTO s6_evidence.persistence_audit(request_id,event) VALUES($1,$2)',[event.requestId,{operation:event.operation,opportunityId:event.opportunityId,revisionId:event.revisionId,action:event.action}]);if(revokeAfterAudit)authority=false;if(failAudit)throw Error('SYNTHETIC_AUDIT_FAILURE');}});
 async function approved(value){const preview=await repo.preview(value,{actor});assert.notEqual(preview.items[0].action,'BLOCKED');approvals.add(preview.previewDigest);return {...value,approvalDigest:preview.previewDigest};}
 async function accept(value){return repo.accept(await approved(value),{actor});}
 let baseline;
 await check('S6_SEED_V1_HISTORY_BEFORE_ADDITIVE_CANDIDATE',async()=>{
  const client=await pool.connect();try{await client.query('BEGIN');
   await client.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'S6 isolated fixture',$2,'ACTIVE')",[actor,actor+'@example.invalid']);
   await client.query("INSERT INTO opportunity_catalog.opportunity(opportunity_id,current_revision_id,revision_number,row_version,lifecycle_state,validation_state,title,funder_name,quality_score,quality_bucket,content_digest,normalization_version,quality_rule_version) VALUES($1,$2,1,1,'ACTIVE','PENDING_REVIEW',$3,$4,0,'LOW',$5,'opportunity-normalization-v1','opportunity-quality-v1')",[legacy.opportunityId,legacy.revisionId,historySnapshot.title,historySnapshot.funderName,'a'.repeat(64)]);
   await client.query('INSERT INTO opportunity_catalog.revision(revision_id,opportunity_id,revision_number,row_version,snapshot,normalized_projection,quality_projection,content_digest) VALUES($1,$2,1,1,$3,$4,$5,$6)',[legacy.revisionId,legacy.opportunityId,historySnapshot,{legacy:true},{score:0},'a'.repeat(64)]);
   const run=randomUUID();await client.query("INSERT INTO opportunity_catalog.funding_run(run_id,request_id,requested_by,status) VALUES($1,$2,$3,'SUCCESS')",[run,randomUUID(),actor]);
   await client.query('INSERT INTO opportunity_catalog.funding_identity(external_identifier,opportunity_id,last_source_fields,corrections,conflicts,observed_at,last_run_id) VALUES($1,$2,$3,$4,$5,$6,$7)',['CASCADE:11145',legacy.opportunityId,historySnapshot,{},[],'2026-10-30T12:00:00.000Z',run]);
   await client.query('CREATE SCHEMA s6_evidence');
   await client.query('REVOKE ALL ON SCHEMA s6_evidence FROM PUBLIC');
   await client.query('GRANT USAGE ON SCHEMA s6_evidence TO c4g_opportunity_central_runtime');
   await client.query('CREATE TABLE s6_evidence.persistence_audit(request_id text PRIMARY KEY,event jsonb NOT NULL)');
   await client.query('GRANT SELECT,INSERT ON s6_evidence.persistence_audit TO c4g_opportunity_central_runtime');
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  baseline=(await pool.query('SELECT snapshot,normalized_projection,quality_projection,content_digest,revision_number,row_version,created_at::text FROM opportunity_catalog.revision WHERE revision_id=$1',[legacy.revisionId])).rows[0];
 });
 await check('S6_APPLY_CANDIDATE_PRESERVES_V1_BYTES_AND_CONSTRAINTS',async()=>{
  const sql=fs.readFileSync(path.join(root,'backend/database/central/candidates/opportunity_persistence_v2.up.sql'),'utf8');
  const client=await pool.connect();try{await client.query('BEGIN');await client.query(sql);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  assert.deepEqual((await pool.query('SELECT snapshot,normalized_projection,quality_projection,content_digest,revision_number,row_version,created_at::text FROM opportunity_catalog.revision WHERE revision_id=$1',[legacy.revisionId])).rows[0],baseline);
  assert.equal(await sqlRejected(pool,'UPDATE opportunity_catalog.opportunity SET funder_name=NULL WHERE opportunity_id=$1',[legacy.opportunityId]),'23514');
 });
 await check('S6_ACCEPT_EU_UPGRADE_REUSES_UUID_AND_PRESERVES_FULL_FACTS',async()=>{
  records.eu=await accept(input(eu,legacy));assert.equal(records.eu.opportunityId,legacy.opportunityId);assert.notEqual(records.eu.revisionId,legacy.revisionId);assert.equal(records.eu.rowVersion,2);
  assert.deepEqual((await pool.query('SELECT snapshot FROM opportunity_catalog.revision WHERE revision_id=$1',[records.eu.revisionId])).rows[0].snapshot,eu);
  assert.deepEqual((await pool.query('SELECT amount_canonical,amount::text,currency_state,currency_code FROM opportunity_catalog.revision_allocation_v2 WHERE revision_id=$1',[records.eu.revisionId])).rows,[{amount_canonical:'120000',amount:'120000.00000000',currency_state:'NOT_FOUND',currency_code:null}]);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM opportunity_catalog.revision_deadline_v2 WHERE revision_id=$1',[records.eu.revisionId])).rows[0].count,7);
  assert.deepEqual((await pool.query("SELECT minimum_canonical,maximum_canonical FROM opportunity_catalog.revision_financial_detail_v2 WHERE revision_id=$1 AND collection='support'",[records.eu.revisionId])).rows[0],{minimum_canonical:null,maximum_canonical:'1500'});
 });
 let replayCommand;
 await check('S6_IDEMPOTENCY_UNCHANGED_OBSERVATION_WITHOUT_ARTIFICIAL_REVISION',async()=>{
  const before=(await pool.query('SELECT o.last_v2_observed_at,f.observed_at::text AS legacy_observed FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.funding_identity f ON f.opportunity_id=o.opportunity_id WHERE o.opportunity_id=$1',[records.eu.opportunityId])).rows[0];
  const observation=structuredClone(eu);observation.provenance.observations.forEach(o=>o.observedAt='2026-10-31T00:00:00.000Z');
  replayCommand=await approved(input(observation,records.eu));const result=await repo.accept(replayCommand,{actor});assert.equal(result.action,'UNCHANGED');assert.equal(result.revisionId,records.eu.revisionId);
  assert.equal(result.rowVersion,records.eu.rowVersion);
  const refreshed=(await pool.query('SELECT o.last_v2_observed_at,f.observed_at::text AS legacy_observed FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.funding_identity f ON f.opportunity_id=o.opportunity_id WHERE o.opportunity_id=$1',[records.eu.opportunityId])).rows[0];
  assert.ok(before.last_v2_observed_at<refreshed.last_v2_observed_at);assert.equal(refreshed.last_v2_observed_at,'2026-10-31T00:00:00.000Z');assert.equal(refreshed.legacy_observed,before.legacy_observed);
  const count=(await pool.query('SELECT count(*)::int AS n FROM opportunity_catalog.source_observation_v2')).rows[0].n;
  assert.deepEqual(await repo.accept(replayCommand,{actor}),result);assert.equal((await pool.query('SELECT count(*)::int AS n FROM opportunity_catalog.source_observation_v2')).rows[0].n,count);
  await assert.rejects(repo.accept({...replayCommand,mappingDigest:'f'.repeat(64)},{actor}),{code:'OPPORTUNITY_V2_IDEMPOTENCY_CONFLICT'});
  await accept(input(eu,records.eu));
  assert.equal((await pool.query('SELECT last_v2_observed_at FROM opportunity_catalog.opportunity WHERE opportunity_id=$1',[records.eu.opportunityId])).rows[0].last_v2_observed_at,refreshed.last_v2_observed_at);
 });
 await check('S6_PERSIST_ALL_177_PLAN_ROWS_WITHOUT_MULTIPLYING_ALLOCATION',async()=>{
  const filename='PlanoAnualAvisos_download_140926-1.xlsx',bytes=fs.readFileSync(path.join(root,'backend/test/fixtures/portugal2030',filename));
  const bundle=await inspectPlanXlsxV2(bytes,{filename,sheetName:'Sheet1',observedAt:'2026-10-30T22:47:58.470Z'});
  assert.equal(bundle.rows.length,177);records.plans=[];
  for(const row of bundle.rows){const result=await accept(input(row.canonicalSnapshot));records.plans.push({...result,externalId:row.externalIdentifier});
   const stored=(await pool.query('SELECT snapshot FROM opportunity_catalog.revision WHERE revision_id=$1',[result.revisionId])).rows[0].snapshot;
   assert.deepEqual(stored,row.canonicalSnapshot);assert.equal(contentDigestV2(stored),result.contentDigest);
  }
  const multi=records.plans.find(r=>r.externalId==='8614'),zero=records.plans.find(r=>r.externalId==='8664');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM opportunity_catalog.revision_allocation_v2 WHERE revision_id=$1',[multi.revisionId])).rows[0].n,1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM opportunity_catalog.revision_concept_v2 WHERE revision_id=$1 AND collection='programmes'",[multi.revisionId])).rows[0].n,3);
  assert.equal((await pool.query('SELECT amount_canonical FROM opportunity_catalog.revision_allocation_v2 WHERE revision_id=$1',[zero.revisionId])).rows[0].amount_canonical,'0');
 });
 await check('S6_OFFICIAL_AND_MANUAL_CORPUS_PERSISTED_DOCUMENT_CONFLICT_BLOCKED',async()=>{
  const {buildCorpus}=require('./reconciliation-proof.cjs');const corpus=await buildCorpus();records.official=[];
  for(const candidate of corpus.candidates.filter(c=>!c.candidateId.startsWith('EU_FUNDING_TENDERS:')&&!c.candidateId.startsWith('PORTUGAL2030_PLAN:'))){
   const value={...input(candidate.snapshot),candidateId:candidate.candidateId,mappingDigest:candidate.mappingDigest};
   if(candidate.candidateId==='POCTEP:2021-2027:CALL:10'){
    const preview=await repo.preview(value,{actor});assert.equal(preview.items[0].action,'BLOCKED');
    await assert.rejects(repo.accept({...value,approvalDigest:preview.previewDigest},{actor}),{code:'OPPORTUNITY_V2_RECONCILIATION_BLOCKED'});
   }else{
    const result=await accept(value);records.official.push({...result,candidateId:candidate.candidateId});
    assert.deepEqual((await pool.query('SELECT snapshot FROM opportunity_catalog.revision WHERE revision_id=$1',[result.revisionId])).rows[0].snapshot,candidate.snapshot);
   }
  }
  assert.equal(records.official.length,13);
 });
 let synthetic,extreme;
 await check('S6_EXACT_NUMERIC_EXTREME_AND_REVISED_CONTENT',async()=>{
  synthetic=structuredClone(eu);synthetic.sourceRecords[0].externalId='CASCADE:999999';synthetic.sourceRecords[0].url=synthetic.sourceRecords[0].url.replace(/11145$/,'999999');synthetic.links.official.value=synthetic.sourceRecords[0].url;synthetic.description.title.value='Synthetic S6 persistence boundary';synthetic.identity.references.value[0].value='999999';
  const first=await accept(input(synthetic));
  extreme=structuredClone(synthetic);extreme.financing.allocations.value[0].money.amount='999999999999999999999999.12345678';validateSnapshotV2(extreme);
  records.synthetic=await accept(input(extreme,first));assert.equal(records.synthetic.opportunityId,first.opportunityId);assert.equal(records.synthetic.rowVersion,2);
  assert.equal((await pool.query('SELECT amount::text FROM opportunity_catalog.revision_allocation_v2 WHERE revision_id=$1',[records.synthetic.revisionId])).rows[0].amount,'999999999999999999999999.12345678');
 });
 await check('S6_SQL_REJECTS_ROUNDING_ORPHANS_AND_PROJECTION_DRIFT',async()=>{
  for(const invalid of ['0.000000001','1000000000000000000000000','1.20','-1','1e3'])assert.equal((await pool.query('SELECT opportunity_catalog.v2_decimal_valid($1) AS valid',[invalid])).rows[0].valid,false);
  const allocation=eu.financing.allocations.value[0];
  assert.equal(await sqlRejected(pool,'INSERT INTO opportunity_catalog.revision_allocation_v2(opportunity_id,revision_id,allocation_key,payload,amount_canonical,currency_state,currency_code) VALUES($1,$2,$3,$4,$5,$6,$7)',[records.eu.opportunityId,records.eu.revisionId,allocation.key,allocation,'0.000000001','NOT_FOUND',null]),'23514');
  assert.equal(await sqlRejected(pool,'INSERT INTO opportunity_catalog.revision_allocation_v2(opportunity_id,revision_id,allocation_key,payload,amount_canonical,currency_state,currency_code) VALUES($1,$2,$3,$4,$5,$6,$7)',[records.eu.opportunityId,records.eu.revisionId,'forged-key',allocation,'120000','NOT_FOUND',null]),'P0001');
  assert.equal(await sqlRejected(pool,"INSERT INTO opportunity_catalog.revision_allocation_concept_v2(revision_id,allocation_key,collection,concept_key) VALUES($1,$2,'programmes','missing')",[records.eu.revisionId,allocation.key]),'P0001');
  assert.equal(await sqlRejected(pool,'UPDATE opportunity_catalog.opportunity SET current_revision_id=$1 WHERE opportunity_id=$2',[records.eu.revisionId,records.synthetic.opportunityId]),'23503');
 });
 await check('S6_PERSISTENCE_PRESERVES_ISO_YEAR_ZERO_AND_DATE_PRECISION',async()=>{
  const ancient=structuredClone(synthetic);ancient.sourceRecords[0].externalId='CASCADE:999998';ancient.sourceRecords[0].url=ancient.sourceRecords[0].url.replace(/999999$/,'999998');ancient.links.official.value=ancient.sourceRecords[0].url;ancient.identity.references.value[0].value='999998';ancient.description.title.value='Synthetic ISO year zero';
  ancient.provenance.observations.forEach(o=>o.observedAt='0000-01-01T00:00:00.000Z');
  ancient.schedule.opening.value={precision:'DATE',value:'0000-01-01'};
  ancient.schedule.deadlines.value=[{at:{precision:'DATE',value:'0000-02-29'},phase:null},{at:{...eu.schedule.deadlines.value[0].at,value:'0000-03-01T12:00:00.000Z'},phase:null}];
  validateSnapshotV2(ancient);const result=await accept(input(ancient));
  const rows=(await pool.query('SELECT temporal_precision AS precision,extract(year FROM date_value)::int AS civil_year,extract(year FROM instant_value)::int AS instant_year FROM opportunity_catalog.revision_deadline_v2 WHERE revision_id=$1 ORDER BY ordinal',[result.revisionId])).rows;
  assert.deepEqual(rows,[{precision:'DATE',civil_year:-1,instant_year:null},{precision:'INSTANT',civil_year:null,instant_year:-1}]);
  assert.deepEqual((await pool.query('SELECT snapshot FROM opportunity_catalog.revision WHERE revision_id=$1',[result.revisionId])).rows[0].snapshot,ancient);
  assert.equal((await pool.query("SELECT min(extract(year FROM observed_at))::int AS year FROM opportunity_catalog.source_observation_v2 WHERE external_identifier='CASCADE:999998'")).rows[0].year,-1);
 });
 await check('S6_SQL_NULL_CURRENCY_AND_PERIOD_END_FAIL_CLOSED',async()=>{
  for(const invalid of ['currency','period']){
   const snapshot=structuredClone(eu),opportunityId=randomUUID(),revisionId=randomUUID();
   if(invalid==='currency'){snapshot.financing.allocations.value[0].money.currency.state='PRESENT';snapshot.financing.allocations.value[0].money.currency.value=null;}
   else snapshot.schedule.deadlines.value=[{at:{precision:'PERIOD',start:'2027-01-01',end:null,label:'Invalid incomplete interval',periodKind:'RANGE'},phase:null}];
   const client=await pool.connect();let failure;
   try{await client.query('BEGIN');await client.query('SET LOCAL ROLE c4g_opportunity_central_runtime');
    await client.query("INSERT INTO opportunity_catalog.opportunity(opportunity_id,current_revision_id,revision_number,row_version,lifecycle_state,validation_state,title,funder_name,quality_score,quality_bucket,content_digest,normalization_version,quality_rule_version,current_schema_version) VALUES($1,$2,1,1,'ACTIVE','PENDING_REVIEW','Hostile SQL fixture',NULL,NULL,NULL,$3,'opportunity-normalization-v2','opportunity-quality-v2.0',2)",[opportunityId,revisionId,'a'.repeat(64)]);
    await client.query("INSERT INTO opportunity_catalog.revision(revision_id,opportunity_id,revision_number,row_version,snapshot,normalized_projection,quality_projection,content_digest) VALUES($1,$2,1,1,$3,'{}','{}',$4)",[revisionId,opportunityId,snapshot,'a'.repeat(64)]);
    try{if(invalid==='currency'){const a=snapshot.financing.allocations.value[0];await client.query('INSERT INTO opportunity_catalog.revision_allocation_v2(opportunity_id,revision_id,allocation_key,payload,amount_canonical,currency_state,currency_code) VALUES($1,$2,$3,$4,$5,$6,$7)',[opportunityId,revisionId,a.key,a,a.money.amount,'PRESENT',null]);}
     else await client.query('INSERT INTO opportunity_catalog.revision_deadline_v2(opportunity_id,revision_id,ordinal,payload) VALUES($1,$2,0,$3)',[opportunityId,revisionId,snapshot.schedule.deadlines.value[0]]);
    }catch(error){failure=error;}
    await client.query('ROLLBACK');
   }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
   assert.equal(failure?.code,'23514',invalid+' must fail its SQL CHECK after matching its snapshot');
  }
 });
 await check('S6_AUTHORITY_APPROVAL_AND_AUDIT_FAILURE_ROLL_BACK_ALL_WRITES',async()=>{
  const changed=structuredClone(extreme);changed.description.summary.value='Synthetic rollback change';
  const value=await approved(input(changed,records.synthetic));const counts=async()=>(await pool.query('SELECT (SELECT count(*) FROM opportunity_catalog.revision)::int AS revisions,(SELECT count(*) FROM opportunity_catalog.source_observation_v2)::int AS observations,(SELECT count(*) FROM opportunity_catalog.accepted_receipt_v2)::int AS receipts,(SELECT count(*) FROM s6_evidence.persistence_audit)::int AS audits')).rows[0];
  const before=await counts();authority=false;await assert.rejects(repo.accept(value,{actor}),{code:'OPPORTUNITY_V2_AUTHORITY_DENIED'});authority=true;
  approval=false;await assert.rejects(repo.accept(value,{actor}),{code:'OPPORTUNITY_V2_APPROVAL_REQUIRED'});approval=true;
  failAudit=true;await assert.rejects(repo.accept(value,{actor}),{code:'OPPORTUNITY_V2_PERSISTENCE_UNAVAILABLE'});failAudit=false;
  revokeAfterAudit=true;await assert.rejects(repo.accept(value,{actor}),{code:'OPPORTUNITY_V2_AUTHORITY_DENIED'});revokeAfterAudit=false;authority=true;
  assert.deepEqual(await counts(),before);
 });
 await check('S6_STALE_APPROVAL_AND_CONCURRENT_CAS_KEEP_ONE_REVISION',async()=>{
  const left=structuredClone(extreme),right=structuredClone(extreme);left.description.summary.value='Concurrent left';right.description.summary.value='Concurrent right';
  const a=await approved(input(left,records.synthetic)),b=await approved(input(right,records.synthetic));
  const results=await Promise.allSettled([repo.accept(a,{actor}),repo.accept(b,{actor})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'OPPORTUNITY_V2_STALE_REVISION');
  records.synthetic=results.find(r=>r.status==='fulfilled').value;
  await assert.rejects(repo.accept({...a,requestId:randomUUID(),snapshot:right},{actor}),error=>['OPPORTUNITY_V2_STALE_REVISION','OPPORTUNITY_V2_APPROVAL_STALE'].includes(error.code));
 });
 await check('S6_EXISTING_EDITORIAL_CORRECTIONS_BLOCK_REPLACEMENT_WITHOUT_HISTORY_LOSS',async()=>{
  const corrections={title:{value:'Protected editorial title',kind:'KEEP_ACCEPTED'}};
  await pool.query('UPDATE opportunity_catalog.funding_identity SET corrections=$1 WHERE external_identifier=$2',[corrections,'CASCADE:11145']);
  const state=async()=>(await pool.query("SELECT o.opportunity_id,o.current_revision_id,o.row_version::text,r.snapshot,r.content_digest,f.corrections,(SELECT count(*)::int FROM opportunity_catalog.revision WHERE opportunity_id=o.opportunity_id) AS revisions FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id JOIN opportunity_catalog.funding_identity f ON f.opportunity_id=o.opportunity_id WHERE f.external_identifier='CASCADE:11145'")).rows[0];
  const before=await state(),changed=structuredClone(eu);changed.description.summary.value='New provider summary after editorial correction';
  const value=input(changed,records.eu),preview=await repo.preview(value,{actor});assert.equal(preview.items[0].action,'BLOCKED');assert.ok(preview.items[0].reasonCodes.includes('EDITORIAL_CORRECTIONS_REQUIRE_REVIEW'));
  approvals.add(preview.previewDigest);
  await assert.rejects(repo.accept({...value,approvalDigest:preview.previewDigest},{actor}),{code:'OPPORTUNITY_V2_RECONCILIATION_BLOCKED'});
  assert.deepEqual(await state(),before);assert.deepEqual(before.corrections,corrections);assert.equal(before.opportunity_id,legacy.opportunityId);assert.deepEqual(before.snapshot,eu);
 });
 await check('S6_HISTORY_IMMUTABILITY_READER_RESTRICTION_AND_V1_PRESERVATION',async()=>{
  for(const table of ['revision','source_identity_v2','source_observation_v2','revision_evidence_v2','revision_allocation_v2','revision_financial_detail_v2','revision_concept_v2','revision_allocation_concept_v2','revision_deadline_v2','accepted_receipt_v2'])assert.equal(await sqlRejected(pool,'TRUNCATE opportunity_catalog.'+table+' CASCADE',[],'c4g_opportunity_central_owner'),'P0001');
  assert.equal(await sqlRejected(pool,'SELECT * FROM opportunity_catalog.source_observation_v2',[],'c4g_catalog_reader'),'42501');
  assert.equal(await sqlRejected(pool,'SELECT * FROM opportunity_catalog.accepted_receipt_v2',[],'c4g_catalog_reader'),'42501');
  assert.equal(await sqlRejected(pool,'UPDATE opportunity_catalog.revision SET snapshot=snapshot WHERE revision_id=$1',[legacy.revisionId],'c4g_opportunity_central_owner'),'P0001');
  assert.deepEqual((await pool.query('SELECT snapshot,normalized_projection,quality_projection,content_digest,revision_number,row_version,created_at::text FROM opportunity_catalog.revision WHERE revision_id=$1',[legacy.revisionId])).rows[0],baseline);
  const client=await pool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE c4g_catalog_reader');assert.equal((await client.query('SELECT amount_canonical FROM opportunity_catalog.revision_allocation_v2 WHERE revision_id=$1',[records.eu.revisionId])).rows[0].amount_canonical,'120000');await client.query('ROLLBACK');}finally{client.release();}
 });
 report.persistence={normativeAccepted:191,blockedDocumentConflict:1,ptPlanRows:177,legacyIdentityPreserved:true,historicalSnapshotPreserved:true,editorialCorrectionsPreserved:true,decimalPrecision:'NUMERIC(32,8)',authorization:'Synthetic explicit central authority/approval ports; transactional audit fixture, not OIDC or production membership attestation',historicalResolutions:'Preview/domain regression only; real funding_resolution rows were not seeded in this persistence proof'};
 return {records,legacy,historySnapshot,actor,repo,approvals};
}
module.exports={persistenceProof};
