'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
async function run({base,admin,userA,userB,opportunityId,worker}) {
 const root=path.resolve(__dirname,'../../../frontend');const {createServer}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')).href);
 const vite=await createServer({root,configFile:path.join(root,'vite.config.js'),logLevel:'error',define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},server:{host:'localhost',port:5188,strictPort:true,proxy:{'/api':{target:base,changeOrigin:true}}}});
 let browser;
 try {
  await vite.listen();browser=await chromium.launch({headless:process.env.FUNDING_DEMO_HOLD!=='1',executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  async function open(actor){const context=await browser.newContext({reducedMotion:'reduce'});await context.addCookies([{name:'c4g_session_dev',value:decodeURIComponent(actor.cookie.slice(actor.cookie.indexOf('=')+1)),domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);return context.newPage()}
  const page=await open(admin),a=await open(userA),b=await open(userB);
  const output=path.resolve(__dirname,'../../../context/reviews/c4g-delivery-2');require('node:fs').mkdirSync(output,{recursive:true});
  await page.goto('http://localhost:5188/integracoes');await page.getByRole('heading',{name:'ADMIN · Fontes de oportunidades'}).waitFor();
  await page.getByRole('button',{name:'Atualizar agora',exact:true}).click();await page.getByRole('button',{name:'Atualização em curso',exact:true}).waitFor();
  await worker.runOnce();await page.getByRole('button',{name:'Atualizar agora',exact:true}).waitFor({timeout:10000});
  await a.setViewportSize({width:1440,height:1000});
  await a.goto('http://localhost:5188/catalogo');await a.getByRole('link',{name:'Funding fixture shared A/B',exact:true}).waitFor();
  await a.getByText('Ambiente de teste · dados sintéticos',{exact:true}).waitFor();
  await a.screenshot({path:path.join(output,'catalog-desktop.png'),fullPage:true});
  await a.getByLabel('Pesquisar',{exact:true}).fill('absent');await a.getByRole('button',{name:'Pesquisar',exact:true}).click();
  await a.getByText('Sem resultados para estes filtros',{exact:true}).waitFor();
  await a.getByRole('button',{name:'Limpar filtros',exact:true}).click();await a.getByRole('link',{name:'Funding fixture shared A/B',exact:true}).waitFor();
  await a.setViewportSize({width:390,height:844});await a.locator('.sidebar').waitFor({state:'hidden'});
  await a.screenshot({path:path.join(output,'catalog-mobile.png'),fullPage:true});
  assert(await a.locator('.data-table').evaluate(e=>e.getBoundingClientRect().right<=window.innerWidth));
  assert(await a.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  for(const client of [a,b]){await client.goto(`http://localhost:5188/catalogo/${opportunityId}`);await client.getByRole('heading',{name:'Funding fixture shared A/B'}).waitFor();}
  await a.screenshot({path:path.join(output,'detail-mobile.png'),fullPage:true});
  assert(await a.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await a.getByRole('link',{name:'Criar candidatura nesta organização'}).click();
  await a.getByLabel('Título',{exact:true}).fill('Browser private funding A');await a.getByLabel('Responsável da organização').selectOption(userA.membershipId);await a.getByLabel('Prazo').fill('2027-11-30');
  await a.getByRole('button',{name:'Criar candidatura',exact:true}).click();
  await a.getByRole('heading',{name:'Candidatura',exact:true}).waitFor({timeout:15000});const url=a.url();
  await b.goto(url);await b.getByRole('alert').waitFor();assert(!(await b.locator('body').innerText()).includes('Browser private funding A'));
  console.log('FUNDING_BROWSER_PASS: platform ADMIN update, shared catalog A/B, tenant application creation and denial');
  if(process.env.FUNDING_DEMO_HOLD==='1'){
    await worker.start();
    await b.goto(`http://localhost:5188/catalogo/${opportunityId}`);
    console.log('Demo local em http://localhost:5188: três contextos Chrome separados, ADMIN /integracoes, cliente A /candidaturas e cliente B /catalogo. Fechar o Chrome termina a demo e remove apenas as bases descartáveis.');
    await new Promise(resolve=>browser.once('disconnected',resolve));
  }
 } finally {await browser?.close();await vite.close()}
}
module.exports={run};
