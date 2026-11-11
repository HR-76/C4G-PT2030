'use strict';
// Read-only browser verification after explicit native reconciliation/imports.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const cfg=require('../../../backend/scripts/localPlatform/config');
async function main(){
 const state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json'))),access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json')));
 const proof=JSON.parse(fs.readFileSync(path.join(cfg.root,'output/funding-programmes/identity-reconciliation-native.json')));
 assert.equal(proof.status,'PASS');const cerv=proof.changes.find(x=>x.to==='CASCADE:11674'),esc=proof.changes.find(x=>x.sourceProgramme==='ESC');
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),errors=[],writes=[],origin='http://localhost:3000';
 const out=path.join(cfg.root,'output/playwright/c4g-funding-identity');fs.mkdirSync(out,{recursive:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.name));
  await page.route('**/api/**',route=>{const r=route.request(),u=new URL(r.url());if(u.origin===origin&&!u.pathname.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(r.method())){writes.push(u.pathname);return route.abort()}return route.continue()});
  await page.goto(origin+'/login');await page.getByRole('button',{name:'Entrar na C4G',exact:true}).click();await page.locator('#username').fill(access.hugo.username);await page.locator('#password').fill(access.hugo.password);await page.locator('#kc-login').click();await page.waitForURL(origin+'/catalogo');
  const read=async route=>{const r=await page.evaluate(async({route,org})=>{const r=await fetch(route,{headers:{'X-C4G-Organization':org}});return{status:r.status,body:await r.json()}},{route,org:state.organizationId});assert.equal(r.status,200);return r.body};
  const list=await read('/api/central-opportunities?q=CERV-2024-CITIZENS-VALUES');assert.equal(list.items.length,2);assert.equal(new Set(list.items.map(x=>x.opportunityId)).size,2);assert.ok(list.items.some(x=>x.opportunityId===cerv.opportunityId));assert.ok(list.items.every(x=>x.programmeName==='CERV'));
  await page.goto(origin+'/catalogo?view=filtered&period=all&q=CERV-2024-CITIZENS-VALUES');await page.getByRole('link',{name:list.items[0].title,exact:true}).waitFor();await page.getByRole('link',{name:list.items[1].title,exact:true}).waitFor();
  await page.waitForLoadState('networkidle');await page.screenshot({path:path.join(out,'distinct-cerv-list.png'),fullPage:true,animations:'disabled'});
  const record=await read('/api/central-opportunities/'+cerv.opportunityId);assert.equal(record.externalIdentifier,'CASCADE:11674');assert.equal(record.snapshot.programmeName,'CERV');
  await page.goto(origin+'/catalogo/'+cerv.opportunityId);await page.getByRole('heading',{name:record.snapshot.title,exact:true}).waitFor();
  assert.equal(await page.locator('.opportunity-badges .opportunity-reference').textContent(),'CERV-2024-CITIZENS-VALUES');
  assert.equal(await page.getByRole('link',{name:'Consultar fonte oficial'}).getAttribute('href'),'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/competitive-calls-cs/11674');
  await page.getByRole('link',{name:'Registar interesse',exact:true}).waitFor();
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});const close=page.getByRole('button',{name:'Fechar menu',exact:true});if(width===390&&await close.isVisible())await close.click();await page.waitForLoadState('networkidle');await page.screenshot({path:path.join(out,'preserved-detail-'+width+'.png'),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}
  assert.equal((await read('/api/central-opportunities/'+esc.opportunityId)).snapshot.programmeName,'ESC');assert.equal(errors.length,0);assert.equal(writes.length,0);
  fs.writeFileSync(path.join(out,'native-verification.json'),JSON.stringify({status:'PASS',originalDetailUrlPreserved:true,readableTopicReference:true,cervCallsDistinct:2,officialCascadeLinkCorrect:true,escClassificationCorrect:true,businessWrites:writes,pageErrors:errors},null,2));console.log('NATIVE_CASCADE_READ_PASS');
 }finally{await browser.close()}
}
main().catch(e=>{console.error(e.code||e.name,e.message?.slice(0,180));process.exitCode=1});
