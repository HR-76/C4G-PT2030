'use strict';
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
async function browserFlow({base,cookie,organizationA,organizationB,title,newTitle,expectedRevision}){
  const root=path.resolve(__dirname,'../../../frontend');
  const {createServer}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')).href);
  const vite=await createServer({root,configFile:path.join(root,'vite.config.js'),logLevel:'error',
    define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},
    server:{host:'localhost',port:5173,strictPort:true,proxy:{'/api':{target:base,changeOrigin:true}}}});
  let browser;
  try{
    await vite.listen();browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext();
    await context.addCookies([{name:'c4g_session_dev',value:decodeURIComponent(cookie.slice(cookie.indexOf('=')+1)),
      domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);
    const page=await context.newPage();
    const diagnostics=[];
    page.on('response',response=>{if(response.url().includes('/api/'))diagnostics.push({url:new URL(response.url()).pathname,status:response.status()});});
    page.on('pageerror',error=>diagnostics.push({browserError:error.message}));
    await page.goto('http://localhost:5173/oportunidades');
    await page.getByText('Selecione uma organização para consultar as suas oportunidades privadas.').waitFor();
    await page.getByLabel('Organização ativa').selectOption(organizationA);
    try { await page.getByRole('link',{name:title,exact:true}).click(); }
    catch(error) { throw new Error(`SYNTHETIC_BROWSER_LIST_FAILED: ${await page.locator('body').innerText()} ${JSON.stringify(diagnostics)}`,{cause:error}); }
    await page.getByRole('button',{name:'Editar',exact:true}).click();
    await page.getByLabel('Título',{exact:true}).fill(newTitle);
    await page.getByRole('button',{name:'Guardar',exact:true}).click();
    await page.getByRole('heading',{name:newTitle,exact:true}).waitFor();
    await page.getByText(`Revisão ${expectedRevision} · Versão CAS ${expectedRevision}`,{exact:true}).waitFor();
    await page.getByLabel('Organização ativa').selectOption(organizationB);
    await page.getByRole('link',{name:'Synthetic private 1',exact:true}).waitFor();
    if(await page.getByRole('link',{name:newTitle,exact:true}).count())throw new Error('BROWSER_CROSS_TENANT_RESULT');
    return{browser:'headless Chrome',organizationSelection:true,detail:true,CAS:true,persistedReread:true,switchAB:true,
      authenticatedSession:'synthetic Central fixture; external OIDC not exercised'};
  }finally{if(browser)await browser.close();await vite.close();}
}
async function browserCreationFlow({base,cookie,organizationA,organizationB,otherCookie}){
  const root=path.resolve(__dirname,'../../../frontend');
  const {createServer}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')).href);
  const vite=await createServer({root,configFile:path.join(root,'vite.config.js'),logLevel:'error',
    define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},server:{host:'localhost',port:5173,strictPort:true,proxy:{'/api':{target:base,changeOrigin:true}}}});
  let browser;
  try{
    await vite.listen();browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const open=async value=>{const context=await browser.newContext();await context.addCookies([{name:'c4g_session_dev',value:decodeURIComponent(value.slice(value.indexOf('=')+1)),domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);return context.newPage();};
    const page=await open(cookie),other=await open(otherCookie);
    await page.goto('http://localhost:5173/oportunidades');await page.getByLabel('Organização ativa').selectOption(organizationA);
    await page.getByRole('button',{name:'Criar oportunidade privada',exact:true}).click();
    await page.locator('form').getByLabel('Título',{exact:true}).fill('Synthetic browser created');await page.locator('form').getByLabel('Financiador',{exact:true}).fill('Synthetic browser funder');
    await page.getByRole('button',{name:'Criar',exact:true}).click();
    await page.getByRole('link',{name:'Synthetic browser created',exact:true}).click();
    const privateUrl=page.url();
    await page.getByRole('button',{name:'Editar',exact:true}).click();await page.getByLabel('Título',{exact:true}).fill('Synthetic browser created edited');
    await page.getByRole('button',{name:'Guardar',exact:true}).click();await page.getByText('Revisão 2 · Versão CAS 2',{exact:true}).waitFor();
    await other.goto(privateUrl);await other.getByRole('alert').filter({hasText:'Acesso recusado'}).waitFor();
    if(await other.getByRole('heading',{name:'Synthetic browser created edited',exact:true}).count())throw new Error('SECOND_USER_CROSS_TENANT_DETAIL');
    await other.goto('http://localhost:5173/oportunidades');await other.getByLabel('Organização ativa').selectOption(organizationB);
    await other.getByRole('table').waitFor();
    if(await other.getByRole('link',{name:'Synthetic browser created edited',exact:true}).count())throw new Error('SECOND_USER_CROSS_TENANT_LIST');
    await page.getByRole('button',{name:'Arquivar oportunidade',exact:true}).click();await page.getByRole('button',{name:'Arquivar',exact:true}).click();
    await page.getByText('Estado: ARCHIVED',{exact:true}).waitFor();await page.getByText('Revisão 3 · Versão CAS 3',{exact:true}).waitFor();
    await page.getByRole('link',{name:'Voltar às oportunidades',exact:true}).click();await page.getByRole('button',{name:'Criar oportunidade privada',exact:true}).waitFor();
    if(await page.getByRole('link',{name:'Synthetic browser created edited',exact:true}).count())throw new Error('ARCHIVED_IN_ACTIVE_LIST');
    await page.getByLabel('Lifecycle').selectOption('ARCHIVED');await page.getByRole('link',{name:'Synthetic browser created edited',exact:true}).click();
    await page.getByText('Estado: ARCHIVED',{exact:true}).waitFor();
    return{browser:'headless Chrome',users:2,createListOpenEditArchive:true,activeListExcludesArchive:true,authorizedArchivedRead:true,tenantBDetailAndListDenied:true,
      authenticatedSession:'synthetic Central fixture; external OIDC not exercised'};
  }finally{if(browser)await browser.close();await vite.close();}
}
module.exports={browserFlow,browserCreationFlow};
