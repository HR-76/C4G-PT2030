'use strict';
// Explicit operational browser client. Importing this module has no I/O.
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {validateEuWriterWindowPlan,planDigest,readSafe}=require('../backend/src/opportunities/v2/euWriterWindowPlan');
const {hash}=require('../backend/src/opportunities/v2/activationArchive');
const pkg=require('../backend/src/security/opportunityEuWriterMigrationPackage'),base=require('../backend/src/security/opportunityV2MigrationPackage');
const cfg=require('../backend/scripts/localPlatform/config');
const ORIGIN='http://localhost:3000',ISSUER='https://localhost:8443/realms/c4g-native-local';
const SOURCE='/api/admin/opportunity-activation/sources/eu',FUNDING='/api/admin/integrations/funding-tenders';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{64}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function fail(code){throw Object.assign(Error(code),{code});}
function check(ok,code='CONTROLLED_CYCLE_INVALID'){if(!ok)fail(code);}
function safeCode(error){return /^(CONTROLLED_|OPPORTUNITY_V2_|FUNDING_|AUTH_|SESSION_|CSRF_)[A-Z0-9_]{1,110}$/.test(error?.code||'')?error.code:'CONTROLLED_OPERATION_FAILED';}
function args(argv){check(Array.isArray(argv)&&argv.length===1&&/^--execution=output\/opportunity-eu-writer-execution-[a-f0-9-]{36}\/window\.json$/.test(argv[0]));const file=argv[0].slice(12);check(UUID.test(file.split('/')[1].slice('opportunity-eu-writer-execution-'.length)));return file;}
function httpCommand(method,url,body){
 if(method==='GET'){check(body===undefined&&['/api/auth/session',SOURCE,FUNDING].includes(url),'CONTROLLED_HTTP_SCOPE_INVALID');return;}
 check(method==='POST','CONTROLLED_HTTP_SCOPE_INVALID');
 if(url===FUNDING)check(exact(body,['requestId','source'])&&UUID.test(body.requestId)&&body.source==='EU_FUNDING_TENDERS','CONTROLLED_HTTP_SCOPE_INVALID');
 else check(['writer','resume','suspend','quiesce'].some(action=>url===SOURCE+'/'+action)&&exact(body,['requestId','expectedFence'])&&UUID.test(body.requestId)&&Number.isSafeInteger(body.expectedFence)&&body.expectedFence>0,'CONTROLLED_HTTP_SCOPE_INVALID');
}
function validateExecution(execution,rawPlan,now=Date.now()){
 const plan=validateEuWriterWindowPlan(rawPlan,now);
 check(execution?.kind==='eu-writer-execution-window-v1'&&UUID.test(execution.executionId)&&execution.windowId===plan.windowId&&execution.status==='INSTALLED_AWAITING_CONTROLLED_CYCLE'&&execution.planDigest===planDigest(plan)&&execution.packageDigest===pkg.packageDigest,'CONTROLLED_EXECUTION_PROOF_INVALID');
 check(execution.installed?.centralVersion===pkg.entry.version&&execution.installed.centralFingerprint===pkg.entry.schemaFingerprint&&execution.installed.tenantVersion===base.tenantAddition.version&&execution.installed.tenantFingerprint===base.tenantAddition.schemaFingerprint&&execution.healthRestored===true,'CONTROLLED_INSTALLED_PACKAGE_REQUIRED');
 check(execution.source?.state==='QUIESCED'&&execution.source.fence===plan.source.fence&&UUID.test(execution.approval?.actorId)&&UUID.test(execution.approval.eventId)&&SHA.test(execution.approval.eventHash),'CONTROLLED_APPROVAL_BINDING_INVALID');
 return plan;
}
function publicArtifact(root,reference){check(exact(reference,['path','sha256'])&&reference.path.startsWith('output/')&&reference.path.endsWith('.json')&&SHA.test(reference.sha256),'CONTROLLED_ARTIFACT_INVALID');const bytes=readSafe(root,reference.path);check(sha(bytes)===reference.sha256,'CONTROLLED_ARTIFACT_CHANGED');return JSON.parse(bytes);}
function loadExecution(relative,root=cfg.root){
 args(['--execution='+relative]);const bytes=readSafe(root,relative),execution=JSON.parse(bytes);check(path.basename(path.dirname(relative))==='opportunity-eu-writer-execution-'+execution.executionId);
 const plan=publicArtifact(root,execution.plan);validateExecution(execution,plan);
 const approval=publicArtifact(root,{path:execution.approval.path,sha256:execution.approval.sha256}),receipt=approval.result?.approval;
 check(approval.kind==='eu-writer-window-authenticated-approval-v1'&&approval.status==='PASS'&&approval.windowId===plan.windowId&&approval.planDigest===execution.planDigest&&approval.result?.replayVerified===true&&receipt?.scope==='PREPARATION_ONLY'&&receipt.windowId===plan.windowId&&receipt.planDigest===execution.planDigest&&receipt.actorId===execution.approval.actorId&&receipt.eventId===execution.approval.eventId&&receipt.eventHash===execution.approval.eventHash&&receipt.expiresAt===plan.expiresAt,'CONTROLLED_APPROVAL_BINDING_INVALID');
 const runtimeFile='.tmp/local-platform/runtime.json',config=execution.config,descriptor={packageId:pkg.PACKAGE_ID,...plan.writer};
 check(config&&config.runtimeBeforeSha256===plan.inputs[runtimeFile]&&SHA.test(config.runtimeAfterSha256)&&SHA.test(config.unchangedRuntimeDigest)&&isDeepStrictEqual(config.changedKeys,['opportunityEuWriter'])&&isDeepStrictEqual(config.writerDescriptor,descriptor),'CONTROLLED_CONFIGURATION_PROOF_INVALID');
 const runtimeBytes=readSafe(root,runtimeFile),runtime=JSON.parse(runtimeBytes),without={...runtime};delete without.opportunityEuWriter;
 check(sha(runtimeBytes)===config.runtimeAfterSha256&&hash(without)===config.unchangedRuntimeDigest&&isDeepStrictEqual(runtime.opportunityEuWriter,descriptor),'CONTROLLED_CONFIGURATION_CHANGED');
 for(const [file,expected]of Object.entries(plan.inputs))if(file!==runtimeFile)check(sha(readSafe(root,file))===expected,'CONTROLLED_INPUT_CHANGED');
 for(const reference of Object.values(plan.evidence))publicArtifact(root,reference);
 return{execution,plan,executionDigest:sha(bytes),relative};
}
function administrator(value){check(UUID.test(value?.user?.id)&&value.user.platformRoles?.includes('C4G_ADMIN'),'CONTROLLED_ADMINISTRATOR_REQUIRED');return value.user.id;}
function sourceValue(value){check(value?.family==='EU_FUNDING_TENDERS'&&['ACTIVE','SUSPEND_REQUESTED','QUIESCED'].includes(value.state)&&Number.isSafeInteger(value.fence)&&value.fence>0&&['activeLeases','pendingRuns','queuedRuns','otherPendingRuns'].every(k=>Number.isSafeInteger(value[k])&&value[k]>=0),'CONTROLLED_SOURCE_INVALID');return value;}
function configured(source,plan){return source.writerMode==='CANONICAL_V2'&&source.writerPolicy===plan.writer.policyVersion&&source.writerMappingDigest===plan.writer.mappingDigest;}
function workerReady(value,plan){const worker=value?.worker;check(worker?.ready===true&&worker.euWriterSupported===true&&worker.euWriterPolicyVersion===plan.writer.policyVersion&&worker.euWriterMappingDigest===plan.writer.mappingDigest&&['coverageSupported','refreshSupported','resolutionSupported','enrichmentSupported','discoveryDetailSupported'].every(k=>worker[k]===true),'CONTROLLED_WORKER_NOT_READY');}
async function runControlledCycle({execution,plan,openSession,validate=validateExecution,clock=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onProgress=async()=>{}}){
 validate(execution,plan,clock());check(typeof openSession==='function');
 const ids=Object.fromEntries(['configure','resume','enqueue','suspend','quiesce'].map(k=>[k,randomUUID()]));
 const result={status:'FAIL',logicalCyclesRequested:0,transportAttempts:{},requestIds:ids,finalSuspensionVerified:false};let session,cycle,observationStarted,initialVerified=false,configuredFence=null,ownResumeFence=null,ownSuspendFence=null;
 async function progress(event,safety=false){try{await onProgress({...event,at:new Date(clock()).toISOString()});}catch{if(!safety)fail('CONTROLLED_JOURNAL_FAILED');result.journalFailure=true;}}
 async function ensureSession(){
  if(session&&Number.isFinite(session.authenticatedAt)&&clock()>=session.authenticatedAt&&clock()-session.authenticatedAt<180000)return;
  const previous=session,next=await openSession();try{check(Number.isFinite(next.authenticatedAt)&&clock()>=next.authenticatedAt&&clock()-next.authenticatedAt<180000,'CONTROLLED_REAUTHENTICATION_REQUIRED');check(administrator(await next.request('GET','/api/auth/session'))===execution.approval.actorId,'CONTROLLED_ACTOR_CHANGED');}catch(e){await next.close().catch(()=>{});throw e;}
  session=next;if(previous)await previous.close().catch(()=>{});
 }
 async function request(method,url,body,status=200,stage=null,safety=false){
  if(result.journalFailure&&!safety)fail('CONTROLLED_JOURNAL_FAILED');
  await ensureSession();httpCommand(method,url,body);
  if(method==='POST'){
   if(!safety)validate(execution,plan,clock());
   result.transportAttempts[stage]=(result.transportAttempts[stage]||0)+1;await progress({stage,status:'ATTEMPTING',request:body},safety);
   await ensureSession();if(!safety)validate(execution,plan,clock());
   if(stage==='configure')configuredFence=body.expectedFence+1;
  }
  // Preserve a confirmed response even if the response journal fails: control()
  // must establish ownership before the next normal step aborts for cleanup.
  try{const value=await session.request(method,url,body,status);if(method==='POST')await progress({stage,status:'RESPONDED'},true);return value;}
  catch(e){if(e.status===401||e.status===403){const old=session;session=null;await old.close().catch(()=>{});}throw e;}
 }
 const uncertain=e=>e?.uncertain===true||!Number.isInteger(e?.status)||e.status>=500;
 const state=async safety=>sourceValue(await request('GET',SOURCE,undefined,200,null,safety));
 async function control(action,stage,before,desired,safety=false){
  const input={requestId:ids[stage],expectedFence:before.fence};let response;
  try{response=await request('POST',SOURCE+'/'+action,input,200,stage,safety);}
  catch(e){if(!uncertain(e))throw e;const current=await state(safety);check((current.fence===before.fence&&current.state===before.state)||(current.fence===before.fence+1&&current.state===desired),'CONTROLLED_SOURCE_FENCE_CHANGED');await progress({stage,status:'RECONCILING_SAME_INTENT',request:input},safety);response=await request('POST',SOURCE+'/'+action,input,200,stage,safety);}
  const value=sourceValue(response);check(value.state===desired&&value.fence===before.fence+1,'CONTROLLED_SOURCE_FENCE_CHANGED');
  // Only the response to this exact durable intention establishes ownership.
  // A competing operator may advance to the same numeric fence after our read.
  if(stage==='resume')ownResumeFence=value.fence;
  if(stage==='suspend')ownSuspendFence=value.fence;
  return value;
 }
 try{
  await progress({stage:'start',status:'PREPARED',executionId:execution.executionId,planDigest:execution.planDigest,requestIds:ids});
  let current=await state();check(current.state==='QUIESCED'&&current.fence===execution.source.fence&&current.activeLeases===0&&current.pendingRuns===0&&current.otherPendingRuns===0,'CONTROLLED_SOURCE_NOT_IDLE');
  initialVerified=true;
  workerReady(await request('GET',FUNDING),plan);
  if(current.writerMode==='LEGACY_V1')current=await control('writer','configure',current,'QUIESCED');
  else{check(configured(current,plan),'CONTROLLED_CONFIGURATION_CHANGED');await progress({stage:'configure',status:'CONFIGURATION_ALREADY_CURRENT'});}
  check(configured(current,plan),'CONTROLLED_CONFIGURATION_CHANGED');
  const checked=await state();check(checked.state==='QUIESCED'&&checked.fence===current.fence&&configured(checked,plan),'CONTROLLED_SOURCE_FENCE_CHANGED');workerReady(await request('GET',FUNDING),plan);
  current=await control('resume','resume',checked,'ACTIVE');check(configured(current,plan),'CONTROLLED_CONFIGURATION_CHANGED');
  const input={requestId:ids.enqueue,source:'EU_FUNDING_TENDERS'};result.logicalCyclesRequested=1;observationStarted=clock();
  try{cycle=await request('POST',FUNDING,input,202,'enqueue');}
  catch(e){if(!uncertain(e))throw e;const active=await state();check(active.state==='ACTIVE'&&active.fence===current.fence&&configured(active,plan),'CONTROLLED_SOURCE_FENCE_CHANGED');await progress({stage:'enqueue',status:'RECONCILING_SAME_INTENT',request:input});cycle=await request('POST',FUNDING,input,202,'enqueue');}
  check(UUID.test(cycle?.runId)&&cycle.source==='EU_FUNDING_TENDERS','CONTROLLED_RUN_INVALID');result.runId=cycle.runId;
  for(;;){
   const history=await request('GET',FUNDING),observed=history?.runs?.find(r=>r.runId===result.runId);check(observed&&observed.source==='EU_FUNDING_TENDERS'&&['QUEUED','RUNNING','SUCCESS','PARTIAL','ERROR'].includes(observed.status),'CONTROLLED_RUN_NOT_OBSERVABLE');cycle=observed;result.cycle=cycle;
   if(['SUCCESS','PARTIAL','ERROR'].includes(cycle.status)){result.stopReason='TERMINAL';result.status={SUCCESS:'PASS',PARTIAL:'PARTIAL',ERROR:'FAIL'}[cycle.status];if(cycle.status==='ERROR')result.failure='CONTROLLED_CYCLE_ERROR';break;}
   if(clock()-observationStarted>=plan.controlledCycle.observationWindowSeconds*1000){result.stopReason='OBSERVATION_WINDOW_ELAPSED';result.status='PAUSED_FOR_REVIEW';break;}
   await wait(Math.min(2000,plan.controlledCycle.observationWindowSeconds*1000-(clock()-observationStarted)));
  }
 }catch(e){result.status='FAIL';result.failure=safeCode(e);}
 finally{
  // Final safety action remains authorized even after the preparation expires.
  // Authentication is refreshed normally; no SERVICE/owner mutation exists.
  try{
   let current=await state(true);
   check(initialVerified,'CONTROLLED_SOURCE_FENCE_CHANGED');
   if(ownResumeFence===null)check(current.state==='QUIESCED'&&(current.fence===execution.source.fence||current.fence===configuredFence&&configured(current,plan)),'CONTROLLED_SOURCE_FENCE_CHANGED');
   else{
    check(configured(current,plan),'CONTROLLED_CONFIGURATION_CHANGED');
    if(current.state==='ACTIVE'){check(current.fence===ownResumeFence,'CONTROLLED_SOURCE_FENCE_CHANGED');current=await control('suspend','suspend',current,'SUSPEND_REQUESTED',true);}
    else if(current.state==='QUIESCED')check(current.fence===ownResumeFence-1||ownSuspendFence!==null&&current.fence===ownSuspendFence+1,'CONTROLLED_SOURCE_FENCE_CHANGED');
   }
   if(current.state==='SUSPEND_REQUESTED'){
    check(ownSuspendFence!==null&&current.fence===ownSuspendFence,'CONTROLLED_SOURCE_FENCE_CHANGED');
    const drainStarted=clock(),fence=current.fence;
    while(current.activeLeases!==0||current.canQuiesce!==true){check(clock()-drainStarted<180000,'CONTROLLED_DRAIN_TIMEOUT');await wait(1000);current=await state(true);check(current.state==='SUSPEND_REQUESTED'&&current.fence===fence,'CONTROLLED_SOURCE_FENCE_CHANGED');}
    current=await control('quiesce','quiesce',current,'QUIESCED',true);
   }
   const final=await state(true);check(final.state==='QUIESCED'&&final.fence===current.fence&&final.activeLeases===0,'CONTROLLED_FINAL_QUIESCENCE_REQUIRED');result.finalSource=final;result.finalSuspensionVerified=true;
   await progress({stage:'final-quiescence',status:'VERIFIED',source:final},true);
  }catch(e){result.cleanupFailure=safeCode(e);result.status='FAIL';}
  if(session)await session.close().catch(()=>{result.browserCleanup=false;});result.browserCleanup??=true;
 }
 if(result.journalFailure){result.status='FAIL';result.failure??='CONTROLLED_JOURNAL_FAILED';}
 return result;
}
async function browserSession({interactive=false,onNavigation=()=>{}}={}){
 const state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));check(state.identity?.origin===ORIGIN&&state.identity.issuer===ISSUER&&state.identity.policyVersion==='c4g-user-mfa-v1','CONTROLLED_IDENTITY_TARGET_INVALID');
 const access=interactive?null:JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json')));if(!interactive)check(typeof access.admin?.username==='string'&&access.admin.username&&typeof access.admin.password==='string'&&access.admin.password,'CONTROLLED_CREDENTIAL_REQUIRED');
 const {chromium}=require('../frontend/test-harness/node_modules/playwright'),browser=await chromium.launch({headless:!interactive,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(20000);let permitted=null;
  if(interactive){const observe=url=>{try{const value=new URL(url);onNavigation(value.origin+value.pathname);}catch{}};
   page.on('framenavigated',frame=>{if(frame===page.mainFrame())observe(frame.url());});
   context.on('page',opened=>{if(opened!==page)observe(opened.url());});}
  await context.route('**/*',route=>{const r=route.request(),url=new URL(r.url()),read=['GET','HEAD','OPTIONS'].includes(r.method());if(![ORIGIN,new URL(ISSUER).origin].includes(url.origin))return route.abort();if(url.origin===ORIGIN&&url.pathname.startsWith('/api/')&&!read&&!(permitted&&r.method()==='POST'&&url.pathname===permitted))return route.abort();if(url.origin===new URL(ISSUER).origin&&!read&&!(r.method()==='POST'&&url.pathname==='/realms/c4g-native-local/login-actions/authenticate'))return route.abort();return route.continue();});
  await page.goto(ORIGIN+'/api/auth/oidc/login?returnTo=%2Fadministracao%2Fdashboard');await page.locator('#username').waitFor();check(new URL(page.url()).origin===new URL(ISSUER).origin,'AUTH_INTERACTION_REQUIRED');
  const action=new URL(await page.locator('#kc-form-login').getAttribute('action'),page.url());check(action.origin===new URL(ISSUER).origin&&action.pathname==='/realms/c4g-native-local/login-actions/authenticate','AUTH_INTERACTION_REQUIRED');
  if(!interactive){await page.locator('#username').fill(access.admin.username);await page.locator('#password').fill(access.admin.password);await page.locator('#kc-login').click();}
  await page.waitForURL(url=>url.origin===ORIGIN&&!url.pathname.startsWith('/api/auth/'),{timeout:interactive?120000:30000});const authenticatedAt=Date.now();
  async function request(method,url,body,expectedStatus=200){httpCommand(method,url,body);permitted=method==='POST'?url:null;try{
   let response;try{response=await page.evaluate(async({method,url,body})=>{
    if(location.origin!=='http://localhost:3000')return{status:0,code:'CONTROLLED_ORIGIN_CHANGED'};const headers={Accept:'application/json'};
    if(method==='POST'){const csrf=await fetch('/api/auth/csrf',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});if(!csrf.ok)return{status:csrf.status,code:'CONTROLLED_CSRF_UNAVAILABLE'};const v=await csrf.json();if(typeof v.csrfToken!=='string'||!v.csrfToken)return{status:0,code:'CONTROLLED_CSRF_UNAVAILABLE'};headers['X-CSRF-Token']=v.csrfToken;headers['Content-Type']='application/json';}
    const r=await fetch(url,{method,credentials:'same-origin',cache:'no-store',redirect:'error',headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)}),reader=r.body.getReader(),chunks=[];let length=0;
    try{for(;;){const p=await reader.read();if(p.done)break;length+=p.value.byteLength;if(length>2*1024*1024)return{status:0,code:'CONTROLLED_HTTP_LIMIT'};chunks.push(p.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}const value=JSON.parse(new TextDecoder().decode(bytes));if(!r.ok)return{status:r.status,code:value?.error?.code};return{status:r.status,value:url==='/api/auth/session'?{user:{id:value.user?.id,platformRoles:value.user?.platformRoles}}:value};
   },{method,url,body});}catch{throw Object.assign(Error('CONTROLLED_HTTP_UNCERTAIN'),{code:'CONTROLLED_HTTP_UNCERTAIN',uncertain:true});}
   if(response.status!==expectedStatus)throw Object.assign(Error('CONTROLLED_HTTP_FAILED'),{code:safeCode({code:response.code}),status:response.status,uncertain:response.status===0||response.status>=500});return response.value;
  }finally{permitted=null;}}
  return{request,authenticatedAt,close:()=>browser.close()};
 }catch(e){await browser.close();throw e;}
}
async function main(argv=process.argv.slice(2)){
 const relative=args(argv),loaded=loadExecution(relative),folder=path.dirname(path.join(cfg.root,relative)),output=path.join(folder,'controlled-cycle.json');
 const report={kind:'eu-writer-controlled-cycle-v1',status:'IN_PROGRESS',executionId:loaded.execution.executionId,windowId:loaded.plan.windowId,planDigest:loaded.execution.planDigest,executionDigest:loaded.executionDigest,startedAt:new Date().toISOString(),credentialsExported:false,sessionFabricated:false,steps:[]};
 // A second invocation never creates another cycle from the same installation.
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});const save=()=>cfg.saveState(report,output);
 try{check(sha(readSafe(cfg.root,relative))===loaded.executionDigest,'CONTROLLED_EXECUTION_PROOF_CHANGED');report.result=await runControlledCycle({...loaded,openSession:browserSession,onProgress:async event=>{report.steps.push(event);save();}});report.status=report.result.status;}
 catch(e){report.status='FAIL';report.failure=safeCode(e);}
 finally{report.completedAt=new Date().toISOString();save();if(report.status==='FAIL')process.exitCode=1;console.log(JSON.stringify({status:report.status,finalSuspensionVerified:report.result?.finalSuspensionVerified===true,evidence:path.relative(cfg.root,output).replaceAll('\\','/')}));}
 return report;
}
if(require.main===module)main().catch(e=>{console.error(safeCode(e));process.exitCode=1;});
module.exports={args,httpCommand,validateExecution,loadExecution,runControlledCycle,browserSession,main};
