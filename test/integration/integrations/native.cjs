'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const {Pool}=require('../../../backend/node_modules/pg');
const cfg=require('../../../backend/scripts/localPlatform/config');
const out=path.join(cfg.root,'output/playwright/c4g-integrations');let stage='setup';
async function main(){
 const state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json'))),access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json'))),config=cfg.readConfig();
 const origin='http://localhost:3000';assert.equal(state.identity.origin,origin);fs.mkdirSync(out,{recursive:true});
 const pool=new Pool(cfg.connection(config,config.centralDatabase));
 const fingerprint=async()=>{const values={};for(const table of ['opportunity_catalog.funding_run','opportunity_catalog.funding_identity','opportunity_catalog.opportunity','opportunity_catalog.revision'])values[table]=(await pool.query('SELECT count(*)::int AS count,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,\'[]\')) AS digest FROM '+table+' t')).rows[0];return values};
 const before=await fingerprint(),browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const writes=[],errors=[];
 try{
  async function login(account){
   const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.name));
   await page.route('**/api/**',route=>{const r=route.request(),url=new URL(r.url());if(url.origin===origin&&!url.pathname.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(r.method())){writes.push(url.pathname);return route.abort()}return route.continue()});
   await page.goto(origin+'/login');await page.getByRole('button',{name:'Entrar na C4G',exact:true}).click();await page.locator('#username').fill(account.username);await page.locator('#password').fill(account.password);await page.locator('#kc-login').click();await page.waitForURL(url=>url.origin===origin&&url.pathname!=='/login');return page;
  }
  stage='admin-login';const page=await login(access.admin);
  stage='admin-page';await page.goto(origin+'/integracoes');await page.getByRole('heading',{name:'Fontes de oportunidades',exact:true}).waitFor();await page.getByText(/Até cinco oportunidades por atualização/).waitFor();
  await page.waitForLoadState('networkidle');assert.equal(await page.getByRole('alert').count(),0);
  stage='history-api';const response=await page.evaluate(async()=>{const r=await fetch('/api/admin/integrations/funding-tenders');return {status:r.status,body:await r.json()}});assert.equal(response.status,200);assert(Array.isArray(response.body.runs));assert.equal(response.body.sourceMode,'live-local');
  const stored=(await pool.query('SELECT run_id,result_count FROM opportunity_catalog.funding_run ORDER BY created_at DESC,run_id DESC LIMIT 101')).rows;
  assert.deepEqual(response.body.runs.map(r=>[r.runId,r.received]),stored.slice(0,100).map(r=>[r.run_id,r.result_count]));assert.equal(response.body.runsLimited,stored.length>100);
  assert.equal(await page.getByRole('button',{name:'Atualização indisponível'}).count(),4);assert.equal(await page.getByRole('region',{name:'Histórico de sincronizações'}).getByRole('row').count(),1+response.body.runs.length);
  stage='responsive';for(const width of [1440,1280,1008,390]){await page.setViewportSize({width,height:1000});const close=page.getByRole('button',{name:'Fechar menu',exact:true});if(width===390&&await close.isVisible())await close.click();await page.screenshot({path:path.join(out,'native-'+width+'.png'),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}
  stage='keyboard';await page.getByRole('button',{name:'Consultar estado'}).focus();assert(await page.getByRole('button',{name:'Consultar estado'}).evaluate(el=>document.activeElement===el));await page.keyboard.press('Enter');await page.getByText(/Até cinco oportunidades por atualização/).waitFor();
  stage='member-denied';const member=await login(access.hugo);const denied=await member.evaluate(async()=>{const r=await fetch('/api/admin/integrations/funding-tenders');return r.status});assert.equal(denied,403);
  stage='preservation';assert.equal(writes.length,0);assert.equal(errors.length,0);assert.deepEqual(await fingerprint(),before);
  fs.writeFileSync(path.join(out,'history-reference.json'),JSON.stringify(response.body.runs,null,2));
  fs.writeFileSync(path.join(out,'native-verification.json'),JSON.stringify({result:'PASS',identity:'existing OIDC accounts',historyMatchesDatabase:true,historyCount:response.body.runs.length,memberDenied:true,businessDataUnchanged:true,businessWrites:writes,pageErrors:errors,widths:[1440,1280,1008,390],externalCollectionsTriggered:0},null,2));
  console.log('NATIVE_INTEGRATIONS_READ_PASS');
 }finally{await browser.close();await pool.end()}
}
main().catch(error=>{console.error('NATIVE_INTEGRATIONS_FAILED',stage,error.code||error.name);process.exitCode=1});
