'use strict';
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
async function run({base,manager,other,reader,unit}){
 const root=path.resolve(__dirname,'../../..'),folder=path.join(root,'context/reviews/organization-profile-recovery');fs.mkdirSync(folder,{recursive:true});
 const {preview}=await import(pathToFileURL(path.join(root,'frontend/node_modules/vite/dist/node/index.js')).href);
 // Production assets prevent editor/HMR refreshes from discarding an open form.
 const vite=await preview({root:path.join(root,'frontend'),configFile:path.join(root,'frontend/vite.config.js'),logLevel:'error',
  preview:{host:'localhost',port:5271,strictPort:true,proxy:{'/api':{target:base,changeOrigin:true}}}});
 let browser;const errors=[],responses=[];
 try{browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  async function open(user){const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'c4g_session_dev',value:decodeURIComponent(user.cookie.slice(user.cookie.indexOf('=')+1)),domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);return context.newPage()}
  const page=await open(manager);page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().includes('/api/organization-directory'))responses.push({path:new URL(r.url()).pathname,status:r.status()})});
  await page.goto('http://localhost:5271/perfil-organizacao');await page.getByRole('button',{name:'Editar dados'}).waitFor({timeout:20000});
  await page.getByRole('button',{name:'Editar dados'}).click();await page.getByLabel('Descrição',{exact:true}).fill('Organização C4G — prova sintética da interface');await page.getByRole('button',{name:'Guardar alterações'}).click();await page.getByRole('button',{name:'Editar dados'}).waitFor();await page.locator('dd').filter({hasText:'Organização C4G — prova sintética da interface'}).waitFor();
  await page.screenshot({path:path.join(folder,'organization-desktop.png'),fullPage:true});
  await page.getByRole('link',{name:'Departamentos / Unidades',exact:true}).click();await page.getByRole('button',{name:'Criar unidade',exact:true}).click();
  await page.getByLabel('Nome da unidade').fill('Comunicação');assert.equal(await page.getByLabel('Unidade superior',{exact:true}).count(),0);await page.getByRole('button',{name:'Guardar alterações'}).click();await page.getByText('Comunicação',{exact:true}).waitFor();
  await page.screenshot({path:path.join(folder,'units-desktop.png'),fullPage:true});
  await page.getByRole('link',{name:'Pessoas',exact:true}).click();await page.getByRole('button',{name:'Registar pessoa'}).click();await page.getByLabel('Nome da pessoa').fill('Pessoa UI sintética');await page.getByLabel('Email (opcional)',{exact:true}).fill('interface@example.invalid');await page.getByLabel('Função (opcional)').fill('Comunicação');await page.getByRole('checkbox',{name:'Comunicação',exact:true}).check();
  let lost=false;await page.route('**/api/organization-directory/people',async route=>{if(route.request().method()==='POST'&&!lost){lost=true;const response=await route.fetch();assert.equal(response.status(),201);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE'}})});return}await route.continue()});
  await page.getByRole('button',{name:'Guardar alterações'}).click();await page.getByRole('button',{name:'Repetir o mesmo envio'}).waitFor();await page.unroute('**/api/organization-directory/people');await page.reload();await page.getByRole('button',{name:'Repetir o mesmo envio'}).click();
  await page.getByRole('button',{name:'Editar Pessoa UI sintética'}).waitFor();assert.equal(await page.getByRole('button',{name:'Editar Pessoa UI sintética'}).count(),1);
  await page.getByLabel('Pesquisar',{exact:true}).fill('Pessoa UI');
  const filtered=page.waitForResponse(r=>r.request().method()==='GET'&&r.url().includes('/organization-directory/people?')&&r.url().includes('search=Pessoa'));
  await page.getByRole('button',{name:'Filtrar',exact:true}).click();await (await filtered).finished();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Filtrar'&&!b.disabled));await page.getByRole('button',{name:'Editar Pessoa UI sintética'}).waitFor();
  await page.screenshot({path:path.join(folder,'people-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>{const nav=document.getElementById('primary-navigation');return nav?.getAttribute('aria-hidden')==='true'&&getComputedStyle(nav).visibility==='hidden'&&nav.getBoundingClientRect().right<=1});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(folder,'people-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Editar Pessoa UI sintética'}).click();await page.getByLabel('Estado da pessoa').selectOption('false');await page.getByRole('button',{name:'Guardar alterações'}).click();await page.getByRole('heading',{name:'Nenhuma pessoa encontrada'}).waitFor();
  await page.getByLabel('Estado',{exact:true}).selectOption('INACTIVE');await page.getByRole('button',{name:'Filtrar',exact:true}).click();await page.getByRole('button',{name:'Editar Pessoa UI sintética'}).waitFor();
  const view=await open(reader);await view.goto('http://localhost:5271/perfil-organizacao/pessoas');await view.getByText('Acesso de consulta.',{exact:false}).waitFor();assert.equal(await view.getByRole('button',{name:'Registar pessoa'}).count(),0);
  const isolated=await open(other);await isolated.goto('http://localhost:5271/perfil-organizacao/pessoas');await isolated.getByRole('heading',{name:'Nenhuma pessoa encontrada'}).waitFor();assert.equal(await isolated.getByText('Pessoa UI sintética',{exact:true}).count(),0);
  assert.equal(errors.length,0);assert(!/\bUBI\b|Universidade da Beira/i.test(await page.locator('body').innerText()));
  fs.writeFileSync(path.join(folder,'browser-verification.json'),JSON.stringify({result:'PASS',synthetic:true,realPostgres:true,identityProvider:'session fixture',organizationEdit:true,unitHierarchy:true,personCreateEdit:true,reloadAndIdempotency:true,reader:true,tenantIsolation:true,mobile390:true,pageErrors:errors,responses},null,2));
  console.log('DIRECTORY_CHROME_PASS');
 }catch(error){if(browser){const page=browser.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:path.join(folder,'browser-failure.png'),fullPage:true});console.error('DIRECTORY_BROWSER_STATE',(await page.locator('body').innerText()).slice(-1800),responses.slice(-10));}}throw error}
 finally{await browser?.close();await new Promise(resolve=>vite.httpServer.close(resolve))}
}
module.exports={run};
