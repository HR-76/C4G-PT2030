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
async function run(){let db,catalog,server,browser,composition,read,durableFixture,control;const durable=process.env.CATALOG_DURABLE_REHEARSAL==='1',load=process.env.CATALOG_DURABLE_LOAD==='1';const controls=process.env.CATALOG_CONTROL_REHEARSAL==='1';const profiler=process.env.CATALOG_PHASE_PROFILE==='1'?require('./phase-profiler.cjs').createProfiler():null;const sessionDiagnostics=process.env.CATALOG_SESSION_PROFILE==='1'?require('./session-diagnostics.cjs').createDiagnostics():null;let sinkFailed=false;
 const deadline=setTimeout(()=>{report.status='TIME_BUDGET_EXCEEDED';save();process.exit(1)},900000);deadline.unref();
 try{
  assert(durable&&controls&&!load,'DURABLE_ADMIN_ONLY_FUNCTIONAL_GATE_REQUIRED');
  const outer=express();let inner;if(profiler)outer.use(profiler.middleware);
  outer.use((req,res,next)=>{const start=performance.now(),write=res.writeHead;res.writeHead=function(...args){res.setHeader('Server-Timing',`catalog;dur=${(performance.now()-start).toFixed(3)}${profiler?","+profiler.header():""}`);return write.apply(this,args)};next()});
  outer.get('/signed-in',(req,res)=>res.type('html').send('<h1>GCNI acceptance signed in</h1>'));
  const ui=process.env.CATALOG_ACCEPTANCE_UI;if(ui){assert(fs.existsSync(path.join(ui,'index.html')));outer.use(express.static(ui,{index:false}));outer.get(/^\/catalogo(?:\/[^/]+)?$/,(req,res)=>res.sendFile(path.join(ui,'index.html')));}
  outer.use((req,res,next)=>inner?inner(req,res,next):res.sendStatus(503));
  server=https.createServer({key:fs.readFileSync(path.join(process.env.HTTP_PROOF_TLS,'localhost.key')),cert:fs.readFileSync(path.join(process.env.HTTP_PROOF_TLS,'localhost.crt'))},outer);await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='https://localhost:'+server.address().port;
  stage('isolated-database-and-identities');db=await databaseFixture(report);const kc=await keycloak(origin);const a=await db.tenant(kc,0),b=await db.tenant(kc,1);const customer=await db.actor(kc,b.organizationId,'catalog-company-reader','CONTRIBUTOR');
  const sameOrgContributor=await db.actor(kc,a.organizationId,'same-entity-contributor','CONTRIBUTOR');const sameOrgAdmin=await db.actor(kc,a.organizationId,'unselected-entity-admin','ORG_ADMIN');
  read=null;
  const {env:runtimeEnv,runtime}=await db.configure([a,b]);
  const env={...runtimeEnv,AUTH_MODE:'oidc',NODE_ENV:'development',PUBLIC_APP_URL:origin,OIDC_ISSUER:kc.issuer,OIDC_CLIENT_ID:kc.clientId,OIDC_REDIRECT_URI:origin+'/api/auth/oidc/callback',SESSION_SECRET:secret(),SESSION_COOKIE_SECURE:'true',SESSION_COOKIE_NAME:'__Host-http-proof',SESSION_IDLE_MS:'1800000',SESSION_ABSOLUTE_MS:'28800000',OIDC_TRANSACTION_MS:'600000',AUTH_POLICY_VERSION:policyVersion,AUTH_ASSURANCE_POLICY_JSON:JSON.stringify({'recent-auth':requirement}),PRIVILEGED_LOGIN_ASSURANCE_CATEGORY:'recent-auth',AUTHORITY_COMMIT_PERMIT_SECRET:db.central.permitSecret,FUNDING_TENDERS_RUNTIME:'central'};
  // Test-only composition seam: place the read router AFTER the unchanged GCNI session/auth middleware and BEFORE its 404 handler.

  let providerCalls=0;const compose=mode=>require('../../../backend/src/productionComposition').createProductionComposition({env:{...env,CATALOG_READ_RUNTIME:mode},isolatedSessionReadConcurrency:process.env.CATALOG_SHARED_SESSION_READS==='1',observeSessionTiming:sessionDiagnostics?.observe,isolatedSessionTouchCoalescing:process.env.CATALOG_COALESCE_TOUCHES==='1',logger:{error:(signal,details)=>{if(details.error){report.httpErrors ||= [];report.httpErrors.push({...safe(details.error),frames:String(details.error.stack||'').split('\n').filter(l=>l.trim().startsWith('at ')).slice(0,3)});save();}},warn:()=>{},info:()=>{}},dependencies:{express,createCatalogReadRuntime:()=>{providerCalls++;return makeReader();},cors,centralPool:db.reader,authorityPool:db.central.authorityPool,routes:{},opportunityRuntimeDependencies:runtime}});composition=compose(undefined);inner=composition.app;assert.equal(providerCalls,0);
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});report.browser=browser.version();report.node=process.version;
  async function login(actor){const context=await browser.newContext(),page=await context.newPage();await page.goto(origin+'/api/auth/oidc/login?returnTo=/signed-in');await page.locator('#username').fill(actor.username);await page.locator('#password').fill(actor.password);await page.locator('#kc-login').click();await page.getByRole('heading',{name:'GCNI acceptance signed in'}).waitFor({timeout:30000});const cookie=(await context.cookies(origin)).find(c=>c.name==='__Host-http-proof');assert(cookie?.secure&&cookie.httpOnly&&cookie.sameSite==='Lax');return {context,page,actor};}
  async function http(client,route,method='GET',body){
   const headers={Origin:origin};if(method!=='GET'){const csrf=await client.context.request.get(origin+'/api/auth/csrf');assert.equal(csrf.status(),200);headers['X-CSRF-Token']=(await csrf.json()).csrfToken;}
   const t=performance.now();try{const response=await client.context.request.fetch(origin+route,{method,headers,...(body===undefined?{}:{data:body}),timeout:30000});const data=await response.json();return {status:response.status(),data,httpMs:performance.now()-t,serverMs:Number(/dur=([0-9.]+)/.exec(response.headers()['server-timing']||'')?.[1]),bytes:(await response.body()).length,phases:profiler?Object.fromEntries(['auth','membership','controls','read'].map(k=>[k,Number(new RegExp('(?:^|,)'+k+';dur=([0-9.]+)').exec(response.headers()['server-timing']||'')?.[1])])):undefined};}catch(e){return {status:0,data:null,httpMs:performance.now()-t,serverMs:null,code:e.name==='TimeoutError'?'HTTP_TIMEOUT':'TRANSPORT_ERROR'};}
  }
  stage('real-oidc-administrator-and-company-login');const admin=await login(a.owner),client=await login(customer),otherAdmin=await login(b.owner),contributor=await login(sameOrgContributor),unselectedAdmin=await login(sameOrgAdmin);check('REAL_PKCE_TLS_SECURE_SESSION_BOTH_PROFILES');
  for(const actor of [admin,client,otherAdmin,contributor,unselectedAdmin]){const selected=await http(actor,'/api/auth/organization','POST',{organizationId:actor.actor.organizationId});assert.equal(selected.status,200);assert.equal(selected.data.organization.id,actor.actor.organizationId);}
  assert(!(await http(admin,'/api/auth/session')).data.user.platformRoles.includes('C4G_ADMIN'));check('ADMIN_AND_CUSTOMER_REQUIRE_CONFIRMED_MEMBERSHIP');assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,503);assert.equal(providerCalls,0);check('NORMAL_COMPOSITION_DEFAULT_OFF_WITHOUT_PROVIDER');
  stage('catalog-package-integration');catalog=await require('./admin-catalog-fixture.cjs').prepare(db,report,{maxPoolConnections:durable?2:10});report.initialFixture=await require('./real-data-fixture.cjs').prepare({db,catalog,check});
  {const c=await catalog.catalogPool.connect();try{await c.query('BEGIN READ ONLY');await require('../../../backend/src/opportunities/catalogRead/readSchema').admitReader(c,{authorityLogin:catalog.authorityLogin});report.readerAdmission='PASS';}finally{await c.query('ROLLBACK');c.release();}}
  if(process.env.CATALOG_SQL_ONLY==='1'){report.sqlDiagnostics=await require('./sql-profile.cjs').diagnose({catalog,db});report.status='DIAGNOSTIC_PASS';return;}
  const readerDependencies={express,catalogPool:catalog.catalogPool,authorityPool:catalog.authorityPool,authorityLogin:catalog.authorityLogin,policyVersion,key:randomBytes(32),observePhase:profiler?.observe};
  if(durable)durableFixture=await require('./admin-durable-fixture.cjs').prepare(db);
  const makeReader=()=>{
   control=require('../../../backend/src/opportunities/catalogRead/adminOnlyRehearsalControl').createAdminOnlyRehearsalControl({isolated:true,organizationId:a.organizationId,userId:a.owner.id,store:durableFixture.store,sink:event=>{if(sinkFailed)throw Error('ISOLATED_SINK_FAILURE');fs.appendFileSync(path.join(out,'control-telemetry.jsonl'),JSON.stringify(event)+'\n');}});
   read=require('../../../backend/src/opportunities/catalogRead/isolatedDurableProvider').createIsolatedDurableReaderProvider({isolated:true,target:catalog.target,credentials:{...catalog.credentials,policy:durableFixture.readerPassword},Pool:require('../../../backend/node_modules/pg').Pool,express,policyVersion,key:readerDependencies.key,control})();return read;
  };
  const offComposition=composition;composition=compose('controlled');inner=composition.app;await offComposition.closeOpportunityRuntime();assert.equal(providerCalls,1);assert.equal(await read.ready(),true);check('NORMAL_COMPOSITION_REAL_DURABLE_PROVIDER_MOUNTED');
  {const visitor=await browser.newContext();try{const response=await visitor.request.get(origin+'/api/catalog-read/v1/opportunities');assert.equal(response.status(),401);assert.equal((await response.json()).error.code,'SESSION_REQUIRED');}finally{await visitor.close();}}check('ANONYMOUS_REQUEST_PRESERVES_401_CONTRACT');
  if(controls){
   assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,durable?503:403);assert.equal((await http(admin,'/api/auth/session')).status,200);
   await admin.page.goto(origin+'/catalogo/consulta');await admin.page.getByRole('heading',{name:'Catálogo temporariamente indisponível'}).waitFor();check('CONTROL_DEFAULT_OFF_API_AND_UI_SESSION_PRESERVED');
   await control.operator.enable({expectedRevision:0});
   assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,200);assert.equal((await http(client,'/api/catalog-read/v1/opportunities')).status,403);check('CONTROL_ADMIN_FIRST_CUSTOMER_OUTSIDE_COHORT_DENIED');
   for(const actor of [client,otherAdmin,contributor,unselectedAdmin]){const refused=await http(actor,'/api/catalog-read/v1/opportunities');assert.equal(refused.status,403);assert(!refused.data?.data);}check('ONLY_SELECTED_ENTITY_ADMIN_ADMITTED');
   await assert.rejects(()=>control.operator.enable({expectedRevision:1,organizations:[b.organizationId]}),/SCOPE_FIXED/);check('COHORT_CANNOT_BE_WIDENED');
  }
  try{await (async()=>{const c=await db.central.authorityPool.connect();try{return await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral({connect:async()=>({query:(...args)=>c.query(...args),release(){}})})}finally{c.release()}})();report.centralAdmission={status:'PASS'};}catch(error){report.centralAdmission={status:'REFUSED',reason:String(error.message).slice(0,180)};}
  report.afterPackage=[];
  for(const [profile,actor] of [['administrator',admin],['company-reader',client]])for(const route of ['/api/auth/session','/api/catalog-read/v1/opportunities']){const response=await http(actor,route);report.afterPackage.push({profile,route,status:response.status,errorCode:response.data?.error?.code||response.data?.code||null});}
  assert.equal((await db.central.pool.query('SELECT state FROM opportunity_catalog.eu_source_control_v2')).rows[0].state,'QUIESCED');assert.equal((await db.central.pool.query('SELECT count(*)::int AS n FROM opportunity_catalog.funding_run')).rows[0].n,0);check('SOURCES_QUIESCED_ZERO_COLLECTIONS');
  assert.equal(report.centralAdmission.status,'PASS');assert(report.afterPackage.every(r=>r.status===(r.profile==='company-reader'&&r.route.includes('/catalog-read/')?403:200)));check('REGISTERED_PACKAGE_ADMITTED_WITH_REAL_SESSIONS');
  assert.equal((await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(db.central.pool)).currentVersion,'048_catalog_read_service_v1');check('NORMAL_048_ADMISSION_WITH_DEDICATED_CREDENTIALS');
  const first=await http(admin,'/api/catalog-read/v1/opportunities?sort=title');assert.equal(first.status,200);assert.equal(first.data.data.length,25);assert(first.data.page.hasMore);
  const snapshot=encodeURIComponent(first.data.meta.snapshot),cursor=encodeURIComponent(first.data.page.nextCursor);
  let all=[...first.data.data], next=first;
  while(next.data.page.hasMore){next=await http(admin,'/api/catalog-read/v1/opportunities?sort=title&snapshot='+snapshot+'&cursor='+encodeURIComponent(next.data.page.nextCursor));assert.equal(next.status,200);all.push(...next.data.data);}
  assert.equal(all.length,178);assert.equal(new Set(all.map(x=>x.id)).size,178);
  assert.deepEqual([...new Set(all.flatMap(x=>x.sources.map(s=>s.namespace)))].sort(),['EU_FUNDING_TENDERS','PORTUGAL2030_PLAN']);
  for(const [namespace,count] of Object.entries(report.initialFixture.counts)){const filtered=await http(admin,'/api/catalog-read/v1/opportunities?source='+namespace);assert.equal(filtered.status,200);assert.equal(filtered.data.data.length,Math.min(25,count));assert(filtered.data.data.every(x=>x.sources.some(s=>s.namespace===namespace)));const row=all.find(x=>x.sources.some(s=>s.namespace===namespace));const response=await http(admin,'/api/catalog-read/v1/opportunities/'+row.id+'?snapshot='+snapshot);assert.equal(response.status,200);assert.deepEqual(response.data.data.summary,row);if(namespace==='PORTUGAL2030_PLAN'){assert.equal(row.status.code,'planned');assert.equal(row.deadline.state,'unknown');}}
  check('BOTH_SOURCES_SAME_TABLE_FILTERS_DETAILS_AND_178_UNIQUE_ROWS');
  const opportunity=first.data.data[0];const detail=await http(admin,'/api/catalog-read/v1/opportunities/'+opportunity.id+'?snapshot='+snapshot);assert.equal(detail.status,200);assert.deepEqual(detail.data.data.summary,opportunity);check('REAL_OIDC_TABLE_DETAIL_AND_KEYSET_PAGINATION');
  const crossed=await http(client,'/api/catalog-read/v1/opportunities?snapshot='+snapshot);assert.equal(crossed.status,403);check('REAL_OIDC_CROSS_ORGANIZATION_SNAPSHOT_DENIED');
  assert(ui,'Isolated UI build required');
  for(const actor of [admin]){await actor.page.goto(origin+'/catalogo/consulta');await actor.page.getByRole('heading',{name:'Oportunidades de financiamento'}).waitFor();await actor.page.getByRole('link',{name:/Abrir /}).first().click();await actor.page.locator('.catalog-read h1').waitFor();}
  check('BROWSER_TABLE_AND_DETAIL_SELECTED_ADMIN');
  for(const actor of [client,otherAdmin,contributor,unselectedAdmin]){await actor.page.goto(origin+'/catalogo/consulta');await actor.page.getByRole('heading',{name:'Catálogo temporariamente indisponível'}).waitFor();assert.equal(await actor.page.locator('.catalog-read tbody tr').count(),0);}check('BROWSER_OTHER_ACCOUNTS_HAVE_NO_CATALOG_DATA');
  assert(admin.page.url().includes('/catalogo/consulta/'));await admin.page.screenshot({path:path.join(out,'normal-detail.png'),fullPage:true});
  await admin.page.getByRole('link',{name:/Gestão de oportunidades, interesses e candidaturas/}).click();await admin.page.getByRole('link',{name:'Explorar catálogo unificado'}).waitFor();assert(new URL(admin.page.url()).pathname==='/catalogo');
  await admin.page.getByRole('link',{name:'Explorar catálogo unificado'}).click();await admin.page.getByRole('heading',{name:'Oportunidades de financiamento'}).waitFor();
  stage('browser-real-source-demonstration');await admin.page.getByText('Mais filtros',{exact:true}).click();
  await admin.page.getByRole('combobox',{name:'Ordenação',exact:true}).selectOption('title');await admin.page.getByRole('button',{name:'Pesquisar',exact:true}).click();
  for(let i=0;i<8;i++){if(await admin.page.getByRole('link',{name:'Abrir Gnomon Internships Offer',exact:true}).count())break;await admin.page.getByRole('button',{name:'Seguinte',exact:true}).click();await admin.page.waitForTimeout(700);}
  await admin.page.getByRole('link',{name:'Abrir Gnomon Internships Offer',exact:true}).waitFor();assert(await admin.page.locator('tbody').getByText('Portugal 2030 · Plano',{exact:true}).count());
  await admin.page.screenshot({path:path.join(out,'real-unified-table.png'),fullPage:true});
  for(const [query,name,file] of [['CONTRATOS DE IMPACTO SOCIAL','CONTRATOS DE IMPACTO SOCIAL','real-pt-detail.png'],['Gnomon','Gnomon Internships Offer','real-eu-detail.png']]){
    await admin.page.goto(origin+'/catalogo/consulta');await admin.page.getByRole('heading',{name:'Oportunidades de financiamento'}).waitFor();
    await admin.page.getByLabel('Código ou título',{exact:true}).fill(query);await admin.page.getByRole('button',{name:'Pesquisar',exact:true}).click();
    await admin.page.getByRole('link',{name:'Abrir '+name,exact:true}).first().click();await admin.page.getByRole('heading',{name,exact:true}).waitFor();
    await admin.page.screenshot({path:path.join(out,file),fullPage:true});
  }
  check('NORMAL_UI_REAL_PT_AND_EU_FILTERS_AND_DETAILS');

  if(controls){
   const change=async(action,body={})=>control.operator[action]({expectedRevision:(await control.operator.status()).revision,...body});
   const open=()=>change('enable');
   await change('disable');assert.equal((await http(admin,'/api/catalog-read/v1/opportunities?snapshot='+snapshot)).status,403);assert.equal((await http(admin,'/api/auth/session')).status,200);
   await admin.page.getByRole('heading',{name:'Catálogo temporariamente indisponível'}).waitFor({timeout:20000});check('CONTROL_ROLLBACK_CLEARS_UI_REJECTS_OLD_REQUESTS_PRESERVES_SESSION');
   await open();await change('withdraw',{generationId:first.data.meta.generationId});
   assert.equal((await http(admin,'/api/catalog-read/v1/opportunities?snapshot='+snapshot)).status,410);
   await catalog.seed(27);assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,200);
   await change('disable');await open();assert.equal((await http(admin,'/api/catalog-read/v1/opportunities?snapshot='+snapshot)).status,410);check('CONTROL_WITHDRAWAL_SURVIVES_NEW_GENERATION_AND_REOPENING');
   sinkFailed=true;await http(admin,'/api/catalog-read/v1/opportunities');assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,503);
   assert(control.monitor.snapshot().alerts.includes('TELEMETRY_UNAVAILABLE'));assert.equal((await http(admin,'/api/auth/session')).status,200);
   sinkFailed=false;assert(control.monitor.heartbeat());assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,200);
   control.monitor.probe(false);control.monitor.probe(false);control.monitor.probe(false);assert(control.monitor.snapshot().alerts.includes('PROBE_FAILURE'));control.monitor.probe(true);
   report.controls={status:'PASS',firstCohort:'synthetic admin with membership',monitor:control.monitor.snapshot(),policyStorage:durable?'PostgreSQL primary, dedicated reader/operator logins':'shared in-process adapter; no distributed durability claim',alertDelivery:'owned JSONL evidence only; no external channel'};
   const telemetry=fs.readFileSync(path.join(out,'control-telemetry.jsonl'),'utf8');assert(!telemetry.includes(first.data.meta.snapshot));assert(!telemetry.includes(a.owner.id));assert(!/[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(telemetry));check('CONTROL_MONITOR_FAILURE_RECOVERY_PROBES_AND_SANITIZED_EVIDENCE');
  }
  if(durable){
   const revision=(await control.operator.status()).revision;const previousComposition=composition;composition=compose('controlled');inner=composition.app;await previousComposition.closeOpportunityRuntime();
   assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,503);
   assert.equal((await http(admin,'/api/auth/session')).status,200);
   await control.operator.resume({expectedRevision:revision});
   assert.equal((await http(admin,'/api/catalog-read/v1/opportunities?snapshot='+snapshot)).status,410);
   assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,200);
   await admin.page.goto(origin+'/catalogo/consulta');await admin.page.getByRole('heading',{name:'Oportunidades de financiamento'}).waitFor();
   await admin.page.getByRole('link',{name:/Abrir /}).first().click();await admin.page.locator('.catalog-read h1').waitFor();
   const history=(await db.central.pool.query('SELECT revision::int FROM gcni_catalog_control_rehearsal.history ORDER BY revision')).rows;
   assert.deepEqual(history.map(x=>x.revision),Array.from({length:history.length},(_,i)=>i));
   check('DURABLE_RECOMPOSITION_REQUIRES_ADMISSION_PRESERVES_SESSION_AND_WITHDRAWALS');
  }
  // Exercise the candidate coordinator's locked security check, not a direct status update.
  await db.central.pool.query('GRANT UPDATE ON catalog_read.revision_projection TO c4g_catalog_projection_reader');
  try{const c=await db.central.authorityPool.connect();try{await assert.rejects(require('../../../backend/src/security/authoritySecurityManifest').assertAuthorityAdmission(c),/CATALOG_READ_SCHEMA_DRIFT/);}finally{c.release();}}finally{await db.central.pool.query('REVOKE UPDATE ON catalog_read.revision_projection FROM c4g_catalog_projection_reader');}
  assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,200);check('NORMAL_ADMISSION_REFUSES_PERMISSION_DRIFT_AND_RECOVERS');
  const coordinator=require('../../../backend/src/security/authorityCoordinator').createAuthorityCoordinator({pool:db.central.authorityPool,permitSecret:db.central.permitSecret});
  const memberships=require('../../../backend/src/security/membershipRepository').createMembershipRepository(db.central.pool,coordinator);
  await memberships.changeStatus({membershipId:a.owner.membershipId,status:'SUSPENDED',reason:'Owned catalog acceptance revocation'});
  const denied=await http(admin,'/api/catalog-read/v1/opportunities');assert([401,403,409].includes(denied.status));assert(!denied.data?.data);assert.equal((await http(client,'/api/catalog-read/v1/opportunities')).status,403);check('SELECTED_ADMIN_MEMBERSHIP_REVOCATION_NO_DATA_RELEASE');
  assert.equal((await db.central.pool.query('SELECT state FROM opportunity_catalog.eu_source_control_v2')).rows[0].state,'QUIESCED');assert.equal((await db.central.pool.query('SELECT count(*)::int AS n FROM opportunity_catalog.funding_run')).rows[0].n,0);
  report.remainingFunctionalChecks=[];report.functionalStatus='PASS';report.status='PASS';
 }catch(e){report.status='FAIL';report.error=safe(e);if(e.name==='TimeoutError')report.error.operation=String(e.message).split('Call log:')[0].slice(0,300);console.log('FAIL '+JSON.stringify(report.error));}
 finally{if(control?.operator){try{await control.operator.disable({expectedRevision:(await control.operator.status()).revision});report.finalExposure=await control.operator.status();}catch(e){report.status='FAIL';report.controlCleanup=safe(e);}}await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await composition?.closeOpportunityRuntime();await catalog?.close();await durableFixture?.close();await db?.close();report.finishedAt=new Date().toISOString();save();}
 console.log('ACCEPTANCE_RESULT '+report.status);if(report.status!=='PASS')process.exitCode=1;
}
run().catch(e=>{report.status='FAIL';report.cleanupError=safe(e);save();process.exitCode=1;});
