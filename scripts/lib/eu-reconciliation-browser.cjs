'use strict';
// Normal OIDC client with a closed HTTP scope; importing it reads no private file.
const fs=require('node:fs'),path=require('node:path');
const cfg=require('../../backend/scripts/localPlatform/config');
const ORIGIN='http://localhost:3000',ISSUER='https://localhost:8443/realms/c4g-native-local';
const API='/api/admin/opportunity-activation',SOURCE=API+'/sources/eu',INERT='/__codex/eu-reconciliation-session';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{64}$/;
function fail(code){throw Object.assign(Error(code),{code});}
function check(value,code='RECONCILIATION_CLIENT_INVALID'){if(!value)fail(code);}
function safeCode(e){return /^(RECONCILIATION_|OPPORTUNITY_V2_|AUTH_|SESSION_|CSRF_)[A-Z0-9_]{1,110}$/.test(e?.code||'')?e.code:'RECONCILIATION_OPERATION_FAILED';}
function base(planId){check(UUID.test(planId));return API+'/eu-writer/reconciliations/'+planId;}
function httpCommand({planId,operation},method,url,body){
 const endpoint=base(planId);check(['approve','execute'].includes(operation));
 if(method==='GET'){check(body===undefined&&['/api/auth/session',SOURCE,endpoint].includes(url),'RECONCILIATION_HTTP_SCOPE_INVALID');return;}
 const keys=['requestId','previewDigest',...(operation==='execute'?['approvalEventId','approvalEventHash']:[])];
 check(method==='POST'&&url===endpoint+'/'+operation&&body&&Object.keys(body).length===keys.length&&keys.every(k=>Object.hasOwn(body,k))&&UUID.test(body.requestId)&&SHA.test(body.previewDigest)
  &&(operation!=='execute'||UUID.test(body.approvalEventId)&&SHA.test(body.approvalEventHash)),'RECONCILIATION_HTTP_SCOPE_INVALID');
}
function routeDecision(method,rawUrl,permitted=null){
 let url;try{url=new URL(rawUrl);}catch{return 'ABORT';}
 if(![ORIGIN,new URL(ISSUER).origin].includes(url.origin))return 'ABORT';
 if(url.origin===ORIGIN&&url.pathname===INERT)return method==='GET'?'INERT':'ABORT';
 if(['GET','HEAD','OPTIONS'].includes(method))return 'CONTINUE';
 if(url.origin===new URL(ISSUER).origin)return method==='POST'&&url.pathname==='/realms/c4g-native-local/login-actions/authenticate'?'CONTINUE':'ABORT';
 return method==='POST'&&permitted&&url.pathname===permitted?'CONTINUE':'ABORT';
}
function administrator(value){check(UUID.test(value?.user?.id)&&value.user.platformRoles?.includes('C4G_ADMIN'),'RECONCILIATION_ADMINISTRATOR_REQUIRED');return value.user.id;}
async function createBrowserSession(scope){
 base(scope.planId);check(['approve','execute'].includes(scope.operation));
 const state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));
 check(state.identity?.origin===ORIGIN&&state.identity.issuer===ISSUER&&state.identity.policyVersion==='c4g-user-mfa-v1','RECONCILIATION_IDENTITY_TARGET_INVALID');
 const access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json')));
 check(typeof access.admin?.username==='string'&&access.admin.username&&typeof access.admin.password==='string'&&access.admin.password,'RECONCILIATION_CREDENTIAL_REQUIRED');
 const {chromium}=require('../../frontend/test-harness/node_modules/playwright');
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(20000);let permitted=null;
  await context.route('**/*',route=>{const request=route.request(),decision=routeDecision(request.method(),request.url(),permitted);
   if(decision==='ABORT')return route.abort();
   if(decision==='INERT')return route.fulfill({status:200,contentType:'text/html',headers:{'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; connect-src 'self'"},body:'<!doctype html><title>Reconciliação administrativa</title>'});
   return route.continue();});
  await page.goto(ORIGIN+'/api/auth/oidc/login?returnTo=%2Fadministracao%2Fdashboard');await page.locator('#username').waitFor();
  check(new URL(page.url()).origin===new URL(ISSUER).origin,'RECONCILIATION_AUTH_INTERACTION_REQUIRED');
  const action=new URL(await page.locator('#kc-form-login').getAttribute('action'),page.url());
  check(action.origin===new URL(ISSUER).origin&&action.pathname==='/realms/c4g-native-local/login-actions/authenticate','RECONCILIATION_AUTH_INTERACTION_REQUIRED');
  await page.locator('#username').fill(access.admin.username);await page.locator('#password').fill(access.admin.password);await page.locator('#kc-login').click();
  await page.waitForURL(url=>url.origin===ORIGIN&&!url.pathname.startsWith('/api/auth/'),{timeout:30000});const authenticatedAt=Date.now();
  // Leave the application SPA before administrative calls. This document has no
  // application script, navigation timer, polling job or externally loaded asset.
  await page.goto(ORIGIN+INERT);check(page.url()===ORIGIN+INERT,'RECONCILIATION_INERT_DOCUMENT_REQUIRED');
  async function request(method,url,body){httpCommand(scope,method,url,body);permitted=method==='POST'?url:null;
   try{let response;
    try{response=await page.evaluate(async({method,url,body,inert})=>{
     if(location.origin!=='http://localhost:3000'||location.pathname!==inert)return{status:0,code:'RECONCILIATION_DOCUMENT_CHANGED'};
     const headers={Accept:'application/json'};
     if(method==='POST'){
      const csrf=await fetch('/api/auth/csrf',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!csrf.ok)return{status:csrf.status,code:'RECONCILIATION_CSRF_UNAVAILABLE'};
      const value=await csrf.json();if(typeof value.csrfToken!=='string'||!value.csrfToken)return{status:0,code:'RECONCILIATION_CSRF_UNAVAILABLE'};
      headers['X-CSRF-Token']=value.csrfToken;headers['Content-Type']='application/json';
     }
     const r=await fetch(url,{method,credentials:'same-origin',cache:'no-store',redirect:'error',headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
     const reader=r.body?.getReader();if(!reader)return{status:0,code:'RECONCILIATION_RESPONSE_INVALID'};const chunks=[];let length=0;
     try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>2*1024*1024)return{status:0,code:'RECONCILIATION_HTTP_LIMIT'};chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
     const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
     let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{return{status:0,code:'RECONCILIATION_RESPONSE_INVALID'};}
     if(!r.ok)return{status:r.status,code:value?.error?.code};
     return{status:r.status,value:url==='/api/auth/session'?{user:{id:value.user?.id,platformRoles:value.user?.platformRoles}}:value};
    },{method,url,body,inert:INERT});}catch{throw Object.assign(Error('RECONCILIATION_TRANSPORT_UNCERTAIN'),{code:'RECONCILIATION_TRANSPORT_UNCERTAIN',uncertain:true});}
    if(response.status!==200)throw Object.assign(Error('RECONCILIATION_HTTP_FAILED'),{code:safeCode({code:response.code}),status:response.status,uncertain:response.status===0||response.status>=500});
    return response.value;
   }finally{permitted=null;}
  }
  return{request,authenticatedAt,close:()=>browser.close()};
 }catch(e){await browser.close().catch(()=>{});throw e;}
}
function createSessionClient({planId,operation,openSession=()=>createBrowserSession({planId,operation}),expectedActorId=null,clock=Date.now,onProgress=async()=>{}}){
 let session,actorId=expectedActorId;const scope={planId,operation};
 async function close(){const old=session;session=null;if(old)await old.close();}
 async function ensure(){if(session&&clock()>=session.authenticatedAt&&clock()-session.authenticatedAt<180000)return;
  await close();const next=await openSession();try{check(Number.isFinite(next.authenticatedAt)&&clock()>=next.authenticatedAt&&clock()-next.authenticatedAt<180000,'RECONCILIATION_REAUTHENTICATION_REQUIRED');const actual=administrator(await next.request('GET','/api/auth/session'));if(actorId!==null)check(actual===actorId,'RECONCILIATION_ACTOR_CHANGED');actorId=actual;session=next;}catch(e){await next.close().catch(()=>{});throw e;}}
 async function request(method,url,body){httpCommand(scope,method,url,body);await ensure();return session.request(method,url,body);}
 async function mutate(input,{assertCurrent=()=>{}}={}){
  const url=base(planId)+'/'+operation;httpCommand(scope,'POST',url,input);await ensure();await assertCurrent();
  await onProgress({stage:operation,status:'INTENT_RECORDED',request:input,actorId});
  for(let attempt=1;attempt<=2;attempt++){
   await ensure();await assertCurrent();
   try{return await session.request('POST',url,input);}catch(e){
    const uncertain=e?.uncertain===true||e?.status>=500;if(!uncertain||attempt===2)throw e;
    await onProgress({stage:operation,status:'REPLAYING_SAME_INTENT',request:input,attempt:attempt+1});await close();
   }
  }
 }
 return{request,mutate,close,actorId:()=>actorId};
}
module.exports={API,SOURCE,UUID,SHA,base,check,fail,safeCode,httpCommand,routeDecision,administrator,createBrowserSession,createSessionClient};
