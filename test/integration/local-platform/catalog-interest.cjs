'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium}=require('../../../frontend/test-harness/node_modules/playwright'),cfg=require('../../../backend/scripts/localPlatform/config');
(async()=>{
 const access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json'))),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json'))),out=path.join(cfg.root,'output/playwright/catalog-interest');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});let stage='login';
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),writes=[],errors=[];page.on('pageerror',e=>errors.push(e.name));
  await page.route('**/api/**',route=>{const r=route.request();if(!new URL(r.url()).pathname.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(r.method())){writes.push(new URL(r.url()).pathname);return route.abort()}return route.continue()});
  await page.goto('http://localhost:3000/');await page.locator('#username').fill(access.hugo.username);await page.locator('#password').fill(access.hugo.password);await page.locator('#kc-login').click();await page.waitForURL('http://localhost:3000/catalogo');
  stage='organization';const selector=page.getByRole('combobox',{name:'Organização ativa'});await selector.waitFor();await page.waitForFunction(()=>!document.querySelector('select[aria-label="Organização ativa"]').disabled);if(await selector.inputValue()!==state.organizationId)await selector.selectOption(state.organizationId);
  stage='catalog';const button=page.getByRole('button',{name:/Registar interesse em/}).first();await button.waitFor();
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await button.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'table-'+width+'.png')});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}
  stage='create-form';await button.click();await page.getByRole('heading',{name:'Nova candidatura',exact:true}).waitFor();const url=new URL(page.url());assert.equal(url.searchParams.get('origem'),'CENTRAL');assert(url.searchParams.get('revisao'));assert(url.searchParams.get('oportunidade'));assert(writes.every(p=>p==='/api/notifications/check-deadlines'));assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({result:'PASS',tableAction:true,organizationAccount:true,revisionPinned:true,creationForm:true,noBusinessWrites:true,backgroundNotificationWritesBlocked:true,viewports:[1440,390]},null,2));console.log('CATALOG_INTEREST_PASS');
 }catch(e){console.error('CATALOG_INTEREST_FAILED',stage,e.name);process.exitCode=1}finally{await browser.close()}
})().catch(()=>{console.error('CATALOG_INTEREST_FAILED');process.exitCode=1});
