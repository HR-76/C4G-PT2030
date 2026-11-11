'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
async function run({base,tech,broad,app,other,remove}){
 const root=path.resolve(__dirname,'../../..'),out=path.join(root,'output/playwright/c4g-team-access');fs.mkdirSync(out,{recursive:true});
 const {createServer}=await import(pathToFileURL(path.join(root,'frontend/node_modules/vite/dist/node/index.js')).href);
 const vite=await createServer({root:path.join(root,'frontend'),configFile:path.join(root,'frontend/vite.config.js'),logLevel:'error',server:{host:'localhost',port:5271,strictPort:true,proxy:{'/api':{target:base,changeOrigin:true}}}});
 let browser,page;const errors=[];
 try{
  await vite.listen();browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const open=async user=>{const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await ctx.addCookies([{name:'c4g_session_dev',value:decodeURIComponent(user.cookie.slice(user.cookie.indexOf('=')+1)),domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);const p=await ctx.newPage();p.setDefaultTimeout(30000);p.on('pageerror',e=>errors.push(e.message));return p};
  page=await open(tech);await page.goto('http://localhost:5271/candidaturas');await page.getByRole('link',{name:app.title,exact:true}).waitFor();assert.equal(await page.getByText(other.title,{exact:true}).count(),0);
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(out,`team-list-${width}.png`),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  await page.getByRole('link',{name:app.title,exact:true}).click();await page.getByRole('heading',{name:app.title,exact:true}).waitFor();await page.getByText('Tarefa existente preservada',{exact:true}).waitFor();await page.getByText('Parceiro Alfa',{exact:true}).first().waitFor();await page.getByText('Sem documentos associados.',{exact:true}).waitFor();await page.waitForLoadState('networkidle');
  await page.getByText('Acesso de consulta à candidatura. A edição requer autorização do gestor.').waitFor();assert.equal(await page.getByRole('button',{name:'Guardar alterações',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Criar tarefa',exact:true}).count(),0);
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(out,`team-detail-${width}.png`),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  const otherPage=await open(broad);await otherPage.goto('http://localhost:5271/candidaturas');await otherPage.getByRole('link',{name:other.title,exact:true}).waitFor();assert.equal(await otherPage.getByText(app.title,{exact:true}).count(),0);
  await remove();await page.reload();await page.getByText('Candidatura ou oportunidade indisponível.',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:app.title,exact:true}).count(),0);assert.equal(await page.getByText('Tarefa existente preservada',{exact:true}).count(),0);
  await page.goto('http://localhost:5271/candidaturas');await page.getByText('Ainda não existem candidaturas registadas.',{exact:true}).waitFor();await page.screenshot({path:path.join(out,'removed-team-390.png'),fullPage:true,animations:'disabled'});
  await page.waitForLoadState('networkidle');await otherPage.waitForLoadState('networkidle');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'browser-verification.json'),JSON.stringify({result:'PASS',synthetic:true,realApplicationHttp:true,widths:[1440,390],teamOnlyList:true,readOnlyDetail:true,tasksPreserved:true,openSessionRevocation:true,pageErrors:errors},null,2));console.log('TEAM_ACCESS_CHROME_PASS');
 }catch(error){if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true,animations:'disabled'});throw error}
 finally{await browser?.close();await vite.close()}
}
module.exports={run};
