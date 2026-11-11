'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../../frontend/test-harness/node_modules/playwright');
const cfg = require('../../../backend/scripts/localPlatform/config');
const out = path.join(cfg.root, 'output/playwright/c4g-clean');
const origin = 'http://localhost:3000';
const pages = ['/catalogo','/dashboard','/candidaturas','/parceiros','/matching','/notificacoes','/perfil-organizacao','/perfil-organizacao/unidades','/perfil-organizacao/pessoas','/utilizadores','/perfil','/conta/seguranca'];
(async () => {
 fs.mkdirSync(out, {recursive:true});
 const access = JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json')));
 const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const results = [];
 try {
  const page = await browser.newPage();
  await page.goto(origin);
  await page.locator('#username').fill(access.hugo.username);
  await page.locator('#password').fill(access.hugo.password);
  await page.locator('#kc-login').click();
  await page.waitForURL(origin+'/catalogo');
  await page.locator('.organization-context').waitFor();
  page.on('response', response=>{
   if(response.status()>=400 && response.url().startsWith(origin+'/api/')) console.log(response.status(),new URL(response.url()).pathname);
  });
  for(const route of pages){
   await page.evaluate(target=>{history.pushState(null,'',target);window.dispatchEvent(new PopStateEvent('popstate'));},route);
   await page.locator('.page-content h1,main h1,.page-content h2').first().waitFor({timeout:30000});
   await page.waitForLoadState('networkidle');
   if(route==='/catalogo') await page.locator('tbody tr').first().waitFor();
   for(const [width,height] of [[1920,1080],[1366,768],[820,1180],[390,844]]) {
    await page.setViewportSize({width,height});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const result=await page.evaluate(()=>{
     const title=document.querySelector('.page-content h1,main h1') || document.querySelector('.page-content h2');
     const table=document.querySelector('tbody');
     return {title:title?.textContent,color:title && getComputedStyle(title).color,brand:getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim(),overflow:document.documentElement.scrollWidth-innerWidth,rows:table?.rows?.length,alerts:document.querySelectorAll('[role=alert]').length};
    });
    await page.locator('#main-content').focus();
    await page.keyboard.press('Tab');
    result.focus=await page.evaluate(()=>document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineStyle!=='none');
    if(route==='/catalogo'){
     const trigger=page.locator('button.catalog-interest-heart:not(:disabled)').first();
     await trigger.waitFor(); await trigger.focus();
     await page.keyboard.press('Enter');
     const dialog=page.getByRole('dialog');
     await dialog.waitFor();
     let trapped=true;
     for(const key of ['Shift+Tab','Shift+Tab','Tab','Tab','Tab','Tab','Tab','Tab','Tab']){
      await page.keyboard.press(key);
      trapped &&= await dialog.evaluate(node=>node.contains(document.activeElement));
     }
     await page.keyboard.press('Escape');
     await dialog.waitFor({state:'hidden'});
     await page.waitForFunction(()=>document.activeElement?.matches('button.catalog-interest-heart'),{},{timeout:2000}); result.dialog=trapped && await trigger.evaluate(node=>node===document.activeElement);
    }
    if(route==='/catalogo') result.clippedCells=await page.locator('tbody td:visible').evaluateAll(cells=>cells.filter(cell=>cell.scrollWidth>cell.clientWidth+2).length);
    results.push({width,route,...result});
    fs.writeFileSync(path.join(out,'matrix.json'),JSON.stringify(results,null,2));
    console.log(width,route,result.color,result.overflow);
    if(route==='/catalogo') await page.evaluate(()=>{window.scrollTo(0,0);document.activeElement.blur()});
    if(route==='/catalogo') await page.screenshot({path:path.join(out,'catalogo-'+width+'.png')});
   }
  }
  // Exercise transient states without changing server data.
  await page.route(/\/central-opportunities\/?(?:\?|$)/, async route=>{
   await new Promise(resolve=>setTimeout(resolve,700));
   await route.fulfill({status:503,json:{}});
  });
  await page.evaluate(()=>{history.pushState(null,'','/catalogo?view=filtered&q=c4g-validation');window.dispatchEvent(new PopStateEvent('popstate'));});
  await page.getByText('A consultar oportunidades…',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Tentar novamente'}).waitFor();
  await page.unroute(/\/central-opportunities\/?(?:\?|$)/);
  await page.getByRole('button',{name:'Tentar novamente'}).click();
  await page.getByRole('heading',{name:'Sem resultados para estes filtros'}).waitFor();
  console.log('Loading, error, retry and empty states passed');
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
  const failures=results.filter(r=>r.overflow||r.color!=='rgb(52, 52, 52)'||!r.focus||r.dialog===false||r.clippedCells>0);
  if(failures.length) throw Error(JSON.stringify(failures));
 } finally {await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1});
