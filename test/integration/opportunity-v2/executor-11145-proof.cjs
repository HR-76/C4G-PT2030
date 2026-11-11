'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {bootstrap,httpRuntime,transaction,policyVersion,recentMfaRequirement}=require('./executor-11145-fixture.cjs');
const {snapshot,preserved}=require('./registered-package-proof.cjs');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const code=response=>response.data?.error?.code||response.data?.code;
function success(response,status=200){assert.equal(response.status,status,JSON.stringify(response));return response.data;}
function refused(response,status,expectedCode){assert.equal(response.status,status,JSON.stringify(response));if(expectedCode)assert.equal(code(response),expectedCode);return code(response);}
async function counts(pool){return (await pool.query(`SELECT
 (SELECT count(*)::int FROM opportunity_catalog.funding_run) AS runs,
 (SELECT count(*)::int FROM opportunity_catalog.funding_candidate_v2) AS candidates,
 (SELECT count(*)::int FROM opportunity_catalog.revision) AS revisions,
 (SELECT count(*)::int FROM opportunity_catalog.accepted_receipt_v2) AS receipts,
 (SELECT count(*)::int FROM async_exec.outbox) AS outbox`)).rows[0];}
async function addActor(central,http,{administrator=true,stale=false}={}){
 const actor={id:randomUUID(),assignmentId:randomUUID(),sessionId:'executor-negative-'+randomUUID()};
 await central.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Isolated negative authority fixture',$2,'ACTIVE')",[actor.id,actor.id+'@example.invalid']);
 if(administrator)await central.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[actor.assignmentId,actor.id]);
 await http.bind(actor,{stale});return actor;
}
async function executor11145Proof({central,tenant,connection,report,check,outputDirectory}){
 let fixture,http,before,collected,candidate,plan,approved,accepted,acceptInput;const transport=require('./executor-11145-transport.cjs').createLive11145Transport({outputDirectory,report});
 try{
  await check('EXECUTOR_BASELINE035_033_LEGACY_ERROR_WITHOUT_ARCHIVE',async()=>{
   fixture=await bootstrap(central,tenant);
   report.baseline={central:await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(central),tenant:await require('../../../backend/src/security/tenantMigrationPreflight').preflightTenant(tenant,fixture.identity,undefined,{timeoutMs:30000})};
   assert.equal(report.baseline.central.currentVersion,'035_funding_source_resolution');assert.equal(report.baseline.tenant.currentVersion,'033_organizational_opportunity_interests');
   assert.equal((await central.query('SELECT status FROM opportunity_catalog.funding_run')).rows[0].status,'ERROR');
   report.fixture={provenance:'Synthetic v1 history with a terminal ERROR run; no collected candidate or successful collection is seeded.',opportunityId:fixture.legacy.opportunityId,legacyRevisionId:fixture.legacy.revisionId,legacyRunId:fixture.legacyRunId};
  });
  await check('EXECUTOR_NORMAL_COORDINATED_SESSION_AND_BASELINE_REFUSAL',async()=>{
   http=await httpRuntime({central,connection,fixture,report,fetchImpl:transport.fetchImpl});
   assert.deepEqual((await http.authorityPool.query('SELECT session_user,current_user')).rows[0],{session_user:'c4g_authority_runtime',current_user:'c4g_authority_runtime'});
   refused(await http.request(fixture.actor,'POST','/calls/11145/collect',{requestId:randomUUID(),expectedSourceFence:1}),503,'OPPORTUNITY_V2_NOT_CONFIGURED');assert.equal(transport.observations.length,0);
   report.authority={physicalRuntimeLogin:true,normalCoordinator:true,coordinatedSessionStore:true,realSessionOriginCsrfMiddleware:true,fixturePermitBypass:false,oidcProviderLogin:false,realPersonApproval:false};
  });
  before={central:await snapshot(central,{central:true}),tenant:await snapshot(tenant)};
  await require('./registered-package-migration.cjs').migrateAndVerify({central,tenant,identity:fixture.identity,report,check,before,preserved});
  const immutableNames=['funding_identity','funding_resolution','revision','provenance'];
  const history={};for(const name of immutableNames)history[name]=(await central.query('SELECT to_jsonb(t) AS value FROM opportunity_catalog.'+name+' t ORDER BY to_jsonb(t)::text')).rows;
  const unchangedHistory=async()=>{for(const name of immutableNames)assert.deepEqual((await central.query('SELECT to_jsonb(t) AS value FROM opportunity_catalog.'+name+' t ORDER BY to_jsonb(t)::text')).rows,history[name],name);await preserved(tenant,before.tenant);};
  await check('EXECUTOR_CLOSED_HTTP_AUTHORITY_ORIGIN_CSRF_AND_DISABLED',async()=>{
   const input={requestId:randomUUID(),expectedSourceFence:1},url='/calls/11145/collect',a=fixture.actor;
   refused(await http.request(a,'POST',url,input,{disabled:true}),503,'OPPORTUNITY_V2_NOT_CONFIGURED');
   refused(await http.request(null,'POST',url,input),401);
   refused(await http.request(a,'POST',url,input,{csrf:false}),403);
   refused(await http.request(a,'POST',url,input,{origin:'https://foreign.example.invalid'}),403);
   const ordinary=await addActor(central,http,{administrator:false});
   await central.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at) VALUES($1,$2,$3,'ORG_ADMIN','ACTIVE',clock_timestamp())",[randomUUID(),ordinary.id,fixture.organizationId]);
   refused(await http.request(ordinary,'POST',url,input),403,'OPPORTUNITY_V2_AUTHORITY_DENIED');
   const stale=await addActor(central,http,{stale:true});refused(await http.request(stale,'POST',url,input),403,'OPPORTUNITY_V2_AUTHORITY_DENIED');
   for(const extra of [{source:'CORDIS'},{externalIdentifier:'CASCADE:11146'},{actor:{id:a.id}},{snapshot:{}},{archive:{}},{destination:'other'}])refused(await http.request(a,'POST',url,{...input,...extra}),400);
   refused(await http.request(a,'POST','/calls/11146/collect',input),405);
   refused(await http.request(a,'POST',url+'?identity=11146',input),400);
   assert.equal(transport.observations.length,0);await unchangedHistory();
   report.closedHttp={organizationAdminDenied:true,staleAuthenticationDenied:true,sessionRequired:true,originAndCsrfRequired:true,alternativeIdentityAndExtraFieldsDenied:true,disabledAndBaselineDenied:true};
  });
  await check('EXECUTOR_LIVE_PUBLIC_11145_DURABLE_COMPLETE_ARCHIVE',async()=>{
   const prior=await counts(central),requestId=randomUUID();
   collected=success(await http.request(fixture.actor,'POST','/calls/11145/collect',{requestId,expectedSourceFence:1}),201);
   assert.equal(collected.replayed,false);assert.equal(collected.opportunityId,fixture.legacy.opportunityId);assert.equal(transport.observations.length,1);assert.equal(collected.transport.sha256,transport.observations[0].sha256);
   const run=(await central.query('SELECT * FROM opportunity_catalog.funding_run WHERE run_id=$1',[collected.runId])).rows[0];
   assert.equal(run.status,'SUCCESS');assert.equal(run.limited,false);assert.equal(run.canonical_v2_required,true);assert.equal(run.collected,true);assert.equal(run.result_count,collected.received);assert(run.result_count>=1&&run.result_count<=5);assert.equal(run.lease_until,null);assert(run.finished_at);assert.equal(run.failed_count,0);
   const row=(await central.query('SELECT * FROM opportunity_catalog.funding_candidate_v2 WHERE run_id=$1',[collected.runId])).rows[0];candidate=row.canonical_snapshot;
   const bytes=fs.readFileSync(path.join(outputDirectory,transport.observations[0].file)),raw=JSON.parse(bytes);
   const evidence=require('../../../backend/src/fundingTenders/sourceEvidence').buildEvidence('CASCADE:11145',raw.results);
   assert.deepEqual(row.source_evidence,evidence);
   const derived=require('../../../backend/src/fundingTenders/adapterV2').adaptEuOpportunityV2(evidence,{observedAt:collected.observedAt});assert.deepEqual(candidate,derived);
   const money=candidate.financing.allocations.value[0].money;
   report.liveComparison={amount:money.amount,currencyState:money.currency.state,cutoffs:candidate.schedule.deadlines.value.length,project:candidate.relatedProject,sourceRecords:candidate.sourceRecords,payloadDigest:row.payload_digest,contentDigest:row.content_digest,rawResponseDigest:transport.observations[0].sha256};
   assert.equal(money.amount,'120000');assert.equal(money.currency.state,'NOT_FOUND');assert.equal(candidate.schedule.deadlines.value.length,7);
   assert.equal(candidate.relatedProject.acronym.value,'SUSA');assert.equal(candidate.relatedProject.grantAgreementNumber.value,'101190010');
   assert.deepEqual(await counts(central),{...prior,runs:prior.runs+1,candidates:prior.candidates+1});await unchangedHistory();
   const replay=success(await http.request(fixture.actor,'POST','/calls/11145/collect',{requestId,expectedSourceFence:1}),201);assert.equal(replay.runId,collected.runId);assert.equal(replay.replayed,true);assert.equal(transport.observations.length,1);
   const other=await addActor(central,http);refused(await http.request(other,'POST','/calls/11145/collect',{requestId,expectedSourceFence:1}),409,'OPPORTUNITY_V2_IDEMPOTENCY_CONFLICT');assert.equal(transport.observations.length,1);
   report.collection={runId:collected.runId,requestId,archive:collected.archive,successProducedByRealCollector:true,noGenericApply:true,replayWithoutNetwork:true,otherActorConflict:true,noPartialOrOrphanRun:true};
  });
  await check('EXECUTOR_AUTHORITY_REVOKED_DURING_REAL_NETWORK_NO_PARTIAL_EFFECTS',async()=>{
   const actor=await addActor(central,http),prior=await counts(central),hold=transport.holdNext();
   const pending=http.request(actor,'POST','/calls/11145/collect',{requestId:randomUUID(),expectedSourceFence:1});
   try{await Promise.race([hold.arrived,pending.then(value=>{throw Error('PUBLIC_HOLD_NOT_REACHED:'+JSON.stringify(value));})]);await http.registry.revokeSession(actor.sessionId,'EXECUTOR_GATE_NETWORK_REVOCATION');}finally{hold.release();}
   refused(await pending,403,'OPPORTUNITY_V2_AUTHORITY_DENIED');assert.deepEqual(await counts(central),prior);await unchangedHistory();
   report.networkRevocation={realResponseCaptured:true,coordinatorRevokedWhileNetworkHeld:true,noSessionLocksAcrossNetwork:true,secondAuthorityCheckDenied:true,noPartialEffects:true};
  });
  const prepare=async()=>success(await http.request(fixture.actor,'POST','/calls/11145/plans',{requestId:randomUUID(),runId:collected.runId}),201);
  const approve=async value=>success(await http.request(fixture.actor,'POST','/plans/'+value.planId+'/approve',{requestId:randomUUID(),planDigest:value.planDigest}));
  const accept=(value,options={},actor=fixture.actor)=>http.request(actor,'POST','/calls/11145/plans/'+value.planId+'/accept',{requestId:randomUUID(),planDigest:value.planDigest,fence:value.fence,sourceFence:3,...options});
  await check('EXECUTOR_FACTUAL_PLAN_SCOPE_TTL_AND_NO_APPROVAL',async()=>{
   refused(await http.request(fixture.actor,'POST','/calls/11145/plans',{requestId:randomUUID(),runId:fixture.legacyRunId}),409,'OPPORTUNITY_V2_11145_RUN_INVALID');
   plan=await prepare();const detail=success(await http.request(fixture.actor,'GET','/plans/'+plan.planId));assert.deepEqual(detail.candidate.snapshot,candidate);assert.deepEqual(detail.accepted.snapshot,fixture.legacy.snapshot);assert.equal(detail.review.canApprove,true);
   refused(await accept(plan),409,'OPPORTUNITY_V2_PLAN_NOT_APPROVED');
   // Negative expired draft only, copied from the live verified plan. Its
   // historical timestamps are legal INSERT data; no stored plan is mutated.
   const expiredId=randomUUID();await central.query(`INSERT INTO opportunity_catalog.activation_plan_v2(plan_id,prepared_request_id,prepared_by,source_code,archive_locator,archive_digest,candidate_id,mapping_digest,snapshot_digest,expected,preview,preview_digest,plan_digest,prepared_at,expires_at)
    SELECT $1,$2,prepared_by,source_code,archive_locator,archive_digest,candidate_id,mapping_digest,snapshot_digest,expected,preview,preview_digest,plan_digest,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '90 minutes' FROM opportunity_catalog.activation_plan_v2 WHERE plan_id=$3`,[expiredId,randomUUID(),plan.planId]);
   refused(await http.request(fixture.actor,'POST','/plans/'+expiredId+'/approve',{requestId:randomUUID(),planDigest:plan.planDigest}),409,'OPPORTUNITY_V2_PLAN_NOT_APPROVABLE');refused(await accept({...plan,planId:expiredId}),409,'OPPORTUNITY_V2_PLAN_NOT_APPROVED');
   report.plan={factualArchive:true,serverDerivedCas:true,legacyRunRejected:true,expiredDraftRejected:true,expiredFixtureOnly:true,approvalRequired:true};
  });
  await check('EXECUTOR_REAL_ARCHIVE_IMMUTABILITY_AND_MAPPING_DRIFT_REFUSAL',async()=>{
   const client=await central.connect();try{await client.query('BEGIN');await assert.rejects(client.query("UPDATE opportunity_catalog.funding_candidate_v2 SET mapping_version='invalid-fixture-mapping' WHERE run_id=$1",[collected.runId]),error=>['23514','P0001','55000'].includes(error.code));}finally{await client.query('ROLLBACK');client.release();}
   assert.deepEqual((await central.query('SELECT canonical_snapshot FROM opportunity_catalog.funding_candidate_v2 WHERE run_id=$1',[collected.runId])).rows[0].canonical_snapshot,candidate);
   const approval=require('../../../backend/src/opportunities/v2/activationApproval'),archive=require('../../../backend/src/opportunities/v2/activationArchive');
   const original=(await central.query('SELECT * FROM opportunity_catalog.activation_plan_v2 WHERE plan_id=$1',[plan.planId])).rows[0];
   const divergent={...original,mapping_digest:'0'.repeat(64)},digest=archive.hash(approval.planBinding(divergent)),id=randomUUID();
   // A separate negative DRAFT fixture uses the real archive and an intentionally
   // divergent mapping binding. Neither archive nor operational plan is edited.
   await central.query(`INSERT INTO opportunity_catalog.activation_plan_v2(plan_id,prepared_request_id,prepared_by,source_code,archive_locator,archive_digest,candidate_id,mapping_digest,snapshot_digest,expected,preview,preview_digest,plan_digest,expires_at)
    SELECT $1,$2,prepared_by,source_code,archive_locator,archive_digest,candidate_id,$3,snapshot_digest,expected,preview,preview_digest,$4,transaction_timestamp()+interval '1 hour' FROM opportunity_catalog.activation_plan_v2 WHERE plan_id=$5`,[id,randomUUID(),divergent.mapping_digest,digest,plan.planId]);
   refused(await http.request(fixture.actor,'POST','/plans/'+id+'/approve',{requestId:randomUUID(),planDigest:digest}),409,'OPPORTUNITY_V2_PLAN_ARCHIVE_CHANGED');
   report.archiveDrift={immutableArchiveUpdateRejected:true,divergentMappingDraftRejected:true,negativeFixtureOnly:true};
  });
  await check('EXECUTOR_APPROVAL_REVOCATION_DIGEST_FENCE_AND_SOURCE_BARRIER',async()=>{
   approved=await approve(plan);const other=await addActor(central,http);
   refused(await accept(approved,{},other),409,'OPPORTUNITY_V2_PLAN_NOT_APPROVED');
   refused(await accept(approved,{planDigest:'0'.repeat(64)}),409,'OPPORTUNITY_V2_APPROVAL_STALE');
   refused(await accept(approved,{fence:approved.fence+1}),409,'OPPORTUNITY_V2_PLAN_NOT_APPROVED');
   refused(await accept(approved,{sourceFence:1}),409,'OPPORTUNITY_V2_EU_NOT_QUIESCENT');
   success(await http.request(fixture.actor,'POST','/plans/'+approved.planId+'/revoke',{requestId:randomUUID(),planDigest:approved.planDigest}));refused(await accept(approved),409,'OPPORTUNITY_V2_PLAN_NOT_APPROVED');
   plan=await prepare();approved=await approve(plan);
   assert.equal((await counts(central)).receipts,0);await unchangedHistory();
   report.approvalRefusals={otherActor:true,digest:true,planFence:true,activeSource:true,revoked:true};
  });
  await check('EXECUTOR_CONCURRENT_V1_REVISION_INVALIDATES_CAS',async()=>{
   // This is an explicit isolated concurrent-editor fixture through the v1
   // repository. It creates a new revision; it never rewrites immutable history.
   const repository=new(require('../../../backend/src/opportunities/centralRepository').CentralOpportunityRepository)({pool:central,identityFactory:{next:randomUUID}});
   const revised=await repository.update({schemaVersion:1,requestId:randomUUID(),opportunityId:fixture.legacy.opportunityId,expectedRowVersion:1,snapshot:{...fixture.legacy.snapshot,provenanceId:randomUUID(),summary:'Isolated concurrent editorial revision for CAS refusal'},provenance:{schemaVersion:1,sourceType:'C4G_MANUAL',sourceNamespace:'EXECUTOR_CAS_FIXTURE',observedAt:new Date().toISOString()}},{actor:{type:'HUMAN',reference:fixture.actor.id}});
   const suspended=success(await http.request(fixture.actor,'POST','/sources/eu/suspend',{requestId:randomUUID(),expectedFence:1}));assert.equal(suspended.fence,2);
   const quiet=success(await http.request(fixture.actor,'POST','/sources/eu/quiesce',{requestId:randomUUID(),expectedFence:2}));assert.equal(quiet.fence,3);
   refused(await accept(approved,{sourceFence:2}),409,'OPPORTUNITY_V2_SOURCE_FENCE_STALE');report.approvalRefusals.sourceFence=true;
   refused(await accept(approved),409,'OPPORTUNITY_V2_STALE_REVISION');assert.equal((await counts(central)).receipts,0);
   report.concurrentEditor={synthetic:true,usedV1Repository:true,revisionId:revised.revisionId,rowVersion:revised.rowVersion,staleApprovalDenied:true};
   plan=await prepare();approved=await approve(plan);assert.equal(approved.preview.items[0].action,'CHANGE_REQUIRES_APPROVAL');
  });
  await check('EXECUTOR_HTTP_ACCEPT_REAL_ARCHIVE_SQL_PARITY_AND_REPLAY',async()=>{
   acceptInput={requestId:randomUUID(),planDigest:approved.planDigest,fence:approved.fence,sourceFence:3};
   accepted=success(await http.request(fixture.actor,'POST','/calls/11145/plans/'+approved.planId+'/accept',acceptInput));
   assert.equal(accepted.opportunityId,fixture.legacy.opportunityId);assert.equal(accepted.action,'REVISION_CREATED');assert.equal(accepted.rowVersion,3);assert.equal(accepted.sourceVersion,2);
   const stored=(await central.query('SELECT snapshot FROM opportunity_catalog.revision WHERE revision_id=$1',[accepted.revisionId])).rows[0].snapshot;assert.deepEqual(stored,candidate);
   const allocation=(await central.query('SELECT payload,amount_canonical,amount::text,currency_state,currency_code,pg_typeof(amount)::text AS sql_type FROM opportunity_catalog.revision_allocation_v2 WHERE revision_id=$1',[accepted.revisionId])).rows[0];
   assert.equal(allocation.amount_canonical,'120000');assert.equal(allocation.amount,'120000.00000000');assert.equal(allocation.currency_state,'NOT_FOUND');assert.equal(allocation.currency_code,null);assert.equal(allocation.sql_type,'numeric');assert.deepEqual(allocation.payload,candidate.financing.allocations.value[0]);
   const deadlines=(await central.query('SELECT payload,temporal_precision,date_value::text,instant_value FROM opportunity_catalog.revision_deadline_v2 WHERE revision_id=$1 ORDER BY ordinal',[accepted.revisionId])).rows;assert.deepEqual(deadlines.map(row=>row.payload),candidate.schedule.deadlines.value);assert.equal(deadlines.length,7);
   for(const row of deadlines){if(row.temporal_precision==='DATE')assert.equal(row.date_value,row.payload.at.value);else if(row.temporal_precision==='INSTANT')assert.equal(row.instant_value.toISOString(),row.payload.at.value);}
   const prior=await counts(central),events=(await central.query('SELECT count(*)::int AS n FROM audit.event')).rows[0].n;
   assert.deepEqual(success(await http.request(fixture.actor,'POST','/calls/11145/plans/'+approved.planId+'/accept',acceptInput)),accepted);assert.deepEqual(await counts(central),prior);assert.equal((await central.query('SELECT count(*)::int AS n FROM audit.event')).rows[0].n,events);
   const replayOtherPlan=await prepare(),otherApproval=await approve(replayOtherPlan);refused(await http.request(fixture.actor,'POST','/calls/11145/plans/'+otherApproval.planId+'/accept',{...acceptInput,planDigest:otherApproval.planDigest,fence:otherApproval.fence}),409,'OPPORTUNITY_V2_IDEMPOTENCY_CONFLICT');
   refused(await http.request(fixture.actor,'POST','/sources/eu/resume',{requestId:randomUUID(),expectedFence:3}),409,'OPPORTUNITY_V2_EU_LEGACY_RESUME_BLOCKED');
   report.acceptance={...accepted,planId:approved.planId,sourceFence:3,amountCanonical:allocation.amount_canonical,sqlNumeric:allocation.amount,currencyState:allocation.currency_state,currencyCode:allocation.currency_code,cutoffs:deadlines.length,replayWithoutRevisionOrAudit:true,crossPlanReplayDenied:true,legacyResumeBlocked:true};
  });
  await require('./executor-11145-readers.cjs').verifyReaders({central,tenant,connection,fixture,candidate,accepted,before,report,check});
  await check('EXECUTOR_FINAL_FINGERPRINTS_IMMUTABLE_HISTORY_AUDIT_AND_REVOKED_ACCEPT',async()=>{
   for(const name of ['funding_identity','funding_resolution'])assert.deepEqual((await central.query('SELECT to_jsonb(t) AS value FROM opportunity_catalog.'+name+' t ORDER BY to_jsonb(t)::text')).rows,history[name]);
   assert.deepEqual((await central.query('SELECT snapshot FROM opportunity_catalog.revision WHERE revision_id=$1',[fixture.legacy.revisionId])).rows[0].snapshot,fixture.legacy.snapshot);await preserved(tenant,before.tenant);
   await http.registry.revokeSession(fixture.actor.sessionId,'EXECUTOR_GATE_FINAL_REVOCATION');refused(await http.request(fixture.actor,'POST','/calls/11145/plans/'+approved.planId+'/accept',acceptInput),401);
   const ready=await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(central),tenantReady=await require('../../../backend/src/security/tenantMigrationPreflight').preflightTenant(tenant,fixture.identity,undefined,{timeoutMs:30000});
   const events=(await central.query("SELECT event_data,event_hash FROM audit.event WHERE organization_id IS NULL AND stream_id='PLATFORM:DATA' ORDER BY sequence")).rows.map(row=>({...row.event_data,eventHash:row.event_hash}));assert.equal(require('../../../backend/src/audit/verifier').verifyEvents(events).valid,true);assert(!JSON.stringify(events).includes(fixture.actor.sessionId));
   report.final={centralVersion:ready.currentVersion,centralFingerprint:ready.fingerprint,tenantVersion:tenantReady.currentVersion,tenantFingerprint:tenantReady.schemaFingerprint,auditEvents:events.length,auditChainValid:true,auditEventCodes:events.map(event=>event.eventCode),sourceFence:3,accepted:true,normalCoordinatorAppliedWrites:(await central.query("SELECT count(*)::int AS n FROM public.authority_write_request WHERE state='APPLIED'")).rows[0].n};
   assert.equal(ready.fingerprint,report.central.fingerprint);assert.equal(tenantReady.schemaFingerprint,report.tenant.fingerprint);
  });
 }finally{await http?.close();}
}
module.exports={executor11145Proof,success,refused,counts};
