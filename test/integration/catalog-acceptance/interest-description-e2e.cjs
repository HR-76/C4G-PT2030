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
async function run(){let db,catalog,server,browser,composition,read,durableFixture,control,boot;const durable=process.env.CATALOG_DURABLE_REHEARSAL==='1',load=process.env.CATALOG_DURABLE_LOAD==='1';const controls=process.env.CATALOG_CONTROL_REHEARSAL==='1';const profiler=process.env.CATALOG_PHASE_PROFILE==='1'?require('./phase-profiler.cjs').createProfiler():null;const sessionDiagnostics=process.env.CATALOG_SESSION_PROFILE==='1'?require('./session-diagnostics.cjs').createDiagnostics():null;let sinkFailed=false;
 const deadline=setTimeout(()=>{report.status='TIME_BUDGET_EXCEEDED';save();process.exit(1)},900000);deadline.unref();
 try{
  assert(durable&&controls&&!load,'DURABLE_ADMIN_ONLY_FUNCTIONAL_GATE_REQUIRED');
  const outer=express();let inner;if(profiler)outer.use(profiler.middleware);
  outer.use((req,res,next)=>{const start=performance.now(),write=res.writeHead;res.writeHead=function(...args){res.setHeader('Server-Timing',`catalog;dur=${(performance.now()-start).toFixed(3)}${profiler?","+profiler.header():""}`);return write.apply(this,args)};next()});
  outer.get('/signed-in',(req,res)=>res.type('html').send('<h1>GCNI acceptance signed in</h1>'));
  const ui=process.env.CATALOG_ACCEPTANCE_UI;if(ui){assert(fs.existsSync(path.join(ui,'index.html')));outer.use(express.static(ui,{index:false}));outer.get(/^\/catalogo(?:\/[^/]+){0,2}$/,(req,res)=>res.sendFile(path.join(ui,'index.html')));}
  outer.use((req,res,next)=>inner?inner(req,res,next):res.sendStatus(503));
  server=https.createServer({key:fs.readFileSync(path.join(process.env.HTTP_PROOF_TLS,'localhost.key')),cert:fs.readFileSync(path.join(process.env.HTTP_PROOF_TLS,'localhost.crt'))},outer);await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='https://localhost:'+server.address().port;
  stage('isolated-database-and-identities');db=await databaseFixture(report);const kc=await keycloak(origin);const a=await db.tenant(kc,0),b=await db.tenant(kc,1);const customer=await db.actor(kc,b.organizationId,'catalog-company-reader','CONTRIBUTOR');
  // Match the habitual tenant's registered v2 snapshot contract before testing writes.
  const schemaPublisher=require('../../../backend/src/security/tenantSchemaObservationPublisher').createTenantSchemaObservationPublisher(require('../../../backend/src/security/tenantSchemaRepository').createTenantSchemaRepository(db.central.pool));
  for(const tenant of [a,b]){
    const observed=(await db.central.pool.query('SELECT s.revision,v.database_generation_id FROM public.tenant_schema_state s JOIN public.organization_connection_version v ON v.tenant_id=s.tenant_id AND v.connection_version=1 WHERE s.tenant_id=$1',[tenant.organizationId])).rows[0];
    const upgraded=await require('../../../backend/src/security/tenantMigrationRunner').createRegisteredTenantMigrationRunner({packageId:'opportunity-v2-activation-11145',pool:tenant.pool,observationPublisher:schemaPublisher,timeoutMs:30000,scheduler:{setTimeout,clearTimeout}}).migrate({tenantId:tenant.organizationId,databaseGenerationId:observed.database_generation_id,expectedRevision:Number(observed.revision),correlationId:randomUUID(),idempotencyKey:randomUUID()});
    assert.equal(upgraded.evidence.currentVersion,'034_application_snapshot_v2');
  }
  check('ISOLATED_TENANTS_ADMITTED_FOR_V2_INTEREST_SNAPSHOTS');
  // The selected synthetic administrator must match the existing habitual
  // interest permissions. Other actors deliberately retain their limited grants.
  const interestGrants=['read','register','manage'].map(action=>({permission:'opportunity_interest.'+action,scope:{type:'ORGANIZATION',id:a.organizationId,organizationId:a.organizationId}}));
  await db.data.change({organizationId:a.organizationId,membershipId:a.owner.membershipId,expectedVersion:a.owner.version,grants:[...a.owner.grants,...interestGrants],assuranceRequirements:requirement});
  const sameOrgContributor=await db.actor(kc,a.organizationId,'same-entity-contributor','CONTRIBUTOR');const sameOrgAdmin=await db.actor(kc,a.organizationId,'unselected-entity-admin','ORG_ADMIN');
  read=null;
  const {env:runtimeEnv,runtime}=await db.configure([a,b]);
  const env={...runtimeEnv,AUTH_MODE:'oidc',NODE_ENV:'development',PUBLIC_APP_URL:origin,OIDC_ISSUER:kc.issuer,OIDC_CLIENT_ID:kc.clientId,OIDC_REDIRECT_URI:origin+'/api/auth/oidc/callback',SESSION_SECRET:secret(),SESSION_COOKIE_SECURE:'true',SESSION_COOKIE_NAME:'__Host-http-proof',SESSION_IDLE_MS:'1800000',SESSION_ABSOLUTE_MS:'28800000',OIDC_TRANSACTION_MS:'600000',AUTH_POLICY_VERSION:policyVersion,AUTH_ASSURANCE_POLICY_JSON:JSON.stringify({'recent-auth':requirement}),PRIVILEGED_LOGIN_ASSURANCE_CATEGORY:'recent-auth',AUTHORITY_COMMIT_PERMIT_SECRET:db.central.permitSecret,FUNDING_TENDERS_RUNTIME:'central'};
  // Test-only composition seam: place the read router AFTER the unchanged GCNI session/auth middleware and BEFORE its 404 handler.

  let providerCalls=0;const compose=mode=>require('../../../backend/src/productionComposition').createProductionComposition({env:{...env,CATALOG_READ_RUNTIME:mode},isolatedSessionReadConcurrency:process.env.CATALOG_SHARED_SESSION_READS==='1',observeSessionTiming:sessionDiagnostics?.observe,isolatedSessionTouchCoalescing:process.env.CATALOG_COALESCE_TOUCHES==='1',logger:{error:(signal,details)=>{if(details.error){report.httpErrors ||= [];report.httpErrors.push({...safe(details.error),frames:String(details.error.stack||'').split('\n').filter(l=>l.trim().startsWith('at ')).slice(0,3)});save();}},warn:()=>{},info:()=>{}},dependencies:{applicationFailureObserver:error=>{report.interestFailures ||= [];report.interestFailures.push({...safe(error),internalCode:error.internalCode||null,causeCode:error.cause?.code||null,frames:String(error.stack||'').split('\n').filter(l=>l.trim().startsWith('at ')).slice(0,4)});save();},express,createCatalogReadRuntime:()=>{providerCalls++;return makeReader();},cors,centralPool:db.reader,authorityPool:db.central.authorityPool,routes:{},opportunityRuntimeDependencies:runtime}});composition=compose(undefined);inner=composition.app;assert.equal(providerCalls,0);
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
  const targetIdentity=(await db.central.pool.query("SELECT (SELECT oid::text FROM pg_database WHERE datname=current_database()) oid,(SELECT system_identifier::text FROM pg_control_system()) cluster")).rows[0];
  const asOf=(await db.central.pool.query('SELECT as_of FROM catalog_read.generation WHERE generation_id=$1',[report.initialFixture.generationId])).rows[0].as_of.toISOString();
  const startArgs={centralPool:db.central.pool,target:catalog.target,Pool:require('../../../backend/node_modules/pg').Pool,express,policyVersion,evidenceDirectory:path.resolve(__dirname,'../../../context/references/opportunity-v2/evidence'),validationOnly:true,sink:event=>fs.appendFileSync(path.join(out,'control-telemetry.jsonl'),JSON.stringify(event)+'\n'),settings:{version:1,mode:'controlled',firstAccess:'organization-administrator',target:{databaseOid:targetIdentity.oid,clusterIdentityHash:require('node:crypto').createHash('sha256').update(targetIdentity.cluster).digest('hex')},organizationId:a.organizationId,userId:a.owner.id,signingKey:randomBytes(32).toString('hex'),credentials:{...catalog.credentials,policy:durableFixture.readerPassword},operatorPassword:durableFixture.operatorPassword,operatorLogin:'gcni_e2e_policy_operator',publishedAsOf:asOf}};
  boot=await require('../../../backend/src/opportunities/catalogRead/controlledStartup').prepareControlledStartup(startArgs);
  assert.equal(boot.publication.inserted,0);assert(boot.publication.replay);check('CONTROLLED_STARTUP_ADMISSION_AND_OFFLINE_REPLAY');
  assert.equal(require('../../../backend/scripts/localPlatform/catalogReadRuntime').catalogReadRuntimeEnvironment({catalogRead:{mode:'controlled',firstAccess:'organization-administrator'}},boot.admission).CATALOG_READ_RUNTIME,'controlled');
  const makeReader=()=>{read=boot.createRuntime();return read;};
  const offComposition=composition;composition=compose('controlled');inner=composition.app;await offComposition.closeOpportunityRuntime();assert.equal(providerCalls,1);assert.equal(await read.ready(),true);check('NORMAL_COMPOSITION_REAL_DURABLE_PROVIDER_MOUNTED');
  {const visitor=await browser.newContext();try{const response=await visitor.request.get(origin+'/api/catalog-read/v1/opportunities');assert.equal(response.status(),401);assert.equal((await response.json()).error.code,'SESSION_REQUIRED');}finally{await visitor.close();}}check('ANONYMOUS_REQUEST_PRESERVES_401_CONTRACT');
  const earlyContext=await http(admin,'/api/opportunity-interests/context');report.earlyInterestContext={status:earlyContext.status,data:earlyContext.data};save();assert.equal(earlyContext.status,200,'INTEREST_CONTEXT_REQUIRED');
  assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,200);
  for(const actor of [client,otherAdmin,contributor,unselectedAdmin])assert.equal((await http(actor,'/api/catalog-read/v1/opportunities')).status,403);
  check('CONTROLLED_STARTUP_ONLY_SELECTED_ACTIVE_ENTITY_ADMIN');
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
  await admin.page.goto(origin+'/catalogo/consulta');await admin.page.getByRole('heading',{name:'Oportunidades de financiamento'}).waitFor();
  stage('browser-real-source-demonstration');await admin.page.getByText('Mais filtros',{exact:true}).click();
  await admin.page.getByRole('combobox',{name:'Ordenação',exact:true}).selectOption('title');await admin.page.getByRole('button',{name:'Pesquisar',exact:true}).click();
  for(let i=0;i<8;i++){if(await admin.page.getByRole('link',{name:'Abrir Gnomon Internships Offer',exact:true}).count())break;await admin.page.getByRole('button',{name:'Seguinte',exact:true}).click();await admin.page.getByText('A carregar a consulta…',{exact:true}).waitFor({state:'hidden'});}
  await admin.page.getByRole('link',{name:'Abrir Gnomon Internships Offer',exact:true}).waitFor();assert(await admin.page.locator('tbody').getByText('Portugal 2030 · Plano',{exact:true}).count());
  await admin.page.screenshot({path:path.join(out,'real-unified-table.png'),fullPage:true});
  for(const [query,name,file] of [['CONTRATOS DE IMPACTO SOCIAL','CONTRATOS DE IMPACTO SOCIAL','real-pt-detail.png'],['Gnomon','Gnomon Internships Offer','real-eu-detail.png']]){
    await admin.page.goto(origin+'/catalogo/consulta');await admin.page.getByRole('heading',{name:'Oportunidades de financiamento'}).waitFor();
    await admin.page.getByLabel('Código ou título',{exact:true}).fill(query);await admin.page.getByRole('button',{name:'Pesquisar',exact:true}).click();
    await admin.page.getByRole('link',{name:'Abrir '+name,exact:true}).first().click();await admin.page.getByRole('heading',{name,exact:true}).waitFor();
    await admin.page.screenshot({path:path.join(out,file),fullPage:true});
  }
  check('NORMAL_UI_REAL_PT_AND_EU_FILTERS_AND_DETAILS');
  stage('interest-context');
  const interestContext=await http(admin,'/api/opportunity-interests/context');
  report.interestContext={status:interestContext.status,data:interestContext.data};save();
  assert.equal(interestContext.status,200);assert.equal(interestContext.data.capabilities.canRegister,true);
  assert((await admin.page.locator('.cr-description').textContent()).length>2000);
  await admin.page.screenshot({path:path.join(out,'before-interest.png'),fullPage:true});
  stage('interest-open');
  await admin.page.getByRole('button',{name:'Registar interesse em Gnomon Internships Offer',exact:true}).click();
  stage('interest-dialog');await admin.page.getByRole('dialog').waitFor();
  stage('interest-save');await admin.page.getByRole('button',{name:'Guardar interesse',exact:true}).click();
  await admin.page.getByText('Interesse registado',{exact:true}).waitFor();
  await admin.page.reload();await admin.page.getByText('Interesse registado',{exact:true}).waitFor();
  assert.equal(await admin.page.getByRole('button',{name:'Registar interesse em Gnomon Internships Offer',exact:true}).count(),0);
  await admin.page.screenshot({path:path.join(out,'registered-interest-full-description.png'),fullPage:true});
  const saved=(await a.pool.query('SELECT count(*)::int n FROM opportunity_catalog.opportunity_interest WHERE organization_id=$1',[a.organizationId])).rows[0].n;assert.equal(saved,1);
  const auditCodes=(await a.pool.query("SELECT event_code,count(*)::int n FROM audit.event WHERE organization_id=$1 AND event_code IN ('AUTHORIZATION_ALLOWED','OPPORTUNITY_INTEREST_REGISTERED') GROUP BY event_code",[a.organizationId])).rows;
  assert(auditCodes.some(r=>r.event_code==='AUTHORIZATION_ALLOWED'&&r.n>0));assert(auditCodes.some(r=>r.event_code==='OPPORTUNITY_INTEREST_REGISTERED'&&r.n===1));report.interestPersistence={records:saved,auditCodes};
  check('FULL_ARCHIVED_DESCRIPTION_AND_DURABLE_ORGANIZATION_INTEREST');

  await boot.close();assert.equal((await durableFixture.store.read()).mode,'OFF');
  const oldComposition=composition;
  boot=await require('../../../backend/src/opportunities/catalogRead/controlledStartup').prepareControlledStartup(startArgs);
  composition=compose('controlled');inner=composition.app;await oldComposition.closeOpportunityRuntime();
  assert.equal((await http(admin,'/api/catalog-read/v1/opportunities')).status,200);
  assert.equal((await db.central.pool.query('SELECT count(*)::int n FROM opportunity_catalog.opportunity')).rows[0].n,178);
  check('CONTROLLED_RESTART_READMITS_WITHOUT_DUPLICATING_DATA');
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
 }catch(e){report.status='FAIL';report.error=safe(e);if(e.name==='TimeoutError')report.error.operation=String(e.message).slice(0,1600);console.log('FAIL '+JSON.stringify(report.error));}
 finally{if(boot){await boot.close();report.finalExposure={mode:(await durableFixture.store.read()).mode};}if(control?.operator){try{await control.operator.disable({expectedRevision:(await control.operator.status()).revision});report.finalExposure=await control.operator.status();}catch(e){report.status='FAIL';report.controlCleanup=safe(e);}}await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await composition?.closeOpportunityRuntime();await catalog?.close();await durableFixture?.close();await db?.close();report.finishedAt=new Date().toISOString();save();}
 console.log('ACCEPTANCE_RESULT '+report.status);if(report.status!=='PASS')process.exitCode=1;
}
run().catch(e=>{report.status='FAIL';report.cleanupError=safe(e);save();process.exitCode=1;});

