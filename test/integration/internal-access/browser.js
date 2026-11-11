'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
async function run({base,admin,manager,candidate}){
 const root=path.resolve(__dirname,'../../..'),out=path.join(root,'output/playwright/c4g-internal-access');fs.mkdirSync(out,{recursive:true});
 const {createServer}=await import(pathToFileURL(path.join(root,'frontend/node_modules/vite/dist/node/index.js')).href);
 const vite=await createServer({root:path.join(root,'frontend'),configFile:path.join(root,'frontend/vite.config.js'),logLevel:'error',server:{host:'localhost',port:5271,strictPort:true,proxy:{'/api':{target:base,changeOrigin:true}}}});
 let browser,page;const errors=[];
 try{
  await vite.listen();browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const open=async user=>{const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await ctx.addCookies([{name:'c4g_session_dev',value:decodeURIComponent(user.cookie.slice(user.cookie.indexOf('=')+1)),domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);const p=await ctx.newPage();p.setDefaultTimeout(40000);p.on('pageerror',e=>errors.push(e.message));await p.goto('http://localhost:5271/utilizadores');await p.getByRole('heading',{name:'Acessos da organização'}).waitFor();await p.waitForLoadState('networkidle');return p};
  page=await open(admin);const row=page.getByRole('row').filter({hasText:'Pessoa a associar à equipa'});
  await row.getByRole('combobox').selectOption('FUNDING_MANAGER');await row.getByRole('button',{name:'Guardar perfil'}).click();await page.getByRole('region',{name:'Confirmar alteração de acesso'}).waitFor();
  await page.getByRole('button',{name:'Confirmar alteração',exact:true}).click();await page.getByText('Acesso atualizado nesta organização.',{exact:true}).waitFor();assert.equal(await row.getByRole('combobox').inputValue(),'FUNDING_MANAGER');
  await row.getByRole('combobox').selectOption('CONTRIBUTOR');await row.getByRole('button',{name:'Guardar perfil'}).click();await page.getByRole('button',{name:'Confirmar alteração',exact:true}).click();await page.getByText('Acesso atualizado nesta organização.',{exact:true}).waitFor();
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(out,`admin-${width}.png`),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  const managerPage=await open(manager),target=managerPage.getByRole('row').filter({hasText:'Pessoa a associar à equipa'});
  assert.deepEqual(await target.getByRole('combobox').locator('option').evaluateAll(options=>options.map(o=>o.value)),['CONTRIBUTOR']);
  await target.getByRole('button',{name:'Suspender acesso'}).click();await managerPage.getByRole('button',{name:'Confirmar alteração',exact:true}).click();await target.getByRole('button',{name:'Reativar acesso'}).waitFor();
  await target.getByRole('button',{name:'Reativar acesso'}).click();await managerPage.getByRole('button',{name:'Confirmar alteração',exact:true}).click();await target.getByRole('button',{name:'Suspender acesso'}).waitFor();
  for(const width of [1440,390]){await managerPage.setViewportSize({width,height:1000});await managerPage.screenshot({path:path.join(out,`manager-${width}.png`),fullPage:true,animations:'disabled'});assert(await managerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  await page.waitForLoadState('networkidle');await managerPage.waitForLoadState('networkidle');assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'browser-verification.json'),JSON.stringify({result:'PASS',synthetic:true,realHttp:true,widths:[1440,390],adminProfileRoundTrip:true,managerStatusRoundTrip:true,limitedManagerOptions:true,errors},null,2));console.log('INTERNAL_ACCESS_CHROME_PASS');
 }catch(e){if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw e}finally{await browser?.close();await vite.close()}
}
module.exports={run};
