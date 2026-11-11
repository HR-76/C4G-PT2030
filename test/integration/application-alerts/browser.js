'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
async function run({base,user,userB,applicationId}){
 const root=path.resolve(__dirname,'../../..'),out=path.join(root,'output/playwright/c4g-alerts');fs.mkdirSync(out,{recursive:true});
 const {createServer}=await import(pathToFileURL(path.join(root,'frontend/node_modules/vite/dist/node/index.js')).href);
 const vite=await createServer({root:path.join(root,'frontend'),configFile:path.join(root,'frontend/vite.config.js'),logLevel:'error',server:{host:'localhost',port:5271,strictPort:true,proxy:{'/api':{target:base,changeOrigin:true}}}});
 let browser;const errors=[];
 try{
  await vite.listen();browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const open=async actor=>{const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'c4g_session_dev',value:decodeURIComponent(actor.cookie.slice(actor.cookie.indexOf('=')+1)),domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));return page};
  const page=await open(user);await page.goto('http://localhost:5271/notificacoes');await page.getByText('Candidatura de ensaio — alertas',{exact:true}).first().waitFor();assert.equal(await page.locator('.notif-item').count(),3);
  await page.evaluate(()=>{const p=document.createElement('p');p.textContent='ENSAIO — serviços reais e dados sintéticos num PostgreSQL descartável.';document.querySelector('main').prepend(p)});
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(out,`c4g-${width}.png`),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  await page.setViewportSize({width:1440,height:1000});await page.getByLabel('Apenas não lidas').check();await page.getByText('Prazo · 7 dias',{exact:true}).waitFor();assert.equal(await page.locator('.notif-item').count(),1);
  await page.getByTitle('Marcar como lida').click();await page.getByText(/Nenhuma notificação/).waitFor();await page.reload();await page.getByText(/Nenhuma notificação/).waitFor();
  await page.getByLabel('Apenas não lidas').uncheck();await page.locator('.notif-item').first().waitFor();await page.getByRole('link',{name:'Candidatura de ensaio — alertas',exact:true}).first().click();await page.waitForURL('**/candidaturas/'+applicationId);
  const other=await open(userB);await other.goto('http://localhost:5271/notificacoes');await other.getByText(/Nenhuma notificação/).waitFor();assert.equal(await other.getByText('Candidatura de ensaio — alertas').count(),0);
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'visual-verification.json'),JSON.stringify({result:'PASS',fixture:'REAL_HTTP_DISPOSABLE_POSTGRES',widths:[1440,390],readPersisted:true,link:true,secondOrganizationEmpty:true,pageErrors:errors},null,2));console.log('APPLICATION_ALERTS_BROWSER_PASS');
 }finally{await browser?.close();await vite.close()}
}
module.exports={run};
