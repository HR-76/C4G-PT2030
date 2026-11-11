'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
async function run({base,userA,userB}){
 const root=path.resolve(__dirname,'../../..'),out=path.join(root,'output/playwright/c4g-application-list');fs.mkdirSync(out,{recursive:true});
 const {createServer}=await import(pathToFileURL(path.join(root,'frontend/node_modules/vite/dist/node/index.js')).href);
 const vite=await createServer({root:path.join(root,'frontend'),configFile:path.join(root,'frontend/vite.config.js'),logLevel:'error',server:{host:'localhost',port:5271,strictPort:true,proxy:{'/api':{target:base,changeOrigin:true}}}});
 let browser,page;const errors=[];
 try{
  await vite.listen();browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const open=async user=>{const ctx=await browser.newContext({viewport:{width:1440,height:1000}});await ctx.addCookies([{name:'c4g_session_dev',value:decodeURIComponent(user.cookie.slice(user.cookie.indexOf('=')+1)),domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);const p=await ctx.newPage();p.setDefaultTimeout(90000);p.on('pageerror',e=>errors.push(e.message));return p};
  page=await open(userA);await page.goto('http://localhost:5271/candidaturas');await page.getByText('32 candidaturas',{exact:true}).waitFor();assert.equal(await page.getByRole('columnheader').count(),8);
  await page.getByRole('button',{name:'Seguinte',exact:true}).click();await page.getByText('Página 2 de 2',{exact:true}).waitFor();await page.getByRole('link',{name:'Projeto 25',exact:true}).waitFor();
  await page.getByRole('button',{name:'Anterior',exact:true}).click();await page.getByRole('link',{name:'Projeto 00 revisto',exact:true}).waitFor();
  await page.getByRole('textbox',{name:'Pesquisar candidaturas'}).fill('Projeto 01');await page.getByText('1 candidatura',{exact:true}).waitFor();
  await page.getByLabel('Estado de Projeto 01').click();await page.getByLabel('Novo estado',{exact:true}).selectOption('PREPARATION');await page.getByLabel('Motivo',{exact:true}).fill('Preparar o dossier');
  let lost=false;await page.route('**/api/applications/*/transitions',async route=>{if(!lost){lost=true;const result=await route.fetch();assert.equal(result.status(),200);return route.fulfill({status:503,contentType:'application/json',body:'{"error":{"code":"SERVICE_UNAVAILABLE"}}'})}return route.continue()});
  await page.getByRole('button',{name:'Confirmar alteração'}).click();await page.getByRole('alert').waitFor();await page.unroute('**/api/applications/*/transitions');await page.reload();await page.getByRole('button',{name:'Repetir o mesmo envio'}).click();await page.getByText('Alteração guardada.',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('select[aria-label="Estado de Projeto 01"]')?.value==='PREPARATION');
  await page.getByRole('button',{name:'Limpar filtros'}).click();await page.getByText('32 candidaturas',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Orç. total',exact:true}).click();await page.waitForURL('**sort=totalBudget**');await page.getByRole('link',{name:'Projeto 01',exact:true}).waitFor();
  await page.getByRole('button',{name:'Orç. total',exact:true}).click();await page.waitForURL('**direction=desc**');await page.waitForLoadState('networkidle');
  assert((await page.locator('tbody tr').first().innerText()).includes('Projeto 00 revisto'));
  for(const width of [1440,1280,1008,390]){await page.setViewportSize({width,height:1000});if(width===390){const close=page.getByRole('button',{name:'Fechar menu',exact:true});if(await close.isVisible())await close.click()}
   await page.screenshot({path:path.join(out,`c4g-list-${width}.png`),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));if(width===390)await page.screenshot({path:path.join(out,'c4g-list-390-viewport.png'),animations:'disabled'});}
  await page.getByLabel('Ordenar por',{exact:true}).selectOption('title');await page.getByLabel('Ordem',{exact:true}).selectOption('asc');await page.waitForLoadState('networkidle');
  const other=await open(userB);await other.goto('http://localhost:5271/candidaturas');await other.getByText('Ainda não existem candidaturas registadas.',{exact:true}).waitFor();assert.equal(await other.getByText('Projeto 01',{exact:true}).count(),0);
  assert.equal(errors.length,0,JSON.stringify(errors));fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({result:'PASS',postgres:true,synthetic:true,serverPagination:true,filtersCountsSort:true,uncertainReplay:true,isolation:true,widths:[1440,1280,1008,390],pageErrors:errors},null,2));console.log('APPLICATION_LIST_CHROME_PASS');
 }catch(error){if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw error}
 finally{await browser?.close();await vite.close()}
}
module.exports={run};
