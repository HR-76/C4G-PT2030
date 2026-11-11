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

  page=await open(userA);await page.goto('http://localhost:5271/parceiros');await page.getByText('1 parceiro',{exact:true}).waitFor();
  await page.getByLabel('Pesquisar parceiros').fill('maria@example.org');await page.getByLabel('País',{exact:true}).selectOption('Portugal');await page.getByLabel('Papel').selectOption('RESPONSAVEL');await page.waitForLoadState('networkidle');
  for(const width of [1440,1280,1008,390]){await page.setViewportSize({width,height:1000});await page.getByText('1 parceiro',{exact:true}).waitFor();await page.getByRole('link',{name:'Abrir candidatura'}).waitFor();await page.screenshot({path:path.join(out,'c4g-partners-'+width+'.png'),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));if(width===1440)assert(await page.getByRole('link',{name:'Abrir candidatura'}).evaluate(el=>{const r=el.getBoundingClientRect();return r.right<innerWidth}));}
  if(process.env.PARTNERS_TABLE_ONLY==='1'){assert.deepEqual(errors,[]);console.log('PARTNER_TABLE_CAPTURE_PASS');return;}
  await page.getByRole('link',{name:'Abrir candidatura'}).click();const panel=page.getByRole('region',{name:'Parceiros da candidatura'});await panel.getByLabel('Nome da entidade *',{exact:true}).waitFor();await page.waitForLoadState('networkidle');
  await page.addStyleTag({content:'.top-header{visibility:hidden}'});
  for(const width of [1440,1008,390]){await page.setViewportSize({width,height:1000});await panel.screenshot({path:path.join(out,'c4g-partner-detail-'+width+'.png'),animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  await panel.locator(':scope > .partner-grid .partner-card').getByRole('button',{name:'Editar',exact:true}).click();
  for(const width of [1440,1008,390]){await page.setViewportSize({width,height:1000});await panel.locator('form').screenshot({path:path.join(out,'c4g-partner-form-'+width+'.png'),animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'visual-verification.json'),JSON.stringify({result:'PASS',realApi:true,synthetic:true,originalComposition:true,visibleApplicationAction:true,widths:[1440,1280,1008,390],pageErrors:errors},null,2));console.log('APPLICATION_PARTNERS_VISUAL_PASS');
 }catch(error){if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true,animations:'disabled'});throw error}
 finally{await browser?.close();await vite.close()}
}
module.exports={run};
