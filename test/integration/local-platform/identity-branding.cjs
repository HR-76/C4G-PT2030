'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const cfg=require('../../../backend/scripts/localPlatform/config');
async function main(){
 const out=path.join(cfg.root,'output/playwright/c4g-access-identity');fs.mkdirSync(out,{recursive:true});
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
  stage='root';await page.goto(origin+'/');await page.locator('#username').waitFor();assert.equal(new URL(page.url()).origin,'https://localhost:8443');await capture('home');
  stage='split login';
  for(const width of [1920,1440,900,390]){
   await page.setViewportSize({width,height:1000});
   const layout=await page.evaluate(()=>{const form=document.querySelector('#kc-form').getBoundingClientRect(),panel=document.querySelector('.c4g-login-story').getBoundingClientRect();return {formRight:form.right,formBottom:form.bottom,panelLeft:panel.left,panelTop:panel.top,panelRight:panel.right,panelWidth:panel.width,background:getComputedStyle(document.body).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth+1}});
   assert.equal(layout.overflow,false);assert.equal(layout.background,'rgb(255, 255, 255)');assert(Math.abs(layout.panelRight-width)<2);
   if(width>900){assert(layout.formRight<layout.panelLeft);assert(Math.abs(layout.panelWidth-width*.42)<2)}else{assert(layout.panelTop>layout.formBottom)}
   assert(await page.locator('#username').isVisible());assert(await page.locator('#password').isVisible());
   await page.screenshot({path:path.join(out,`split-login-${width}.png`),fullPage:true,animations:'disabled'});
  }
  await page.setViewportSize({width:1440,height:1000});
  const passwordToggle=page.locator('button[data-password-toggle]');await passwordToggle.click();assert.equal(await page.locator('#password').getAttribute('type'),'text');await passwordToggle.click();assert.equal(await page.locator('#password').getAttribute('type'),'password');
  stage='native recovery';await page.locator('summary').filter({hasText:'Esqueci-me da palavra-passe'}).click();await page.getByText(/A recuperação por email ainda não está disponível/).waitFor();await capture('native-recovery');
  stage='recovery';await page.goto(origin+'/recuperar-password');await page.getByRole('heading',{name:'Recuperar password'}).waitFor();await page.reload();await page.getByText('A recuperação por email ainda não está disponível neste ambiente.').waitFor();assert.equal(await page.locator('input').count(),0);await capture('recovery');
  stage='login theme';await page.getByRole('link',{name:'Voltar ao login'}).click();await page.locator('#username').waitFor();await capture('keycloak-login');
  stage='login alias';await page.goto(origin+'/login');await page.locator('#username').waitFor();assert(await page.locator('#password').isVisible());await page.reload();await page.locator('#username').waitFor();await capture('login-alias');
  stage='OIDC';await page.locator('#username').fill(access.admin.username);await page.locator('#password').fill(access.admin.password);await page.locator('#kc-login').click();await page.waitForURL(origin+'/integracoes');
  stage='existing session';await page.goto(origin+'/');await page.waitForURL(origin+'/integracoes');assert.equal(await page.locator('#password').count(),0);
  await page.goto(origin+'/login');await page.waitForURL(origin+'/integracoes');assert.equal(await page.locator('#password').count(),0);
  stage='account';await page.goto(origin+'/conta/seguranca');await page.getByRole('link',{name:'Gerir password e MFA'}).click();await page.locator('body[data-page-id="account"] .pf-v5-c-masthead').waitFor();await page.waitForLoadState('networkidle');
  const appearance=await page.evaluate(()=>({header:getComputedStyle(document.querySelector('.pf-v5-c-masthead')).backgroundColor,logo:document.querySelector('.pf-v5-c-masthead img[src$="/logo-c4g.png"]')?.getAttribute('src'),images:[...document.querySelectorAll('.pf-v5-c-masthead img')].map(i=>({class:i.className,parent:i.parentElement.className})),title:document.title,links:[...document.querySelectorAll('nav a')].map(a=>({text:a.textContent,path:new URL(a.href).pathname}))}));
  console.log('ACCOUNT_APPEARANCE',JSON.stringify(appearance));
  assert.equal(appearance.header,'rgb(7, 91, 89)');assert(appearance.logo?.endsWith('/logo-c4g.png'));assert.equal(appearance.title,'Conta C4G');
  await capture('keycloak-account');
  assert.equal(new URL(page.url()).pathname,`/realms/${state.identity.realm}/account/account-security/signing-in`);
  assert(await page.getByRole('heading',{name:'Autenticação de Dois Fatores',exact:true}).isVisible());
  assert(await page.getByRole('button',{name:'Atualizar',exact:true}).count()>0);
  const after=await admin(state.identity.realm);assert.deepEqual(after,before);assert.equal(await admin(state.identity.realm+'/users/count'),usersBefore);assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({result:'PASS',observedAt:new Date().toISOString(),rootLogin:true,directLogin:true,existingSessionPreserved:true,recoveryEmailDeferred:true,oidc:true,accountTheme:'c4g',configurationUnchanged:true,accountsUnchanged:true,viewports:[1440,390]},null,2));console.log('C4G_ACCESS_IDENTITY_PASS');
 }catch(e){console.error('C4G_ACCESS_IDENTITY_FAILED',stage,e.name);if(page&&stage!=='OIDC'){await page.screenshot({path:path.join(out,'failed.png'),fullPage:true});console.log('LAYOUT_OVERFLOW',await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,20).map(e=>({tag:e.tagName,class:e.className,width:Math.round(e.getBoundingClientRect().width)}))))}process.exitCode=1}finally{await browser?.close()}
}
main().catch(e=>{console.error('C4G_ACCESS_IDENTITY_FAILED',e.code||e.name);process.exitCode=1});
