'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
async function run({base,userA,userB,applicationId}){
 const root=path.resolve(__dirname,'../../..'),out=path.join(root,'output/playwright/c4g-application-partners');fs.mkdirSync(out,{recursive:true});
 const {createServer}=await import(pathToFileURL(path.join(root,'frontend/node_modules/vite/dist/node/index.js')).href);
 const vite=await createServer({root:path.join(root,'frontend'),configFile:path.join(root,'frontend/vite.config.js'),logLevel:'error',server:{host:'localhost',port:5271,strictPort:true,proxy:{'/api':{target:base,changeOrigin:true}}}});
 let browser,page;const errors=[];
 try{
  await vite.listen();browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const open=async user=>{const ctx=await browser.newContext({viewport:{width:1440,height:1000}});await ctx.addCookies([{name:'c4g_session_dev',value:decodeURIComponent(user.cookie.slice(user.cookie.indexOf('=')+1)),domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);const p=await ctx.newPage();p.setDefaultTimeout(90000);p.on('pageerror',e=>errors.push(e.message));return p};
  console.log('PARTNER_BROWSER_CREATE');page=await open(userA);await page.goto('http://localhost:5271/candidaturas/'+applicationId);
  const panel=page.getByRole('region',{name:'Parceiros da candidatura'});await panel.getByLabel('Nome da entidade *',{exact:true}).fill('Rede de parceiros — ensaio');await panel.getByLabel('País',{exact:true}).fill('Portugal');await panel.getByLabel('Pessoa responsável',{exact:true}).fill('Maria Santos');await panel.getByLabel('Email',{exact:true}).fill('rede@example.org');await panel.getByLabel('Área de investigação / Interesse no projeto').fill('Capacitação e transformação digital');
  await panel.getByRole('button',{name:'Adicionar pessoa'}).click();await panel.getByLabel('Nome *',{exact:true}).fill('Maria Santos');assert.equal(await panel.getByLabel('Papel').inputValue(),'OUTRO');await panel.getByLabel('Papel').selectOption('RESPONSAVEL');await panel.getByLabel('Área',{exact:true}).fill('Formação');await panel.getByLabel('Email',{exact:true}).nth(1).fill('maria@example.org');
  let lost=false;await page.route('**/api/applications/*/partners',async route=>{if(route.request().method()==='POST'&&!lost){lost=true;const result=await route.fetch();assert.equal(result.status(),200);return route.fulfill({status:503,contentType:'application/json',body:'{"error":{"code":"SERVICE_UNAVAILABLE"}}'})}return route.continue()});
  await panel.getByRole('button',{name:'Adicionar parceiro',exact:true}).click();await panel.getByRole('alert').waitFor();await page.unroute('**/api/applications/*/partners');await page.reload();await panel.getByRole('button',{name:'Repetir envio de parceiros'}).click();await panel.getByText('Parceiros atualizados.',{exact:true}).waitFor();
  console.log('PARTNER_BROWSER_REPLAY_PASS');
  // Find the created association using the aggregate page, including pagination/search.
  await page.goto('http://localhost:5271/parceiros');await page.getByText('30 parceiros',{exact:true}).waitFor();assert.equal(await page.getByRole('columnheader').count(),6);await page.getByRole('button',{name:'Seguinte',exact:true}).click();await page.getByText('Página 2',{exact:false}).waitFor();
  await page.getByLabel('Pesquisar parceiros').fill('maria@example.org');await page.getByText('1 parceiro',{exact:true}).waitFor();await page.getByLabel('País',{exact:true}).selectOption('Portugal');await page.getByLabel('Papel').selectOption('RESPONSAVEL');await page.getByText('1 parceiro',{exact:true}).waitFor();
  console.log('PARTNER_BROWSER_FILTERS_PASS');
  for(const width of [1440,1280,1008,390]){await page.setViewportSize({width,height:1000});if(width===390){const close=page.getByRole('button',{name:'Fechar menu',exact:true});if(await close.isVisible())await close.click()}await page.screenshot({path:path.join(out,`c4g-partners-${width}.png`),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  await page.getByRole('link',{name:'Abrir candidatura'}).click();await panel.getByLabel('Nome da entidade *',{exact:true}).waitFor();
  // Detail is paged by stable ID; navigate until the newly created card appears.
  let card=panel.locator(':scope > .partner-grid > .partner-card').filter({hasText:'Rede de parceiros — ensaio'});
  if(!await card.count()){await panel.getByRole('button',{name:'Seguinte',exact:true}).click();await card.waitFor()}
  await card.getByRole('button',{name:'Editar',exact:true}).click();await panel.getByLabel('Nome da entidade *',{exact:true}).fill('Rede de parceiros revista');await panel.getByRole('button',{name:'Remover pessoa',exact:true}).click();await panel.getByRole('button',{name:'Guardar parceiro',exact:true}).click();await panel.getByText('Parceiros atualizados.',{exact:true}).waitFor();
  await panel.locator('summary').filter({hasText:'Parceiro atualizado — Rede de parceiros revista'}).click();await panel.getByText(/Pessoa removida: Maria Santos/).waitFor();
  console.log('PARTNER_BROWSER_EDIT_HISTORY_PASS');
  for(const width of [1440,1008,390]){await page.setViewportSize({width,height:1000});await panel.scrollIntoViewIfNeeded();await page.addStyleTag({content:'.top-header{visibility:hidden}'});await panel.screenshot({path:path.join(out,`c4g-partner-detail-${width}.png`),animations:'disabled'});await page.addStyleTag({content:'.top-header{visibility:visible}'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  await page.goto('http://localhost:5271/parceiros');await page.getByLabel('Pesquisar parceiros').fill('Rede de parceiros revista');await page.getByText('1 parceiro',{exact:true}).waitFor();await page.getByRole('link',{name:'Abrir candidatura'}).click();await panel.getByLabel('Nome da entidade *',{exact:true}).waitFor();card=panel.locator(':scope > .partner-grid > .partner-card').filter({hasText:'Rede de parceiros revista'});if(!await card.count()){await panel.getByRole('button',{name:'Seguinte',exact:true}).click();await card.waitFor()}
  await card.getByRole('button',{name:'Remover',exact:true}).click();await page.getByRole('button',{name:'Remover associação',exact:true}).click();await panel.getByText('Parceiros atualizados.',{exact:true}).waitFor();await page.reload();await panel.locator('summary').filter({hasText:'Associação removida — Rede de parceiros revista'}).waitFor();
  const other=await open(userB);await other.goto('http://localhost:5271/parceiros');await other.getByText('Ainda não há parceiros registados.',{exact:true}).waitFor();assert.equal(await other.getByLabel('País',{exact:true}).locator('option').count(),1);
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({result:'PASS',postgres:true,synthetic:true,crudHistory:true,taskPreservation:true,pagination:true,filters:true,uncertainReplay:true,isolation:true,widths:[1440,1280,1008,390],pageErrors:errors},null,2));console.log('APPLICATION_PARTNERS_CHROME_PASS');
 }catch(error){if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true,animations:'disabled'});throw error}
 finally{await browser?.close();await vite.close()}
}
module.exports={run};
