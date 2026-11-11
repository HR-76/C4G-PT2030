const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
process.chdir(path.resolve(__dirname, '../../..'));
(async()=>{
 const out=path.resolve('output/playwright/account-controls');const access=JSON.parse(fs.readFileSync('.tmp/local-platform/access.json'));
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const results=[];
 try{const page=await browser.newPage({viewport:{width:1440,height:950}});page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(e.name));
 await page.goto('http://localhost:3000/api/auth/oidc/login');await page.locator('#username').fill(access.admin.username);await page.locator('#password').fill(access.admin.password);await page.locator('#kc-login').click();await page.waitForURL(u=>u.origin==='http://localhost:3000');await page.goto('http://localhost:3000/api/auth/account');await page.getByTestId('options-toggle').waitFor();
 await page.getByRole('link',{name:'Atividade dos dispositivos',exact:true}).click();await page.getByRole('heading',{name:'Atividade dos dispositivos',exact:true}).waitFor();
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:950});await page.waitForTimeout(350);
  const nav=page.getByTestId('nav-toggle');if(width<=768&&await nav.getAttribute('aria-expanded')==='true')await nav.click();
  const toggle=page.getByTestId('options-toggle'),back=page.getByTestId('referrer-link');
  for(const control of [toggle,back]){const r=await control.boundingBox();assert(r&&r.x>=0&&r.x+r.width<=width+1);assert(r.height>=(width<=600?44:40));}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await toggle.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
  assert(await toggle.evaluate(e=>e===document.activeElement));
  assert.notEqual(await toggle.evaluate(e=>getComputedStyle(e).outlineStyle),'none');
  await page.screenshot({path:path.join(out,'devices-'+width+'.png'),fullPage:true});
  await page.keyboard.press('Enter');await page.getByRole('menu').waitFor();
  assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  const menu=page.getByRole('menu');await page.waitForFunction(()=>{const e=document.querySelector('[data-testid=options]');if(!e)return false;const r=e.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth+1});await page.waitForTimeout(200);const r=await menu.boundingBox();await page.screenshot({path:path.join(out,"menu-"+width+".png"),fullPage:true});console.log(JSON.stringify({menuBounds:r,width}));assert((await menu.boundingBox()).x>=0&&(await menu.boundingBox()).x+(await menu.boundingBox()).width<=width+1);
  console.log(JSON.stringify({width,menu:await menu.innerText()}));
  await page.screenshot({path:path.join(out,'menu-'+width+'.png'),fullPage:true});
  await page.keyboard.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  await toggle.click();await menu.waitFor();await page.getByRole('heading',{name:'Dispositivos autenticados',exact:true}).click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  results.push({width,noOverflow:true,controlsVisible:true,keyboardFocus:true,menuEnterEscape:true,outsideClick:true});
 }
 await page.getByRole('button',{name:'Atualizar página',exact:true}).click();await page.getByRole('heading',{name:'Atividade dos dispositivos',exact:true}).waitFor();
 await page.getByTestId('referrer-link').click();await page.waitForURL('http://localhost:3000/conta/seguranca');
 const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,storageState:await page.context().storageState()});
 const mobile=await mobileContext.newPage();await mobile.goto('http://localhost:3000/api/auth/account');const mobileToggle=mobile.getByTestId('options-toggle');await mobileToggle.waitFor();await mobileToggle.tap();await mobile.getByRole('menu').waitFor();await mobile.waitForTimeout(350);assert.equal(await mobileToggle.getAttribute('aria-expanded'),'true');assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await mobile.screenshot({path:path.join(out,'mobile-touch.png'),fullPage:true});await mobileToggle.tap();assert.equal(await mobileToggle.getAttribute('aria-expanded'),'false');await mobileContext.close();results.push({width:390,touch:true,menuTap:true});
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({result:'PASS',results,refresh:true,returnToApp:true,pageErrors:errors},null,2));console.log('PASS');
 }finally{await browser.close()}
})().catch(e=>{console.error(e.name,e.message.replace(/https?:\/\/\S+/g,'[url]'));process.exitCode=1});







