'use strict';
// Ordinary OIDC and CSRF. The browser can approve this preparation only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createUuidV7}=require('../backend/src/audit/uuidV7');
const cfg=require('../backend/scripts/localPlatform/config');
const {args}=require('./eu-writer-window-plan.cjs');
const {loadEuWriterWindowPlan}=require('../backend/src/opportunities/v2/euWriterWindowPlan');
const ORIGIN='http://localhost:3000',ISSUER='https://localhost:8443/realms/c4g-native-local',API='/api/admin/opportunity-activation';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{64}$/;
function httpCommand(method,url,body,windowId){
 assert(UUID.test(windowId));const base=API+'/eu-writer/windows/'+windowId;
 if(method==='GET'){assert(body===undefined&&['/api/auth/session',API+'/sources/eu',base].includes(url),'APPROVAL_HTTP_SCOPE_INVALID');return;}
 assert(method==='POST'&&url===base+'/approve'&&body&&Object.keys(body).sort().join(',')==='planDigest,requestId'&&UUID.test(body.requestId)&&SHA.test(body.planDigest),'APPROVAL_HTTP_SCOPE_INVALID');
}
function administrator(value){assert(UUID.test(value?.user?.id)&&value.user.platformRoles?.includes('C4G_ADMIN'),'APPROVAL_ADMINISTRATOR_REQUIRED');return value.user.id;}
async function approvePrepared({loaded,request,authenticatedAt,clock=Date.now,onProgress=()=>{}}){
 const {plan,planDigest}=loaded,base=API+'/eu-writer/windows/'+plan.windowId;
 const recent=()=>assert(Number.isFinite(authenticatedAt)&&clock()>=authenticatedAt&&clock()-authenticatedAt<240000,'APPROVAL_REAUTHENTICATION_REQUIRED');
 recent();const actorId=administrator(await request('GET','/api/auth/session'));
 const state=async()=>{const value=await request('GET',API+'/sources/eu');assert.equal(value.state,'QUIESCED');assert.equal(value.fence,plan.source.fence);assert.equal(value.activeLeases+value.pendingRuns,0);return {state:value.state,fence:value.fence};};
 const before=await state(),detail=await request('GET',base);assert.equal(detail.scope,'PREPARATION_ONLY');assert.equal(detail.planDigest,planDigest,'APPROVAL_PLAN_CHANGED');assert.deepEqual(detail.plan,plan,'APPROVAL_PLAN_CHANGED');recent();
 const input={requestId:createUuidV7(),planDigest};onProgress({stage:'reviewed',windowId:plan.windowId,planDigest,requestId:input.requestId});
 const approval=await request('POST',base+'/approve',input);recent();
 assert.equal(approval.scope,'PREPARATION_ONLY');assert.equal(approval.windowId,plan.windowId);assert.equal(approval.planDigest,planDigest);assert.equal(approval.actorId,actorId);assert.equal(approval.requestId,input.requestId);assert.equal(approval.eventId,input.requestId);assert(SHA.test(approval.eventHash));assert.equal(approval.expiresAt,plan.expiresAt);assert.equal(approval.replayed,false);
 onProgress({stage:'approved',...approval});
 const replay=await request('POST',base+'/approve',input);assert.equal(replay.replayed,true);assert.deepEqual({...replay,replayed:false},approval,'APPROVAL_REPLAY_CHANGED');
 assert.equal(administrator(await request('GET','/api/auth/session')),actorId);const after=await state();assert.deepEqual(after,before);
 return {actorId,approval,replayVerified:true,sourceUnchanged:true,source:after};
}
async function browserSession(windowId){
 const state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));assert.equal(state.identity?.origin,ORIGIN);assert.equal(state.identity?.issuer,ISSUER);assert.equal(state.identity?.policyVersion,'c4g-user-mfa-v1');
 const access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json')));assert(typeof access.admin?.username==='string'&&access.admin.username&&typeof access.admin.password==='string'&&access.admin.password,'APPROVAL_CREDENTIAL_REQUIRED');
 const {chromium}=require('../frontend/test-harness/node_modules/playwright');const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(20000);let permitted=null;
  await context.route('**/*',route=>{const r=route.request(),url=new URL(r.url()),read=['GET','HEAD','OPTIONS'].includes(r.method());
   if(![ORIGIN,new URL(ISSUER).origin].includes(url.origin))return route.abort();
   if(url.origin===ORIGIN&&url.pathname.startsWith('/api/')&&!read&&!(permitted&&r.method()==='POST'&&url.pathname===permitted))return route.abort();
   if(url.origin===new URL(ISSUER).origin&&!read&&!(r.method()==='POST'&&url.pathname==='/realms/c4g-native-local/login-actions/authenticate'))return route.abort();return route.continue();});
  await page.goto(ORIGIN+'/api/auth/oidc/login?returnTo=%2Fadministracao%2Fdashboard');await page.locator('#username').waitFor();assert.equal(new URL(page.url()).origin,new URL(ISSUER).origin,'AUTH_INTERACTION_REQUIRED');
  const action=new URL(await page.locator('#kc-form-login').getAttribute('action'));assert.equal(action.origin,new URL(ISSUER).origin);assert.equal(action.pathname,'/realms/c4g-native-local/login-actions/authenticate');
  await page.locator('#username').fill(access.admin.username);await page.locator('#password').fill(access.admin.password);await page.locator('#kc-login').click();
  await page.waitForURL(url=>url.origin===ORIGIN&&!url.pathname.startsWith('/api/auth/'),{timeout:30000});const authenticatedAt=Date.now();
  async function request(method,url,body){httpCommand(method,url,body,windowId);permitted=method==='POST'?url:null;try{
   const response=await page.evaluate(async({method,url,body})=>{
    if(location.origin!=='http://localhost:3000')return {status:0,code:'APPROVAL_ORIGIN_CHANGED'};const headers={Accept:'application/json'};
    if(method==='POST'){const csrf=await fetch('/api/auth/csrf',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});if(!csrf.ok)return {status:csrf.status,code:'APPROVAL_CSRF_UNAVAILABLE'};const v=await csrf.json();if(typeof v.csrfToken!=='string'||!v.csrfToken)return {status:0,code:'APPROVAL_CSRF_UNAVAILABLE'};headers['X-CSRF-Token']=v.csrfToken;headers['Content-Type']='application/json';}
    const r=await fetch(url,{method,credentials:'same-origin',cache:'no-store',redirect:'error',headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    const reader=r.body.getReader(),chunks=[];let length=0;try{for(;;){const p=await reader.read();if(p.done)break;length+=p.value.byteLength;if(length>2*1024*1024)return {status:0,code:'APPROVAL_HTTP_LIMIT'};chunks.push(p.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}const value=JSON.parse(new TextDecoder().decode(bytes));if(!r.ok)return {status:r.status,code:value?.error?.code};
    return {status:r.status,value:url==='/api/auth/session'?{user:{id:value.user?.id,platformRoles:value.user?.platformRoles}}:value};
   },{method,url,body});if(response.status!==200)throw Object.assign(Error('APPROVAL_HTTP_FAILED'),{code:response.code});return response.value;
  }finally{permitted=null;}}
  return {request,authenticatedAt,close:()=>browser.close()};
 }catch(error){await browser.close();throw error;}
}
async function main(argv=process.argv.slice(2)){
 const windowId=args(argv),loaded=loadEuWriterWindowPlan(cfg.root,windowId),folder=path.join(cfg.root,'output','opportunity-eu-writer-window-'+windowId),output=path.join(folder,'approval-'+randomUUID()+'.json');
 const report={kind:'eu-writer-window-authenticated-approval-v1',windowId,planDigest:loaded.planDigest,status:'IN_PROGRESS',startedAt:new Date().toISOString(),sessionFabricated:false,credentialsExported:false,scope:'PREPARATION_ONLY',steps:[]};
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});const save=()=>cfg.saveState(report,output);let session;
 try{session=await browserSession(windowId);assert.deepEqual(loadEuWriterWindowPlan(cfg.root,windowId),loaded);report.result=await approvePrepared({loaded,request:session.request,authenticatedAt:session.authenticatedAt,onProgress:step=>{report.steps.push(step);save();}});report.authentication={provider:'OIDC',actorId:report.result.actorId,policy:'c4g-user-mfa-v1',administrator:true};report.status='PASS';}
 catch(error){report.status='FAIL';report.failure=/^(OPPORTUNITY_V2_|AUTH_|CSRF_|SESSION_)[A-Z0-9_]+$/.test(error.code||'')?error.code:/^APPROVAL_[A-Z0-9_]+$/.test(error.message||'')?error.message:'APPROVAL_OPERATION_FAILED';process.exitCode=1;}
 finally{if(session)await session.close().catch(()=>{report.browserCleanup=false;});report.browserCleanup??=true;report.completedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,windowId,failure:report.failure||null,evidence:path.relative(cfg.root,output).replaceAll('\\','/')}));}return report;
}
if(require.main===module)main().catch(()=>{console.error('EU_WRITER_WINDOW_APPROVAL_FAILED');process.exitCode=1;});
module.exports={httpCommand,approvePrepared,main};
