'use strict';
const assert=require('node:assert/strict');
const {randomBytes,randomUUID}=require('node:crypto');
const path=require('node:path');const {pathToFileURL}=require('node:url');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const express=require('../../../backend/node_modules/express');
async function run({central,databases,dependencies,control}) {
 const secret=randomBytes(32).toString('hex'),issuer='https://synthetic-idp.example.invalid',redirectUri='http://localhost:5173/api/auth/oidc/callback';
 const env={AUTH_MODE:'oidc',OPPORTUNITIES_RUNTIME:'f12',PQ1_ACTIVATION_RUNTIME:'f13-f14-pq1',PROFILE_EDITORIAL_RUNTIME:'f13-editorial',NODE_ENV:'development',PUBLIC_APP_URL:'http://localhost:5173',
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
 vite=await createServer({root,configFile:path.join(root,'vite.config.js'),logLevel:'error',define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},server:{host:'localhost',port:5173,strictPort:true,proxy:{'/api':{target:`http://127.0.0.1:${server.address().port}`,changeOrigin:true}}}});await vite.listen();
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
 const a=databases[0],checker=await pageFor(a.submitter,true);
 await checker.goto('http://localhost:5173/pre-qualificacao');
 await checker.getByRole('button',{name:'Atualizar consulta',exact:true}).waitFor();
 await checker.getByLabel('Publicação',{exact:true}).selectOption(a.versionId);
 await checker.getByLabel('Motivo',{exact:true}).fill('Análise parcial sintética');
 await checker.getByRole('button',{name:'Pré-validar publicação',exact:true}).click();
 await checker.getByRole('heading',{name:'Pré-validação concluída'}).waitFor();
 assert.equal(await checker.getByRole('button',{name:'Ativar para análise parcial',exact:true}).isDisabled(),true);
 await Promise.all([checker.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/oidc/callback'),checker.getByRole('button',{name:'Validar identidade com MFA'}).click()]);
 await checker.waitForURL('http://localhost:5173/pre-qualificacao',{waitUntil:'domcontentloaded'});
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
 await checker.goto('http://localhost:5173/pre-qualificacao?opportunityId='+a.testOpportunityId);
 await checker.getByRole('checkbox',{name:'Confirmo estas entradas para a análise parcial'}).check();
 await checker.getByRole('button',{name:'Avaliar critérios',exact:true}).click();
 await checker.getByRole('heading',{name:'Análise parcial — informação global indeterminada',exact:true}).waitFor();
 await checker.getByText('Correspondência observada',{exact:true}).waitFor();
 await checker.getByText('Entradas atuais',{exact:true}).waitFor();
 const resultUrl=checker.url();await checker.reload();await checker.getByRole('heading',{name:'Análise parcial — informação global indeterminada',exact:true}).waitFor();
 const b=await pageFor(databases[1].checker);await b.goto(resultUrl);await b.getByRole('alert').filter({hasText:'Registo indisponível.'}).waitFor();
 assert.equal(await b.getByText('Correspondência observada',{exact:true}).count(),0);
 await checker.setViewportSize({width:390,height:844});
 await checker.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=0);
 assert(await checker.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 require('node:fs').mkdirSync(path.resolve(__dirname,'../../../context/reviews/f13-pq1-http'),{recursive:true});
 await checker.screenshot({path:path.resolve(__dirname,'../../../context/reviews/f13-pq1-http/result-mobile.png'),fullPage:true});
 console.log('PQ1_BROWSER_INTEGRATED_PASS preview signed-MFA confirmation-invalidation activate lost-response reload lookup evaluate read A/B');
 } catch(error) { if(browser)for(const c of browser.contexts())for(const p of c.pages())console.log('BROWSER_FAILURE_DOM',await p.locator('body').innerText().catch(()=>''));throw error;
 } finally {OidcClient.prototype.begin=begin;OidcClient.prototype.callback=callback;OidcClient.prototype.endSessionUrl=endSession;if(browser)await browser.close();if(vite)await vite.close();if(server)await new Promise(r=>server.close(r));}
}
module.exports={run};
