'use strict';
// Production sequencer + production HTTP + owned PgBoss worker. Session and
// execution-window metadata are explicit fixtures, never habitual approval.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'../../..');
async function controlledCycleProof({central,fixture,report,check,http,worker,publish}){
 const {runControlledCycle,httpCommand}=require('../../../scripts/eu-writer-controlled-cycle.cjs');
 const {planDigest}=require('../../../backend/src/opportunities/v2/euWriterWindowPlan');
 const pkg=require('../../../backend/src/security/opportunityEuWriterMigrationPackage'),base=require('../../../backend/src/security/opportunityV2MigrationPackage');
 const receipt=report.windowApproval.receipt;
 const plan=JSON.parse(fs.readFileSync(path.join(root,report.windowApproval.ownedWorkspace,'output/opportunity-eu-writer-window-'+receipt.windowId,'plan.json'),'utf8'));
 const execution={kind:'eu-writer-execution-window-v1',executionId:randomUUID(),windowId:plan.windowId,status:'INSTALLED_AWAITING_CONTROLLED_CYCLE',planDigest:planDigest(plan),packageDigest:pkg.packageDigest,
  installed:{centralVersion:pkg.entry.version,centralFingerprint:pkg.entry.schemaFingerprint,tenantVersion:base.tenantAddition.version,tenantFingerprint:base.tenantAddition.schemaFingerprint},source:{...plan.source},healthRestored:true,approval:{actorId:receipt.actorId,eventId:receipt.eventId,eventHash:receipt.eventHash}};
 const calls=[],events=[];let resumeResponseLost=false;
 const openSession=async()=>({authenticatedAt:fixture.actor.session.auth.evidence.authTime*1000,close:async()=>{},async request(method,url,body,expectedStatus=200){
  httpCommand(method,url,body);const response=await http.request(fixture.actor,method,url,body);
  calls.push({method,url,status:response.status,...(body?{requestId:body.requestId}:{} )});
  if(method==='POST'&&url==='/api/admin/opportunity-activation/sources/eu/resume'&&response.status===200&&!resumeResponseLost){resumeResponseLost=true;throw Object.assign(Error('ISOLATED_LOST_RESUME_RESPONSE'),{code:'CONTROLLED_HTTP_UNCERTAIN',uncertain:true});}
  if(response.status!==expectedStatus)throw Object.assign(Error('ISOLATED_CONTROLLED_HTTP_FAILED'),{code:response.data?.error?.code||response.data?.code||'CONTROLLED_HTTP_FAILED',status:response.status});return response.data;
 }});
 const wait=async ms=>{
  // Cooperative scheduling executes real queue claims and handlers; no HTTP
  // response, clock, completion state or authority decision is fabricated.
  const deadline=Date.now()+Math.min(ms,2000);
  for(let step=0;step<8;step++){await worker.runOnce();publish();if(Number((await central.query("SELECT count(*) AS n FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING')")).rows[0].n)===0||Date.now()>=deadline)break;}
  await new Promise(resolve=>setTimeout(resolve,Math.min(ms,50)));
 };
 await check('EU_WRITER_CONTROLLED_CYCLE_REAL_HTTP_ONE_REQUEST_AND_FINAL_SUSPENSION',async()=>{
  const before=(await central.query('SELECT count(*)::int AS n FROM opportunity_catalog.funding_cycle')).rows[0].n,resumeAuditBefore=Number((await central.query("SELECT count(*) AS n FROM audit.event WHERE event_code='OPPORTUNITY_SOURCE_RESUMED'")).rows[0].n);
  const result=await runControlledCycle({execution,plan,openSession,wait,onProgress:async event=>events.push(event)});
  report.controlledCycle={...result,realHttp:true,realQueueAndWorker:true,syntheticSession:true,syntheticWindowHealthMetadata:true,realOidcProvider:false,privateConfigurationRead:false,cooperativeWorkerScheduling:true,syntheticResumeResponseLoss:true,calls,events};
  // A legacy v1 identity requires a separate prearchive receipt and is not
  // selected by the automatic canonical refresh.
  assert.equal(result.status,'PASS',JSON.stringify(result));assert.equal(result.cycle.status,'SUCCESS');assert.equal(result.cycle.errorCode,null);assert.equal(result.cycle.knownRefresh.REVIEW||0,0);assert.equal(result.cycle.knownRefresh.UNCHANGED,1);assert.equal(result.cycle.failed,0);
  const legacy=(await central.query('SELECT current_revision_id,current_schema_version FROM opportunity_catalog.opportunity WHERE opportunity_id=$1',[fixture.legacyReview.opportunityId])).rows[0];
  assert.equal(legacy.current_revision_id,fixture.legacyReview.revisionId);assert.equal(legacy.current_schema_version,1);
  assert.equal(result.logicalCyclesRequested,1);assert.equal(result.finalSuspensionVerified,true);assert.equal(result.finalSource.state,'QUIESCED');assert.equal(result.finalSource.activeLeases,0);
  assert.equal(calls.filter(call=>call.method==='POST'&&call.url==='/api/admin/integrations/funding-tenders').length,1);
  const resumes=calls.filter(call=>call.method==='POST'&&call.url==='/api/admin/opportunity-activation/sources/eu/resume');assert.equal(resumes.length,2);assert.equal(resumes[0].requestId,resumes[1].requestId);assert.equal(result.transportAttempts.resume,2);assert.equal(Number((await central.query("SELECT count(*) AS n FROM audit.event WHERE event_code='OPPORTUNITY_SOURCE_RESUMED'")).rows[0].n),resumeAuditBefore+1);
  assert.equal((await central.query('SELECT count(*)::int AS n FROM opportunity_catalog.funding_cycle')).rows[0].n,before+1);
  assert.equal((await central.query('SELECT count(*)::int AS n FROM opportunity_catalog.funding_run WHERE request_id=$1',[result.requestIds.enqueue])).rows[0].n,1);
  const row=(await central.query('SELECT status,source_code,eu_writer_mode FROM opportunity_catalog.funding_run WHERE run_id=$1',[result.runId])).rows[0];assert.equal(row.source_code,'EU_FUNDING_TENDERS');assert.equal(row.eu_writer_mode,'CANONICAL_V2');assert.equal(row.status,'SUCCESS');
  report.controlledCycle.sameIntentReconciled=true;report.controlledCycle.noDuplicateResumeAudit=true;report.controlledCycle.legacyV1HeldForPrearchive=true;
 });
 return report.controlledCycle;
}
module.exports={controlledCycleProof};
