'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const {Pool}=require('../../../backend/node_modules/pg'),cfg=require('../../../backend/scripts/localPlatform/config');
const out=path.join(cfg.root,'output/playwright/c4g-funding-programmes');let stage='setup';
async function main(){
 const access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json'))),origin='http://localhost:3000';
 fs.mkdirSync(out,{recursive:true});const pool=new Pool(cfg.connection(cfg.readConfig(),'c4g_central_dev'));
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),errors=[],writes=[],runs=[];
 try{
  async function login(account){const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.name));
   await page.route('**/api/**',route=>{const r=route.request(),u=new URL(r.url());if(u.origin===origin&&!u.pathname.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(r.method())){if(r.method()!=='POST'||u.pathname!=='/api/admin/integrations/funding-tenders')return route.abort();const body=r.postDataJSON();assert(['EU_FUNDING_TENDERS','CORDIS','ERASMUS'].includes(body.source));writes.push(body.source)}return route.continue()});
   await page.goto(origin+'/login');await page.getByRole('button',{name:'Entrar na C4G',exact:true}).click();await page.locator('#username').fill(account.username);await page.locator('#password').fill(account.password);await page.locator('#kc-login').click();await page.waitForURL(u=>u.origin===origin&&u.pathname!=='/login');return page}
  stage='admin';const page=await login(access.admin);await page.goto(origin+'/integracoes');await page.getByText(/100 resultados/).first().waitFor();
  const status=()=>page.evaluate(async()=>{const r=await fetch('/api/admin/integrations/funding-tenders');if(!r.ok)throw Error('STATUS_FAILED');return r.json()});
  assert.deepEqual((await status()).collection,{sources:['EU_FUNDING_TENDERS','CORDIS','ERASMUS'],limits:{results:100,pageSize:25,pages:4}});
  assert.equal(await page.getByRole('button',{name:'Atualização indisponível'}).count(),2);
  if(!process.argv.includes('--read-only'))for(const [code,label]of [['EU_FUNDING_TENDERS','EU Funding & Tenders'],['CORDIS','CORDIS — Horizon Europe'],['ERASMUS','Erasmus+']]){
   stage='collect-'+code;const section=page.getByRole('region',{name:label,exact:true});
   let accepted;
   if(process.argv.includes('--resume'))accepted=(await status()).lastRuns.find(r=>r.source===code&&new Date(r.createdAt).getTime()>fs.statSync(path.join(cfg.root,'output/funding-programmes/local-upgrade.json')).mtimeMs);
   if(!accepted){const posted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/admin/integrations/funding-tenders'));
    await section.getByRole('button',{name:'Atualizar agora',exact:true}).click();const response=await posted;assert.equal(response.status(),202);accepted=await response.json();assert.equal(accepted.source,code)}
   let completed;for(let attempt=0;attempt<180;attempt++){const data=await status();completed=data.runs.find(r=>r.runId===accepted.runId);if(['SUCCESS','ERROR'].includes(completed?.status))break;await new Promise(resolve=>setTimeout(resolve,1000))}
   assert(['SUCCESS','ERROR'].includes(completed?.status));runs.push(completed);console.log('NATIVE_COLLECTION',code,completed.status,completed.received,completed.created,completed.updated,completed.errorCode||'');
   await page.reload();await page.getByText(/100 resultados/).first().waitFor();
  }
  stage='history';const data=await status();const stored=(await pool.query('SELECT run_id,source_code,result_count FROM opportunity_catalog.funding_run ORDER BY created_at DESC,run_id DESC LIMIT 100')).rows;
  assert.deepEqual(data.runs.map(r=>[r.runId,r.source,r.received]),stored.map(r=>[r.run_id,r.source_code,r.result_count]));
  assert.equal((await pool.query('SELECT count(*)::int n FROM (SELECT external_identifier FROM opportunity_catalog.funding_identity GROUP BY external_identifier HAVING count(*)>1) t')).rows[0].n,0);
  stage='responsive';for(const width of [1440,1008,390]){await page.setViewportSize({width,height:1000});const close=page.getByRole('button',{name:'Fechar menu',exact:true});if(width===390&&await close.isVisible())await close.click();await page.screenshot({path:path.join(out,'native-'+width+'.png'),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}
  stage='member';const member=await login(access.hugo);assert.equal(await member.evaluate(async()=>(await fetch('/api/admin/integrations/funding-tenders')).status),403);
  const catalog=await member.evaluate(async()=>{const r=await fetch('/api/central-opportunities');return {status:r.status,body:await r.json()}});assert.equal(catalog.status,200);assert(catalog.body.items.length>0);
  for(const item of catalog.body.items)assert.equal((await pool.query('SELECT count(*)::int n FROM opportunity_catalog.funding_identity WHERE opportunity_id=$1',[item.opportunityId])).rows[0].n,1);
  assert.equal(errors.length,0);assert(writes.length<=(process.argv.includes('--read-only')?0:3));
  const result={result:'PASS',realCollectionStatus:runs.every(r=>r.status==='SUCCESS')?'SUCCESS':'SOURCE_ERRORS',runs,historyMatchesDatabase:true,noDuplicateIdentity:true,memberDeniedAdministration:true,memberReadsCentralIdentity:true,widths:[1440,1008,390],pageErrors:errors};
  fs.writeFileSync(path.join(out,'native-verification.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(out,'history-reference.json'),JSON.stringify(data.runs,null,2));console.log('NATIVE_PROGRAMMES_UI_PASS');
 }finally{await browser.close();await pool.end()}
}
main().catch(e=>{console.error('NATIVE_PROGRAMMES_FAILED',stage,e.code||e.name,e.message?.slice(0,180));process.exitCode=1});
