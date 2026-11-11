'use strict';
// Read-only local review: block all business POST/PUT requests in the browser.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright'),{Pool}=require('../../../backend/node_modules/pg');
const cfg=require('../../../backend/scripts/localPlatform/config'),{authorityFingerprint}=require('../../../backend/scripts/localPlatform/internalAccess'),{fingerprint}=require('../../../backend/scripts/localPlatform/officialSources');
async function main(){
 const config=cfg.readConfig(),access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json'))),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json'))),origin='http://localhost:3000',out=path.join(cfg.root,'output/playwright/c4g-completion');
 const central=new Pool(cfg.connection(config,config.centralDatabase)),tenant=new Pool(cfg.connection(config,config.tenantDatabase));let browser,page,stage='start';
 const digest=async()=>({authority:await authorityFingerprint(central),catalog:await fingerprint(central,['opportunity_catalog']),tenant:await fingerprint(tenant,['opportunity_catalog','organizational_scope','organization_profile','document_storage']),admissions:(await central.query('SELECT count(*)::int n FROM public.entity_admission')).rows[0].n});
 try{
  const before=await digest(),writes=[],errors=[];browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.name));await page.route('**/api/**',route=>{const r=route.request(),u=new URL(r.url());if(!u.pathname.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(r.method())){writes.push(u.pathname);return route.abort();}return route.continue();});
  stage='login';await page.goto(origin+'/');await page.locator('#username').fill(access.admin.username);await page.locator('#password').fill(access.admin.password);await page.locator('#kc-login').click();await page.waitForURL(u=>u.origin===origin);
  stage='invite';await page.goto(origin+'/administracao/entidades');await page.getByRole('button',{name:'Novo convite',exact:true}).click();await page.getByLabel('Nome do administrador').waitFor();await page.getByText('Administração da plataforma C4G',{exact:true}).waitFor();await page.getByText('Ainda não existem convites nesta página.').waitFor();
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(out,'native-invitation-'+width+'.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  assert.equal((await page.request.get(origin+'/api/admissions/mine')).status(),200);
  const invitations=await page.request.get(origin+'/api/admin/directory/admissions?page=1');assert.equal(invitations.status(),200);assert.equal((await invitations.json()).total,before.admissions);
  stage='existing-access';await page.goto(origin+'/administracao/entidades/'+state.organizationId);await page.getByRole('heading',{name:'Utilizadores e acessos',exact:true}).waitFor();assert.equal((await page.request.get(origin+'/api/admin/directory/entities/'+state.organizationId+'/access')).status(),200);
  stage='health';const health=await page.request.get(origin+'/api/local-health');assert.equal(health.status(),200);assert.equal((await health.json()).admissionReady,true);assert.equal((await page.request.get('http://localhost:5000/health/db')).status(),200);
  assert.deepEqual(await digest(),before);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'native-verification.json'),JSON.stringify({result:'PASS',observedAt:new Date().toISOString(),nativeLogin:true,invitationForm:true,existingAccess:true,admissionWorker:true,noBusinessWrites:true,dataPreserved:true,viewports:[1440,390]},null,2));console.log('ADMISSION_NATIVE_UI_PASS');
 }catch(e){console.error('ADMISSION_NATIVE_UI_FAILED',stage,e.code||e.name);process.exitCode=1;}finally{await browser?.close();await central.end();await tenant.end();}
}
main().catch(e=>{console.error('ADMISSION_NATIVE_FAILED',e.code||e.name);process.exitCode=1;});
