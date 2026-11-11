'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
async function run({base,admin,member,other}){
 const root=path.resolve(__dirname,'../../..'),out=path.join(root,'output/playwright/c4g-notices');fs.mkdirSync(out,{recursive:true});
 const {createServer}=await import(pathToFileURL(path.join(root,'frontend/node_modules/vite/dist/node/index.js')).href);
 const vite=await createServer({root:path.join(root,'frontend'),configFile:path.join(root,'frontend/vite.config.js'),logLevel:'error',server:{host:'localhost',port:5271,strictPort:true,proxy:{'/api':{target:base,changeOrigin:true}}}});
 let browser;const errors=[];
 try{
  await vite.listen();browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const open=async actor=>{const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'c4g_session_dev',value:decodeURIComponent(actor.cookie.slice(actor.cookie.indexOf('=')+1)),domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:5271/notificacoes');return page};
  const page=await open(admin);await page.getByText(/Nenhuma notifica\u00e7\u00e3o/).waitFor();await page.getByRole('button',{name:'Preparar aviso e consultar histórico'}).click();await page.getByRole('cell',{name:'Aviso de ensaio',exact:true}).first().waitFor();
  await page.getByLabel('Título',{exact:true}).fill('Reunião de acompanhamento das candidaturas');
  await page.getByLabel('Mensagem',{exact:true}).fill('A reunião da equipa realiza-se na sexta-feira, às 10h.\nPrepare os pontos de situação e os próximos prazos.');
  assert.equal(await page.getByLabel('Joana Equipa',{exact:true}).isChecked(),false);
  await page.getByLabel('Joana Equipa',{exact:true}).check();
  await page.evaluate(()=>{const p=document.createElement('p');p.textContent='ENSAIO — serviços reais e dados sintéticos num PostgreSQL descartável.';document.querySelector('main').prepend(p)});
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(out,`form-${width}.png`),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Rever aviso',exact:true}).click();
  await page.getByLabel('Rever aviso',{exact:true}).getByText('Organização: Synthetic',{exact:true}).waitFor();
  await page.screenshot({path:path.join(out,'preview-1440.png'),fullPage:true});
  assert.equal(await page.getByLabel('Rever aviso',{exact:true}).getByText('Joana Equipa',{exact:false}).count(),1);
  await page.getByRole('button',{name:'Confirmar e enviar aviso'}).click();await page.getByRole('status').filter({hasText:'Aviso enviado a 1 pessoa.'}).waitFor();
  await page.getByRole('cell',{name:'Reunião de acompanhamento das candidaturas',exact:true}).waitFor();
  const received=await open(member);await received.getByText('Reunião de acompanhamento das candidaturas',{exact:true}).waitFor();assert.equal(await received.getByRole('button',{name:'Preparar aviso e consultar histórico'}).count(),0);
  for(const width of [1440,390]){await received.setViewportSize({width,height:1000});await received.screenshot({path:path.join(out,`inbox-${width}.png`),fullPage:true,animations:'disabled'});assert(await received.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  await received.getByTitle('Marcar como lida').click();await received.getByTitle('Marcar como lida').waitFor({state:'detached'});await received.reload();await received.getByText('Reunião de acompanhamento das candidaturas',{exact:true}).waitFor();assert.equal(await received.locator('.notif-item.unread').count(),0);
  const otherPage=await open(other);await otherPage.getByText(/Nenhuma notificação/).waitFor();assert.equal(await otherPage.getByText('Reunião de acompanhamento das candidaturas',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'visual-verification.json'),JSON.stringify({result:'PASS',fixture:'REAL_HTTP_DISPOSABLE_POSTGRES',widths:[1440,390],explicitSelection:true,previewBeforeSend:true,history:true,memberWithoutApplicationGrants:true,readPersisted:true,secondOrganizationEmpty:true,pageErrors:errors},null,2));console.log('ORGANIZATION_NOTICES_BROWSER_PASS');
 }finally{await browser?.close();await vite.close()}
}
module.exports={run};
