'use strict';
// Existing installation: authentication and reads only; no schema, grants or business writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const cfg=require('../../../backend/scripts/localPlatform/config'),{totp}=require('../local-platform/login');
async function main(){
 const state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json'))),access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json')));
 const origin='http://localhost:3000';assert.equal(state.identity.origin,origin);
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),writes=[],errors=[],checks=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.name));
  await page.route('**/api/**',route=>{const r=route.request(),u=new URL(r.url());if(u.origin===origin&&!u.pathname.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(r.method())){writes.push(u.pathname);return route.abort()}return route.continue()});
  await page.goto(origin+'/login');await page.getByRole('button',{name:'Entrar na C4G',exact:true}).click();await page.locator('#username').fill(access.hugo.username);await page.locator('#password').fill(access.hugo.password);await page.locator('#kc-login').click();
  if(access.hugo.totpSecret){await page.locator('#otp').fill(totp(access.hugo.totpSecret));await page.locator('#kc-login').click()}
  await page.waitForURL(origin+'/catalogo');await page.waitForLoadState('networkidle');
  for(const route of ['/dashboard','/catalogo','/perfil-organizacao/unidades','/perfil-organizacao/pessoas']){
   await page.goto(origin+route);await page.waitForLoadState('networkidle');assert.equal(await page.locator('[role=alert]').count(),0,'NATIVE_PAGE_ALERT');checks.push(route);
  }
  for(const route of ['/api/organization-directory','/api/organization-directory/units','/api/organization-directory/people','/api/opportunities','/api/applications']){
   const status=await page.evaluate(async({route,org})=>(await fetch(route,{headers:{'X-C4G-Organization':org}})).status,{route,org:state.organizationId});assert.equal(status,200,route);checks.push(route);
  }
  assert.equal(writes.length,0);assert.equal(errors.length,0);
  fs.writeFileSync(path.join(cfg.root,'output/playwright/c4g-pilot-people/native-compatibility.json'),JSON.stringify({result:'PASS',identity:'existing OIDC manager',schema:'existing 015/025',newDeliveryActivated:false,businessWrites:writes,pageErrors:errors,checks},null,2));
  console.log('NATIVE_PRE_UPGRADE_OIDC_READ_COMPATIBILITY_PASS');
 }finally{await browser.close()}
}
main().catch(e=>{console.error(e.code||e.name,e.message?.replace(/https?:\/\/\S+/g,'[local]'));process.exitCode=1});
