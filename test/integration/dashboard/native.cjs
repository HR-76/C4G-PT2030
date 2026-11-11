'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright'),{Pool}=require('../../../backend/node_modules/pg');
const cfg=require('../../../backend/scripts/localPlatform/config'),{fingerprint}=require('../../../backend/scripts/localPlatform/officialSources');
const out=path.join(cfg.root,'output/playwright/c4g-dashboard');
async function verifyResponsiveDashboard(page,width){
 await page.setViewportSize({width,height:1000});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const layout=await page.evaluate(()=>{
  const rect=element=>{const box=element.getBoundingClientRect();return {top:box.top,bottom:box.bottom,width:box.width,height:box.height}};
  const stats=[...document.querySelectorAll('.dashboard-stats > .stat-item')],header=document.querySelector('.dashboard-grid .section-hd');
  return {
   overflow:document.documentElement.scrollWidth-innerWidth,
   stats:stats.map(item=>({rect:rect(item),display:getComputedStyle(item).display,paddingTop:getComputedStyle(item).paddingTop,borderTop:getComputedStyle(item).borderTopWidth,labelDisplay:getComputedStyle(item.querySelector('.stat-lbl')).display})),
   header:header?{direction:getComputedStyle(header).flexDirection,items:[...header.children].map(rect)}:null,
  };
 });
 assert.ok(layout.overflow<=1,`Dashboard overflow at ${width}px: ${layout.overflow}px`);
 assert.equal(layout.stats.length,4,`Dashboard must expose four KPI blocks at ${width}px`);
 assert.ok(layout.stats.every(item=>item.display==='flex'&&parseFloat(item.paddingTop)>=12&&item.labelDisplay==='block'),`KPI CSS contract failed at ${width}px`);
 if(width===1440){
  assert.ok(layout.stats.every(item=>Math.abs(item.rect.top-layout.stats[0].rect.top)<1),'Desktop KPI blocks must share one row');
 }else{
  assert.ok(layout.stats.slice(1).every((item,index)=>item.rect.top>=layout.stats[index].rect.bottom-1&&item.borderTop==='1px'),'Mobile KPI blocks must stack with separators');
  assert.equal(layout.header.direction,'row','Operational card header must remain horizontal on mobile');
  assert.ok(Math.max(...layout.header.items.map(item=>item.top))-Math.min(...layout.header.items.map(item=>item.top))<16,'Operational card header items must remain visually associated');
 }
 return layout;
}
async function main(){
 fs.mkdirSync(out,{recursive:true});
 const config=cfg.readConfig(),access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json'))),origin='http://localhost:3000';
 const central=new Pool(cfg.connection(config,config.centralDatabase)),tenant=new Pool(cfg.connection(config,config.tenantDatabase));
 const schemas=['opportunity_catalog','organizational_scope','organization_profile','document_storage'];
 const before={central:await fingerprint(central,['opportunity_catalog']),tenant:await fingerprint(tenant,schemas)};
 const errors=[],writes=[];const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.name));
  await page.route('**/api/**',route=>{const r=route.request(),u=new URL(r.url());if(!u.pathname.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(r.method())&&!(r.method()==='POST'&&u.pathname==='/api/notifications/check-deadlines')){writes.push(u.pathname);return route.abort()}return route.continue()});
  await page.goto(origin+'/login');const appLogin=page.getByRole('button',{name:'Entrar na C4G',exact:true});if(await appLogin.isVisible({timeout:3000}).catch(()=>false))await appLogin.click();await page.locator('#username').fill(access.hugo.username);await page.locator('#password').fill(access.hugo.password);await page.locator('#kc-login').click();await page.waitForURL(u=>u.origin===origin&&u.pathname!=='/login');
  await page.waitForLoadState('networkidle');
  const reportResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/applications/report');reportResponse.catch(()=>{});
  await page.goto(origin+'/dashboard');
  await page.getByRole('heading',{name:'Dashboard operacional'}).waitFor();assert.equal(await page.getByRole('alert').count(),0);
  const response=await reportResponse,report={status:response.status(),data:await response.json()};assert.equal(report.status,200);assert.equal(report.data.total,report.data.items.length);
  assert.equal(report.data.total,Number((await tenant.query('SELECT count(*)::int n FROM opportunity_catalog.application WHERE organization_id=$1',[report.data.organizationId])).rows[0].n));
  const responsiveLayout={};for(const width of [1440,390]){responsiveLayout[width]=await verifyResponsiveDashboard(page,width);await page.screenshot({path:path.join(out,`native-operational-${width}.png`),fullPage:true,animations:'disabled'});}
  await page.getByRole('button',{name:'Relatório da organização'}).click();await page.getByRole('heading',{name:'Relatório de candidaturas'}).waitFor();
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(out,`native-report-${width}.png`),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  const pendingDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar candidaturas para Excel'}).click();const download=await pendingDownload;
  assert.equal(download.suggestedFilename(),'relatorio-candidaturas-c4g.xlsx');
  await download.saveAs(path.join(out,'native-report.xlsx'));
  await page.reload();await page.getByRole('heading',{name:'Dashboard operacional'}).waitFor();assert.equal(await page.getByRole('alert').count(),0);
  assert.deepEqual(await fingerprint(central,['opportunity_catalog']),before.central);assert.deepEqual(await fingerprint(tenant,schemas),before.tenant);assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  fs.writeFileSync(path.join(out,'native-verification.json'),JSON.stringify({result:'PASS',observedAt:new Date().toISOString(),oidc:true,reportApplications:report.data.total,unitsAvailable:report.data.unitsAvailable,unitRows:report.data.units.length,realXlsx:true,businessDataUnchanged:true,widths:[1440,390],responsiveLayout,pageErrors:errors},null,2));console.log('DASHBOARD_NATIVE_OIDC_PASS');
 }finally{await browser.close();await central.end();await tenant.end()}
}
main().catch(e=>{console.error('DASHBOARD_NATIVE_FAILED',e.code||e.name,e.message?.slice(0,180));process.exitCode=1});
