'use strict';
const assert=require('node:assert/strict');
const {randomBytes,randomUUID}=require('node:crypto');
const path=require('node:path');const {pathToFileURL}=require('node:url');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const express=require('../../../backend/node_modules/express');
async function run({central,databases,dependencies,control}) {
 const browserPort=process.env.PQ1_BROWSER_BOUNDARY_ONLY==='1'?5174:5173,browserOrigin=`http://localhost:${browserPort}`;
 const secret=randomBytes(32).toString('hex'),issuer='https://synthetic-idp.example.invalid',redirectUri=`${browserOrigin}/api/auth/oidc/callback`;
 const env={AUTH_MODE:'oidc',OPPORTUNITIES_RUNTIME:'f12',PQ1_ACTIVATION_RUNTIME:'f13-f14-pq1',PROFILE_EDITORIAL_RUNTIME:'f13-editorial',NODE_ENV:'development',PUBLIC_APP_URL:`${browserOrigin}`,
 OIDC_ISSUER:issuer,OIDC_REDIRECT_URI:redirectUri,OIDC_CLIENT_ID:'synthetic',SESSION_SECRET:secret,SESSION_IDLE_MS:'1800000',SESSION_ABSOLUTE_MS:'28800000',OIDC_TRANSACTION_MS:'600000',AUTH_POLICY_VERSION:'c4g-assurance-v1',AUTH_ASSURANCE_POLICY_JSON:JSON.stringify({'recent-mfa':central.requirement}),AUTHORITY_COMMIT_PERMIT_SECRET:central.permitSecret,DB_HOST:'synthetic-legacy',DB_PORT:'5432',DB_NAME:'synthetic_legacy',CENTRAL_DB_HOST:'synthetic-central',CENTRAL_DB_PORT:'5432',CENTRAL_DB_NAME:'synthetic_central',PROFILE_EDITORIAL_UI_KEY_ID:'local',PROFILE_EDITORIAL_UI_KEYS_JSON:JSON.stringify({local:randomBytes(32).toString('hex')})};
 const routes=Object.fromEntries(['auth','dashboard','ubiStructure','users','professors','researchAreas','opportunities','applications','partners','imports','integrations','matching','notifications'].map(key=>[key,express.Router()]));
 const {OidcClient}=require('../../../backend/src/security/oidcClient');
 const begin=OidcClient.prototype.begin,callback=OidcClient.prototype.callback,endSession=OidcClient.prototype.endSessionUrl;
 OidcClient.prototype.endSessionUrl=async()=>'/login';
 // Only the local IdP transport is substituted. The production callback, Central
 // one-time transaction, signed ID-token validation and session rotation run real.
 OidcClient.prototype.begin=async function(input){const transaction={...input,state:randomUUID(),nonce:randomUUID(),codeVerifier:randomBytes(32).toString('hex'),createdAt:Date.now()};return{transaction,redirectUrl:issuer+'/authorize?state='+transaction.state};};
 OidcClient.prototype.callback=async function(url,transaction){const adapter=await require('../../../backend/test/support/realOidcFixture').createSignedOidcAdapter({issuer,clientId:'synthetic',redirectUri,claims:{sub:databases[0].submitter.id,nonce:transaction.nonce,auth_time:Math.floor(Date.now()/1000),acr:'c4g-loa2',amr:['otp']}});return callback.call(adapter,url,transaction);};
 let server,vite,browser;
 try {
 const composition=require('../../../backend/src/productionComposition').createProductionComposition({env,dependencies:{express,cors:require('../../../backend/node_modules/cors'),legacyPool:{query(){throw Error('LEGACY_FORBIDDEN');}},centralPool:central.pool,authorityPool:central.authorityPool,routes,services:{},opportunityRuntimeDependencies:dependencies,editorialUiFailureObserver:e=>console.log('BROWSER_UI_FAILURE',e.code,e.internalCode)}});
 server=composition.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const root=path.resolve(__dirname,'../../../frontend');const {createServer}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')).href);
 vite=await createServer({root,configFile:path.join(root,'vite.config.js'),logLevel:'error',define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},server:{host:'localhost',port:browserPort,strictPort:true,proxy:{'/api':{target:`http://127.0.0.1:${server.address().port}`,changeOrigin:true}}}});await vite.listen();
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 async function pageFor(actor,stale=false){
 const stored=(await central.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[actor.sid])).rows[0].sess;
 stored.auth.evidence.authTime=Math.floor(Date.now()/1000)-(stale?600:0);stored.auth.identity={issuer,subject:actor.id};stored.auth.user.sessionRevocationVersion=1;
 stored.cookie={originalMaxAge:1800000,expires:new Date(Date.now()+1800000).toISOString(),httpOnly:true,path:'/',sameSite:'lax'};
 await central.coordinator.write([central.coordinator.sessionKey(actor.sid)],()=>central.coordinator.pool.query('INSERT INTO "public"."application_session_store" (sess, expire, sid) SELECT $1, to_timestamp($2), $3 ON CONFLICT (sid) DO UPDATE SET sess=$1, expire=to_timestamp($2) RETURNING sid',[stored,stored.auth.absoluteExpiresAt/1000,actor.sid]));
 const context=await browser.newContext();await context.addCookies([{name:'c4g_session_dev',value:'s:'+require('../../../backend/node_modules/cookie-signature').sign(actor.sid,secret),domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);const page=await context.newPage();page.setDefaultTimeout(60000);
 page.on('response',r=>{if(r.url().includes('/api/'))console.log('BROWSER_HTTP',new URL(r.url()).pathname.replace(/[a-f0-9-]{36}/g,':id'),r.status());});
 page.on('pageerror',e=>console.log('BROWSER_ERROR',e.message));
 await page.route(issuer+'/**',async route=>{const state=new URL(route.request().url()).searchParams.get('state');await route.fulfill({status:302,headers:{location:redirectUri+'?code=synthetic&state='+state},body:''});});return page;
 }
 const a=databases[0],other=databases[1],extraMembership=randomUUID();
 await central.pool.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at) VALUES($1,$2,$3,'ORG_ADMIN','ACTIVE',clock_timestamp())",[extraMembership,a.submitter.id,other.org]);
 await central.data.change({organizationId:other.org,membershipId:extraMembership,expectedVersion:0,grants:['organization_profile.read','prequalification.read'].map(permission=>({permission,scope:{type:'ORGANIZATION',id:other.org,organizationId:other.org}})),assuranceRequirements:central.requirement});
 const checker=await pageFor(a.submitter,true);
 await checker.goto(`${browserOrigin}/pre-qualificacao`);
 await checker.getByRole('button',{name:'Atualizar consulta',exact:true}).waitFor();
 if(a.oversizedVersionId){
  await checker.getByLabel('Publicação',{exact:true}).selectOption(a.oversizedVersionId);
  await checker.getByRole('button',{name:'Pré-validar publicação',exact:true}).click();
  await checker.getByRole('alert').filter({hasText:'O material excede o limite técnico desta operação.'}).waitFor();
  console.log('PQ1_BROWSER_ABOVE_MATERIAL_LIMIT_CONTROLLED_REFUSAL PASS');
  if(process.env.PQ1_BROWSER_BOUNDARY_ONLY==='1')return;
 }
 await checker.getByLabel('Publicação',{exact:true}).selectOption(a.versionId);
 await checker.getByLabel('Motivo',{exact:true}).fill('Análise parcial sintética');
 await checker.getByRole('button',{name:'Pré-validar publicação',exact:true}).click();
 await checker.getByRole('heading',{name:'Pré-validação concluída'}).waitFor();
 assert.equal(await checker.getByRole('button',{name:'Ativar para análise parcial',exact:true}).isDisabled(),true);
 await Promise.all([checker.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/oidc/callback'),checker.getByRole('button',{name:'Validar identidade com MFA'}).click()]);
 await checker.waitForURL(`${browserOrigin}/pre-qualificacao`,{waitUntil:'domcontentloaded'});
 console.log('PQ1_BROWSER_MFA_CALLBACK_COMPLETE');
 await checker.getByLabel('Publicação',{exact:true}).selectOption(a.versionId);
 await checker.getByLabel('Motivo',{exact:true}).fill('Ativação confirmada após MFA');
 await checker.getByRole('button',{name:'Pré-validar publicação',exact:true}).click();
 await checker.getByRole('heading',{name:'Pré-validação concluída'}).waitFor();
 await checker.getByRole('checkbox',{name:'Confirmo esta publicação, geração e motivo'}).check();
 await checker.getByLabel('Motivo',{exact:true}).fill('Motivo revisto explicitamente');
 assert.equal(await checker.getByRole('checkbox',{name:'Confirmo esta publicação, geração e motivo'}).isChecked(),false);
 await checker.getByRole('checkbox',{name:'Confirmo esta publicação, geração e motivo'}).check();
 const beforeActivation=Number((await a.pool.query('SELECT count(*)::int AS n FROM organization_profile.pq1_activation')).rows[0].n);
 let dropped=false;
 await checker.route('**/api/organizational-profile/pq1-activation/activate',async route=>{
  if(dropped)return route.continue();dropped=true;const response=await route.fetch();assert(response.status()<300);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE'}})});
 });
 await checker.getByRole('button',{name:'Ativar para análise parcial',exact:true}).click();
 await checker.getByText('Resultado por confirmar. A falha de comunicação não demonstra rollback.',{exact:true}).waitFor();
 await checker.reload();
 await checker.getByRole('button',{name:'Consultar resultado da intenção',exact:true}).click();
 await checker.getByRole('status').filter({hasText:'Operação confirmada.'}).waitFor();
 assert.equal(await checker.getByRole('button',{name:'Consultar resultado da intenção',exact:true}).count(),0);
 assert.equal(Number((await a.pool.query('SELECT count(*)::int AS n FROM organization_profile.pq1_activation')).rows[0].n),beforeActivation+1);
 await checker.goto(`${browserOrigin}/pre-qualificacao?opportunityId=`+a.testOpportunityId);
 await checker.getByRole('checkbox',{name:'Confirmo estas entradas para a análise parcial'}).check();
 await checker.getByRole('button',{name:'Avaliar critérios',exact:true}).click();
 await checker.getByRole('heading',{name:'Análise parcial — informação global indeterminada',exact:true}).waitFor();
 await checker.getByText('Correspondência observada',{exact:true}).waitFor();
 await checker.getByText('Entradas atuais',{exact:true}).waitFor();
 await checker.getByRole('heading',{name:'Histórico de decisões',exact:true}).waitFor();
 for(const kind of ['REQUEST_INFORMATION','KEEP_UNDER_REVIEW','DISCARD_FROM_ANALYSIS']){
  await checker.getByLabel('Decisão',{exact:true}).selectOption(kind);
  if(kind==='REQUEST_INFORMATION')await checker.getByRole('group',{name:'Critérios com informação em falta'}).getByRole('checkbox').check();
  await checker.getByLabel('Justificação ou informação necessária',{exact:true}).fill('Justificação sintética '+kind);
  await checker.getByRole('checkbox',{name:'Confirmo esta decisão sobre a avaliação exata',exact:true}).check();
  await checker.getByLabel('Justificação ou informação necessária',{exact:true}).fill('Justificação final '+kind);
  assert.equal(await checker.getByRole('checkbox',{name:'Confirmo esta decisão sobre a avaliação exata',exact:true}).isChecked(),false);
  await checker.getByRole('checkbox',{name:'Confirmo esta decisão sobre a avaliação exata',exact:true}).check();
  if(kind==='REQUEST_INFORMATION')await checker.route('**/api/opportunities/prequalifications/*/decisions',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();assert(response.status()<300);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE'}})});});
  await checker.getByRole('button',{name:'Registar decisão',exact:true}).click();
  if(kind==='REQUEST_INFORMATION'){
   await checker.getByText('Resultado não confirmado. Consulte a intenção original se estiver pendente.',{exact:true}).waitFor();
   await checker.unroute('**/api/opportunities/prequalifications/*/decisions');await checker.reload();
   await checker.getByRole('button',{name:'Consultar resultado da intenção',exact:true}).click();
   await checker.getByRole('status').filter({hasText:'Operação confirmada.'}).waitFor();
  }
  await checker.locator('li').filter({hasText:'Justificação final '+kind}).waitFor();
 }
 await checker.getByText('Necessidade registada; nenhuma comunicação enviada.',{exact:true}).waitFor();
 const browserEvaluationId=new URL(checker.url()).searchParams.get('evaluationId');assert(browserEvaluationId);
 assert.equal(Number((await a.pool.query('SELECT count(*)::int n FROM organization_profile.pq1_decision WHERE evaluation_id=$1',[browserEvaluationId])).rows[0].n),3);
 console.log('PQ1_BROWSER_THREE_DECISIONS_PERSISTED_EXACT_EVALUATION PASS');
 const resultUrl=checker.url();await checker.reload();await checker.getByRole('heading',{name:'Análise parcial — informação global indeterminada',exact:true}).waitFor();
 await checker.getByLabel('Organização ativa',{exact:true}).selectOption(other.org);
 await checker.waitForURL('**/pre-qualificacao');await checker.goto(resultUrl);
 await checker.getByRole('alert').filter({hasText:'Registo indisponível.'}).waitFor();
 assert.equal(await checker.getByText('Correspondência observada',{exact:true}).count(),0);
 await checker.getByLabel('Organização ativa',{exact:true}).selectOption(a.org);
 await checker.waitForURL('**/pre-qualificacao');await checker.goto(resultUrl);
 await checker.locator('li').filter({hasText:'Justificação final DISCARD_FROM_ANALYSIS'}).waitFor();
 console.log('PQ1_BROWSER_ORGANIZATION_SWITCH_AB_AND_BACK PASS');
 const b=await pageFor(databases[1].checker);await b.goto(resultUrl);await b.getByRole('alert').filter({hasText:'Registo indisponível.'}).waitFor();
 assert.equal(await b.getByText('Correspondência observada',{exact:true}).count(),0);
 for(let n=4;n<=30;n++){
  await checker.getByLabel('Decisão',{exact:true}).selectOption('KEEP_UNDER_REVIEW');
  await checker.getByLabel('Justificação ou informação necessária',{exact:true}).fill('Prova de paginação '+n);
  await checker.getByRole('checkbox',{name:'Confirmo esta decisão sobre a avaliação exata'}).check();
  await checker.getByRole('button',{name:'Registar decisão',exact:true}).click();
  await checker.locator('li').filter({hasText:'Prova de paginação '+n}).waitFor();
 }
 const decisionPanel=checker.getByRole('region',{name:'Decisão humana'});
 assert.equal(await decisionPanel.locator('ol > li').count(),25);
 await checker.getByRole('button',{name:'Mais decisões',exact:true}).click();
 await checker.getByText('Justificação final REQUEST_INFORMATION',{exact:true}).waitFor();
 assert.equal(await decisionPanel.locator('ol > li').count(),30);
 const storedDecisions=(await a.pool.query('SELECT justification FROM organization_profile.pq1_decision WHERE evaluation_id=$1 ORDER BY generation DESC',[browserEvaluationId])).rows.map(r=>r.justification);
 assert.deepEqual(await decisionPanel.locator('ol > li > p:first-of-type').allTextContents(),storedDecisions);
 assert.equal(await checker.getByRole('button',{name:'Mais decisões',exact:true}).count(),0);
 console.log('PQ1_BROWSER_HISTORY_TWO_PAGES_30_ROWS_NO_GAPS_OR_DUPLICATES PASS');
 await checker.setViewportSize({width:390,height:844});
 await checker.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=0);
 assert(await checker.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 const evidenceDir=path.resolve(__dirname,'../../../context/reviews/f13-pq1-capacity-fix');
 require('node:fs').mkdirSync(evidenceDir,{recursive:true});
 await checker.screenshot({path:path.join(evidenceDir,'result-mobile.png'),fullPage:true});
 // Same-session concurrency: a protected read and its concurrent session touch
 // leave a registered authority writer WAITING. The UI's original write must
 // fail closed, retaining its original key; no synthetic 503 response here.
 await checker.goto(`${browserOrigin}/pre-qualificacao?opportunityId=`+a.testOpportunityId);
 await checker.getByRole('checkbox',{name:'Confirmo estas entradas para a análise parcial'}).check();
 const cookies=await checker.context().cookies();const signed=decodeURIComponent(cookies.find(c=>c.name==='c4g_session_dev').value);
 const currentSid=require('../../../backend/node_modules/cookie-signature').unsign(signed.slice(2),secret);
 assert(currentSid);let originalKey;
 const pendingCount=async()=>Number((await central.pool.query("SELECT count(*)::int n FROM public.authority_write_request WHERE state='WAITING' AND $1=ANY(scope_keys)",[central.coordinator.sessionKey(currentSid)])).rows[0].n);
 async function awaitCondition(work){const end=Date.now()+8000;while(Date.now()<end){if(await work())return;await new Promise(setImmediate);}throw Error('SESSION_CONCURRENCY_BARRIER_NOT_REACHED');}
 const beforeEvaluations=Number((await a.pool.query('SELECT count(*)::int n FROM organization_profile.pq1_evaluation')).rows[0].n);
 await checker.route('**/api/opportunities/*/prequalifications',async route=>{
  originalKey=route.request().postDataJSON().idempotencyKey;
  const paused=control.pauseAt('final');const protectedRead=checker.request.get(`${browserOrigin}/api/organizational-profile/pq1-activation/active`);
  await paused.reached;const touching=checker.request.get(`${browserOrigin}/api/auth/session`);
  try{await awaitCondition(async()=>await pendingCount()>=1);const original=route.fetch();
   await awaitCondition(async()=>await pendingCount()>=2);paused.release();const response=await original;assert.equal(response.status(),503);
   await Promise.all([protectedRead,touching]);await route.fulfill({response});
  }finally{paused.release();}
 });
 await checker.getByRole('button',{name:'Avaliar critérios',exact:true}).click();
 await checker.getByText('Resultado por confirmar. A falha de comunicação não demonstra rollback.',{exact:true}).waitFor();
 assert(originalKey);assert.equal(Number((await a.pool.query('SELECT count(*)::int n FROM organization_profile.pq1_evaluation')).rows[0].n),beforeEvaluations);
 await checker.reload();await checker.getByRole('button',{name:'Consultar resultado da intenção',exact:true}).click();
 await checker.getByRole('status').filter({hasText:'Contacte o suporte com a intenção '+originalKey}).waitFor();
 assert.equal(await checker.getByRole('button',{name:'Avaliar critérios',exact:true}).isDisabled(),true);
 assert(await checker.evaluate(key=>Object.values(sessionStorage).some(v=>JSON.parse(v).idempotencyKey===key),originalKey));
 console.log('PQ1_BROWSER_REAL_SAME_SESSION_503_ORIGINAL_INTENTION_UNKNOWN_NO_EFFECT PASS');
 console.log('PQ1_BROWSER_INTEGRATED_PASS preview signed-MFA confirmation-invalidation activate lost-response reload lookup evaluate read A/B');
 } catch(error) { if(browser)for(const c of browser.contexts())for(const p of c.pages())console.log('BROWSER_FAILURE_DOM',await p.locator('body').innerText().catch(()=>''));throw error;
 } finally {OidcClient.prototype.begin=begin;OidcClient.prototype.callback=callback;OidcClient.prototype.endSessionUrl=endSession;if(browser)await browser.close();if(vite)await vite.close();if(server)await new Promise(r=>server.close(r));}
}
module.exports={run};
