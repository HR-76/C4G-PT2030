'use strict';
// Native OIDC/read-only checks. POCTEP visual preview is explicitly mocked and
// labelled fixture; its requests never reach the database or source transport.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const {Pool}=require('../../../backend/node_modules/pg');
const cfg=require('../../../backend/scripts/localPlatform/config');
const {fingerprint}=require('../../../backend/scripts/localPlatform/officialSources');
const {parsePoctep}=require('../../../backend/src/fundingTenders/officialSources');
const out=path.join(cfg.root,'output/playwright/c4g-official-sources');let stage='setup';
async function main(){
 const access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json'))),config=cfg.readConfig(),origin='http://localhost:3000';
 const upgrade=JSON.parse(fs.readFileSync(path.join(cfg.root,'output/interreg-poctep/local-upgrade.json')));assert.equal(upgrade.status,'PASS');
 const heartbeat=JSON.parse(fs.readFileSync(path.join(cfg.folder,'funding-worker-heartbeat.json')));assert.equal(heartbeat.mode,'STANDBY');assert(Date.now()-heartbeat.at<10000);
 const pool=new Pool(cfg.connection(config,config.centralDatabase)),before=await fingerprint(pool,['opportunity_catalog']);
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),writes=[],errors=[];
 try{
  async function login(account){const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.name));
   await page.route('**/api/**',route=>{const r=route.request(),u=new URL(r.url());if(u.origin===origin&&!u.pathname.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(r.method())){writes.push(u.pathname);return route.abort()}return route.continue()});
   await page.goto(origin+'/login');await page.getByRole('button',{name:'Entrar na C4G',exact:true}).click();await page.locator('#username').fill(account.username);await page.locator('#password').fill(account.password);await page.locator('#kc-login').click();await page.waitForURL(u=>u.origin===origin&&u.pathname!=='/login');return page;}
  stage='admin';const page=await login(access.admin);await page.goto(origin+'/integracoes');await page.getByText(/100 resultados/).first().waitFor();
  assert.equal(await page.getByRole('button',{name:'Atualizar agora'}).count(),5);assert.equal(await page.getByRole('alert').count(),0);
  const response=await page.evaluate(async()=>{const r=await fetch('/api/admin/integrations/funding-tenders');return {status:r.status,body:await r.json()}});assert.equal(response.status,200);assert.equal(response.body.runs.length,upgrade.runs);
  assert(response.body.collection.sources.includes('POCTEP'));assert(response.body.collection.sources.includes('INTERREG_EUROPE'));assert(!response.body.runs.some(r=>['POCTEP','INTERREG_EUROPE'].includes(r.source)));
  for(const name of ['Interreg Europe','Interreg POCTEP']){const region=page.getByRole('region',{name,exact:true});await region.getByText(/Zero chamadas atuais/).waitFor();assert.equal(await region.getByText(/API real/).count(),0);}
  stage='screenshots';for(const width of [1440,390]){await page.setViewportSize({width,height:1000});const close=page.getByRole('button',{name:'Fechar menu',exact:true});if(width===390&&await close.isVisible())await close.click();await page.waitForLoadState('networkidle');await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('main')?.scrollTo(0,0)});await page.screenshot({path:path.join(out,'native-'+width+'.png'),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  stage='member';const member=await login(access.hugo);assert.equal(await member.evaluate(async()=>(await fetch('/api/admin/integrations/funding-tenders')).status),403);
  stage='fixture-preview';const rows=parsePoctep(require('../../../backend/test/fixtures/official-programmes/calendar.json'),require('../../../backend/test/fixtures/official-programmes/open.json')).filter(r=>!r.declaredClosed);
  const records=rows.map((r,i)=>({opportunityId:`00000000-0000-4000-8000-00000000000${i+1}`,revisionId:`00000000-0000-4000-8001-00000000000${i+1}`,source:'POCTEP',sourceMode:'fixture',externalIdentifier:r.externalIdentifier,snapshot:{...r.fields,lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW'},observedAt:'2026-10-18T12:00:00Z',createdAt:'2026-10-18T12:00:00Z',conflicts:[]}));
  await page.route('**/api/admin/central-opportunities**',route=>{assert.equal(route.request().method(),'GET');const u=new URL(route.request().url()),id=u.pathname.split('/').at(-1),record=records.find(r=>r.opportunityId===id);return route.fulfill({json:record||{sourceMode:'fixture',items:records.map(r=>({...r,...r.snapshot,funding:{summary:r.snapshot.summary}})),programmes:['POCTEP 2021-2027'],nextCursor:null}})});
  await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/catalogo?view=filtered&period=all');await page.getByRole('link',{name:records[0].snapshot.title,exact:true}).waitFor();assert.equal(await page.locator('td[data-label="Fonte"]').filter({hasText:'POCTEP'}).count(),2);await page.waitForLoadState('networkidle');await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('main')?.scrollTo(0,0)});await page.screenshot({path:path.join(out,'poctep-fixture-list.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('link',{name:records[0].snapshot.title,exact:true}).click();await page.getByRole('heading',{name:records[0].snapshot.title,exact:true}).waitFor();assert.equal(await page.locator('.dl-row').filter({has:page.locator('dt',{hasText:'Fonte'})}).textContent(),'FonteInterreg POCTEP');
  await page.getByRole('button',{name:'Ler descrição completa'}).click();await page.getByText(/14:00.*hora peninsular española/).waitFor();
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.waitForLoadState('networkidle');await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('main')?.scrollTo(0,0)});await page.screenshot({path:path.join(out,'poctep-fixture-detail-'+width+'.png'),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  assert.equal(errors.length,0);assert.equal(writes.length,0);assert.deepEqual(await fingerprint(pool,['opportunity_catalog']),before);
  fs.writeFileSync(path.join(out,'native-verification.json'),JSON.stringify({status:'PASS',observedAt:new Date().toISOString(),nativeSources:5,nativeIdentities:upgrade.identities,nativeRuns:upgrade.runs,businessDataUnchanged:true,realImports:0,workerMode:'STANDBY',memberDenied:true,poctepPreview:'MOCKED_HTTP_REAL_SOURCE_FIXTURES',poctepPreviewIdentities:2,widths:[1440,390],businessWrites:writes,pageErrors:errors},null,2));console.log('OFFICIAL_NATIVE_READ_PASS');
 }finally{await browser.close();await pool.end();}
}
main().catch(e=>{console.error('OFFICIAL_NATIVE_FAILED',stage,e.code||e.name,e.message?.slice(0,170));process.exitCode=1});
