'use strict';
// Owned disposable PostgreSQL and loopback HTTP only. Sessions are seeded test
// identities, then loaded through the real signed-cookie/session/CSRF pipeline.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const {seedSession,stageEu,seedLegacy,fixtureAuthorityMutation,policyVersion,recentMfaRequirement,runtimeTransaction}=require('./activation-proof.cjs');
const root=path.resolve(__dirname,'../../..'),prefix='/api/admin/opportunity-activation';
const sha=value=>createHash('sha256').update(value).digest('hex');
const expected=value=>({opportunityId:value.opportunityId,revisionId:value.revisionId,rowVersion:value.rowVersion});
async function seedHttpActor(pool,{administrator=true,orgAdmin=false,stale=false}={}){
 const actor=await seedSession(pool,{administrator});
 actor.session.auth.identity={issuer:'https://identity.example.invalid/isolated',subject:actor.id};
 actor.session.cookie={...actor.session.cookie,originalMaxAge:3600000,httpOnly:true,path:'/',sameSite:'lax'};
 if(stale)actor.session.auth.evidence.authTime-=3600;
 await fixtureAuthorityMutation(pool,actor,'UPDATE public.application_session_store SET sess=$1 WHERE sid=$2',[actor.session,actor.sessionId]);
 if(orgAdmin){const organizationId=randomUUID(),membershipId=randomUUID();
  await pool.query("INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code) VALUES($1,'Isolated institution','Isolated institution',$2,'UNIVERSITY','ACTIVE','EUR','OPTIONAL')",[organizationId,'isolated-'+organizationId]);
  await pool.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at) VALUES($1,$2,$3,'ORG_ADMIN','ACTIVE',clock_timestamp())",[membershipId,actor.id,organizationId]);
  actor.organizationId=organizationId;actor.membershipId=membershipId;
 }
 return actor;
}
async function application({pool,report}){
 const express=require('../../../backend/node_modules/express'),session=require('../../../backend/node_modules/express-session');
 const PgStore=require('../../../backend/node_modules/connect-pg-simple')(session),signature=require('../../../backend/node_modules/cookie-signature');
 const app=express(),server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
 try{
 const base='http://127.0.0.1:'+server.address().port,secret=randomBytes(48).toString('base64url'),cookieName='c4g-activation-gate';
 const sessionStore=new PgStore({pool,schemaName:'public',tableName:'application_session_store',createTableIfMissing:false,pruneSessionInterval:false,disableTouch:true});
 const {createSessionSecurity,csrfTokenForSession}=require('../../../backend/src/security/sessionSecurity');
 const security=createSessionSecurity({config:{sessionCookieName:cookieName,sessionSecret:secret,secureCookie:false,sessionIdleMs:3600000,nodeEnv:'test',publicOrigin:new URL(base),allowedDevelopmentOrigins:[]},pool,sessionStore});
 const authentication=require('../../../backend/src/middlewares/authMiddleware');
 authentication.configureAuthentication({mode:'oidc',policyVersion,sessionRegistry:require('../../../backend/src/security/sessionRegistry').createPgSessionRegistry(pool)});
 const organization=require('../../../backend/src/middlewares/organizationContext').createOrganizationContextMiddleware({organizationSession:null});
 app.use(express.json({limit:'1mb'}),security.sessionMiddleware);
 const {createOpportunityActivationHttpRuntime}=require('../../../backend/src/opportunities/v2/activationHttp');
 const activation=createOpportunityActivationHttpRuntime({express,pool,authenticate:authentication.authenticate,requireServerSession:organization.requireServerSession,policyVersion,recentMfaRequirement,originProtection:security.originProtection,csrfProtection:security.csrfProtection});
 app.use(prefix,activation.router);
 app.use((error,_req,res,_next)=>{report.lastHttpError={code:error.code||'HTTP_ERROR',status:error.statusCode||error.status||500};res.status(error.statusCode||error.status||500).json({code:error.code||'HTTP_ERROR'});});
 return {base,async request(actor,method,url,body,options={}){
  const headers={};if(actor&&options.cookie!==false)headers.cookie=cookieName+'='+encodeURIComponent('s:'+signature.sign(actor.sessionId,secret));
  if(method!=='GET'){headers.origin=options.origin===undefined?base:options.origin;if(options.csrf!==false&&actor)headers['x-csrf-token']=options.csrf||csrfTokenForSession({sessionID:actor.sessionId},secret);}
  if(body!==undefined)headers['content-type']='application/json';
  const response=await fetch(base+prefix+url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let data;try{data=await response.json();}catch{data=null;}
  return {status:response.status,data,cacheControl:response.headers.get('cache-control')};
 },async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));sessionStore.close?.();}};
 }catch(error){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));throw error;}
}
async function applyCandidates(pool,report,files){
 const schema=require('../../../backend/src/security/centralSchemaManifest'),authority=require('../../../backend/src/security/authoritySecurityManifest'),catalog=require('../../../backend/src/security/catalogSecurityManifest');
 const fingerprints=async()=>({schema:schema.schemaFingerprint(await schema.centralSchemaSnapshot(pool)),authority:authority.digest(await authority.authoritySecuritySnapshot(pool)),catalog:catalog.digest(await catalog.catalogSecuritySnapshot(pool))});
 report.httpBaselineFingerprints??=await fingerprints();report.httpCandidateSql??=[];
 for(const name of files){const file='backend/database/central/candidates/'+name,sql=fs.readFileSync(path.join(root,file),'utf8');await pool.query(sql);report.httpCandidateSql.push({file,sha256:sha(sql),fingerprints:await fingerprints(),registered:false});}
}
async function localQueue(pool,report){
 const options=pool.options;assert.equal(options.host,'127.0.0.1');assert(options.port>1024&&options.port!==5432);assert.equal(options.database,'s6_central');
 const target=new URL('postgresql://127.0.0.1');target.port=String(options.port);target.username=options.user;target.password=options.password;target.pathname='/s6_central';
 const {PgBoss}=await import('../../../backend/node_modules/pg-boss/dist/index.js');
 const boss=new PgBoss({connectionString:target.toString(),supervise:false,schedule:false});
 try{await boss.start();await boss.createQueue('activation-funding-refresh',{retryLimit:0});}catch{throw Error('ISOLATED_QUEUE_INITIALIZATION_FAILED');}finally{await boss.stop().catch(()=>{});}
 const version=Number((await pool.query('SELECT version FROM pgboss.version')).rows[0].version);report.pgBoss={schema:'pgboss',schemaVersion:version,packageVersion:JSON.parse(fs.readFileSync(path.join(root,'backend/node_modules/pg-boss/package.json'),'utf8')).version};
 return require('../../../backend/src/async/adapters/pgBossQueueAdapter').createPgBossQueueAdapter({connectionString:target.toString(),queueMap:{'funding_tenders.refresh':'activation-funding-refresh'},inspectSchema:async()=>({schema:'pgboss',schemaVersion:version})});
}
async function durableJob(pool,runId){return {
 run:(await pool.query('SELECT run_id,status,fence,lease_until::text,eu_source_fence,eu_source_held,created_at::text FROM opportunity_catalog.funding_run WHERE run_id=$1',[runId])).rows[0],
 outbox:(await pool.query("SELECT outbox_id,envelope,digest_sha256,content_digest,envelope_digest,lineage_version,delivery_kind,attempt,root_execution_id,previous_execution_id,replay_request_id,state FROM async_exec.outbox WHERE envelope#>>'{payload,runId}'=$1 ORDER BY attempt",[runId])).rows,
 inbox:(await pool.query("SELECT state,result_code,execution_id,fence,lease_until::text FROM async_exec.inbox WHERE organization_id IS NULL AND job_type='funding_tenders.refresh' AND idempotency_key=$1",[runId])).rows,
 execution:(await pool.query('SELECT * FROM async_exec.execution WHERE execution_id=$1',[runId])).rows
};}
const immutableOutbox=rows=>rows.map(({state,...row})=>row);
async function sqlRejected(pool,sql,values,message){await assert.rejects(runtimeTransaction(pool,client=>client.query(sql,values)),error=>error.code==='P0001'&&error.message===message);}
async function activationHttpProof({pool,tenantPool,check,report}){
 const admin=await seedHttpActor(pool),orgAdmin=await seedHttpActor(pool,{administrator:false,orgAdmin:true}),stale=await seedHttpActor(pool,{stale:true});
 const http=await application({pool,report});let queue,worker;
 try{
  await check('HTTP_ACTIVATION_REQUIRES_SESSION_AND_CANDIDATE_CAPABILITY',async()=>{
   assert.equal((await http.request(null,'GET','/plans')).status,401);
   const response=await http.request(admin,'GET','/sources/eu');assert.equal(response.status,503);assert.equal(response.data.error.code,'OPPORTUNITY_V2_NOT_CONFIGURED');
  });
  await check('HTTP_INSTALL_CANDIDATES_AND_SEED_LEGACY_INFLIGHT_JOB',async()=>{
   await applyCandidates(pool,report,['funding_canonical_v2.up.sql','manual_opportunity_v2.up.sql','pt2030_plan_v2.up.sql','opportunity_persistence_v2.up.sql','opportunity_activation_authority_v2.up.sql','opportunity_activation_approval_v2.up.sql']);
  });
  const archived=await stageEu(pool,admin),legacy=await seedLegacy(pool,archived.run),archive={kind:'FUNDING',runId:archived.runId,externalIdentifier:'CASCADE:11145'};
  const {createFundingRepository}=require('../../../backend/src/fundingTenders/repository'),oldRepository=createFundingRepository({pool});
  const oldJob=await oldRepository.enqueue(admin.id,randomUUID(),'CORDIS'),oldRun=await oldRepository.claim(oldJob.runId);
  queue=await localQueue(pool,report);
  const outbox=new(require('../../../backend/src/async/outboxRepository').OutboxRepository)(),projection=require('../../../backend/src/async/executionLineageProjection').createExecutionLineageProjection({transaction:oldRepository.transaction});
  const relay=new(require('../../../backend/src/async/outboxRelay').OutboxRelay)({repository:outbox,queue,transaction:oldRepository.transaction,workerId:'activation-isolated-relay',projectionPort:projection});
  assert.deepEqual(await relay.poll(),['PUBLISHED']);
  await check('HTTP_INSTALL_EU_SOURCE_GUARD_WITH_EXISTING_DELIVERY',async()=>{
   await applyCandidates(pool,report,['opportunity_eu_source_control_v2.up.sql']);
   const job=await durableJob(pool,oldJob.runId);assert.equal(job.run.eu_source_fence,1);assert.equal(job.outbox[0].state,'PUBLISHED');assert.equal(job.execution.length,1);
   assert.equal(job.run.eu_source_held,false);
   await sqlRejected(pool,'UPDATE opportunity_catalog.funding_run SET eu_source_held=true,result_count=result_count+1 WHERE run_id=$1',[oldJob.runId],'OPPORTUNITY_V2_SOURCE_CONTROL_INVALID');
  });
  const repository=createFundingRepository({pool,euSourceControlEnabled:true});
  let collected=[],flightBarrier=null;worker=require('../../../backend/src/fundingTenders/worker').createFundingWorker({pool,queue,repository,source:{async collect(input){collected.push(input.source);if(input.source==='EU_FUNDING_TENDERS'&&flightBarrier){const barrier=flightBarrier;flightBarrier=null;await barrier();}return {records:[],received:0,failed:0,limited:false,observedAt:new Date().toISOString()};}}});
  const prepareBody={requestId:randomUUID(),archive,expected:expected(legacy)};let plan,approved,source;
  await check('HTTP_REAL_SESSION_CSRF_ORIGIN_AND_CENTRAL_AUTHORITY',async()=>{
   for(const actor of [orgAdmin,stale])assert.equal((await http.request(actor,'GET','/plans')).status,403);
   assert.equal((await http.request(admin,'POST','/plans',prepareBody,{csrf:false})).status,403);
   assert.equal((await http.request(admin,'POST','/plans',prepareBody,{csrf:'invalid'})).status,403);
   assert.equal((await http.request(admin,'POST','/plans',prepareBody,{origin:'https://foreign.example.invalid'})).status,403);
   assert.equal((await http.request(admin,'POST','/plans',{...prepareBody,actor:{type:'HUMAN',id:admin.id}})).status,400);
   assert.equal((await http.request(admin,'POST','/plans?actorId='+admin.id,prepareBody)).status,400);
   assert.equal((await http.request(admin,'POST','/plans/'+randomUUID()+'/accept',{})).status,405);
   await pool.query("UPDATE public.platform_admin_assignment SET status='REVOKED' WHERE id=$1",[admin.assignmentId]);
   assert.equal((await http.request(admin,'GET','/plans')).status,403);
   await pool.query("UPDATE public.platform_admin_assignment SET status='ACTIVE' WHERE id=$1",[admin.assignmentId]);
   const sessionRevoked=await seedHttpActor(pool);
   await fixtureAuthorityMutation(pool,sessionRevoked,"UPDATE public.application_session SET status='REVOKED',revoked_at=clock_timestamp() WHERE sid=$1",[sessionRevoked.sessionId]);
   assert.equal((await http.request(sessionRevoked,'GET','/plans')).status,401);
  });
  await check('HTTP_VERIFIED_11145_FACTS_PREVIEW_AND_APPROVAL_AUDIT',async()=>{
   const prepared=await http.request(admin,'POST','/plans',prepareBody);assert.equal(prepared.status,201);plan=prepared.data;assert.equal(plan.state,'DRAFT');
   const detail=await http.request(admin,'GET','/plans/'+plan.planId);assert.equal(detail.status,200);assert.equal(detail.cacheControl,'no-store');
   assert.deepEqual(detail.data.candidate.snapshot,archived.snapshot);assert.deepEqual(detail.data.accepted.snapshot,legacy.snapshot);assert.equal(detail.data.review.currentPreviewMatches,true);
   assert.equal(detail.data.candidate.snapshot.financing.allocations.value[0].money.amount,'120000');assert.equal(detail.data.candidate.snapshot.schedule.deadlines.value.length,7);
   const listed=await http.request(admin,'GET','/plans');assert.equal(listed.status,200);assert(listed.data.items.some(item=>item.planId===plan.planId));
   const decision={requestId:randomUUID(),planDigest:plan.planDigest};
   const results=await Promise.all([http.request(admin,'POST','/plans/'+plan.planId+'/approve',decision),http.request(admin,'POST','/plans/'+plan.planId+'/approve',decision)]);
   assert(results.every(response=>response.status===200));assert.equal(results.filter(response=>response.data.replayed).length,1);approved=results[0].data;
   assert.equal(approved.state,'APPROVED');
   const composition=require('../../../backend/src/opportunities/v2/activationComposition').createOpportunityActivationV2({pool,policyVersion,recentMfaRequirement});
   await assert.rejects(composition.accept({requestId:randomUUID(),planId:plan.planId,fence:approved.fence,sourceFence:1},admin.context),{code:'OPPORTUNITY_V2_EU_NOT_QUIESCENT'});
   assert.equal((await pool.query('SELECT current_schema_version FROM opportunity_catalog.opportunity WHERE opportunity_id=$1',[legacy.opportunityId])).rows[0].current_schema_version,1);
  });
  await check('HTTP_SUSPEND_DRAINS_INFLIGHT_AND_FENCES_ALL_EU_SELECTIONS',async()=>{
   const current=await http.request(admin,'GET','/sources/eu');assert.equal(current.status,200);assert.equal(current.data.state,'ACTIVE');assert.equal(current.data.fence,1);
   await pool.query("UPDATE opportunity_catalog.funding_run SET lease_until=clock_timestamp()+interval '3 seconds' WHERE run_id=$1",[oldJob.runId]);
   const command={requestId:randomUUID(),expectedFence:1};const suspended=await http.request(admin,'POST','/sources/eu/suspend',command);assert.equal(suspended.status,200);source=suspended.data;assert.equal(source.state,'SUSPEND_REQUESTED');assert.equal(source.fence,2);
   const repeated=await http.request(admin,'POST','/sources/eu/suspend',command);assert.equal(repeated.status,200);assert.equal(repeated.data.replayed,true);
   const early=await http.request(admin,'POST','/sources/eu/quiesce',{requestId:randomUUID(),expectedFence:2});assert.equal(early.status,409);assert.equal(early.data.error.code,'OPPORTUNITY_V2_EU_NOT_QUIESCENT');
   for(const selection of ['EU_FUNDING_TENDERS','CORDIS','ERASMUS']){
    await assert.rejects(repository.enqueue(admin.id,randomUUID(),selection),{code:'OPPORTUNITY_V2_EU_SUSPENDED'});
    await sqlRejected(pool,"INSERT INTO opportunity_catalog.funding_run(run_id,request_id,requested_by,status,source_code) VALUES($1,$2,$3,'QUEUED',$4)",[randomUUID(),randomUUID(),admin.id,selection],'OPPORTUNITY_V2_EU_SUSPENDED');
   }
   await sqlRejected(pool,'UPDATE opportunity_catalog.funding_identity SET observed_at=observed_at WHERE external_identifier=$1',['CASCADE:11145'],'OPPORTUNITY_V2_EU_SUSPENDED');
   await assert.rejects(oldRepository.claim(oldJob.runId),error=>error.code==='P0001'&&error.message==='OPPORTUNITY_V2_EU_SUSPENDED'||error.code==='FUNDING_BUSY');
  });
  await check('HTTP_PAUSED_EU_TRANSPORT_IS_DEFERRED_WITH_DURABLE_LINEAGE',async()=>{
   const before=await durableJob(pool,oldJob.runId);assert.deepEqual(await worker.runOnce(),['DEFERRED']);
   const after=await durableJob(pool,oldJob.runId);assert.deepEqual(after,before);assert.equal(collected.length,0);assert.equal(after.inbox.length,0);
   const queueId=(await pool.query('SELECT queue_id FROM async_exec.outbox WHERE outbox_id=$1',[before.outbox[0].outbox_id])).rows[0].queue_id;
   const transport=await queue.getState({type:'funding_tenders.refresh',id:queueId});assert.equal(transport[0].state,'completed');assert.equal(transport[0].output.code,'SOURCE_SUSPENDED');
   const official=await repository.enqueue(admin.id,randomUUID(),'INTERREG_EUROPE');
   await assert.rejects(repository.enqueue(admin.id,randomUUID(),'POCTEP'),{code:'FUNDING_BUSY'});
   await assert.rejects(runtimeTransaction(pool,client=>client.query("INSERT INTO opportunity_catalog.funding_run(run_id,request_id,requested_by,status,source_code) VALUES($1,$2,$3,'QUEUED','POCTEP')",[randomUUID(),randomUUID(),admin.id])),{code:'23505'});
   assert.deepEqual(await worker.runOnce(),['SUCCESS']);assert.equal((await pool.query('SELECT status FROM opportunity_catalog.funding_run WHERE run_id=$1',[official.runId])).rows[0].status,'SUCCESS');
   const crossBorder=await repository.enqueue(admin.id,randomUUID(),'POCTEP');assert.deepEqual(await worker.runOnce(),['SUCCESS']);assert.equal((await pool.query('SELECT status FROM opportunity_catalog.funding_run WHERE run_id=$1',[crossBorder.runId])).rows[0].status,'SUCCESS');assert.deepEqual(collected,['INTERREG_EUROPE','POCTEP']);
  });
  await check('HTTP_QUIESCENCE_RESUME_REARMS_EXACT_JOB_AND_REJECTS_OLD_FENCE',async()=>{
   const deadline=Date.now()+6000;while(Date.now()<deadline){const state=await http.request(admin,'GET','/sources/eu');if(state.data.canQuiesce)break;await new Promise(resolve=>setTimeout(resolve,100));}
   const quiet=await http.request(admin,'POST','/sources/eu/quiesce',{requestId:randomUUID(),expectedFence:2});assert.equal(quiet.status,200);source=quiet.data;assert.equal(source.state,'QUIESCED');assert.equal(source.fence,3);
   const before=await durableJob(pool,oldJob.runId);const resumed=await http.request(admin,'POST','/sources/eu/resume',{requestId:randomUUID(),expectedFence:3});assert.equal(resumed.status,200);assert.equal(resumed.data.state,'ACTIVE');assert.equal(resumed.data.fence,4);
   const after=await durableJob(pool,oldJob.runId);assert.deepEqual(immutableOutbox(after.outbox),immutableOutbox(before.outbox));assert.equal(after.outbox[0].state,'PENDING');assert.equal(before.run.eu_source_held,true);assert.equal(after.run.eu_source_held,false);assert.deepEqual({...after.run,eu_source_held:true},before.run);assert.deepEqual(after.execution,before.execution);
   await sqlRejected(pool,'UPDATE opportunity_catalog.funding_run SET collected=collected WHERE run_id=$1',[oldJob.runId],'OPPORTUNITY_V2_SOURCE_FENCE_STALE');
   for(const mutation of ["created_at=created_at+interval '1 second'",'result_count=result_count+1'])await sqlRejected(pool,"UPDATE opportunity_catalog.funding_run SET status='RUNNING',started_at=COALESCE(started_at,clock_timestamp()),lease_until=clock_timestamp()+interval '30 seconds',fence=fence+1,"+mutation+' WHERE run_id=$1',[oldJob.runId],'OPPORTUNITY_V2_SOURCE_CONTROL_INVALID');
   assert.deepEqual(await worker.runOnce(),['SUCCESS']);const complete=await durableJob(pool,oldJob.runId);assert.equal(complete.run.status,'SUCCESS');assert.equal(complete.run.eu_source_fence,4);assert.equal(Number(complete.run.fence),Number(oldRun.fence)+1);assert.equal(complete.inbox[0].state,'COMPLETED');assert.deepEqual(immutableOutbox(complete.outbox),immutableOutbox(before.outbox));
   await sqlRejected(pool,"UPDATE opportunity_catalog.funding_run SET status='RUNNING',lease_until=clock_timestamp()+interval '30 seconds',fence=fence+1 WHERE run_id=$1",[oldJob.runId],'OPPORTUNITY_V2_SOURCE_CONTROL_INVALID');
  });
  let activeFence=4;
  async function drainAndResume(pauseFence){
   const deadline=Date.now()+7000;while(Date.now()<deadline){if((await http.request(admin,'GET','/sources/eu')).data.canQuiesce)break;await new Promise(resolve=>setTimeout(resolve,100));}
   const quiet=await http.request(admin,'POST','/sources/eu/quiesce',{requestId:randomUUID(),expectedFence:pauseFence});assert.equal(quiet.status,200);
   const resumed=await http.request(admin,'POST','/sources/eu/resume',{requestId:randomUUID(),expectedFence:quiet.data.fence});assert.equal(resumed.status,200);activeFence=resumed.data.fence;return resumed.data;
  }
  await check('HTTP_ENQUEUE_AND_CLAIM_LOCK_ORDER_SERIALIZES_WITH_PAUSE',async()=>{
   let job;
   for(const action of ['enqueue','claim']){
    let entered,release,timer,intercepted=false,pause,operation;
    const arrived=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});
    const probePool={async connect(){const client=await pool.connect();return {release:()=>client.release(),async query(sql,values){
     if(action==='enqueue'&&!intercepted&&sql.startsWith('INSERT INTO opportunity_catalog.funding_run(')){intercepted=true;entered();await held;}
     const result=await client.query(sql,values);
     if(action==='claim'&&!intercepted&&sql==='SELECT * FROM opportunity_catalog.funding_run WHERE run_id=$1 FOR UPDATE'){intercepted=true;entered();await held;}
     if(action==='claim'&&sql.startsWith("UPDATE opportunity_catalog.funding_run SET status='RUNNING'"))await client.query("UPDATE opportunity_catalog.funding_run SET lease_until=clock_timestamp()+interval '2 seconds' WHERE run_id=$1",[job.runId]);
     return result;
    }};}};
    const probing=createFundingRepository({pool:probePool,euSourceControlEnabled:true});
    operation=action==='enqueue'?probing.enqueue(admin.id,randomUUID(),'ERASMUS'):probing.claim(job.runId);operation.catch(()=>{});
    try{
     await Promise.race([arrived,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ISOLATED_ADMISSION_BARRIER_TIMEOUT')),10000);})]);clearTimeout(timer);
     let settled=false;pause=http.request(admin,'POST','/sources/eu/suspend',{requestId:randomUUID(),expectedFence:activeFence}).then(value=>{settled=true;return value;});
     await new Promise(resolve=>setTimeout(resolve,100));assert.equal(settled,false);release();const result=await operation;if(action==='enqueue')job=result;
     const paused=await pause;assert.equal(paused.status,200);assert.equal(paused.data.fence,activeFence+1);await drainAndResume(paused.data.fence);
    }finally{clearTimeout(timer);release();await operation.catch(()=>{});if(pause)await pause;}
   }
   let enteredProjection,releaseProjection,projectionTimer,pausing;
   const projectionArrived=new Promise(resolve=>{enteredProjection=resolve;}),projectionHeld=new Promise(resolve=>{releaseProjection=resolve;});
   const controlledProjection=require('../../../backend/src/async/executionLineageProjection').createExecutionLineageProjection({transaction:repository.transaction});
   const probingRelay=new(require('../../../backend/src/async/outboxRelay').OutboxRelay)({repository:outbox,queue,transaction:repository.transaction,workerId:'activation-isolated-concurrent-relay',projectionPort:{async project(input){enteredProjection();await projectionHeld;return controlledProjection.project(input);}}});
   const publishing=probingRelay.poll();publishing.catch(()=>{});
   try{
    await Promise.race([projectionArrived,new Promise((_,reject)=>{projectionTimer=setTimeout(()=>reject(Error('ISOLATED_RELAY_BARRIER_TIMEOUT')),10000);})]);clearTimeout(projectionTimer);
    let done=false;pausing=http.request(admin,'POST','/sources/eu/suspend',{requestId:randomUUID(),expectedFence:activeFence}).then(value=>{done=true;return value;});await new Promise(resolve=>setTimeout(resolve,100));assert.equal(done,false);
    releaseProjection();assert.deepEqual(await publishing,['PUBLISHED']);const paused=await pausing;assert.equal(paused.status,200);
    assert.deepEqual(await worker.runOnce(),['DEFERRED']);await drainAndResume(paused.data.fence);
   }finally{clearTimeout(projectionTimer);releaseProjection();await publishing.catch(()=>{});if(pausing)await pausing;}
   const before=await durableJob(pool,job.runId);assert.deepEqual(await worker.runOnce(),['SUCCESS']);const after=await durableJob(pool,job.runId);assert.equal(after.run.status,'SUCCESS');assert.equal(after.run.eu_source_fence,activeFence);assert.deepEqual(immutableOutbox(after.outbox),immutableOutbox(before.outbox));
  });
  await check('HTTP_OLD_INFLIGHT_HANDLER_CANNOT_COMMIT_AFTER_RESUME',async()=>{
   const job=await repository.enqueue(admin.id,randomUUID(),'EU_FUNDING_TENDERS');let entered,release,timer;
   const arrived=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});flightBarrier=async()=>{entered();await held;};
   const flight=worker.runOnce();flight.catch(()=>{});
   try{
    await Promise.race([arrived,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ISOLATED_SOURCE_BARRIER_TIMEOUT')),10000);})]);clearTimeout(timer);
    // Shorten only disposable execution leases while the source is active. The
    // immutable envelope deadline/attempt are never changed or extended.
    await pool.query("UPDATE opportunity_catalog.funding_run SET lease_until=clock_timestamp()+interval '2 seconds' WHERE run_id=$1",[job.runId]);
    await pool.query("UPDATE async_exec.inbox SET lease_until=clock_timestamp()+interval '2 seconds' WHERE organization_id IS NULL AND idempotency_key=$1",[job.runId]);
    const initialFence=activeFence,suspended=await http.request(admin,'POST','/sources/eu/suspend',{requestId:randomUUID(),expectedFence:initialFence});assert.equal(suspended.status,200);assert.equal(suspended.data.fence,initialFence+1);
    assert.equal((await http.request(admin,'POST','/sources/eu/quiesce',{requestId:randomUUID(),expectedFence:initialFence+1})).status,409);
    const deadline=Date.now()+6000;while(Date.now()<deadline){if((await http.request(admin,'GET','/sources/eu')).data.canQuiesce)break;await new Promise(resolve=>setTimeout(resolve,100));}
    const quiet=await http.request(admin,'POST','/sources/eu/quiesce',{requestId:randomUUID(),expectedFence:initialFence+1});assert.equal(quiet.status,200);assert.equal(quiet.data.fence,initialFence+2);
    const resumed=await http.request(admin,'POST','/sources/eu/resume',{requestId:randomUUID(),expectedFence:initialFence+2});assert.equal(resumed.status,200);activeFence=resumed.data.fence;assert.equal(activeFence,initialFence+3);
    const before=await durableJob(pool,job.runId);release();await assert.rejects(flight,error=>['FUNDING_FENCE_STALE','OPPORTUNITY_V2_SOURCE_FENCE_STALE'].includes(error.code));assert.deepEqual(await durableJob(pool,job.runId),before);
    assert.equal(before.run.status,'RUNNING');assert.equal(before.outbox[0].state,'PENDING');assert.equal(before.inbox[0].state,'PROCESSING');
    assert.deepEqual(await worker.runOnce(),['SUCCESS']);const completed=await durableJob(pool,job.runId);assert.equal(completed.run.status,'SUCCESS');assert.equal(completed.run.eu_source_fence,activeFence);assert.equal(completed.inbox[0].state,'COMPLETED');assert.deepEqual(immutableOutbox(completed.outbox),immutableOutbox(before.outbox));
   }finally{clearTimeout(timer);release();await flight.catch(()=>{});}
  });
  await check('HTTP_DEADLINE_CROSSING_AFTER_RESUME_TERMINATES_WITHOUT_EXTENSION',async()=>{
   const runId=randomUUID(),now=(await pool.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime(),createdAt=new Date(now-294000).toISOString(),deadlineAt=new Date(now+6000).toISOString();
   const uuid=require('../../../backend/src/audit/uuidV7').createUuidV7;
   const envelope={envelopeVersion:3,authority:'CENTRAL',jobType:'funding_tenders.refresh',jobVersion:1,payloadVersion:1,organizationId:null,actor:{kind:'SERVICE',serviceActorCode:'FUNDING_TENDERS_CENTRAL'},operation:'opportunity.central.manage',correlationId:uuid(),causationId:uuid(),idempotencyKey:runId,executionId:runId,createdAt,deadlineAt,payload:{runId},observability:{version:1,traceparent:null,tracestate:null}};
   const validated=require('../../../backend/src/async/envelope').validateEnvelope(envelope,{supports:()=>true});
   await repository.transaction(async client=>{await client.query("INSERT INTO opportunity_catalog.funding_run(run_id,request_id,requested_by,source_code,status,created_at) VALUES($1,$2,$3,'ERASMUS','QUEUED',$4)",[runId,randomUUID(),admin.id,createdAt]);await outbox.enqueueLineage(client,{organizationId:null,logicalId:'funding:'+runId,envelope,lineage:{deliveryKind:'INITIAL',attempt:1,rootExecutionId:runId,previousExecutionId:null,contentDigest:validated.contentDigest,envelopeDigest:validated.envelopeDigest,replayRequestId:null}});});
   const paused=await http.request(admin,'POST','/sources/eu/suspend',{requestId:randomUUID(),expectedFence:activeFence});assert.equal(paused.status,200);await drainAndResume(paused.data.fence);
   const before=await durableJob(pool,runId);const waitUntil=Date.now()+8000;while(Date.now()<waitUntil){if((await pool.query('SELECT clock_timestamp()>$1::timestamptz AS expired',[deadlineAt])).rows[0].expired)break;await new Promise(resolve=>setTimeout(resolve,100));}
   assert.deepEqual(await worker.runOnce(),['EXPIRED']);const after=await durableJob(pool,runId);assert.equal(after.run.status,'ERROR');assert.equal(after.run.eu_source_fence,activeFence);assert.equal(Number(after.run.fence),Number(before.run.fence)+1);assert.deepEqual(immutableOutbox(after.outbox),immutableOutbox(before.outbox));assert.equal(after.inbox.length,0);
   assert.equal((await pool.query('SELECT error_code FROM opportunity_catalog.funding_run WHERE run_id=$1',[runId])).rows[0].error_code,'FUNDING_EXECUTION_EXPIRED');
  });
  await check('HTTP_SOURCE_AUDIT_FAILURE_ROLLS_BACK_CONTROL_AND_RECEIPT',async()=>{
   const before=(await http.request(admin,'GET','/sources/eu')).data,receipts=Number((await pool.query('SELECT count(*)::int AS n FROM opportunity_catalog.eu_source_control_receipt_v2')).rows[0].n);
   await pool.query("CREATE SCHEMA activation_http_evidence;REVOKE ALL ON SCHEMA activation_http_evidence FROM PUBLIC;CREATE FUNCTION activation_http_evidence.reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ISOLATED_HTTP_AUDIT_FAILURE'; END $$;CREATE TRIGGER activation_http_reject_audit BEFORE INSERT ON audit.event FOR EACH ROW EXECUTE FUNCTION activation_http_evidence.reject_audit()");
   try{assert.equal((await http.request(admin,'POST','/sources/eu/suspend',{requestId:randomUUID(),expectedFence:activeFence})).status,503);assert.deepEqual((await http.request(admin,'GET','/sources/eu')).data,before);assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM opportunity_catalog.eu_source_control_receipt_v2')).rows[0].n),receipts);}finally{await pool.query('DROP TRIGGER activation_http_reject_audit ON audit.event');}
  });
  await check('HTTP_SUSPENSION_WAITS_FOR_OLD_SQL_WRITER_AND_EU_ACCEPT_REQUIRES_NEW_FENCE',async()=>{
   const writer=await pool.connect();let paused;
   try{await writer.query('BEGIN');await writer.query('SET LOCAL ROLE c4g_opportunity_central_runtime');await writer.query("UPDATE opportunity_catalog.funding_identity SET observed_at=observed_at WHERE external_identifier='CASCADE:11145'");
    let done=false;paused=http.request(admin,'POST','/sources/eu/suspend',{requestId:randomUUID(),expectedFence:activeFence}).then(value=>{done=true;return value;});await new Promise(resolve=>setTimeout(resolve,150));assert.equal(done,false);await writer.query('COMMIT');assert.equal((await paused).status,200);
   }finally{await writer.query('ROLLBACK').catch(()=>{});writer.release();if(paused)await paused;}
   const quiet=await http.request(admin,'POST','/sources/eu/quiesce',{requestId:randomUUID(),expectedFence:activeFence+1});assert.equal(quiet.status,200);assert.equal(quiet.data.fence,activeFence+2);
   const composition=require('../../../backend/src/opportunities/v2/activationComposition').createOpportunityActivationV2({pool,policyVersion,recentMfaRequirement});
   await assert.rejects(composition.accept({requestId:randomUUID(),planId:plan.planId,fence:approved.fence,sourceFence:3},admin.context),{code:'OPPORTUNITY_V2_SOURCE_FENCE_STALE'});
   const accepted=await composition.accept({requestId:randomUUID(),planId:plan.planId,fence:approved.fence,sourceFence:quiet.data.fence},admin.context);assert.equal(accepted.opportunityId,legacy.opportunityId);
   const resume=await http.request(admin,'POST','/sources/eu/resume',{requestId:randomUUID(),expectedFence:quiet.data.fence});assert.equal(resume.status,409);assert.equal(resume.data.error.code,'OPPORTUNITY_V2_EU_LEGACY_RESUME_BLOCKED');
   report.httpAccepted={opportunityId:accepted.opportunityId,sourceFence:quiet.data.fence,amount:'120000',cutoffs:7,endpointExposed:false};
  });
  await check('HTTP_AUDIT_CHAIN_FINGERPRINTS_AND_PRESERVED_PRIVATE_BOUNDARY',async()=>{
   const events=(await pool.query("SELECT event_data,event_hash FROM audit.event WHERE organization_id IS NULL AND stream_id='PLATFORM:DATA' ORDER BY sequence")).rows.map(row=>({...row.event_data,eventHash:row.event_hash}));assert.equal(require('../../../backend/src/audit/verifier').verifyEvents(events).valid,true);
   for(const code of ['OPPORTUNITY_SOURCE_SUSPENSION_REQUESTED','OPPORTUNITY_SOURCE_QUIESCED','OPPORTUNITY_SOURCE_RESUMED'])assert(events.some(event=>event.eventCode===code));
   assert(!JSON.stringify(events).includes(admin.sessionId));assert(!JSON.stringify(events).includes('@example.invalid'));
   const central=require('../../../backend/src/security/centralSchemaManifest'),tenant=require('../../../backend/src/security/tenantSchemaFingerprint');
   report.httpFingerprints={central:central.schemaFingerprint(await central.centralSchemaSnapshot(pool)),tenant:tenant.tenantSchemaFingerprint(await tenant.tenantSchemaSnapshot(tenantPool)),registered:false};
   report.httpProof={signedCookie:true,persistedSession:true,realAuthenticationMiddleware:true,realCsrfAndOrigin:true,sessionStoreTouchDisabled:true,oidcProviderLogin:false,sourceFamily:['EU_FUNDING_TENDERS','CORDIS','ERASMUS'],officialSourceUnaffected:true,pgBossReal:true,durableDeferral:true,staleInflightEpochRejected:true,exactResume:true,auditEvents:events.length,auditChainValid:true,habitualEnvironmentAccess:false};
  });
 }finally{await http.close();if(worker)await worker.shutdown();else if(queue)await queue.shutdown();}
}
module.exports={activationHttpProof,seedHttpActor,application,applyCandidates};
