'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright'),cfg=require('../../../backend/scripts/localPlatform/config');
(async()=>{
 const access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json'))),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));
 const out=path.join(cfg.root,'output/organizational-opportunity-interest/live');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const report={status:'IN_PROGRESS',businessWrites:0,blockedBackgroundWrites:0,checks:[]};let stage='LOGIN',page;
 try{
  page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);
  await page.route('**/api/**',route=>{const request=route.request(),url=new URL(request.url());
   if(!url.pathname.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(request.method())){report.blockedBackgroundWrites++;return route.abort();}return route.continue();});
  await page.goto('http://localhost:3000/');await page.locator('#username').fill(access.hugo.username);await page.locator('#password').fill(access.hugo.password);await page.locator('#kc-login').click();
  await page.locator('.organization-context').waitFor();
  const activeOrganization=await page.evaluate(async()=>{const r=await fetch('/api/auth/session');const body=await r.json();return body.organization?.id;});
  assert.equal(activeOrganization,state.organizationId);
  report.checks.push('OIDC_EXISTING_ACCOUNT_AND_ORGANIZATION');stage='HTTP_READ';
  const result=await page.evaluate(async org=>{
   const paths=['/api/opportunity-interests/context','/api/opportunity-interests','/api/opportunity-interests/units?purpose=ASSIGN'];const items=[];
   for(const url of paths){const response=await fetch(url,{headers:{'X-C4G-Organization':org}});items.push({status:response.status,body:await response.json()});}return items;
  },state.organizationId);
  report.http=result.map(r=>({status:r.status,keys:Object.keys(r.body||{}),available:r.body.available,canRegister:r.body.capabilities?.canRegister,code:r.body.code||r.body.error?.code}));
  assert(result.every(r=>r.status===200));assert.equal(result[0].body.available,true);assert.equal(result[0].body.capabilities.canRegister,true);
  assert(Array.isArray(result[1].body.items));assert(Array.isArray(result[2].body.items));report.unitOptions=result[2].body.items.length;
  report.checks.push('CONTEXT_LIST_UNITS_HTTP_200');stage='CATALOG_MODAL';
  await page.goto('http://localhost:3000/catalogo');const button=page.getByRole('button',{name:/Registar interesse em/}).first();await button.waitFor();await button.click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();await dialog.getByRole('button',{name:'Guardar interesse',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Nova candidatura',exact:true}).count(),0);
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(out,'register-interest-'+width+'.png')});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();report.checks.push('INTEREST_MODAL_WITHOUT_APPLICATION_OR_WRITE');stage='INTEREST_LIST';
  await page.goto('http://localhost:3000/interesses');await page.getByRole('heading',{name:'Interesses da organização',exact:true}).waitFor();
  await page.getByRole('status').filter({hasText:/interesses? nesta página/}).waitFor();
  assert.equal(await page.getByRole('alert').count(),0);
  await page.screenshot({path:path.join(out,'interests-390.png')});report.checks.push('INTEREST_LIST_NAVIGATION');report.status='PASS';
 }catch(e){report.status='FAIL';report.stage=stage;report.code=e.name;if(page){report.pathname=new URL(page.url()).pathname;await page.screenshot({path:path.join(out,'failure.png')});}throw e;}
 finally{await browser.close();report.at=new Date().toISOString();fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})().catch(()=>{console.error('LIVE_INTEREST_READ_FAILED');process.exitCode=1});
