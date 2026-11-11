'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
async function run({base,userA,userB,opportunityId}){
 const root=path.resolve(__dirname,'../../..'),out=path.join(root,'output/playwright/c4g-application-lifecycle');fs.mkdirSync(out,{recursive:true});
 const {createServer}=await import(pathToFileURL(path.join(root,'frontend/node_modules/vite/dist/node/index.js')).href);
 const vite=await createServer({root:path.join(root,'frontend'),configFile:path.join(root,'frontend/vite.config.js'),logLevel:'error',server:{host:'localhost',port:5271,strictPort:true,proxy:{'/api':{target:base,changeOrigin:true}}}});
 let browser,page;const errors=[],responses=[];
 try{
  await vite.listen();browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const open=async user=>{const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'c4g_session_dev',value:decodeURIComponent(user.cookie.slice(user.cookie.indexOf('=')+1)),domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);const p=await context.newPage();p.setDefaultTimeout(90000);p.on('response',async r=>{if(new URL(r.url()).pathname.startsWith('/api/applications')){const body=await r.json().catch(()=>({}));responses.push({method:r.request().method(),path:new URL(r.url()).pathname,http:r.status(),state:body.status,revision:body.revision,error:body.error?.code})}});p.on('pageerror',e=>errors.push(e.message));return p};
  page=await open(userA);await page.goto(`http://localhost:5271/candidaturas?nova=1&oportunidade=${opportunityId}`);
  await page.getByLabel('Título',{exact:true}).fill('Candidatura de ensaio visual');await page.getByLabel('Responsável da organização').selectOption(userA.membershipId);await page.getByLabel('Prazo interno',{exact:true}).fill('2026-12-31');
  await page.getByLabel('Orçamento total da candidatura (EUR)',{exact:true}).fill('120000.67');await page.getByLabel('Orçamento afeto à organização (EUR)',{exact:true}).fill('0');await page.getByLabel('Notas',{exact:true}).fill('Preparar a candidatura com a equipa.\nConfirmar os documentos necessários.');
  await page.waitForFunction(()=>document.querySelector('button[type=submit]')?.disabled===false);
  for(const width of [1440,1008,390]){await page.setViewportSize({width,height:1000});if(width<769)await page.waitForFunction(()=>document.querySelector('#primary-navigation')?.getAttribute('aria-hidden')==='true');await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0)});await page.screenshot({path:path.join(out,`c4g-form-${width}.png`),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Form must fit viewport')}
  await page.setViewportSize({width:1440,height:1000});
  if(process.env.APPLICATION_LIFECYCLE_CAPTURE_ONLY==='1'){
   await page.getByText('Synthetic private 0',{exact:true}).waitFor();
   console.log('APPLICATION_FORM_TITLE_POSTGRES_CAPTURE_PASS');return;
  }
  let lost=false;await page.route('**/api/applications',async route=>{if(route.request().method()==='POST'&&!lost){lost=true;const r=await route.fetch();assert.equal(r.status(),201);return route.fulfill({status:503,contentType:'application/json',body:'{"error":{"code":"SERVICE_UNAVAILABLE"}}'})}return route.continue()});
  await page.getByRole('button',{name:'Criar candidatura',exact:true}).click();await page.getByRole('button',{name:'Repetir o mesmo envio'}).waitFor();await page.unroute('**/api/applications');await page.reload();await page.getByRole('button',{name:'Repetir o mesmo envio'}).click();
  await page.getByText('Estado: Identificada',{exact:false}).waitFor();const detail=page.url();await page.reload();await page.getByRole('button',{name:'Guardar alterações'}).waitFor();
  assert.equal(await page.getByLabel('Orçamento total da candidatura (EUR)',{exact:true}).inputValue(),'120000.67');assert.equal(await page.getByLabel('Orçamento afeto à organização (EUR)',{exact:true}).inputValue(),'0');
  await page.getByLabel('Orçamento afeto à organização (EUR)',{exact:true}).fill('45000.23');await page.getByRole('button',{name:'Guardar alterações'}).click();await page.getByText('Revisão 2',{exact:false}).first().waitFor();
  await page.getByLabel('Título da tarefa').fill('Preparar dossier');await page.getByLabel('Responsável da tarefa').selectOption(userA.membershipId);await page.getByLabel('Prazo da tarefa').fill('2026-12-20');await page.getByRole('button',{name:'Criar tarefa'}).click();await page.getByText('Preparar dossier',{exact:false}).first().waitFor();
  for(const [label,status] of [['Submetida','SUBMITTED'],['Em preparação','PREPARATION'],['Submetida','SUBMITTED'],['Aprovada','APPROVED']]){await page.getByLabel('Motivo',{exact:true}).fill('Registo confirmado no ensaio');const response=page.waitForResponse(r=>r.url().endsWith('/transitions')&&r.request().method()==='POST',{timeout:90000});await page.getByRole('button',{name:label,exact:true}).click();const r=await response;assert.equal(r.status(),200);assert.equal((await r.json()).status,status);await page.getByText(`Estado: ${label}`,{exact:false}).waitFor()}
  await page.reload();await page.getByText('Estado: Aprovada',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Em preparação',exact:true}).count(),0);assert.equal(await page.getByLabel('Orçamento afeto à organização (EUR)',{exact:true}).inputValue(),'45000.23');await page.getByText('Preparar dossier',{exact:false}).first().waitFor();
  for(const width of [1440,1008,390]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0)});await page.screenshot({path:path.join(out,`c4g-detail-${width}.png`),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Detail must fit viewport')}
  const other=await open(userB);await other.goto(detail);await other.getByRole('alert').waitFor();assert.equal(await other.getByLabel('Notas',{exact:true}).count(),0);
  await page.setViewportSize({width:1440,height:1000});await page.goto('http://localhost:5271/candidaturas');await page.getByRole('columnheader',{name:'Orç. total',exact:true}).waitFor();await page.screenshot({path:path.join(out,'c4g-list-1440.png'),fullPage:true});
  assert.equal(errors.length,0,JSON.stringify(errors));fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({result:'PASS',synthetic:true,postgres:true,newIdentified:true,fieldsReload:true,uncertainReplay:true,submitBacktrackApprove:true,tasksPreserved:true,isolation:true,widths:[1440,1008,390],pageErrors:errors},null,2));console.log('APPLICATION_LIFECYCLE_CHROME_POSTGRES_PASS');
 }catch(error){if(page){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});console.error('APPLICATION_BROWSER_RESPONSES',JSON.stringify(responses.slice(-18)));console.error('APPLICATION_BROWSER_STATE',(await page.locator('body').innerText()).slice(-2000))}throw error}
 finally{await browser?.close();await vite.close()}
}
module.exports={run};
