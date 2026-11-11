'use strict';
// Called only by the explicitly isolated EU writer gate. All modified source
// responses below are declared fixtures; they are not new official assertions.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {head,runCycle}=require('./eu-writer-fixture.cjs');
const root=path.resolve(__dirname,'../../..');
const specimen=JSON.parse(fs.readFileSync(path.join(root,'context/references/opportunity-v2/evidence/eu-11145.json'),'utf8'));
const FAMILY=Object.freeze({CORDIS:{id:'9911161',programme:'43108390'},ERASMUS:{id:'9911162',programme:'43353764'}});

function fixtureSources(){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  assert.equal(new URL(url).origin,'https://api.tech.ec.europa.eu');assert.equal(options.method,'POST');
  const query=await options.body.get('query').text(),parsed=JSON.parse(query);let id=null;
  const visit=value=>{if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){if(key==='callccm2Id'&&!Array.isArray(item))id=String(item);else visit(item);}};visit(parsed);
  const entry=Object.entries(FAMILY).find(([,value])=>id?value.id===id:query.includes(value.programme));
  assert(entry,'EXTRA_FIXTURE_QUERY_OUTSIDE_DECLARED_FAMILY');
  const [selection,config]=entry,row=structuredClone(specimen.results[0]);
  row.metadata.callccm2Id=[config.id];row.metadata.frameworkProgramme=[config.programme];row.metadata.identifier=[selection+'-ISOLATED-EXTRA'];
  row.content='Synthetic '+selection+' candidate for isolated writer proof';row.metadata.callTitle=[row.content];
  calls.push({selection,lookup:id!==null,externalIdentifier:'CASCADE:'+config.id});
  return new Response(JSON.stringify({...specimen,results:[row],totalResults:1,pageNumber:1,pageSize:25}),{headers:{'content-type':'application/json'}});
 };
 const eu=require('../../../backend/src/fundingTenders/source').createSource({enrichmentEnabled:true,canonicalV2Enabled:true,fetchImpl});
 const {SOURCES,createOfficialSource}=require('../../../backend/src/fundingTenders/officialSources');
 const fixtures=path.join(root,'backend/test/fixtures/official-programmes'),excel=fs.readFileSync(path.join(fixtures,'interreg.xlsx'));
 const calendar=JSON.parse(fs.readFileSync(path.join(fixtures,'calendar.json'),'utf8')),open=JSON.parse(fs.readFileSync(path.join(fixtures,'open.json'),'utf8'));
 const officialFetch=async url=>{
  assert([SOURCES.INTERREG_EUROPE.url,SOURCES.POCTEP.url,SOURCES.POCTEP.details].includes(url));
  return new Response(url===SOURCES.INTERREG_EUROPE.url?excel:JSON.stringify(url===SOURCES.POCTEP.url?calendar:open),{headers:{'content-type':url.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/json'}});
 };
 // The legacy path is tested with source fixtures and their declared as-of
 // dates so Interreg's historical rows actually reach the writer.
 const interreg=createOfficialSource({fetchImpl:officialFetch,clock:()=>Date.parse('2022-04-10T12:00:00.000Z')});
 const poctep=createOfficialSource({fetchImpl:officialFetch,clock:()=>Date.parse('2026-10-18T12:00:00.000Z')});
 return {calls,source:{lookup:input=>eu.lookup(input),collect:input=>input.source==='INTERREG_EUROPE'?interreg.collect(input):input.source==='POCTEP'?poctep.collect(input):eu.collect(input)}};
}

async function rollbackProbe(pool,work){const client=await pool.connect();try{await client.query('BEGIN');return await work(client);}finally{await client.query('ROLLBACK');client.release();}}
async function executionNegatives({central,row,capability,fixture,report}){
 const authority=require('../../../backend/src/opportunities/v2/euWriterAuthority').createEuWriterAuthorityV2(capability);
 const execution={runId:row.run_id,runFence:Number(row.fence),sourceFence:row.eu_source_fence,executionId:row.execution_id,inboxFence:Number(row.inbox_fence),workerId:row.claim_owner,consumer:'funding-central-v1'};
 const before={assignment:(await central.query('SELECT * FROM public.platform_admin_assignment WHERE id=$1',[fixture.actor.assignmentId])).rows,
  metadata:(await central.query('SELECT corrections FROM opportunity_catalog.funding_identity WHERE opportunity_id=$1',[fixture.legacy.opportunityId])).rows,
  head:await head(central,fixture.legacy.opportunityId)};
 await rollbackProbe(central,async client=>{
  assert.equal((await authority.assertExecution(client,execution)).actor.type,'SERVICE');
  await client.query("UPDATE public.platform_admin_assignment SET status='REVOKED' WHERE id=$1",[fixture.actor.assignmentId]);
  await assert.rejects(authority.assertExecution(client,execution),{code:'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'});
 });
 for(const mutation of [{workerId:'another-isolated-worker'},{inboxFence:execution.inboxFence+1},{sourceFence:execution.sourceFence+1},{executionId:randomUUID()}]){
  await rollbackProbe(central,client=>assert.rejects(authority.assertExecution(client,{...execution,...mutation}),{code:'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'}));
 }
 await rollbackProbe(central,async client=>{
  await authority.assertExecution(client,execution);
  await assert.rejects(client.query("UPDATE opportunity_catalog.funding_identity SET corrections=jsonb_build_object('title','Forbidden correction from service execution') WHERE opportunity_id=$1",[fixture.legacy.opportunityId]),error=>error.message==='OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED');
 });
 assert.deepEqual((await central.query('SELECT * FROM public.platform_admin_assignment WHERE id=$1',[fixture.actor.assignmentId])).rows,before.assignment);
 assert.deepEqual((await central.query('SELECT corrections FROM opportunity_catalog.funding_identity WHERE opportunity_id=$1',[fixture.legacy.opportunityId])).rows,before.metadata);
 assert.deepEqual(await head(central,fixture.legacy.opportunityId),before.head);
 report.extraAuthority={realLiveInboxAndRun:true,administratorRevocationDenied:true,revocationTransactionRolledBack:true,wrongWorkerDenied:true,staleInboxFenceDenied:true,staleSourceFenceDenied:true,wrongExecutionDenied:true,executionAloneCannotEditCorrections:true,
  limit:'Existing protected-v2 policy decisions are unit-tested; this SQL proof does not fabricate pre-existing protected v2 metadata.'};
}

async function extraProof({central,fixture,report,check,repository,worker,queuePort,control,context,publish}){
 const fixtureSource=fixtureSources(),extraWorker=require('../../../backend/src/fundingTenders/worker').createFundingWorker({pool:central,queue:{...queuePort,shutdown:async()=>{}},source:fixtureSource.source,repository});
 const healthy=async()=>{await worker.runOnce();publish();};
 try{
  await check('EU_WRITER_CORDIS_ERASMUS_REAL_CANONICAL_QUEUE_AND_REVIEW',async()=>{
   const results=[];
   for(const selection of Object.keys(FAMILY)){
    const cycle=await runCycle({central,repository,worker:extraWorker,actor:fixture.actor,source:selection});
    assert(cycle.runs.every(run=>run.status==='SUCCESS'&&run.source_code===selection&&run.eu_writer_mode==='CANONICAL_V2'));
    assert(cycle.runs.some(run=>run.review_count===1));
    const archived=(await central.query('SELECT c.source_selection,c.canonical_snapshot,d.decision,d.reason_codes FROM opportunity_catalog.funding_candidate_v2 c JOIN opportunity_catalog.eu_writer_decision_v2 d USING(run_id,external_identifier) JOIN opportunity_catalog.funding_batch b USING(run_id) WHERE b.cycle_id=$1',[cycle.run.runId])).rows;
    assert.equal(archived.length,1);assert.equal(archived[0].source_selection,selection);assert.equal(archived[0].decision,'REVIEW');assert(archived[0].reason_codes.includes('NEW_IDENTITY_REQUIRES_REVIEW'));
    assert(archived[0].canonical_snapshot.sourceRecords.every(record=>record.namespace==='EU_FUNDING_TENDERS'));
    assert.equal((await central.query('SELECT count(*)::int AS n FROM opportunity_catalog.source_identity_v2 WHERE external_identifier=$1',['CASCADE:'+FAMILY[selection].id])).rows[0].n,0);
    results.push({selection,runId:cycle.run.runId,canonicalArchives:1,decision:'REVIEW',identityCreated:false});
   }
   report.extraFamilies={syntheticSourceVariants:true,realQueueAndAuthorityAndArchive:true,results,lookupCalls:fixtureSource.calls.filter(call=>call.lookup)};
  });
  await check('EU_WRITER_PAUSED_FAMILY_AND_INTERREG_POCTEP_LEGACY_COMPATIBILITY',async()=>{
   await healthy();let state=await control.status(context);
   state=await control.suspend({requestId:randomUUID(),expectedFence:state.fence},context);
   state=await control.acknowledgeQuiesced({requestId:randomUUID(),expectedFence:state.fence},context);assert.equal(state.state,'QUIESCED');
   const runCount=(await central.query('SELECT count(*)::int AS n FROM opportunity_catalog.funding_run')).rows[0].n;
   for(const selection of ['EU_FUNDING_TENDERS','CORDIS','ERASMUS'])await assert.rejects(repository.enqueue(fixture.actor.id,randomUUID(),selection),{code:'OPPORTUNITY_V2_EU_SUSPENDED'});
   assert.equal((await central.query('SELECT count(*)::int AS n FROM opportunity_catalog.funding_run')).rows[0].n,runCount);
   const euHead=await head(central,fixture.legacy.opportunityId),official=[];
   for(const selection of ['INTERREG_EUROPE','POCTEP']){
    const cycle=await runCycle({central,repository,worker:extraWorker,actor:fixture.actor,source:selection});
    assert(cycle.runs.every(run=>run.status==='SUCCESS'&&run.eu_writer_mode==='LEGACY_V1'));
    assert(cycle.runs.some(run=>run.created_count>0));
    const rows=(await central.query('SELECT r.snapshot FROM opportunity_catalog.funding_run_item i JOIN opportunity_catalog.opportunity o USING(opportunity_id) JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id WHERE i.run_id=$1',[cycle.run.runId])).rows;
    assert(rows.length>0&&rows.every(row=>row.snapshot.schemaVersion===1));
    official.push({selection,runId:cycle.run.runId,created:cycle.runs.reduce((sum,run)=>sum+run.created_count,0),schemaVersion:1});
   }
   assert.deepEqual(await head(central,fixture.legacy.opportunityId),euHead);
   await healthy();const resumed=await control.resume({requestId:randomUUID(),expectedFence:state.fence},context);assert.equal(resumed.state,'ACTIVE');
   report.extraOfficial={euFamilyPaused:true,allThreeSelectionsRefused:true,officialSourcesWorkedWhileEuPaused:true,legacyWriterPreserved:true,fixtures:'Existing public-source fixtures; Interreg as-of 2022-04-10, POCTEP as-of 2026-10-18',results:official};
  });
 }finally{await extraWorker.shutdown();}
}
module.exports={extraProof,executionNegatives,fixtureSources};
