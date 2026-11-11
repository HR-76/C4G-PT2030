"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),https=require('node:https'),{randomUUID,randomBytes}=require('node:crypto');
const express=require('../../../backend/node_modules/express'),cors=require('../../../backend/node_modules/cors');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const {keycloak,databaseFixture,secret,requirement,policyVersion}=require('../http-oidc/fixture');
const out=path.resolve(__dirname,'../../../context/reviews/catalog-read-acceptance-load',process.env.HTTP_PROOF_RUN);
const report={status:'RUNNING',startedAt:new Date().toISOString(),isolated:true,habitualAccess:false,sourceConnections:false,checks:[],load:[],limits:['Real local Keycloak/TLS/PKCE with synthetic administrator and company reader; no external institutional federation.','Normal GCNI auth composition; existing fixture central non-authority reads use pg_read_all_data. Catalog and membership readers have dedicated limited logins.','Local single-machine design targets, not a production SLA.']};
const save=()=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));};
const check=name=>{report.checks.push({name,status:'PASS'});console.log('PASS '+name);save();};
const stage=name=>{report.stage=name;console.log('STAGE '+name);save();};
const safe=e=>({name:e.name,code:e.code||null,message:e.code==='ERR_ASSERTION'?String(e.message).split('\n')[0].slice(0,140):/^[A-Z_0-9 ]+$/.test(e.message||'')?e.message:null});
const quantile=(values,q)=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?Math.round(a[Math.ceil(a.length*q)-1]*100)/100:null;};
async function run(){let db,catalog,server,browser,composition,read,durableFixture;const durable=process.env.CATALOG_DURABLE_REHEARSAL==='1',load=process.env.CATALOG_DURABLE_LOAD==='1';const controls=process.env.CATALOG_CONTROL_REHEARSAL==='1';const profiler=process.env.CATALOG_PHASE_PROFILE==='1'?require('./phase-profiler.cjs').createProfiler():null;const sessionDiagnostics=process.env.CATALOG_SESSION_PROFILE==='1'?require('./session-diagnostics.cjs').createDiagnostics():null;let sinkFailed=false;
 const deadline=setTimeout(()=>{report.status='TIME_BUDGET_EXCEEDED';save();process.exit(1)},900000);deadline.unref();
 try{
  const outer=express();let inner;if(profiler)outer.use(profiler.middleware);
  outer.use((req,res,next)=>{const start=performance.now(),write=res.writeHead;res.writeHead=function(...args){res.setHeader('Server-Timing',`catalog;dur=${(performance.now()-start).toFixed(3)}${profiler?","+profiler.header():""}`);return write.apply(this,args)};next()});
  outer.get('/signed-in',(req,res)=>res.type('html').send('<h1>GCNI acceptance signed in</h1>'));
  const ui=process.env.CATALOG_ACCEPTANCE_UI;if(ui){assert(fs.existsSync(path.join(ui,'index.html')));outer.use(express.static(ui,{index:false}));outer.get(/^\/catalogo(?:\/[^/]+)?$/,(req,res)=>res.sendFile(path.join(ui,'index.html')));}
  outer.use((req,res,next)=>inner?inner(req,res,next):res.sendStatus(503));
  server=https.createServer({key:fs.readFileSync(path.join(process.env.HTTP_PROOF_TLS,'localhost.key')),cert:fs.readFileSync(path.join(process.env.HTTP_PROOF_TLS,'localhost.crt'))},outer);await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='https://localhost:'+server.address().port;
  stage('isolated-database-and-identities');db=await databaseFixture(report);const kc=await keycloak(origin);const a=await db.tenant(kc,0),b=await db.tenant(kc,1);const customer=await db.actor(kc,b.organizationId,'catalog-company-reader','CONTRIBUTOR');
  await db.central.pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),a.owner.id]);
  read=null;
  const {env:runtimeEnv,runtime}=await db.configure([a,b]);
  const env={...runtimeEnv,AUTH_MODE:'oidc',NODE_ENV:'development',PUBLIC_APP_URL:origin,OIDC_ISSUER:kc.issuer,OIDC_CLIENT_ID:kc.clientId,OIDC_REDIRECT_URI:origin+'/api/auth/oidc/callback',SESSION_SECRET:secret(),SESSION_COOKIE_SECURE:'true',SESSION_COOKIE_NAME:'__Host-http-proof',SESSION_IDLE_MS:'1800000',SESSION_ABSOLUTE_MS:'28800000',OIDC_TRANSACTION_MS:'600000',AUTH_POLICY_VERSION:policyVersion,AUTH_ASSURANCE_POLICY_JSON:JSON.stringify({'recent-auth':requirement}),PRIVILEGED_LOGIN_ASSURANCE_CATEGORY:'recent-auth',AUTHORITY_COMMIT_PERMIT_SECRET:db.central.permitSecret,FUNDING_TENDERS_RUNTIME:'central'};
  // Test-only composition seam: place the read router AFTER the unchanged GCNI session/auth middleware and BEFORE its 404 handler.

  const isolatedAdmission=require('../../../backend/src/opportunities/catalogRead/isolatedAdmission').createIsolatedAdmission({isolated:true,databaseName:new URL(db.central.connectionString).pathname.slice(1),readerLogin:'gcni_acceptance_reader',authorityLogin:'gcni_acceptance_authority'});
  let providerCalls=0;const compose=mode=>require('../../../backend/src/productionComposition').createProductionComposition({env:{...env,CATALOG_READ_RUNTIME:mode},isolatedCatalogAdmission:isolatedAdmission,isolatedSessionReadConcurrency:process.env.CATALOG_SHARED_SESSION_READS==='1',observeSessionTiming:sessionDiagnostics?.observe,isolatedSessionTouchCoalescing:process.env.CATALOG_COALESCE_TOUCHES==='1',logger:{error:(signal,details)=>{if(details.error){report.httpErrors ||= [];report.httpErrors.push({...safe(details.error),frames:String(details.error.stack||'').split('\n').filter(l=>l.trim().startsWith('at ')).slice(0,3)});save();}},warn:()=>{},info:()=>{}},dependencies:{express,createCatalogReadRuntime:()=>{providerCalls++;return {policyKind:"durable",router:(req,res,next)=>read?read.router(req,res,next):res.sendStatus(503),ready:async()=>Boolean(read&&durableFixture&&(await durableFixture.store.read())),close:async()=>{}};},cors,centralPool:db.reader,authorityPool:db.central.authorityPool,routes:{},opportunityRuntimeDependencies:runtime}});composition=compose(undefined);inner=composition.app;assert.equal(providerCalls,0);
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});report.browser=browser.version();report.node=process.version;
  async function login(actor){const context=await browser.newContext(),page=await context.newPage();await page.goto(origin+'/api/auth/oidc/login?returnTo=/signed-in');await page.locator('#username').fill(actor.username);await page.locator('#password').fill(actor.password);await page.locator('#kc-login').click();await page.getByRole('heading',{name:'GCNI acceptance signed in'}).waitFor({timeout:30000});const cookie=(await context.cookies(origin)).find(c=>c.name==='__Host-http-proof');assert(cookie?.secure&&cookie.httpOnly&&cookie.sameSite==='Lax');return {context,page,actor};}
  async function http(client,route,method='GET',body){
   const headers={Origin:origin};if(method!=='GET'){const csrf=await client.context.request.get(origin+'/api/auth/csrf');assert.equal(csrf.status(),200);headers['X-CSRF-Token']=(await csrf.json()).csrfToken;}
   const t=performance.now();try{const response=await client.context.request.fetch(origin+route,{method,headers,...(body===undefined?{}:{data:body}),timeout:30000});const data=await response.json();return {status:response.status(),data,httpMs:performance.now()-t,serverMs:Number(/dur=([0-9.]+)/.exec(response.headers()['server-timing']||'')?.[1]),bytes:(await response.body()).length,phases:profiler?Object.fromEntries(['auth','membership','controls','read'].map(k=>[k,Number(new RegExp('(?:^|,)'+k+';dur=([0-9.]+)').exec(response.headers()['server-timing']||'')?.[1])])):undefined};}catch(e){return {status:0,data:null,httpMs:performance.now()-t,serverMs:null,code:e.name==='TimeoutError'?'HTTP_TIMEOUT':'TRANSPORT_ERROR'};}
  }
  stage('real-oidc-administrator-and-company-login');const admin=await login(a.owner),client=await login(customer);check('REAL_PKCE_TLS_SECURE_SESSION_BOTH_PROFILES');
  for(const actor of [admin,client]){const selected=await http(actor,'/api/auth/organization','POST',{organizationId:actor.actor.organizationId});assert.equal(selected.status,200);assert.equal(selected.data.organization.id,actor.actor.organizationId);}
  assert((await http(admin,'/api/auth/session')).data.user.platformRoles.includes('C4G_ADMIN'));check('ADMIN_AND_CUSTOMER_REQUIRE_CONFIRMED_MEMBERSHIP');assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,503);assert.equal(providerCalls,0);check('NORMAL_COMPOSITION_DEFAULT_OFF_WITHOUT_PROVIDER');
  stage('catalog-package-integration');catalog=await require('./catalog-fixture.cjs').prepare(db,report,{maxPoolConnections:durable?2:10});const initial=await catalog.seed(27);report.initialFixture={count:27,storedPayloadBytes:initial.storedPayloadBytes};
  {const c=await catalog.catalogPool.connect();try{await c.query('BEGIN READ ONLY');await require('../../../backend/src/opportunities/catalogRead/readSchema').admitReader(c,{authorityLogin:catalog.authorityLogin});report.readerAdmission='PASS';}finally{await c.query('ROLLBACK');c.release();}}
  if(process.env.CATALOG_SQL_ONLY==='1'){report.sqlDiagnostics=await require('./sql-profile.cjs').diagnose({catalog,db});report.status='DIAGNOSTIC_PASS';return;}
  const readerDependencies={express,catalogPool:catalog.catalogPool,authorityPool:catalog.authorityPool,authorityLogin:catalog.authorityLogin,policyVersion,key:randomBytes(32),observePhase:profiler?.observe};
  if(durable)durableFixture=await require('./durable-fixture.cjs').prepare(db);
  const makeReader=()=>controls?require('../../../backend/src/opportunities/catalogRead/controlledRuntime').createControlledReadRuntime({...readerDependencies,isolated:true,...(durable?{policyStore:durableFixture.store}:{}),sink:event=>{if(sinkFailed)throw Error('ISOLATED_SINK_FAILURE');fs.appendFileSync(path.join(out,'control-telemetry.jsonl'),JSON.stringify(event)+'\n');}}):require('../../../backend/src/opportunities/catalogRead/readRuntime').createReadRuntime(readerDependencies);
  read=makeReader();const offComposition=composition;composition=compose("controlled");inner=composition.app;await offComposition.closeOpportunityRuntime();assert.equal(providerCalls,1);check("NORMAL_COMPOSITION_CONTROLLED_PROVIDER_MOUNTED");
  if(controls){
   assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,durable?503:403);assert.equal((await http(admin,'/api/auth/session')).status,200);
   await admin.page.goto(origin+'/catalogo/consulta');await admin.page.getByRole('heading',{name:'Catálogo temporariamente indisponível'}).waitFor();check('CONTROL_DEFAULT_OFF_API_AND_UI_SESSION_PRESERVED');
   await read.operator.enable({expectedRevision:0,organizations:[a.organizationId],roles:['ORG_ADMIN']});
   assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,200);assert.equal((await http(client,'/api/catalog-read/v1/opportunities')).status,403);check('CONTROL_ADMIN_FIRST_CUSTOMER_OUTSIDE_COHORT_DENIED');
   // Broader synthetic cohort solely for the existing regression matrix, not a user rollout.
   await read.operator.enable({expectedRevision:1,organizations:[a.organizationId,b.organizationId],roles:['ORG_ADMIN','CONTRIBUTOR']});
  }
  try{await (async()=>{const c=await db.central.authorityPool.connect();try{return await isolatedAdmission.admit(c)}finally{c.release()}})();report.centralAdmission={status:'PASS'};}catch(error){report.centralAdmission={status:'REFUSED',reason:String(error.message).slice(0,180)};}
  report.afterPackage=[];
  for(const [profile,actor] of [['administrator',admin],['company-reader',client]])for(const route of ['/api/auth/session','/api/catalog-read/v1/opportunities']){const response=await http(actor,route);report.afterPackage.push({profile,route,status:response.status,errorCode:response.data?.error?.code||response.data?.code||null});}
  assert.equal((await db.central.pool.query('SELECT state FROM opportunity_catalog.eu_source_control_v2')).rows[0].state,'QUIESCED');assert.equal((await db.central.pool.query('SELECT count(*)::int AS n FROM opportunity_catalog.funding_run')).rows[0].n,0);check('SOURCES_QUIESCED_ZERO_COLLECTIONS');
  assert.equal(report.centralAdmission.status,'PASS');assert(report.afterPackage.every(r=>r.status===200));check('CANDIDATE_PACKAGE_ADMITTED_WITH_REAL_SESSIONS');
  await assert.rejects(require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(db.central.pool),/Unknown applied migration/);check('ORDINARY_ADMISSION_STILL_REFUSES_CANDIDATE');
  const first=await http(admin,'/api/catalog-read/v1/opportunities?sort=title');assert.equal(first.status,200);assert.equal(first.data.data.length,25);assert(first.data.page.hasMore);
  const snapshot=encodeURIComponent(first.data.meta.snapshot),cursor=encodeURIComponent(first.data.page.nextCursor);
  const second=await http(admin,'/api/catalog-read/v1/opportunities?sort=title&snapshot='+snapshot+'&cursor='+cursor);assert.equal(second.status,200);assert.equal(second.data.data.length,2);assert.equal(new Set([...first.data.data,...second.data.data].map(x=>x.id)).size,27);
  const opportunity=first.data.data[0];const detail=await http(admin,'/api/catalog-read/v1/opportunities/'+opportunity.id+'?snapshot='+snapshot);assert.equal(detail.status,200);assert.deepEqual(detail.data.data.summary,opportunity);check('REAL_OIDC_TABLE_DETAIL_AND_KEYSET_PAGINATION');
  const crossed=await http(client,'/api/catalog-read/v1/opportunities?snapshot='+snapshot);assert.equal(crossed.status,403);check('REAL_OIDC_CROSS_ORGANIZATION_SNAPSHOT_DENIED');
  assert(ui,'Isolated UI build required');
  for(const actor of [admin,client]){await actor.page.goto(origin+'/catalogo/consulta');await actor.page.getByRole('heading',{name:'Oportunidades de financiamento'}).waitFor();await actor.page.getByRole('link',{name:/Abrir Ensaio GCNI/}).first().click();await actor.page.getByRole('heading',{name:/Ensaio GCNI/}).waitFor();}
  check('BROWSER_TABLE_AND_DETAIL_BOTH_PROFILES');
  assert(admin.page.url().includes('/catalogo/consulta/'));await admin.page.screenshot({path:path.join(out,'normal-detail.png'),fullPage:true});
  await admin.page.getByRole('link',{name:/Gestão de oportunidades, interesses e candidaturas/}).click();await admin.page.getByRole('link',{name:'Explorar catálogo unificado'}).waitFor();assert(new URL(admin.page.url()).pathname==='/catalogo');
  await admin.page.getByRole('link',{name:'Explorar catálogo unificado'}).click();await admin.page.getByRole('heading',{name:'Oportunidades de financiamento'}).waitFor();
  await admin.page.getByLabel('Código ou título',{exact:true}).fill('Ensaio GCNI 00005');await admin.page.getByRole('button',{name:'Pesquisar',exact:true}).click();await admin.page.waitForFunction(()=>document.querySelectorAll('.catalog-read tbody tr').length===1);await admin.page.screenshot({path:path.join(out,'normal-filtered.png'),fullPage:true});
  await admin.page.getByRole('link',{name:'Abrir Ensaio GCNI 00005',exact:true}).click();await admin.page.getByRole('heading',{name:'Ensaio GCNI 00005',exact:true}).waitFor();check('NORMAL_UI_NAVIGATION_FILTER_DETAIL_AND_RETURN');

  if(controls){
   const change=async(action,body={})=>read.operator[action]({expectedRevision:(await read.operator.status()).revision,...body});
   const open=()=>change('enable',{organizations:[a.organizationId,b.organizationId],roles:['ORG_ADMIN','CONTRIBUTOR']});
   await change('disable');assert.equal((await http(admin,'/api/catalog-read/v1/opportunities?snapshot='+snapshot)).status,403);assert.equal((await http(admin,'/api/auth/session')).status,200);
   await admin.page.getByRole('heading',{name:'Catálogo temporariamente indisponível'}).waitFor({timeout:20000});check('CONTROL_ROLLBACK_CLEARS_UI_REJECTS_OLD_REQUESTS_PRESERVES_SESSION');
   await open();await change('withdraw',{generationId:first.data.meta.generationId});
   assert.equal((await http(admin,'/api/catalog-read/v1/opportunities?snapshot='+snapshot)).status,410);
   await catalog.seed(27);assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,200);
   await change('disable');await open();assert.equal((await http(admin,'/api/catalog-read/v1/opportunities?snapshot='+snapshot)).status,410);check('CONTROL_WITHDRAWAL_SURVIVES_NEW_GENERATION_AND_REOPENING');
   sinkFailed=true;await http(admin,'/api/catalog-read/v1/opportunities');assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,503);
   assert(read.monitor.snapshot().alerts.includes('TELEMETRY_UNAVAILABLE'));assert.equal((await http(admin,'/api/auth/session')).status,200);
   sinkFailed=false;assert(read.monitor.heartbeat());assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,200);
   read.monitor.probe(false);read.monitor.probe(false);read.monitor.probe(false);assert(read.monitor.snapshot().alerts.includes('PROBE_FAILURE'));read.monitor.probe(true);
   report.controls={status:'PASS',firstCohort:'synthetic admin with membership',monitor:read.monitor.snapshot(),policyStorage:durable?'PostgreSQL primary, dedicated reader/operator logins':'shared in-process adapter; no distributed durability claim',alertDelivery:'owned JSONL evidence only; no external channel'};
   const telemetry=fs.readFileSync(path.join(out,'control-telemetry.jsonl'),'utf8');assert(!telemetry.includes(first.data.meta.snapshot));assert(!telemetry.includes(a.owner.id));assert(!/[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(telemetry));check('CONTROL_MONITOR_FAILURE_RECOVERY_PROBES_AND_SANITIZED_EVIDENCE');
  }
  if(durable){
   const revision=(await read.operator.status()).revision;read=makeReader();
   assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,503);
   assert.equal((await http(admin,'/api/auth/session')).status,200);
   await read.operator.resume({expectedRevision:revision});
   assert.equal((await http(admin,'/api/catalog-read/v1/opportunities?snapshot='+snapshot)).status,410);
   assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,200);
   await admin.page.goto(origin+'/catalogo/consulta');await admin.page.getByRole('heading',{name:'Oportunidades de financiamento'}).waitFor();
   await admin.page.getByRole('link',{name:/Abrir Ensaio GCNI/}).first().click();await admin.page.getByRole('heading',{name:/Ensaio GCNI/}).waitFor();
   const history=(await db.central.pool.query('SELECT revision::int FROM gcni_catalog_control_rehearsal.history ORDER BY revision')).rows;
   assert.deepEqual(history.map(x=>x.revision),Array.from({length:history.length},(_,i)=>i));
   check('DURABLE_RECOMPOSITION_REQUIRES_ADMISSION_PRESERVES_SESSION_AND_WITHDRAWALS');
  }
  if(process.env.CATALOG_SHARED_SESSION_READS==='1'){report.sessionConcurrency=await require('./shared-session-proof.cjs').prove({db,isolatedAdmission});check('SESSION_READERS_CONCURRENT_WRITER_SERIALIZED_READONLY_ENFORCED');}
  if(load){
   // Stop background UI availability polling to keep the declared load exact.
   await admin.page.goto('about:blank');await client.page.goto('about:blank');
   stage('durable-oidc-useful-load');
   const renew=async()=>{assert(read.monitor.heartbeat());await read.operator.enable({expectedRevision:(await read.operator.status()).revision,organizations:[a.organizationId,b.organizationId],roles:['ORG_ADMIN','CONTRIBUTOR']});};
   await require('./durable-load.cjs').runLoad({catalog,http,admin,renew,report,save,sessionDiagnostics,volumes:process.env.CATALOG_PROFILE_ONLY==='1'?[27]:[27,10000]});
   check('DURABLE_OIDC_LOAD_MEASUREMENT_COMPLETED');
   if(profiler){report.sqlDiagnostics=await require('./sql-profile.cjs').diagnose({catalog,db});save();}
  }
  // Exercise the candidate coordinator's locked security check, not a direct status update.
  await db.central.pool.query('GRANT UPDATE ON catalog_read.revision_projection TO c4g_catalog_projection_reader');
  try{const c=await db.central.authorityPool.connect();try{await assert.rejects(isolatedAdmission.admit(c),/CATALOG_READ_SCHEMA_OR_PERMISSION_DRIFT/);}finally{c.release();}}finally{await db.central.pool.query('REVOKE UPDATE ON catalog_read.revision_projection FROM c4g_catalog_projection_reader');}
  assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,200);check('CANDIDATE_ADMISSION_REFUSES_PERMISSION_DRIFT_AND_RECOVERS');
  const coordinator=require('../../../backend/src/security/authorityCoordinator').createAuthorityCoordinator({pool:db.central.authorityPool,permitSecret:db.central.permitSecret,isolatedCatalogAdmission:isolatedAdmission});
  const memberships=require('../../../backend/src/security/membershipRepository').createMembershipRepository(db.central.pool,coordinator);
  await memberships.changeStatus({membershipId:customer.membershipId,status:'SUSPENDED',reason:'Owned catalog acceptance revocation'});
  const denied=await http(client,'/api/catalog-read/v1/opportunities');assert([401,403,409].includes(denied.status));assert(!denied.data?.data);assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,200);check('REAL_OIDC_MEMBERSHIP_REVOCATION_NO_DATA_RELEASE');
  assert.equal((await db.central.pool.query('SELECT state FROM opportunity_catalog.eu_source_control_v2')).rows[0].state,'QUIESCED');assert.equal((await db.central.pool.query('SELECT count(*)::int AS n FROM opportunity_catalog.funding_run')).rows[0].n,0);
  report.remainingFunctionalChecks=[];report.functionalStatus='PASS';report.status=load&&report.load.status!=='PASS'?'NOT_ACCEPTED':'PASS';
 }catch(e){report.status='FAIL';report.error=safe(e);console.log('FAIL '+JSON.stringify(report.error));}
 finally{if(read?.operator){try{await read.operator.disable({expectedRevision:(await read.operator.status()).revision});report.finalExposure=await read.operator.status();}catch(e){report.status='FAIL';report.controlCleanup=safe(e);}}await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await composition?.closeOpportunityRuntime();await catalog?.close();await durableFixture?.close();await db?.close();report.finishedAt=new Date().toISOString();save();}
 console.log('ACCEPTANCE_RESULT '+report.status);if(report.status!=='PASS')process.exitCode=1;
}
run().catch(e=>{report.status='FAIL';report.cleanupError=safe(e);save();process.exitCode=1;});
