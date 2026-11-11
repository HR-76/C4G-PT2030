'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const cfg=require('../../../backend/scripts/localPlatform/config');
async function main(){
 const out=path.join(cfg.root,'output/playwright/c4g-security-presentation');fs.mkdirSync(out,{recursive:true});
 const access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json'))),origin='http://localhost:3000';
 const state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));
 const admin=await require('../../../backend/scripts/localPlatform/optionalIdentity').identityAdmin(require('../../../backend/scripts/localPlatform/identity').identityConfig());
 const before=await admin(state.identity.realm),usersBefore=await admin(state.identity.realm+'/users/count');
 assert.equal(before.accountTheme,'c4g');assert.equal(before.resetPasswordAllowed,false);
 const errors=[],writes=[];let browser,page,stage='launch';
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(30000);
  page.on('pageerror',e=>errors.push(e.name));
  await page.route('**/api/**',route=>{const r=route.request(),u=new URL(r.url());if(!u.pathname.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(r.method())){writes.push(u.pathname);return route.abort()}return route.continue()});
  await page.route('**/realms/*/account/**',route=>{if(!['GET','HEAD','OPTIONS'].includes(route.request().method())){writes.push('account mutation');return route.abort()}return route.continue()});
  const capture=async(name)=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});const toggle=page.locator('.pf-v5-c-masthead__toggle button');if(width===390&&await toggle.count()&&await toggle.getAttribute('aria-expanded')==='true')await toggle.click();await page.screenshot({path:path.join(out,`${name}-${width}.png`),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}await page.setViewportSize({width:1440,height:1000})};
  stage='login';await page.goto(origin+'/');await page.locator('#username').waitFor();
  stage='OIDC';await page.locator('#username').fill(access.admin.username);await page.locator('#password').fill(access.admin.password);await page.locator('#kc-login').click();await page.waitForURL(origin+'/administracao/dashboard');
  stage='existing session';await page.goto(origin+'/');await page.waitForURL(origin+'/administracao/dashboard');assert.equal(await page.locator('#password').count(),0);
  await page.goto(origin+'/login');await page.waitForURL(origin+'/administracao/dashboard');assert.equal(await page.locator('#password').count(),0);
  stage='account';await page.goto(origin+'/conta/seguranca');await page.getByRole('link',{name:'Gerir password e MFA'}).waitFor();await page.getByText('Administra\u00e7\u00e3o da plataforma C4G',{exact:true}).waitFor();await capture('platform-security');await page.getByRole('link',{name:'Gerir password e MFA'}).click();await page.locator('body[data-page-id="account"] .pf-v5-c-masthead').waitFor();await page.waitForLoadState('networkidle');
  const appearance=await page.evaluate(()=>({header:getComputedStyle(document.querySelector('.pf-v5-c-masthead')).backgroundColor,logo:document.querySelector('.pf-v5-c-masthead img[src$="/logo-c4g.png"]')?.getAttribute('src'),images:[...document.querySelectorAll('.pf-v5-c-masthead img')].map(i=>({class:i.className,parent:i.parentElement.className})),title:document.title,links:[...document.querySelectorAll('nav a')].map(a=>({text:a.textContent,path:new URL(a.href).pathname}))}));
  fs.writeFileSync(path.join(out,'account-structure.json'),JSON.stringify(await page.locator('main').evaluate(el=>[...el.querySelectorAll('*')].filter(e=>e.className&&typeof e.className==='string').map(e=>({tag:e.tagName,class:e.className}))),null,2));
  assert.equal(appearance.header,'rgb(7, 91, 89)');assert(appearance.logo?.endsWith('/logo-c4g.png'));assert.equal(appearance.title,'Conta C4G');
  await capture('keycloak-account');
  assert.equal(new URL(page.url()).pathname,`/realms/${state.identity.realm}/account/account-security/signing-in`);
  assert(await page.getByRole('heading',{name:'Autenticação de Dois Fatores',exact:true}).isVisible());
  assert(await page.getByRole('button',{name:'Atualizar',exact:true}).count()>0);
  const after=await admin(state.identity.realm);assert.deepEqual(after,before);assert.equal(await admin(state.identity.realm+'/users/count'),usersBefore);assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({result:'PASS',observedAt:new Date().toISOString(),existingSessionPreserved:true,oidc:true,accountTheme:'c4g',configurationUnchanged:true,accountsUnchanged:true,viewports:[1440,390]},null,2));console.log('C4G_ACCESS_IDENTITY_PASS');
 }catch(e){console.error('C4G_ACCESS_IDENTITY_FAILED',stage,e.name);if(page&&stage!=='OIDC'){await page.screenshot({path:path.join(out,'failed.png'),fullPage:true});console.log('LAYOUT_OVERFLOW',await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,20).map(e=>({tag:e.tagName,class:e.className,width:Math.round(e.getBoundingClientRect().width)}))))}process.exitCode=1}finally{await browser?.close()}
}
main().catch(e=>{console.error('C4G_ACCESS_IDENTITY_FAILED',e.code||e.name);process.exitCode=1});
