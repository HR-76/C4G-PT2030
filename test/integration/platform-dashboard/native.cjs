'use strict';
// Existing local C4G account, no business mutations or synthetic errors.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright'),{Pool}=require('../../../backend/node_modules/pg');
const cfg=require('../../../backend/scripts/localPlatform/config'),{authorityFingerprint}=require('../../../backend/scripts/localPlatform/internalAccess'),{fingerprint}=require('../../../backend/scripts/localPlatform/officialSources');
async function main(){
 const config=cfg.readConfig(),access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json'))),origin='http://localhost:3000',out=path.join(cfg.root,'output/playwright/c4g-admin-dashboard');
 const central=new Pool(cfg.connection(config,config.centralDatabase)),tenant=new Pool(cfg.connection(config,config.tenantDatabase));let browser,stage='start';
 const digest=async()=>({authority:await authorityFingerprint(central),catalog:await fingerprint(central,['opportunity_catalog']),tenant:await fingerprint(tenant,['opportunity_catalog','organizational_scope','organization_profile','document_storage'])});
 try{
  fs.mkdirSync(out,{recursive:true});const before=await digest(),writes=[],errors=[];const since=new Date();browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.name));await page.route('**/api/**',route=>{const r=route.request(),u=new URL(r.url());if(!u.pathname.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(r.method())){writes.push(u.pathname);return route.abort()}return route.continue()});
  stage='login';await page.goto(origin+'/');await page.locator('#username').fill(access.admin.username);await page.locator('#password').fill(access.admin.password);await page.locator('#kc-login').click();await page.waitForURL(u=>u.origin===origin);
  stage='dashboard';await page.waitForURL(origin+'/administracao/dashboard');await page.getByRole('heading',{name:'Dashboard C4G',exact:true}).waitFor();await page.getByLabel('Totais da plataforma').waitFor();
  const response=await page.request.get(origin+'/api/admin/directory/dashboard');assert.equal(response.status(),200);const data=await response.json();
  const expected=(await central.query('SELECT (SELECT count(*)::int FROM public.organization) entities,(SELECT count(*)::int FROM public.global_user) users,(SELECT count(*)::int FROM opportunity_catalog.opportunity) opportunities')).rows[0];
  assert.equal(data.entities.total,expected.entities);assert.equal(data.users.total,expected.users);assert.equal(data.opportunities.total,expected.opportunities);assert.equal(['active','stale','draft','archived'].reduce((a,k)=>a+data.opportunities[k],0),expected.opportunities);
  await page.getByText('Administra\u00e7\u00e3o da plataforma C4G',{exact:true}).waitFor();
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(out,'native-dashboard-'+width+'.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}
  stage='refresh';await page.getByRole('button',{name:'Atualizar',exact:true}).click();await page.getByLabel('Totais da plataforma').waitFor();
  stage='health';assert.equal((await page.request.get('http://localhost:5000/health/db')).status(),200);const health=await page.request.get(origin+'/api/local-health');assert.equal(health.status(),200);const h=await health.json();assert(h.workerReady&&h.admissionReady);
  const anonymous=await browser.newContext();assert.equal((await anonymous.request.get(origin+'/api/admin/directory/dashboard')).status(),401);await anonymous.close();
  assert.deepEqual(await digest(),before);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'native-verification.json'),JSON.stringify({result:'PASS',observedAt:new Date().toISOString(),nativeLogin:true,metricsReconciled:true,anonymousDenied:true,refresh:true,dataPreserved:true,viewports:[1440,390]},null,2));console.log('DASHBOARD_NATIVE_UI_PASS');
 }catch(e){console.error('DASHBOARD_NATIVE_FAILED',stage,e.code||e.name);process.exitCode=1}finally{await browser?.close();await central.end();await tenant.end()}
}
main().catch(e=>{console.error('DASHBOARD_NATIVE_FAILED',e.code||e.name);process.exitCode=1});
