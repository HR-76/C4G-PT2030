'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const {readFile,utils}=require('../../../backend/node_modules/xlsx');
async function verifyResponsiveDashboard(page,width){
 await page.setViewportSize({width,height:1000});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const layout=await page.evaluate(()=>{
  const rect=element=>{const box=element.getBoundingClientRect();return {top:box.top,bottom:box.bottom,left:box.left,right:box.right,width:box.width,height:box.height}};
  const stats=[...document.querySelectorAll('.dashboard-stats > .stat-item')];
  const metric=document.querySelector('.metric-row'),fill=metric?.querySelector('.metric-bar > i');
  const list=document.querySelector('.dashboard-list'),header=document.querySelector('.dashboard-grid .section-hd');
  return {
   overflow:document.documentElement.scrollWidth-innerWidth,
   stats:stats.map(item=>({rect:rect(item),display:getComputedStyle(item).display,paddingTop:getComputedStyle(item).paddingTop,borderTop:getComputedStyle(item).borderTopWidth,labelDisplay:getComputedStyle(item.querySelector('.stat-lbl')).display})),
   metric:metric&&fill?{fillDisplay:getComputedStyle(fill).display,fillRect:rect(fill)}:null,
   list:list?{style:getComputedStyle(list).listStyleType,paddingLeft:getComputedStyle(list).paddingLeft}:null,
   header:header?{direction:getComputedStyle(header).flexDirection,items:[...header.children].map(rect)}:null,
  };
 });
 assert.ok(layout.overflow<=1,`Dashboard overflow at ${width}px: ${layout.overflow}px`);
 assert.equal(layout.stats.length,4,`Dashboard must expose four KPI blocks at ${width}px`);
 assert.ok(layout.stats.every(item=>item.display==='flex'&&parseFloat(item.paddingTop)>=12&&item.labelDisplay==='block'),`KPI CSS contract failed at ${width}px`);
 assert.ok(layout.metric&&layout.metric.fillDisplay==='block'&&layout.metric.fillRect.width>0&&layout.metric.fillRect.height>0,`Pipeline bar is not visible at ${width}px`);
 assert.deepEqual(layout.list,{style:'none',paddingLeft:'0px'},`Dashboard list reset failed at ${width}px`);
 if(width===1440){
  assert.ok(layout.stats.every(item=>Math.abs(item.rect.top-layout.stats[0].rect.top)<1),'Desktop KPI blocks must share one row');
 }else{
  assert.ok(layout.stats.slice(1).every((item,index)=>item.rect.top>=layout.stats[index].rect.bottom-1&&item.borderTop==='1px'),'Mobile KPI blocks must stack with separators');
  assert.equal(layout.header.direction,'row','Operational card header must remain horizontal on mobile');
  assert.ok(Math.max(...layout.header.items.map(item=>item.top))-Math.min(...layout.header.items.map(item=>item.top))<16,'Operational card header items must remain visually associated');
 }
 return layout;
}
async function run({base,manager,userB}){
 const root=path.resolve(__dirname,'../../..'),out=path.join(root,'output/playwright/c4g-dashboard');fs.mkdirSync(out,{recursive:true});
 const {createServer}=await import(pathToFileURL(path.join(root,'frontend/node_modules/vite/dist/node/index.js')).href);
 const vite=await createServer({root:path.join(root,'frontend'),configFile:path.join(root,'frontend/vite.config.js'),logLevel:'error',server:{host:'localhost',port:5271,strictPort:true,proxy:{'/api':{target:base,changeOrigin:true}}}});
 let browser,page;const errors=[];
 try{
  await vite.listen();browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const open=async user=>{
   const ctx=await browser.newContext({viewport:{width:1440,height:1000}});await ctx.addCookies([{name:'c4g_session_dev',value:decodeURIComponent(user.cookie.slice(user.cookie.indexOf('=')+1)),domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);
   const p=await ctx.newPage();p.setDefaultTimeout(45000);p.on('pageerror',e=>errors.push(e.message));
   // This isolated fixture has no central-catalog provider; ONLY that public endpoint is simulated.
   await p.route('**/api/central-opportunities*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[{opportunityId:'public-fixture',title:'Oportunidade pública de ensaio',source:'POCTEP',lifecycleState:'ACTIVE',closingDate:'2099-12-31'}],nextCursor:null})}));
   return p;
  };
  page=await open(manager);await page.goto('http://localhost:5271/dashboard');await page.getByRole('heading',{name:'Dashboard operacional'}).waitFor();assert.equal(await page.getByRole('alert').count(),0);
  await page.getByText('50%',{exact:true}).waitFor();await page.getByText(/em atraso/).waitFor();
  const responsiveLayout={};for(const width of [1440,390]){responsiveLayout[width]=await verifyResponsiveDashboard(page,width);await page.screenshot({path:path.join(out,`operational-${width}.png`),fullPage:true,animations:'disabled'});}
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Relatório da organização'}).click();await page.getByRole('cell',{name:'Departamento de Projetos',exact:true}).waitFor();
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(out,`units-${width}.png`),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Por estado',exact:true}).click();await page.screenshot({path:path.join(out,'states-1440.png'),fullPage:true});
  await page.getByRole('button',{name:'Candidaturas',exact:true}).click();assert.equal(await page.locator('tbody tr').count(),32);await page.screenshot({path:path.join(out,'applications-1440.png'),fullPage:true});
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar candidaturas para Excel'}).click();const download=await downloadPromise;
  assert.equal(download.suggestedFilename(),'relatorio-candidaturas-c4g.xlsx');
  const reportPath=path.join(out,'synthetic-report.xlsx');await download.saveAs(reportPath);
  const rows=utils.sheet_to_json(readFile(reportPath).Sheets.Candidaturas,{header:1});
  assert(rows.some(row=>row[7]==='99999999999999.99'));
  const other=await open(userB);await other.goto('http://localhost:5271/dashboard');await other.getByRole('heading',{name:'Dashboard operacional'}).waitFor();await other.getByRole('button',{name:'Relatório da organização'}).click();await other.getByRole('button',{name:'Candidaturas',exact:true}).click();await other.getByText('Sem candidaturas acessíveis.',{exact:true}).waitFor();assert.equal(await other.locator('tbody tr').count(),0);
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'browser-verification.json'),JSON.stringify({result:'PASS',synthetic:true,applicationAndDirectoryApi:'real PostgreSQL/HTTP',centralCatalog:'explicit public fixture',widths:[1440,390],responsiveLayout,reportRows:32,xlsxDownload:true,otherOrganizationEmpty:true,pageErrors:errors},null,2));console.log('DASHBOARD_CHROME_PASS');
 }catch(error){if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw error}
 finally{await browser?.close();await vite.close()}
}
module.exports={run};
