'use strict';
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const metrics=require('./instrumentation').install();
const {keycloak,databaseFixture,secret,requirement,policyVersion}=require('../http-oidc/fixture');
const {seed,roles}=require('../http-oidc/sqlProof');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const express=require('../../../backend/node_modules/express'),cors=require('../../../backend/node_modules/cors');
const reportName=process.env.HTTP_PROOF_REPORT;assert(/^[a-z0-9-]+$/.test(reportName));
const mode=process.env.HTTP_CONTENTION_MODE||'standard';assert(['standard','capacity'].includes(mode));
const out=path.resolve(__dirname,'../../../context/reviews',reportName);
const report={startedAt:new Date().toISOString(),mode,status:'RUNNING',checks:[],scenarios:[],limits:['Local synthetic data; no production capacity claim.','Instrumentation adds timing and 100ms PostgreSQL sampling overhead.','Central non-authority reader uses fixture pg_read_all_data.','No changes to pool limits, deadlines or security checks.','Standard mixed-tenant scenario warms tenant A only; first tenant B access can be cold.']};
const check=name=>{report.checks.push(name);console.log('PASS '+name);};
const save=()=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');};
const safe=error=>({name:error.name,code:error.internalCode||error.code||null,reason:/^[A-Z0-9_]+$/.test(error.message)?error.message:null,
 frames:String(error.stack).split('\n').filter(l=>l.trim().startsWith('at ')).slice(0,3).map(l=>l.trim())});
