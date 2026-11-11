'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,randomBytes}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {transport,queue,head,runCycle}=require('./eu-writer-fixture.cjs');
const {transaction,policyVersion,recentMfaRequirement}=require('./executor-11145-fixture.cjs');
async function sqlRefused(pool,sql,values=[],role=null,beforeQuery=null){
 const c=await pool.connect();let error;
 try{await c.query('BEGIN');if(role)await c.query('SET LOCAL ROLE '+role);if(beforeQuery)await beforeQuery(c);try{await c.query(sql,values);await c.query('SET CONSTRAINTS ALL IMMEDIATE');}catch(e){error=e;}await c.query('ROLLBACK');}finally{c.release();}
 assert(error,'SQL_EFFECT_MUST_BE_REFUSED');return {code:error.code,message:error.message};
}
async function workerProof({central,tenant,connection,fixture,report,check,outputDirectory,before}){
 let worker,http,helperPool,queuePort;
 const capability=require('../../../backend/src/fundingTenders/euWriter').euWriterConfiguration();
 const fixtureTransport=transport(),installationId=randomUUID(),heartbeatFile=path.join(outputDirectory,'synthetic-worker-heartbeat.json');
 const publish=()=>fs.writeFileSync(heartbeatFile,JSON.stringify({installationId,at:Date.now(),mode:'PROCESSING',...worker.health()}));
 const workerHealth=async()=>require('../../../backend/src/fundingTenders/workerHealth').workerHealth(JSON.parse(fs.readFileSync(heartbeatFile,'utf8')),{installationId});
 const fault={armed:false,hits:0,code:'ISOLATED_WRITER_AFTER_EFFECT_FAILURE'};
 const observedPool={query:central.query.bind(central),async connect(){const client=await central.connect();return {async query(sql,...args){if(fault.armed&&/INSERT INTO opportunity_catalog\.eu_writer_decision_v2/.test(sql)){fault.armed=false;fault.hits++;throw Object.assign(new Error('ISOLATED_WRITER_AFTER_EFFECT_FAILURE'),{code:fault.code});}try{return await client.query(sql,...args);}catch(error){report.lastWorkerDatabaseError={code:error.code,message:error.message,where:error.where,sql:String(sql).slice(0,250)};throw error;}},release:client.release.bind(client)};}};
 try{
  const source=require('../../../backend/src/fundingTenders/source').createSource({enrichmentEnabled:true,canonicalV2Enabled:true,fetchImpl:fixtureTransport.fetchImpl});
  const repository=require('../../../backend/src/fundingTenders/repository').createFundingRepository({pool:observedPool,euSourceControlEnabled:true,coverageEnabled:true,startCoverage:true,refreshEnabled:true,resolutionEnabled:true,enrichmentEnabled:true,euWriterV2:capability});
  queuePort=await queue(central,connection,report);
  const observedRepository=new Proxy(repository,{get(target,key){const value=target[key];
   if(typeof value!=='function'||!['claim','stage','pending','apply','finish'].includes(key))return value;
   return async(...args)=>{try{return await value(...args);}catch(error){report.lastWorkerError={phase:key,code:error.code||null,message:String(error.message).slice(0,300)};throw error;}};
  }});
  worker=require('../../../backend/src/fundingTenders/worker').createFundingWorker({pool:central,queue:queuePort,source,repository:observedRepository});
  await worker.runOnce();publish();
  fixture.actor.sessionId='eu-writer-session-'+randomUUID();
  http=await require('./eu-writer-http.cjs').httpRuntime({central,connection,fixture,report,euWriterCapability:capability,workerHealth});
  const context={actor:{type:'HUMAN',id:fixture.actor.id},sessionId:fixture.actor.sessionId};
  const control=require('../../../backend/src/opportunities/v2/euSourceControl').createEuSourceControlV2({pool:central,policyVersion,recentMfaRequirement,euWriterCapability:capability,workerHealth});
  await check('EU_WRITER_CAPABILITY_HEARTBEAT_CONFIGURATION_AND_RESUME',async()=>{
   assert.equal((await workerHealth()).euWriterSupported,true);
   const stale=JSON.parse(fs.readFileSync(heartbeatFile,'utf8'));stale.at-=20000;fs.writeFileSync(heartbeatFile,JSON.stringify(stale));
   await assert.rejects(control.configureWriter({requestId:randomUUID(),expectedFence:3},context),{code:'OPPORTUNITY_V2_EU_WRITER_UNAVAILABLE'});publish();
   const controlled=await require('./eu-writer-controlled-cycle-proof.cjs').controlledCycleProof({central,fixture,report,check,http,worker,publish});
   assert.equal(controlled.finalSource.writerMode,'CANONICAL_V2');publish();
   const resumed=await control.resume({requestId:randomUUID(),expectedFence:controlled.finalSource.fence},context);assert.equal(resumed.state,'ACTIVE');
   report.capability={...capability,heartbeatSerialized:true,staleHeartbeatDenied:true,sourceFence:resumed.fence};
  });
  await check('EU_WRITER_PHYSICAL_HELPER_ROLE_AND_NO_GUC_OR_LEGACY_BYPASS',async()=>{
   const password=randomBytes(32).toString('hex');await central.query(`CREATE ROLE eu_writer_proof_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${password}'`);
   await central.query('GRANT CONNECT ON DATABASE registered_central TO eu_writer_proof_login');
   await central.query('GRANT c4g_eu_writer_runtime TO eu_writer_proof_login WITH INHERIT FALSE,SET TRUE');
   helperPool=new Pool({...connection,database:'registered_central',user:'eu_writer_proof_login',password});
   const fn="SELECT opportunity_catalog.assert_eu_writer_permit_v2($1::uuid)",id=randomUUID();
   assert.equal((await sqlRefused(helperPool,fn,[id],'c4g_eu_writer_runtime')).message,'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED');
   for(const role of ['c4g_opportunity_central_runtime','c4g_catalog_reader'])assert.equal((await sqlRefused(central,fn,[id],role)).code,'42501');
   const beforeHead=await head(central,fixture.legacy.opportunityId);
   const denial=await sqlRefused(central,"UPDATE opportunity_catalog.opportunity SET title='Forbidden downgrade',current_schema_version=1 WHERE opportunity_id=$1",[fixture.legacy.opportunityId],null,c=>c.query("SELECT set_config('app.eu_writer_permit',$1,true)",[id]));assert.match(denial.message,/EU_WRITER/);
   assert.deepEqual(await head(central,fixture.legacy.opportunityId),beforeHead);
   const legacy=require('../../../backend/src/fundingTenders/repository').createFundingRepository({pool:central,euSourceControlEnabled:true});
   await assert.rejects(legacy.enqueue(fixture.actor.id,randomUUID(),'EU_FUNDING_TENDERS'));
   report.privileges={physicalHelperLogin:true,helperRoleOnly:true,centralRuntimeCannotMintPermit:true,catalogReaderCannotMintPermit:true,workerDatabaseConnection:'isolated owner; concrete helper executes under SET LOCAL ROLE c4g_eu_writer_runtime',leastPrivilegeWorkerEndToEnd:false};
  });
  const initial=await head(central,fixture.legacy.opportunityId);
  let unchanged,changed;
  await check('EU_WRITER_REAL_QUEUE_ARCHIVE_UNCHANGED_PRESERVES_HEAD',async()=>{
   unchanged=await runCycle({central,repository,worker,actor:fixture.actor});publish();
   assert(unchanged.runs.every(row=>row.status==='SUCCESS'),JSON.stringify(unchanged.runs.map(({status,error_code})=>({status,error_code}))));
   const after=await head(central,fixture.legacy.opportunityId);assert.equal(after.current_revision_id,initial.current_revision_id);assert.equal(after.row_version,initial.row_version);
   assert(unchanged.runs.some(row=>row.unchanged_count>0));
   const archives=(await central.query('SELECT c.run_id,c.external_identifier,c.content_digest FROM opportunity_catalog.funding_candidate_v2 c JOIN opportunity_catalog.funding_batch b USING(run_id) WHERE b.cycle_id=$1',[unchanged.run.runId])).rows;assert.equal(archives.filter(row=>row.external_identifier==='CASCADE:11145').length,1);
   report.unchanged={runId:unchanged.run.runId,revisionId:after.current_revision_id,rowVersion:after.row_version,archives:archives.length};
   const legacy=await head(central,fixture.legacyReview.opportunityId);assert.equal(legacy.current_revision_id,fixture.legacyReview.revisionId);assert.equal(legacy.current_schema_version,1);
   assert(unchanged.runs.every(row=>row.review_count===0),'LEGACY_V1_MUST_NOT_ENTER_AUTOMATIC_REFRESH');
  });
  await check('EU_WRITER_SAFE_CHANGE_ONE_REVISION_AND_NORMALIZED_SQL',async()=>{
   fixtureTransport.select('CHANGED');changed=await runCycle({central,repository,worker,actor:fixture.actor});publish();
   assert(changed.runs.every(row=>row.status==='SUCCESS'));
   const after=await head(central,fixture.legacy.opportunityId);assert.equal(Number(after.row_version),Number(initial.row_version)+1);assert.equal(after.current_schema_version,2);
   const money=(await central.query('SELECT amount_canonical::text,currency_state,currency_code FROM opportunity_catalog.revision_allocation_v2 WHERE revision_id=$1',[after.current_revision_id])).rows;assert.equal(money.length,1);assert.equal(Number(money[0].amount_canonical),120000);assert.equal(money[0].currency_state,'NOT_FOUND');assert.equal(money[0].currency_code,null);
   assert.equal((await central.query('SELECT count(*)::int AS n FROM opportunity_catalog.revision_deadline_v2 WHERE revision_id=$1',[after.current_revision_id])).rows[0].n,7);
   report.changed={runId:changed.run.runId,revisionId:after.current_revision_id,rowVersion:after.row_version,amount:money[0],deadlines:7};
  });
  await check('EU_WRITER_LOSS_AND_NEW_IDENTITIES_REQUIRE_DURABLE_REVIEW',async()=>{
   const previous=await head(central,fixture.legacy.opportunityId);
   fixtureTransport.select('LOSS');const loss=await runCycle({central,repository,worker,actor:fixture.actor});publish();
   assert(loss.runs.some(row=>row.review_count>0));assert.deepEqual(await head(central,fixture.legacy.opportunityId),previous);
   fixtureTransport.select('NEW');const fresh=await runCycle({central,repository,worker,actor:fixture.actor});publish();
   assert(fresh.runs.some(row=>row.review_count>0));
   assert.equal((await central.query("SELECT count(*)::int AS n FROM opportunity_catalog.funding_identity WHERE external_identifier='CASCADE:9911145'")).rows[0].n,0);
   const decisions=(await central.query("SELECT decision,reason_codes,external_identifier FROM opportunity_catalog.eu_writer_decision_v2 WHERE decision='REVIEW' ORDER BY external_identifier")).rows;assert(decisions.length>=2);
   const response=await http.request(fixture.actor,'GET','/eu-writer/reviews');assert.equal(response.status,200,JSON.stringify(response));
   report.reviews={decisions,httpStatus:response.status,response:response.data,p3CompleteLookup:fixtureTransport.calls.some(row=>row.externalIdentifier==='CASCADE:9911145')};
  });
  await check('EU_WRITER_EXACT_TRANSPORT_REDELIVERY_NO_DUPLICATE_EFFECTS',async()=>{
   const counts=async()=>({head:await head(central,fixture.legacy.opportunityId),decisions:(await central.query('SELECT * FROM opportunity_catalog.eu_writer_decision_v2 ORDER BY run_id,external_identifier')).rows,audit:Number((await central.query('SELECT count(*) AS n FROM audit.event')).rows[0].n)});
   const original=await counts();
   const delivery=(await central.query("SELECT o.envelope,o.envelope_digest FROM async_exec.outbox o JOIN opportunity_catalog.funding_batch b ON b.run_id::text=o.envelope#>>'{payload,runId}' WHERE b.cycle_id=$1 AND b.input_cursor->>'externalIdentifier'='CASCADE:11145' ORDER BY o.attempt DESC LIMIT 1",[changed.run.runId])).rows[0];assert(delivery);
   await queuePort.publish({type:'funding_tenders.refresh',envelope:delivery.envelope,envelopeDigest:delivery.envelope_digest});
   assert.deepEqual(await worker.runOnce(),['DUPLICATE']);publish();assert.deepEqual(await counts(),original);
   report.redelivery={sameEnvelope:true,inboxDuplicate:true,revisionAndDecisionsAndAuditUnchanged:true};
  });
  await check('EU_WRITER_FAILURE_PRESERVES_CATALOG_AND_HISTORY',async()=>{
   const previous=await head(central,fixture.legacy.opportunityId);fixtureTransport.select('ERROR');
   const failed=await runCycle({central,repository,worker,actor:fixture.actor});publish();assert(failed.runs.some(row=>row.status==='ERROR'));
   assert.deepEqual(await head(central,fixture.legacy.opportunityId),previous);
   assert.deepEqual((await central.query('SELECT snapshot FROM opportunity_catalog.revision WHERE revision_id=$1',[fixture.legacy.revisionId])).rows[0].snapshot,fixture.legacy.snapshot);
  });
  await check('EU_WRITER_FAILURE_AFTER_EFFECT_ROLLS_BACK_HEAD_RECEIPT_AND_AUDIT',async()=>{
   const effects=async()=>({head:await head(central,fixture.legacy.opportunityId),receipts:(await central.query('SELECT * FROM opportunity_catalog.accepted_receipt_v2 ORDER BY request_id')).rows,revisionEvents:(await central.query("SELECT event_hash FROM audit.event WHERE event_code='OPPORTUNITY_REVISION_CREATED' ORDER BY sequence")).rows});
   const previous=await effects();fixtureTransport.select('ROLLBACK');fault.armed=true;
   const result=await runCycle({central,repository,worker,actor:fixture.actor});publish();assert.equal(fault.hits,1);assert(result.runs.some(row=>row.status==='ERROR'));
   assert.deepEqual(await effects(),previous);report.rollback={fault:'after accepted effects, before durable decision',headReceiptAuditAtomic:true};
   fixtureTransport.select('UNCHANGED');
  });
  await check('EU_WRITER_PAUSE_DRAIN_RESUME_FENCES_THE_INFLIGHT_HANDLER',async()=>{
   let entered,release;const observed=new Promise(resolve=>{entered=resolve;}),blocked=new Promise(resolve=>{release=resolve;});
   fixtureTransport.select('UNCHANGED');fixtureTransport.pauseNextLookup(async()=>{entered();await blocked;});
   const job=await repository.enqueue(fixture.actor.id,randomUUID(),'EU_FUNDING_TENDERS');
   await worker.runOnce();const flight=worker.runOnce().then(value=>({value}),error=>({error}));
   try{
    await Promise.race([observed,new Promise((_,reject)=>setTimeout(()=>reject(Error('LOOKUP_BARRIER_NOT_REACHED')),10000))]);
    const row=(await central.query("SELECT r.*,i.execution_id,i.fence AS inbox_fence,i.claim_owner FROM opportunity_catalog.funding_run r JOIN async_exec.inbox i ON i.idempotency_key=r.run_id::text AND i.consumer='funding-central-v1' WHERE r.status='RUNNING' AND i.state='PROCESSING'")).rows[0];assert(row);
    await require('./eu-writer-extra-proof.cjs').executionNegatives({central,row,capability,fixture,report});
    const authority=require('../../../backend/src/opportunities/v2/euWriterAuthority').createEuWriterAuthorityV2(capability);
    await transaction(central,null,null,async c=>{
     await authority.assertExecution(c,{runId:row.run_id,runFence:Number(row.fence),sourceFence:row.eu_source_fence,executionId:row.execution_id,inboxFence:Number(row.inbox_fence),workerId:row.claim_owner,consumer:'funding-central-v1'});
     await c.query("UPDATE opportunity_catalog.funding_run SET lease_until=clock_timestamp()+interval '2 seconds' WHERE run_id=$1",[row.run_id]);
     await c.query("UPDATE async_exec.inbox SET lease_until=clock_timestamp()+interval '2 seconds' WHERE execution_id=$1 AND consumer='funding-central-v1'",[row.execution_id]);
    });
    publish();const state=await control.status(context),paused=await control.suspend({requestId:randomUUID(),expectedFence:state.fence},context);
    await assert.rejects(control.acknowledgeQuiesced({requestId:randomUUID(),expectedFence:paused.fence},context),{code:'OPPORTUNITY_V2_EU_NOT_QUIESCENT'});
    await new Promise(resolve=>setTimeout(resolve,2150));const quiet=await control.acknowledgeQuiesced({requestId:randomUUID(),expectedFence:paused.fence},context);publish();
    const resumed=await control.resume({requestId:randomUUID(),expectedFence:quiet.fence},context);
    const durable=async()=>({run:(await central.query('SELECT * FROM opportunity_catalog.funding_run WHERE run_id=$1',[row.run_id])).rows,inbox:(await central.query('SELECT * FROM async_exec.inbox WHERE execution_id=$1',[row.execution_id])).rows,outbox:(await central.query("SELECT * FROM async_exec.outbox WHERE envelope#>>'{payload,runId}'=$1 ORDER BY outbox_id",[row.run_id])).rows,head:await head(central,fixture.legacy.opportunityId)});
    const prior=await durable();release();const result=await flight;assert(result.error);assert(['FUNDING_FENCE_STALE','OPPORTUNITY_V2_SOURCE_FENCE_STALE','OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'].includes(result.error.code),result.error.code);assert.deepEqual(await durable(),prior);
    for(let step=0;step<8;step++){await worker.runOnce();if(Number((await central.query("SELECT count(*) AS n FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING')")).rows[0].n)===0)break;}
    assert.equal((await central.query('SELECT status FROM opportunity_catalog.funding_run WHERE run_id=$1',[row.run_id])).rows[0].status,'SUCCESS');publish();
    report.inflight={originalCycle:job.runId,oldFence:row.eu_source_fence,newFence:resumed.fence,staleError:result.error.code,staleHandlerNoEffects:true,originalDurableDeliveryRecovered:true,fixtureLeaseShortenedViaValidExecution:true};
   }finally{release?.();await flight;}
  });
  await check('EU_WRITER_TRANSIENT_RETRY_PRESERVES_LINEAGE_AND_ORIGINAL_DEADLINE',async()=>{
   fixtureTransport.select('ROLLBACK');fault.armed=true;fault.code='40001';const previous=await head(central,fixture.legacy.opportunityId);
   const job=await repository.enqueue(fixture.actor.id,randomUUID(),'EU_FUNDING_TENDERS');await worker.runOnce();assert.deepEqual(await worker.runOnce(),['RETRYABLE']);
   assert.deepEqual(await head(central,fixture.legacy.opportunityId),previous);
   const rows=(await central.query("SELECT o.* FROM async_exec.outbox o JOIN opportunity_catalog.funding_batch b ON b.run_id::text=o.envelope#>>'{payload,runId}' WHERE b.cycle_id=$1 AND b.input_cursor->>'externalIdentifier'='CASCADE:11145' ORDER BY o.attempt",[job.runId])).rows;
   assert.equal(rows.length,2);const [original,retry]=rows;assert.equal(retry.attempt,2);assert.equal(retry.delivery_kind,'RETRY');assert.equal(retry.content_digest,original.content_digest);assert.equal(retry.root_execution_id,original.root_execution_id);assert.equal(retry.envelope.deadlineAt,original.envelope.deadlineAt);assert.equal(retry.envelope.idempotencyKey,original.envelope.idempotencyKey);assert.notEqual(retry.envelope.executionId,original.envelope.executionId);
   const delay=Math.max(0,new Date(retry.available_at).getTime()-Date.now())+25;assert(delay<10000);await new Promise(resolve=>setTimeout(resolve,delay));
   for(let step=0;step<8;step++){await worker.runOnce();if(Number((await central.query("SELECT count(*) AS n FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING')")).rows[0].n)===0)break;}
   const run=(await central.query('SELECT status,fence FROM opportunity_catalog.funding_run WHERE run_id=$1',[original.envelope.payload.runId])).rows[0];assert.equal(run.status,'SUCCESS');assert(Number(run.fence)>=2);
   assert.equal(Number((await head(central,fixture.legacy.opportunityId)).row_version),Number(previous.row_version)+1);publish();
   report.retry={originalDeadlinePreserved:true,rootExecutionPreserved:true,newExecution:true,sameContent:true,freshRunFence:Number(run.fence)};fault.code='ISOLATED_WRITER_AFTER_EFFECT_FAILURE';fixtureTransport.select('UNCHANGED');
  });
  await require('./eu-writer-extra-proof.cjs').extraProof({central,tenant,connection,fixture,report,check,repository,worker,queuePort,control,context,fixtureTransport,publish,capability});
  await check('EU_WRITER_FINAL_QUIESCENCE_AND_AUDIT_CHAIN',async()=>{
   publish();const sourceState=await control.status(context);const paused=await control.suspend({requestId:randomUUID(),expectedFence:sourceState.fence},context);const quiesced=await control.acknowledgeQuiesced({requestId:randomUUID(),expectedFence:paused.fence},context);assert.equal(quiesced.state,'QUIESCED');
   const events=(await central.query("SELECT event_data,event_hash FROM audit.event WHERE organization_id IS NULL AND stream_id='PLATFORM:DATA' ORDER BY sequence")).rows.map(row=>({...row.event_data,eventHash:row.event_hash}));
   assert.equal(require('../../../backend/src/audit/verifier').verifyEvents(events).valid,true);
   report.audit={events:events.length,valid:true};report.finalSource={state:quiesced.state,fence:quiesced.fence,mode:quiesced.writerMode};
  });
  await check('EU_WRITER_HUMAN_APPROVED_NEW_ID_REFRESHES_WITHOUT_LEGACY_PLACEHOLDER',async()=>{
   const externalIdentifier='CASCADE:9911145',review=(await central.query("SELECT run_id FROM opportunity_catalog.eu_writer_decision_v2 WHERE external_identifier=$1 AND decision='REVIEW' ORDER BY run_id LIMIT 1",[externalIdentifier])).rows[0];assert(review);
   const composition=require('../../../backend/src/opportunities/v2/activationComposition').createOpportunityActivationV2({pool:central,policyVersion,recentMfaRequirement});
   const plan=await composition.prepare({requestId:randomUUID(),archive:{kind:'FUNDING',runId:review.run_id,externalIdentifier},expected:null},context);
   const approved=await composition.approve({requestId:randomUUID(),planId:plan.planId,planDigest:plan.planDigest},context);
   const beforeState=await control.status(context),accepted=await composition.accept({requestId:randomUUID(),planId:plan.planId,fence:approved.fence,sourceFence:beforeState.fence},context);
   assert.equal((await central.query('SELECT count(*)::int AS n FROM opportunity_catalog.funding_identity WHERE external_identifier=$1',[externalIdentifier])).rows[0].n,0);
   assert.equal((await central.query("SELECT opportunity_id FROM opportunity_catalog.source_identity_v2 WHERE source_namespace='EU_FUNDING_TENDERS' AND external_identifier=$1",[externalIdentifier])).rows[0].opportunity_id,accepted.opportunityId);
   publish();await control.resume({requestId:randomUUID(),expectedFence:beforeState.fence},context);fixtureTransport.select('UNCHANGED');
   const cycle=await repository.enqueue(fixture.actor.id,randomUUID(),'EU_FUNDING_TENDERS');
   assert.equal((await central.query('SELECT state FROM opportunity_catalog.funding_refresh_target WHERE cycle_id=$1 AND external_identifier=$2',[cycle.runId,externalIdentifier])).rows[0].state,'PENDING');
   assert.equal((await central.query('SELECT count(*)::int AS n FROM opportunity_catalog.funding_identity WHERE external_identifier=$1',[externalIdentifier])).rows[0].n,0);
   for(let step=0;step<16;step++){await worker.runOnce();if(Number((await central.query("SELECT count(*) AS n FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING')")).rows[0].n)===0)break;}
   const current=await head(central,accepted.opportunityId);assert.equal(current.current_revision_id,accepted.revisionId);assert.equal(Number(current.row_version),accepted.rowVersion);
   const result=(await central.query('SELECT i.result FROM opportunity_catalog.funding_run_item i JOIN opportunity_catalog.funding_batch b USING(run_id) WHERE b.cycle_id=$1 AND i.external_identifier=$2',[cycle.runId,externalIdentifier])).rows;assert.deepEqual(result,[{result:'UNCHANGED'}]);
   publish();const state=await control.status(context),paused=await control.suspend({requestId:randomUUID(),expectedFence:state.fence},context),quiet=await control.acknowledgeQuiesced({requestId:randomUUID(),expectedFence:paused.fence},context);
   report.identityOnly={opportunityId:accepted.opportunityId,externalIdentifier,humanApprovedFixturePlan:plan.planId,realProductionApproval:true,syntheticHumanSession:true,noLegacyIdentityBeforeRefresh:true,targetDiscoveredWithoutPlaceholder:true,unchangedAfterRefresh:true};
   report.finalSource={state:quiet.state,fence:quiet.fence,mode:quiet.writerMode};
   const events=(await central.query("SELECT event_data,event_hash FROM audit.event WHERE organization_id IS NULL AND stream_id='PLATFORM:DATA' ORDER BY sequence")).rows.map(row=>({...row.event_data,eventHash:row.event_hash}));assert.equal(require('../../../backend/src/audit/verifier').verifyEvents(events).valid,true);report.audit={events:events.length,valid:true};
  });
  const current=await head(central,fixture.legacy.opportunityId);
  await require('./executor-11145-readers.cjs').verifyReaders({central,tenant,connection,fixture,candidate:current.snapshot,accepted:{opportunityId:current.opportunity_id,revisionId:current.current_revision_id},before,report,check});
 }catch(error){report.workerFailure={code:error.code,runs:(await central.query('SELECT run_id,status,source_code,eu_writer_mode,eu_source_fence,fence,collected,canonical_v2_required,result_count,failed_count,error_code FROM opportunity_catalog.funding_run ORDER BY created_at')).rows,inboxes:(await central.query('SELECT consumer,execution_id,state,claim_owner,fence,lease_until FROM async_exec.inbox')).rows};throw error;}
 finally{await http?.close();await worker?.shutdown();if(!worker)await queuePort?.shutdown();await helperPool?.end();}
}
module.exports={workerProof,sqlRefused};
