'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),https=require('node:https');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const express=require('../../../backend/node_modules/express'),cors=require('../../../backend/node_modules/cors');
const {keycloak,databaseFixture,secret,requirement,policyVersion}=require('./fixture');
const {randomUUID}=require('node:crypto');
const {instrumentation,measure}=require('./measurement');
const {roles,seed}=require('./sqlProof');
const reportName=process.env.HTTP_PROOF_REPORT||'http-oidc-isolated';
assert(/^[a-z0-9-]+$/.test(reportName));
const out=path.resolve(__dirname,'../../../context/reviews',reportName);
const report={startedAt:new Date().toISOString(),status:'RUNNING',checks:[],measurements:[],failures:[],limits:['Synthetic data and local Docker; no productive SLO or capacity claim.','Central non-authority reads use a bootstrap pg_read_all_data login; exact production central privilege parity is not claimed.','Keycloak development mode with TLS and the existing trusted local test certificate.']};
const check=name=>{report.checks.push(name);console.log('PASS '+name);};
const stage=name=>{report.stage=name;console.log('STAGE '+name);};
report.scope=process.env.HTTP_PROOF_SCOPE||'all';
const blocked=(name,evidence)=>{report.blockers ||= [];report.blockers.push({test:name,...evidence});console.log('BLOCKED '+name);};
const checkpoint=()=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,report.scope==='all'?'results.json':'results-'+report.scope+'.json'),JSON.stringify(report,null,2)+'\n');};
function safeError(error){return {name:error.name,code:error.code||error.internalCode||null,reason:/^[A-Z0-9_]{1,100}$/.test(error.message||'')?error.message:null,assertion:error.code==='ERR_ASSERTION'?String(error.message).split('\n')[0].slice(0,160):null,frames:String(error.stack||'').split('\n').filter(x=>x.trim().startsWith('at ')).slice(0,4).map(x=>x.trim())};}
async function run(){
 let server,browser,db,composition,metrics;
 try{
  const outer=express();let inner;
  metrics=instrumentation();outer.use(metrics.middleware);
  const holds=new Set(),events=[];
  outer.use((req,res,next)=>{const requestPath=req.path;res.once('finish',()=>events.push({method:req.method,path:requestPath,status:res.statusCode}));
   if(req.path==='/api/auth/session'&&req.get('X-HTTP-Proof-Hold')==='1'){
    res.end=()=>{holds.add(res);return res;};res.once('close',()=>holds.delete(res));
   }next();});
  const clientBundle=await require('./browserProof').bundle();
  outer.get('/proof-client.js',(req,res)=>res.type('application/javascript').send(clientBundle));
  outer.get('/signed-in',(req,res)=>res.send('<h1>HTTP OIDC proof</h1><div id="proof-root"></div><script type="module" src="/proof-client.js"></script>'));
  outer.use((req,res,next)=>inner?inner(req,res,next):res.sendStatus(503));
  server=https.createServer({key:fs.readFileSync(path.join(process.env.HTTP_PROOF_TLS,'localhost.key')),cert:fs.readFileSync(path.join(process.env.HTTP_PROOF_TLS,'localhost.crt'))},outer);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='https://localhost:'+server.address().port;
  stage('isolated-central-migrations');db=await databaseFixture(report);check('current central migrations and security preflight');
  stage('real-keycloak');const kc=await keycloak(origin);report.keycloak='26.8.0';
  stage('isolated-tenants');const a=await db.tenant(kc,0),b=await db.tenant(kc,1);check('two physical tenants migrated and published through real directory');
  stage('real-sql-roles-rls');await roles(a,b,db.central,check,report);
  await seed(a,25,25);await seed(b,1,1);
  const {env:runtimeEnv,runtime}=await db.configure([a,b]);
  const env={...runtimeEnv,AUTH_MODE:'oidc',NODE_ENV:'development',PUBLIC_APP_URL:origin,OIDC_ISSUER:kc.issuer,OIDC_CLIENT_ID:kc.clientId,OIDC_REDIRECT_URI:origin+'/api/auth/oidc/callback',SESSION_SECRET:secret(),SESSION_COOKIE_SECURE:'true',SESSION_COOKIE_NAME:'__Host-http-proof',SESSION_IDLE_MS:'1800000',SESSION_ABSOLUTE_MS:'28800000',OIDC_TRANSACTION_MS:'600000',AUTH_POLICY_VERSION:policyVersion,AUTH_ASSURANCE_POLICY_JSON:JSON.stringify({'recent-auth':requirement}),PRIVILEGED_LOGIN_ASSURANCE_CATEGORY:'recent-auth',AUTHORITY_COMMIT_PERMIT_SECRET:db.central.permitSecret,FUNDING_TENDERS_RUNTIME:'central'};
  const observe=e=>report.failures.push({code:e.internalCode||e.code||e.name,constraint:e.constraint||null,column:e.column||null,routine:e.routine||null});
  composition=require('../../../backend/src/productionComposition').createProductionComposition({env,dependencies:{express,cors,centralPool:db.reader,authorityPool:db.central.authorityPool,routes:{},opportunityRuntimeDependencies:runtime,applicationFailureObserver:observe,opportunityFailureObserver:observe,directoryFailureObserver:observe}});
  inner=composition.app;
  if(report.scope!=='revocation'){
  const catalogProbe=require('../../../backend/src/fundingTenders/catalogReader').createCatalogReader({env});
  try{await catalogProbe.ready();check('catalog reader accepts current real central schema');}
  catch(error){blocked('catalog reader preflight',safeError(error));}
  finally{await catalogProbe.close();}
  }
  stage('browser-oidc-login');
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  async function login(actor){
   const context=await browser.newContext(),p=await context.newPage();
   p.on('pageerror',error=>{report.browserErrors ||= [];report.browserErrors.push({name:error.name,reason:/^[a-zA-Z_$]+ is not defined$/.test(error.message)?error.message:null});});
   await p.goto(origin+'/api/auth/oidc/login?returnTo=/signed-in');
   await p.locator('#username').fill(actor.username);await p.locator('#password').fill(actor.password);await p.locator('#kc-login').click();
   await p.getByRole('heading',{name:'HTTP OIDC proof'}).waitFor();
   await p.waitForFunction(()=>window.proof?.auth&&!window.proof.auth.loading);
   const cookies=await context.cookies(origin),session=cookies.find(c=>c.name==='__Host-http-proof');
   assert(session?.secure&&session.httpOnly&&session.sameSite==='Lax'&&session.path==='/');
   return {context,page:p,actor};
  }
  let clientA=await login(a.owner);const clientB=await login(b.owner);report.browser=browser.version();report.node=process.version;check('real Authorization Code PKCE login and secure HttpOnly SameSite cookies');
  async function http(client,route,method='GET',body,extra={}){
   const measureId=randomUUID(),headers={Origin:origin,'X-HTTP-Proof-Measure':measureId,...(client.organizationId?{'X-C4G-Organization':client.organizationId}:{}),...extra};
   if(method!=='GET'&&!headers['X-CSRF-Token']){
    const csrf=await client.context.request.get(origin+'/api/auth/csrf');assert.equal(csrf.status(),200);headers['X-CSRF-Token']=(await csrf.json()).csrfToken;
   }
   const start=performance.now();let response;
   try{response=await client.context.request.fetch(origin+route,{method,headers,...(body===undefined?{}:{data:body}),timeout:65000});}
   catch(error){const sql=metrics.records.get(measureId);metrics.records.delete(measureId);return {status:0,data:null,code:error.name==='TimeoutError'?'REQUEST_TIMEOUT':'TRANSPORT_FAILURE',bytes:0,ms:performance.now()-start,sql};}
   const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=null;}
   const sql=metrics.records.get(measureId);metrics.records.delete(measureId);
   return {status:response.status(),data,bytes:Buffer.byteLength(text),ms:performance.now()-start,sql};
  }
  for(const [client,tenant] of [[clientA,a],[clientB,b]]){
   const session=await http(client,'/api/auth/session');assert.equal(session.status,200,'authenticated session');
   const selected=await http(client,'/api/auth/organization','POST',{organizationId:tenant.organizationId});
   assert.equal(selected.status,200,'organization selection');assert.equal(selected.data.organization.id,tenant.organizationId);assert(selected.data.csrfToken&&selected.data.user);client.organizationId=tenant.organizationId;
  }
  check('organization POST returns confirmed user organization and fresh CSRF');
  if(report.scope==='revocation'){
   stage('real-authority-revocation');await require('./revocationProof').verify({tenant:b,client:clientB,http,central:db.central,check,report});report.status='PASS';return;
  }
  const cookieBefore=(await clientA.context.cookies(origin)).find(c=>c.name==='__Host-http-proof').value;
  const signed=decodeURIComponent(cookieBefore),sid=require('../../../backend/node_modules/cookie-signature').unsign(signed.slice(2),env.SESSION_SECRET);assert(sid);
  const sessionKey=db.central.coordinator.sessionKey(sid);
  const epoch=async()=>BigInt((await db.central.pool.query('SELECT epoch::text FROM public.authority_scope_epoch WHERE scope_key=$1',[sessionKey])).rows[0]?.epoch||'0');
  const beforeEpoch=await epoch();assert.equal((await http(clientA,'/api/auth/session')).status,200);const afterEpoch=await epoch();
  const cookieAfter=(await clientA.context.cookies(origin)).find(c=>c.name==='__Host-http-proof').value;
  report.sessionTouch={sameCookie:cookieBefore===cookieAfter,epochAdvanced:afterEpoch>beforeEpoch,epochDelta:Number(afterEpoch-beforeEpoch)};
  assert.equal(afterEpoch,beforeEpoch);assert.equal(cookieBefore,cookieAfter);
  check('idle renewal preserves the session authority epoch');
  await require('./sessionEpochProof').verify({sid,client:clientA,http,central:db.central,composition,check,report});
  stage('browser-http-session-proofs');
  try{
   await require('./browserProof').verify({client:clientA,origin,tenant:a,http,holds,events,check,report});
   assert((await epoch())>beforeEpoch);
   assert.equal((await db.central.pool.query('SELECT sid FROM public.application_session_store WHERE sid=$1',[sid])).rows.length,0);
   check('real HTTP rotation invalidates the old SID and advances its authority epoch');
  }catch(error){blocked('browser session proof',safeError(error));}
  if(report.scope==='sessions'){assert(!report.blockers?.length);report.status='PASS';return;}
  await clientA.context.close();clientA=await login(a.owner);clientA.organizationId=a.organizationId;
  checkpoint();
  stage('real-http-domain');
  for(const route of ['/api/applications/browse','/api/applications/report','/api/organizations/'+a.organizationId+'/dashboard/summary','/api/organization-directory/matching?origin=PRIVATE&opportunityId='+a.opportunityId]){
   const r=await http(clientA,route),name=route.replace(a.organizationId,':organization').replace(a.opportunityId,':opportunity');
   const evidence={route:name,status:r.status,code:r.data?.error?.code||r.code||null,ms:Math.round(r.ms),bytes:r.bytes,sql:r.sql};report.domain ||= [];report.domain.push(evidence);
   if(r.status===200)check('HTTP '+name);else blocked('HTTP '+name,{status:r.status,code:evidence.code});checkpoint();
  }
  const ownId=(await a.pool.query('SELECT application_id FROM opportunity_catalog.application LIMIT 1')).rows[0].application_id;
  const cross=await http(clientB,'/api/applications/'+ownId);if(cross.status===404)check('foreign application hidden by HTTP');else blocked('foreign application route should return 404',{status:cross.status});
  assert.equal((await http(clientB,'/api/organizations/'+a.organizationId+'/dashboard/summary')).status,404);
  assert.equal((await http(clientA,'/api/auth/organization','POST',{organizationId:b.organizationId})).status,403);
  check('real HTTP identities cannot select or request another organization dashboard');
  const added=await http(clientB,'/api/applications','POST',{opportunityId:b.opportunityId,evaluationId:null,title:'Real HTTP command',responsibleMembershipId:b.owner.membershipId,deadline:'2027-12-31',idempotencyKey:randomUUID()});
  if(added.status===201)check('application POST commits through real authority and audit');else blocked('application POST',{status:added.status,code:added.data?.error?.code||added.code,sql:added.sql});
  stage('real-authority-revocation');
  try{await require('./revocationProof').verify({tenant:b,client:clientB,http,central:db.central,check,report});}
  catch(error){blocked('concurrent revocation',safeError(error));}checkpoint();
  const revokedDashboard=await http(clientB,'/api/organizations/'+b.organizationId+'/dashboard/summary');
  report.revokedDashboard={status:revokedDashboard.status,code:revokedDashboard.data?.error?.code||revokedDashboard.data?.code};
  // The preceding refused browse rotates away the invalid organization. A
  // subsequent request can therefore require context, rather than revoke twice.
  assert([401,403].includes(revokedDashboard.status)
   || (revokedDashboard.status===409&&report.revokedDashboard.code==='ORGANIZATION_SELECTION_REQUIRED'));
  check('dashboard remains denied after real central membership revocation');
  stage('concurrent-http-measurement');
  const samples=Number(process.env.HTTP_PROOF_SAMPLES||12);assert(Number.isInteger(samples)&&samples>=4&&samples<=100);
  for(const [volume,people] of [[10000,1000]]){
   await seed(a,volume,people);
   await clientA.context.close();clientA=await login(a.owner);clientA.organizationId=a.organizationId;
   for(const [name,route] of [['browse','/api/applications/browse'],['report','/api/applications/report'],['dashboard','/api/organizations/'+a.organizationId+'/dashboard/summary']]){
    for(const concurrency of [1,2,4,6]){
    const results=await measure({http,client:clientA,route,name,volume,people,samples,concurrency,report});
    for(const result of results){const payload=name==='dashboard'?result.data.report:result.data;assert.equal(payload.total,volume);assert.equal(payload.items.length,25);assert.equal(result.sql.applicationSelections,1);}
    checkpoint();
    }
   }
  }
  const browse=report.measurements.filter(m=>m.name==='browse');
  if(browse.every(m=>!m.warmupFailed&&m.errors===0)){
   // Authority polling varies with contention; it is measured, not mistaken
   // for a per-row query. The data selection itself must remain one/page.
   assert(browse.every(m=>m.applicationSelections.every(n=>n===1)));
   check('real browse keeps one application data selection and 25 details at every volume');
  }
  if(report.measurements.some(m=>m.warmupFailed||m.errors))blocked('HTTP performance acceptance',{reason:'FAILED_REQUESTS_ARE_NOT_SUCCESSFUL_LATENCY_SAMPLES'});
  report.status=report.blockers?.length?'FAIL':'PASS';if(report.status==='FAIL')process.exitCode=1;
 }catch(error){report.status='FAIL';report.error=safeError(error);console.log('FAIL '+JSON.stringify(report.error));process.exitCode=1;}
 finally{
  await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  try{await composition?.closeOpportunityRuntime();await db?.close();}catch(error){report.cleanupError=safeError(error);report.status='FAIL';process.exitCode=1;}
  metrics?.close();report.finishedAt=new Date().toISOString();
  checkpoint();fs.writeFileSync(path.join(out,'run-'+process.env.HTTP_PROOF_RUN+'.json'),JSON.stringify(report,null,2)+'\n');
 }
}
run().catch(e=>{console.error('CLEANUP_FAILURE '+e.name);process.exitCode=1;});
