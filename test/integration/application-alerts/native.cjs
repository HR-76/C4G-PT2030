'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright'),{Pool}=require('../../../backend/node_modules/pg');
const cfg=require('../../../backend/scripts/localPlatform/config'),{fingerprint}=require('../../../backend/scripts/localPlatform/officialSources');
const out=path.join(cfg.root,'output/playwright/c4g-alerts');
async function business(pool){const rows=await fingerprint(pool,['opportunity_catalog','organizational_scope','organization_profile','document_storage']);delete rows['"opportunity_catalog"."application_alert"'];return rows}
async function main(){
 const config=cfg.readConfig(),access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json'))),origin='http://localhost:3000';
 const central=new Pool(cfg.connection(config,config.centralDatabase)),tenant=new Pool(cfg.connection(config,config.tenantDatabase));
 const before={central:await fingerprint(central,['opportunity_catalog']),tenant:await business(tenant)};
 const beforeAlerts=(await tenant.query('SELECT count(*)::int n FROM opportunity_catalog.application_alert')).rows[0].n;
 const writes=[],errors=[];let status;
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.name));
  await page.route('**/api/**',route=>{const r=route.request(),u=new URL(r.url());if(u.origin===origin&&!u.pathname.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(r.method())&&!(r.method()==='POST'&&u.pathname==='/api/notifications/check-deadlines')){writes.push(u.pathname);return route.abort()}return route.continue()});
  await page.goto(origin+'/login');await page.getByRole('button',{name:'Entrar na C4G',exact:true}).click();await page.locator('#username').fill(access.hugo.username);await page.locator('#password').fill(access.hugo.password);await page.locator('#kc-login').click();await page.waitForURL(u=>u.origin===origin&&u.pathname!=='/login');
  await page.goto(origin+'/notificacoes');await page.getByRole('button',{name:'Atualizar alertas'}).waitFor();await page.waitForFunction(()=>!document.body.textContent.includes('A carregar...'));
  status=await page.evaluate(async()=>{const r=await fetch('/api/notifications');const body=await r.json();return{status:r.status,count:body.total,unread:body.unread_count}});assert.equal(status.status,200);
  assert.equal(await page.getByRole('alert').count(),0);
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(out,`native-${width}.png`),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/candidaturas');await page.getByRole('heading',{name:'Candidaturas',exact:true}).first().waitFor();await page.goto(origin+'/perfil-organizacao/pessoas');await page.getByRole('heading',{name:/Pessoas/}).first().waitFor();
  assert.deepEqual(await fingerprint(central,['opportunity_catalog']),before.central);assert.deepEqual(await business(tenant),before.tenant);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  const afterAlerts=(await tenant.query('SELECT count(*)::int n FROM opportunity_catalog.application_alert')).rows[0].n;
  fs.writeFileSync(path.join(out,'native-verification.json'),JSON.stringify({result:'PASS',observedAt:new Date().toISOString(),oidc:true,ordinaryMember:true,status,widths:[1440,390],businessDataUnchanged:true,alertsCreatedByOwnDeadlineRefresh:afterAlerts-beforeAlerts,forbiddenWrites:writes,pageErrors:errors},null,2));console.log('ALERTS_NATIVE_OIDC_READ_REFRESH_PASS');
 }finally{await browser.close();await central.end();await tenant.end()}
}
main().catch(e=>{console.error('ALERTS_NATIVE_FAILED',e.code||e.name,e.message?.slice(0,150));process.exitCode=1});
