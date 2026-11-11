'use strict';
// A real durable worker run. Only identities, HTTP session and public transport
// are fixtures. Its deadline and leases are never rewritten or clock-shifted.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {transport,queue}=require('./eu-writer-fixture.cjs');
const {policyVersion,recentMfaRequirement}=require('./executor-11145-fixture.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function expiredFixture({central,tenant,connection,report,check,workspaceRoot}){
 const actorId=report.windowApproval.receipt.actorId;
 const assignment=(await central.query("SELECT id FROM public.platform_admin_assignment WHERE global_user_id=$1 AND role_code='C4G_ADMIN' AND status='ACTIVE'",[actorId])).rows;assert.equal(assignment.length,1);
 const identity=(await tenant.query('SELECT tenant_id AS "tenantId",database_generation_id AS "databaseGenerationId" FROM c4g_system.tenant_identity')).rows[0];
 const fixture={actor:{id:actorId,assignmentId:assignment[0].id,sessionId:'eu-reconciliation-'+randomUUID()},identity};
 const capability=require('../../../backend/src/fundingTenders/euWriter').euWriterConfiguration(),fixtureTransport=transport();
 const repository=require('../../../backend/src/fundingTenders/repository').createFundingRepository({pool:central,euSourceControlEnabled:true,coverageEnabled:true,startCoverage:true,refreshEnabled:true,resolutionEnabled:true,enrichmentEnabled:true,euWriterV2:capability});
 const fault={armed:false,hits:0},httpPool={query:central.query.bind(central),async connect(){const client=await central.connect();return {async query(sql,...args){let result;try{result=await client.query(sql,...args);}catch(error){if(String(sql).includes('SELECT opportunity_catalog.reconcile_eu_expired_v1('))report.reconciliationSqlDiagnostic={code:error.code,detail:error.message,where:error.where,operation:'reconcile_eu_expired_v1',parametersExported:false,expectedRefusal:!fault.armed};throw error;}if(fault.armed&&String(sql).includes('SELECT opportunity_catalog.reconcile_eu_expired_v1(')){fault.armed=false;fault.hits++;throw Object.assign(Error('ISOLATED_AFTER_RECONCILIATION_EFFECTS'),{code:'ISOLATED_AFTER_RECONCILIATION_EFFECTS'});}return result;},release:client.release.bind(client)};}};
 let worker,http,queuePort,release,flight,row,cycle,paused,quiet,closed=false;
 try{
  queuePort=await queue(central,connection,report);
  worker=require('../../../backend/src/fundingTenders/worker').createFundingWorker({pool:central,queue:queuePort,source:require('../../../backend/src/fundingTenders/source').createSource({enrichmentEnabled:true,canonicalV2Enabled:true,fetchImpl:fixtureTransport.fetchImpl}),repository});
  await worker.runOnce();
  const workerHealth=async()=>({ready:true,...worker.health()});
  http=await require('./eu-writer-http.cjs').httpRuntime({central:httpPool,connection,fixture,report,euWriterCapability:capability,workerHealth,reconciliationWorkspaceRoot:workspaceRoot});
  const context={actor:{type:'HUMAN',id:actorId},sessionId:fixture.actor.sessionId};
  const control=require('../../../backend/src/opportunities/v2/euSourceControl').createEuSourceControlV2({pool:central,policyVersion,recentMfaRequirement,euWriterCapability:capability,workerHealth});
  await check('EU_RECONCILIATION_REAL_RUN_PAUSED_WITH_ORIGINAL_DEADLINE',async()=>{
   const initial=await control.status(context);assert.equal(initial.state,'QUIESCED');assert.equal(initial.pendingRuns,0);
   const resumed=await control.resume({requestId:randomUUID(),expectedFence:initial.fence},context);assert.equal(resumed.state,'ACTIVE');
   let entered;const barrier=new Promise(resolve=>{entered=resolve;}),blocked=new Promise(resolve=>{release=resolve;});fixtureTransport.pauseNextLookup(async()=>{entered();await blocked;});
   cycle=await repository.enqueue(actorId,randomUUID(),'EU_FUNDING_TENDERS');await worker.runOnce();flight=worker.runOnce().then(value=>({value}),error=>({error}));
   await Promise.race([barrier,new Promise((_,reject)=>setTimeout(()=>reject(Error('EU_RECONCILIATION_LOOKUP_NOT_REACHED')),15000))]);
   const rows=(await central.query("SELECT r.*,i.execution_id,i.fence AS inbox_fence,i.claim_owner FROM opportunity_catalog.funding_run r JOIN async_exec.inbox i ON i.idempotency_key=r.run_id::text AND i.consumer='funding-central-v1' WHERE r.status='RUNNING' AND i.state='PROCESSING'")).rows;assert.equal(rows.length,1);row=rows[0];
   paused=await control.suspend({requestId:randomUUID(),expectedFence:resumed.fence},context);assert.equal(paused.state,'SUSPEND_REQUESTED');
   const outbox=(await central.query("SELECT envelope,envelope_digest,content_digest,state FROM async_exec.outbox WHERE envelope#>>'{payload,runId}'=$1 ORDER BY attempt DESC LIMIT 1",[row.run_id])).rows[0];assert.equal(outbox.state,'PUBLISHED');
   report.reconciliationFixture={realWorkerRun:true,realPgBoss:true,syntheticIdentityAndSession:true,realOidcProvider:false,sourceFixture:true,cycleId:cycle.runId,runId:row.run_id,executionId:row.execution_id,sourceFence:paused.fence,deadlineAt:outbox.envelope.deadlineAt,createdAt:row.created_at,originalEnvelopeDigest:outbox.envelope_digest,originalContentDigest:outbox.content_digest,deadlineModified:false,leaseModified:false,clockModified:false};
  });
  const durable=async()=>({run:(await central.query('SELECT * FROM opportunity_catalog.funding_run WHERE run_id=$1',[row.run_id])).rows,inbox:(await central.query('SELECT * FROM async_exec.inbox WHERE execution_id=$1',[row.execution_id])).rows,outbox:(await central.query("SELECT * FROM async_exec.outbox WHERE envelope#>>'{payload,runId}'=$1 ORDER BY outbox_id",[row.run_id])).rows});
  async function quiesce(){
   let ticks=0;for(;;){const current=await control.status(context);assert.equal(current.state,'SUSPEND_REQUESTED');assert.equal(current.fence,paused.fence);if(current.activeLeases===0){quiet=await control.acknowledgeQuiesced({requestId:randomUUID(),expectedFence:current.fence},context);break;}if(++ticks%6===0)process.stdout.write('WAIT original worker leases before quiescence\n');assert(ticks<=40,'EU_RECONCILIATION_LEASE_DRAIN_TIMEOUT');await wait(5000);}
   assert.equal(quiet.state,'QUIESCED');const before=await durable();release();const completed=await flight;assert.deepEqual(await durable(),before,'PAUSED_HANDLER_MUST_PRESERVE_DURABLE_RUN');
   await worker.shutdown();worker=null;report.reconciliationFixture.sourceFence=quiet.fence;report.reconciliationFixture.originalLeasesNaturallyExpired=true;report.reconciliationFixture.pausedHandlerResult=completed.error?{code:completed.error.code}:completed.value;
   return quiet;
  }
  async function expired(){
   let ticks=0;for(;;){const probe=(await central.query("SELECT clock_timestamp()>=GREATEST(created_at+interval '5 minutes',$2::timestamptz) AS expired FROM opportunity_catalog.funding_run WHERE run_id=$1",[row.run_id,report.reconciliationFixture.deadlineAt])).rows[0];if(probe.expired)break;if(++ticks%6===0)process.stdout.write('WAIT original durable run deadline\n');assert(ticks<=70,'EU_RECONCILIATION_DEADLINE_TIMEOUT');await wait(5000);}
   fixture.actor.sessionId='eu-reconciliation-fresh-'+randomUUID();await http.bind(fixture.actor);context.sessionId=fixture.actor.sessionId;
   report.reconciliationFixture.originalDeadlineNaturallyExpired=true;report.reconciliationFixture.transportCallsBeforeReconciliation=fixtureTransport.calls.length;
  }
  async function close(){if(closed)return;closed=true;release?.();await flight?.catch(()=>{});await http?.close();await worker?.shutdown();}
  return {fixture,identity,http,context,control,capability,fixtureTransport,run:row,cycle,quiesce,expired,durable,close,fault};
 }catch(error){release?.();await flight?.catch(()=>{});await http?.close();await worker?.shutdown();if(!worker)await queuePort?.shutdown();throw error;}
}
module.exports={expiredFixture};
