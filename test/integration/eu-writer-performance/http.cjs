'use strict';
const assert=require('node:assert/strict'),{createHash,randomUUID,randomBytes}=require('node:crypto');
const protocol=require('../../../context/references/performance/eu-writer-v2-protocol.json');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function percentile(values,p){if(!values.length)return null;assert(values.every(Number.isFinite));return values.slice().sort((a,b)=>a-b)[Math.ceil(p*values.length)-1];}
function unionMs(intervals){let end=-Infinity,total=0;for(const [a,b] of intervals.slice().sort((x,y)=>x[0]-y[0])){assert(Number.isFinite(a)&&Number.isFinite(b)&&b>=a);total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}return total;}
function normalizeResponse(value){
 if(Array.isArray(value))return value.map(normalizeResponse);
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).filter(([key])=>!['asOf','generatedAt'].includes(key)).map(([key,item])=>{
  if(['nextCursor','previousCursor'].includes(key)&&item!==null){assert(typeof item==='string'&&item.length<=4096);const parts=item.split('.');assert.equal(parts.length,3);const payload=JSON.parse(Buffer.from(parts[1],'base64url'));assert(payload.position&&payload.context&&Number.isSafeInteger(payload.exp));return [key,{position:normalizeResponse(payload.position),context:normalizeResponse(payload.context)}];}
  return [key,normalizeResponse(item)];
 }));
}
function serializeAttempt(value,context){return {...context,status:value.status,ms:value.ms,code:value.data?.error?.code||value.code||null,total:value.data?.report?.total??value.data?.total??null,responseDigest:value.data?digest(normalizeResponse(value.data)):null,metrics:value.metrics||null};}
function completeMetrics(record){return Boolean(record&&Number.isInteger(record.transactionCount)&&record.transactionCount>=0&&Number.isFinite(record.responseAt)&&Array.isArray(record.lockEvents)&&record.lockEvents.every(e=>Number.isFinite(e.startMs)&&Number.isFinite(e.endMs)&&e.endMs>=e.startMs)&&record.queryCount>0&&record.queryEvents?.length===record.queryCount&&record.pendingQueries===0&&record.queryEvents.every(e=>Number.isFinite(e.startMs)&&Number.isFinite(e.endMs)&&e.endMs>=e.startMs)&&record.checkouts?.length&&record.checkouts.every(c=>Number.isFinite(c.waitMs)&&(c.error||Number.isFinite(c.holdMs)))&&record.admissions?.length&&record.admissions.every(a=>Number.isFinite(a.ms)&&a.before&&a.after&&Number.isFinite(a.before.active)&&Number.isFinite(a.before.queued)&&Number.isFinite(a.after.active)&&Number.isFinite(a.after.queued))&&record.spans?.length&&record.spans.every(s=>Number.isFinite(s.endMs))&&record.spans.some(s=>['assertCentralSchema','assertCentralSchemaForVersions'].includes(s.name))&&record.spans.some(s=>s.name==='observeTenantRuntimeMetadata')&&record.sqlErrors?.length===0&&record.failures?.length===0);}
function metricSummary(record){if(!completeMetrics(record))return null;const events=record.queryEvents;return {queryObservedWorkMs:events.reduce((n,e)=>n+e.endMs-e.startMs,0),queryWallUnionMs:unionMs(events.map(e=>[e.startMs,e.endMs])),centralMetadataWallMs:unionMs(events.filter(e=>e.category==='metadata'&&e.role!=='tenant').map(e=>[e.startMs,e.endMs])),tenantMetadataWallMs:unionMs(events.filter(e=>e.category==='metadata'&&e.role==='tenant').map(e=>[e.startMs,e.endMs])),afterResponseQueries:events.filter(e=>e.afterResponse).length,authorityLockHeldMs:unionMs((record.lockEvents||[]).map(e=>[e.startMs,e.endMs]))};}
async function runHttpReplica({http,replica=0,validate=()=>true,onProgress=()=>{}}){
 const output={status:'PASS',replica,attempts:[],warmups:[],scenarios:[]};
 try{
 for(const scenario of protocol.http.scenarios){
  const scenarioReport={id:scenario.id,replica,status:'RUNNING',attempts:0};output.scenarios.push(scenarioReport);
  const kind=scenario.id.startsWith('report')?'report':'dashboard',expectedDigests=new Map();http.setPhase?.(scenario.id+'-warmup');
  for(let tenant=0;tenant<scenario.tenants;tenant++){const warm=await http.request(tenant,kind);const record=serializeAttempt(warm,{replica,scenario:scenario.id,tenant});output.warmups.push(record);assert.equal(warm.status,200,'WARMUP_FAILED');assert(validate(warm,tenant,kind),'WARMUP_FUNCTIONAL_MISMATCH');expectedDigests.set(tenant,record.responseDigest);}
  http.setPhase?.(scenario.id);const measured=[];let next=0;const start=performance.now();
  scenarioReport.controlBudgetMs=protocol.execution.controlBudgetsMs.httpScenario;
  const withinBudget=()=>{scenarioReport.controlElapsedMs=performance.now()-start;if(scenarioReport.controlElapsedMs>scenarioReport.controlBudgetMs)throw Object.assign(Error('CONTROL_DEADLINE_EXCEEDED'),{code:'CONTROL_DEADLINE_EXCEEDED'});};
  const workers=await Promise.allSettled(Array.from({length:scenario.concurrency},async()=>{while(next<scenario.attempts){withinBudget();const attempt=next++,tenant=attempt%scenario.tenants,requestStart=performance.now();let value;try{value=await http.request(tenant,kind);}catch(error){value={status:0,ms:performance.now()-requestStart,code:error.name==='TimeoutError'?'HTTP_TIMEOUT':'HTTP_TRANSPORT_FAILURE'};}let row;try{row=serializeAttempt(value,{replica,scenario:scenario.id,attempt,tenant});}catch{row={replica,scenario:scenario.id,attempt,tenant,status:value.status,ms:value.ms,responseDigest:null,code:'RESPONSE_NORMALIZATION_FAILED',metrics:value.metrics||null};}row.normalizedResponsePass=row.responseDigest!==null&&row.responseDigest===expectedDigests.get(tenant);try{row.functionalPass=value.status===200&&row.normalizedResponsePass&&validate(value,tenant,kind);}catch{row.functionalPass=false;}if(!row.functionalPass)output.status='FAIL';measured.push(row);output.attempts.push(row);scenarioReport.attempts++;withinBudget();}}));
  const workerFailure=workers.find(result=>result.status==='rejected');if(workerFailure)throw workerFailure.reason;
  withinBudget();
  measured.sort((a,b)=>a.attempt-b.attempt);const drainMs=await http.drain(protocol.execution.controlBudgetsMs.drain);
  for(const row of measured){row.instrumentationPass=completeMetrics(row.metrics);row.metricSummary=metricSummary(row.metrics);if(!row.instrumentationPass)output.status='FAIL';}
  const good=measured.filter(x=>x.status===200),all=measured.map(x=>x.ms);
  Object.assign(scenarioReport,{status:measured.every(x=>x.functionalPass&&x.instrumentationPass)?'PASS':'FAIL',attempts:measured.length,successes:good.length,errors:measured.length-good.length,timeouts:measured.filter(x=>x.code==='HTTP_TIMEOUT').length,http503:measured.filter(x=>x.status===503).length,p50Ms:percentile(good.map(x=>x.ms),.5),p95Ms:percentile(good.map(x=>x.ms),.95),maximumMs:good.length?Math.max(...good.map(x=>x.ms)):null,allAttemptP50Ms:percentile(all,.5),allAttemptP95Ms:percentile(all,.95),drainMs});
  onProgress({replica,scenario:scenario.id,status:output.status});
 }
 return output;
 }catch(error){output.status='FAIL';for(const scenario of output.scenarios)if(scenario.status==='RUNNING')scenario.status='FAIL';error.httpReport=output;throw error;}
}
async function runHttpMatrix({createHarness,validate,onProgress}){
 const output={status:'PASS',attempts:[],warmups:[],scenarios:[]};
 for(let replica=0;replica<protocol.http.replicas;replica++){let http,result,failure;try{http=await createHarness(replica);result=await runHttpReplica({http,replica,validate,onProgress});}catch(error){failure=error;result=error.httpReport;output.status='FAIL';}finally{try{await http?.close();}catch(error){failure ||= error;output.status='FAIL';}}
  if(result)for(const field of ['attempts','warmups','scenarios'])output[field].push(...result[field]);if(result?.status==='FAIL')output.status='FAIL';if(failure){failure.httpReport=output;throw failure;}}
 assert.equal(output.attempts.length,protocol.http.totalMeasuredAttempts);return output;
}
async function createHttpHarness({fixture,tlsDirectory,metrics,check}){
 const fs=require('node:fs'),path=require('node:path'),https=require('node:https');
 const express=require('../../../backend/node_modules/express'),cors=require('../../../backend/node_modules/cors');
 const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
 const {requirement,policyVersion}=require('./fixture.cjs');
 const outer=express();let inner,composition,browser,server;const clients=[];
 async function close(){const results=await Promise.allSettled([Promise.resolve().then(()=>browser?.close()),Promise.resolve().then(async()=>{if(server?.listening){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}}),Promise.resolve().then(()=>composition?.closeOpportunityRuntime())]);if(results.some(x=>x.status==='rejected'))throw Object.assign(Error('HTTP_HARNESS_CLEANUP_FAILED'),{code:'HTTP_HARNESS_CLEANUP_FAILED'});}
 outer.use(metrics.middleware);outer.get('/signed-in',(req,res)=>res.send('<h1>EU writer trial</h1>'));outer.use((req,res,next)=>inner?inner(req,res,next):res.sendStatus(503));
 try{
  server=https.createServer({key:fs.readFileSync(path.join(tlsDirectory,'localhost.key')),cert:fs.readFileSync(path.join(tlsDirectory,'localhost.crt'))},outer);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='https://localhost:'+server.address().port;
  await fixture.keycloak.configureClient(origin);
  const env={...fixture.runtimeEnv,AUTH_MODE:'oidc',NODE_ENV:'development',PUBLIC_APP_URL:origin,OIDC_ISSUER:fixture.keycloak.issuer,OIDC_CLIENT_ID:fixture.keycloak.clientId,OIDC_REDIRECT_URI:origin+'/api/auth/oidc/callback',SESSION_SECRET:randomBytes(32).toString('hex'),SESSION_COOKIE_SECURE:'true',SESSION_COOKIE_NAME:'__Host-eu-writer-trial',SESSION_IDLE_MS:'1800000',SESSION_ABSOLUTE_MS:'28800000',OIDC_TRANSACTION_MS:'600000',AUTH_POLICY_VERSION:policyVersion,AUTH_ASSURANCE_POLICY_JSON:JSON.stringify({'recent-auth':requirement}),PRIVILEGED_LOGIN_ASSURANCE_CATEGORY:'recent-auth',AUTHORITY_COMMIT_PERMIT_SECRET:fixture.central.permitSecret,FUNDING_TENDERS_RUNTIME:'central'};
  composition=require('../../../backend/src/productionComposition').createProductionComposition({env,dependencies:{express,cors,centralPool:fixture.reader,authorityPool:fixture.central.authorityPool,routes:{},opportunityRuntimeDependencies:fixture.runtime,applicationFailureObserver:metrics.failure,opportunityFailureObserver:metrics.failure,directoryFailureObserver:metrics.failure}});inner=composition.app;
  await check('HTTP_REAL_COMPOSITION_READINESS',()=>composition.assertDatabaseReadiness());
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  for(const tenant of fixture.tenants){
   const context=await browser.newContext(),page=await context.newPage();clients.push({context,tenant});
   await page.goto(origin+'/api/auth/oidc/login?returnTo=/signed-in');await page.locator('#username').fill(tenant.owner.username);await page.locator('#password').fill(tenant.owner.password);await page.locator('#kc-login').click();await page.getByRole('heading',{name:'EU writer trial'}).waitFor();
   const cookie=(await context.cookies(origin)).find(c=>c.name==='__Host-eu-writer-trial');assert(cookie?.secure&&cookie.httpOnly,'SECURE_SERVER_SESSION_REQUIRED');
   const response=await context.request.get(origin+'/api/auth/csrf'),csrf=await response.json();assert.equal(response.status(),200);
   const selected=await context.request.post(origin+'/api/auth/organization',{headers:{Origin:origin,'X-CSRF-Token':csrf.csrfToken},data:{organizationId:tenant.organizationId}});assert.equal(selected.status(),200);
  }
  await check('HTTP_REAL_OIDC_PKCE_AND_SECURE_SESSION',async()=>{assert.equal(clients.length,2);});
  const anonymous=await browser.newContext();
  function route(kind,org){if(kind==='report')return '/api/applications/report';if(kind==='dashboard')return '/api/organizations/'+org+'/dashboard/summary';if(kind==='private')return '/api/opportunities';assert(typeof kind==='string'&&kind.startsWith('/')&&!kind.startsWith('//')&&!kind.includes('://'));return kind;}
  async function request(index,kind,opts={},anonymousMode=false){const client=clients[index],org=opts.expectedOrganization||client.tenant.organizationId,tag=randomUUID(),start=performance.now();const target=origin+route(kind,org);
   try{const response=await(anonymousMode?anonymous:client.context).request.fetch(target,{method:opts.method||'GET',headers:{'X-EU-Trial-Request':tag,'X-C4G-Organization':org,...opts.headers},...(opts.body?{data:opts.body}:{}),timeout:65000,maxRedirects:0});let data;try{data=await response.json();}catch{data=null;}return {status:response.status(),data,ms:performance.now()-start,metrics:metrics.take(tag),tag};}catch(error){return {status:0,data:null,code:error.name==='TimeoutError'?'HTTP_TIMEOUT':'HTTP_TRANSPORT_FAILURE',ms:performance.now()-start,metrics:metrics.take(tag),tag};}}
  return {origin,clients,request:(i,k,o)=>request(i,k,o),anonymousRequest:(k,o)=>request(0,k,o,true),setPhase:metrics.setPhase,drain:metrics.drain,
   close};
 }catch(error){try{await close();}catch{error.httpCleanupFailed=true;}throw error;}
}
module.exports={runHttpMatrix,runHttpReplica,createHttpHarness,percentile,normalizeResponse,unionMs,digest,serializeAttempt,completeMetrics,metricSummary};