const percentile=(values,p)=>{const sorted=values.slice().sort((a,b)=>a-b);return Math.round(sorted[Math.ceil(p*sorted.length)-1]*100)/100;};
async function run(){let db,composition,server,browser;
 try{
  const outer=express();let inner;outer.use(metrics.middleware);
  outer.get('/signed-in',(req,res)=>res.send('<h1>Contention proof</h1>'));
  outer.use((req,res,next)=>inner?inner(req,res,next):res.sendStatus(503));
  server=https.createServer({key:fs.readFileSync(path.join(process.env.HTTP_PROOF_TLS,'localhost.key')),cert:fs.readFileSync(path.join(process.env.HTTP_PROOF_TLS,'localhost.crt'))},outer);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='https://localhost:'+server.address().port;
  console.log('STAGE fixture');db=await databaseFixture(report);const kc=await keycloak(origin);
  const a=await db.tenant(kc,0),b=await db.tenant(kc,1);await roles(a,b,db.central,check,report);
  await seed(a,1000,250);await seed(b,1000,250);
  const {env:runtimeEnv,runtime}=await db.configure([a,b]);
  assert(metrics.managers.some(m=>m.manager===runtime.poolManager),'observe the actual runtime pool manager');
  const env={...runtimeEnv,AUTH_MODE:'oidc',NODE_ENV:'development',PUBLIC_APP_URL:origin,OIDC_ISSUER:kc.issuer,OIDC_CLIENT_ID:kc.clientId,OIDC_REDIRECT_URI:origin+'/api/auth/oidc/callback',SESSION_SECRET:secret(),SESSION_COOKIE_SECURE:'true',SESSION_COOKIE_NAME:'__Host-contention-proof',SESSION_IDLE_MS:'1800000',SESSION_ABSOLUTE_MS:'28800000',OIDC_TRANSACTION_MS:'600000',AUTH_POLICY_VERSION:policyVersion,AUTH_ASSURANCE_POLICY_JSON:JSON.stringify({'recent-auth':requirement}),PRIVILEGED_LOGIN_ASSURANCE_CATEGORY:'recent-auth',AUTHORITY_COMMIT_PERMIT_SECRET:db.central.permitSecret,FUNDING_TENDERS_RUNTIME:'central'};
  composition=require('../../../backend/src/productionComposition').createProductionComposition({env,dependencies:{express,cors,centralPool:db.reader,authorityPool:db.central.authorityPool,routes:{},opportunityRuntimeDependencies:runtime,applicationFailureObserver:metrics.failure,opportunityFailureObserver:metrics.failure,directoryFailureObserver:metrics.failure}});inner=composition.app;
  await composition.assertDatabaseReadiness();check('real composition readiness');
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  async function login(tenant){
   const context=await browser.newContext(),page=await context.newPage();
   await page.goto(origin+'/api/auth/oidc/login?returnTo=/signed-in');await page.locator('#username').fill(tenant.owner.username);
   await page.locator('#password').fill(tenant.owner.password);await page.locator('#kc-login').click();await page.getByRole('heading',{name:'Contention proof'}).waitFor();
   const cookie=(await context.cookies(origin)).find(c=>c.name==='__Host-contention-proof');assert(cookie?.secure&&cookie.httpOnly);
   const csrf=await (await context.request.get(origin+'/api/auth/csrf')).json();
   const selected=await context.request.post(origin+'/api/auth/organization',{headers:{Origin:origin,'X-CSRF-Token':csrf.csrfToken},data:{organizationId:tenant.organizationId}});assert.equal(selected.status(),200);
   return {context,tenant};
  }
  const clients=[await login(a),await login(b)];check('OIDC PKCE login and organization selection');
  await metrics.startSampling(db.central.pool);
  const scenarios=mode==='capacity'?[['dashboard-c6','dashboard',6,false]]:[['report-c1','report',1,false],['report-c2','report',2,false],['report-c4','report',4,false],
   ['dashboard-c1','dashboard',1,false],['dashboard-c4','dashboard',4,false],['dashboard-two-tenants-c4','dashboard',4,true]];
  async function request(client,route){const tag=randomUUID(),start=performance.now();let response,data,transport=null;
   try{response=await client.context.request.get(origin+route,{headers:{'X-Contention-Request':tag,'X-C4G-Organization':client.tenant.organizationId},timeout:65000});data=await response.json();}
   catch(error){transport=error.name;}
   return {status:response?.status()||0,code:data?.error?.code||data?.code||transport,ms:Math.round((performance.now()-start)*100)/100,total:data?.report?.total??data?.total,
    metrics:metrics.take(tag)};
  }
  for(const [name,kind,concurrency,mixed] of scenarios){
   console.log('STAGE '+name);const route=c=>kind==='report'?'/api/applications/report':'/api/organizations/'+c.tenant.organizationId+'/dashboard/summary';
   metrics.setPhase(name+'-warmup');const warm=await request(clients[0],route(clients[0]));assert.equal(warm.status,200,'warmup '+name);
   metrics.setPhase(name);const results=[];let next=0;const n=mode==='capacity'?6:concurrency===4?8:4,start=performance.now();
   await Promise.all(Array.from({length:concurrency},async()=>{while(next<n){const index=next++,client=clients[mixed?index%2:0];results.push(await request(client,route(client)));}}));
   const httpEnd=performance.now();metrics.setPhase(name+'-drain');
   const drainDeadline=Date.now()+20000;
   while(metrics.managers.some(m=>m.manager.snapshot().active||m.manager.snapshot().queued)
    || results.some(r=>r.metrics?.checkouts.some(c=>!c.error&&c.holdMs===null))){
    if(Date.now()>drainDeadline)throw Error('DIAGNOSTIC_DRAIN_TIMEOUT');await new Promise(r=>setTimeout(r,50));
   }
   const good=results.filter(r=>r.status===200);assert(good.every(r=>r.total===1000));
   const value={name,kind,concurrency,tenants:mixed?2:1,samples:n,successes:good.length,errors:n-good.length,p50Ms:good.length?percentile(good.map(r=>r.ms),.5):null,p95Ms:good.length?percentile(good.map(r=>r.ms),.95):null,elapsedMs:Math.round(httpEnd-start),drainMs:Math.round(performance.now()-httpEnd),warmup:warm,results};
   report.scenarios.push(value);console.log('MEASURE '+JSON.stringify({name,n,errors:value.errors,p50:value.p50Ms,p95:value.p95Ms}));
   metrics.setPhase('setup');save();
  }
  report.status='COMPLETE';
 }catch(error){report.status='FAIL';report.error=safe(error);console.log('FAIL '+JSON.stringify(report.error));process.exitCode=1;}
 finally{
  await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  await metrics.close();report.instrumentation=metrics.evidence();
  try{await composition?.closeOpportunityRuntime();await db?.close();}catch(error){report.cleanupError=safe(error);process.exitCode=1;}
  report.finishedAt=new Date().toISOString();save();
 }
}
run().catch(error=>{console.log('CLEANUP_FAILURE '+error.name);process.exitCode=1;});
