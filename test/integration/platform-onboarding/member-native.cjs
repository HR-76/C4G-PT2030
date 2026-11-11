'use strict';
// Read-only validation of the usual environment. No user or invitation is created.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright'),{Pool}=require('../../../backend/node_modules/pg');
const cfg=require('../../../backend/scripts/localPlatform/config'),{authorityFingerprint}=require('../../../backend/scripts/localPlatform/internalAccess'),{fingerprint}=require('../../../backend/scripts/localPlatform/officialSources');
async function main(){
 const config=cfg.readConfig(),access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json'))),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json'))),origin='http://localhost:3000',out=path.join(cfg.root,'output/playwright/c4g-member-onboarding');
 const central=new Pool(cfg.connection(config,config.centralDatabase)),tenant=new Pool(cfg.connection(config,config.tenantDatabase));let browser,page,stage='start';
 const digest=async()=>({authority:await authorityFingerprint(central),catalog:await fingerprint(central,['opportunity_catalog']),tenant:await fingerprint(tenant,['opportunity_catalog','organizational_scope','organization_profile','document_storage'])});
 try{
  const before=await digest(),writes=[],errors=[];browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.name));await page.route('**/api/**',route=>{const r=route.request(),u=new URL(r.url());if(!u.pathname.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(r.method())){writes.push(u.pathname);return route.abort();}return route.continue();});
  stage='login';await page.goto(origin+'/');await page.locator('#username').fill(access.admin.username);await page.locator('#password').fill(access.admin.password);await page.locator('#kc-login').click();await page.waitForURL(u=>u.origin===origin);
  stage='entity';await page.goto(origin+'/administracao/entidades/'+state.organizationId);await page.getByRole('heading',{name:'Utilizadores e acessos',exact:true}).waitFor();const add=page.getByRole('button',{name:'Adicionar utilizador'});await add.click();
  assert.deepEqual(await page.getByRole('region',{name:'Adicionar utilizador'}).getByRole('combobox').locator('option').evaluateAll(options=>options.map(o=>o.value)),['','ORG_ADMIN','FUNDING_MANAGER','CONTRIBUTOR']);
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.evaluate(async()=>{scrollTo(0,0);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});await page.screenshot({path:path.join(out,'native-form-'+width+'.png'),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  const list=await page.request.get(origin+'/api/admin/directory/entities/'+state.organizationId+'/access');assert.equal(list.status(),200);assert((await list.json()).items.length>0);
  assert.equal((await page.request.get(origin+'/api/local-health')).status(),200);assert.deepEqual(await digest(),before);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'native-verification.json'),JSON.stringify({result:'PASS',observedAt:new Date().toISOString(),nativeLogin:true,entityUserForm:true,threeProfiles:true,accessList:true,health:true,businessDataPreserved:true,noUserCreated:true,viewports:[1440,390]},null,2));console.log('MEMBER_NATIVE_UI_PASS');
 }catch(e){console.error('MEMBER_NATIVE_UI_FAILED',stage,e.code||e.name);if(page&&new URL(page.url()).origin===origin){console.log('ALERTS',JSON.stringify(await page.getByRole('alert').allTextContents()));await page.screenshot({path:path.join(out,'native-failure.png'),fullPage:true});}process.exitCode=1;}finally{await browser?.close();await central.end();await tenant.end();}
}
main().catch(e=>{console.error('MEMBER_NATIVE_FAILED',e.code||e.name);process.exitCode=1;});
