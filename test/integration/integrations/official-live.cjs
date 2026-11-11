'use strict';
// Authorized real collections through the native OIDC UI. No legacy sync.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const {Pool}=require('../../../backend/node_modules/pg'),cfg=require('../../../backend/scripts/localPlatform/config');
const {fingerprint}=require('../../../backend/scripts/localPlatform/officialSources');
const {createOfficialSource}=require('../../../backend/src/fundingTenders/officialSources');
const {FIELDS}=require('../../../backend/src/fundingTenders/merge');
const out=path.join(cfg.root,'output/playwright/c4g-official-live'),proofDir=path.join(cfg.root,'output/interreg-poctep');let stage='setup';
async function main(){
 const config=cfg.readConfig(),access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json'))),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));
 const before=JSON.parse(fs.readFileSync(path.join(proofDir,'live-baseline.json'))),readiness=JSON.parse(fs.readFileSync(path.join(proofDir,'corrected-live-read.json')));
 assert(readiness.results.every(r=>r.status==='PASS'));assert(Date.now()-Date.parse(readiness.observedAt)<30*60000);
 const heartbeat=JSON.parse(fs.readFileSync(path.join(cfg.folder,'funding-worker-heartbeat.json')));assert.equal(heartbeat.mode,'PROCESSING');assert(Date.now()-heartbeat.at<10000);
 const pool=new Pool(cfg.connection(config,config.centralDatabase)),tenant=new Pool(cfg.connection(config,config.tenantDatabase));fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),errors=[],writes=[],runs=[],origin='http://localhost:3000';
 try{
  async function login(account){const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.name));
   await page.route('**/api/**',route=>{const r=route.request(),u=new URL(r.url());if(u.origin===origin&&!u.pathname.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(r.method())){if(r.method()!=='POST'||u.pathname!=='/api/admin/integrations/funding-tenders')return route.abort();const b=r.postDataJSON();assert(['POCTEP','INTERREG_EUROPE'].includes(b.source));writes.push(b.source);}return route.continue();});
   await page.goto(origin+'/login');await page.getByRole('button',{name:'Entrar na C4G',exact:true}).click();await page.locator('#username').fill(account.username);await page.locator('#password').fill(account.password);await page.locator('#kc-login').click();await page.waitForURL(u=>u.origin===origin&&u.pathname!=='/login');return page;}
  stage='admin-login';const page=await login(access.admin);await page.goto(origin+'/integracoes');await page.getByText(/100 resultados/).first().waitFor();
  const status=()=>page.evaluate(async()=>{const r=await fetch('/api/admin/integrations/funding-tenders');if(!r.ok)throw Error('STATUS_FAILED');return r.json();});
  const sequence=[['INTERREG_EUROPE','Interreg Europe'],['POCTEP','Interreg POCTEP'],['INTERREG_EUROPE','Interreg Europe'],['POCTEP','Interreg POCTEP']];
  const progressFile=path.join(proofDir,'live-import-journal.json');let journal=fs.existsSync(progressFile)?JSON.parse(fs.readFileSync(progressFile)):[];
  for(let index=0;index<sequence.length;index++){
   const [source,label]=sequence[index];stage=`collect-${index+1}-${source}`;
   let accepted=journal[index];
   if(!accepted){
    // Recover a response lost by the harness before recording the accepted ID.
    const fresh=(await status()).runs.filter(r=>Date.parse(r.createdAt)>=Date.parse(before.preparedAt)).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt));
    assert(fresh.length<=sequence.length);if(fresh[index]){assert.equal(fresh[index].source,source);accepted=fresh[index];}
   }
   if(!accepted){const responsePromise=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/admin/integrations/funding-tenders'));
    await page.getByRole('region',{name:label,exact:true}).getByRole('button',{name:'Atualizar agora',exact:true}).click();const response=await responsePromise;assert.equal(response.status(),202);accepted=await response.json();}
   assert.equal(accepted.source,source);journal[index]=accepted;fs.writeFileSync(progressFile,JSON.stringify(journal,null,2));
   let completed;for(let i=0;i<180;i++){completed=(await status()).runs.find(r=>r.runId===accepted.runId);if(['SUCCESS','ERROR'].includes(completed?.status))break;await new Promise(r=>setTimeout(r,1000));}
   journal[index]=completed;fs.writeFileSync(progressFile,JSON.stringify(journal,null,2));assert.equal(completed?.status,'SUCCESS');assert.equal(completed.failed,0);runs.push(completed);
   console.log('REAL_COLLECTION',index+1,source,completed.status,'received',completed.received,'created',completed.created,'updated',completed.updated,'unchanged',completed.unchanged);
   await page.reload();await page.getByText(/100 resultados/).first().waitFor();
  }
  assert.deepEqual(runs.map(r=>r.created),[0,2,0,0]);assert.deepEqual(runs.map(r=>r.updated),[0,0,0,0]);assert.equal(runs[3].unchanged,2);
  stage='public-recheck';const source=createOfficialSource({fetchImpl:globalThis.fetch});const confirmed=[];
  for(const code of ['INTERREG_EUROPE','POCTEP'])confirmed.push({source:code,...await source.collect({source:code})});
  assert.equal(confirmed[0].records.length,0);assert.equal(confirmed[1].records.length,2);
  stage='stored-fields';const stored=[];
  for(const expected of confirmed[1].records){
   const row=(await pool.query('SELECT f.*,r.snapshot,o.current_revision_id FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id) JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id WHERE f.external_identifier=$1',[expected.externalIdentifier])).rows[0];assert(row);assert.deepEqual(row.last_source_fields,expected.fields);
   assert.deepEqual(Object.fromEntries(FIELDS.filter(k=>Object.hasOwn(row.snapshot,k)).map(k=>[k,row.snapshot[k]])),expected.fields);
   const observations=(await pool.query('SELECT run_id,revision_id FROM opportunity_catalog.funding_observation WHERE opportunity_id=$1',[row.opportunity_id])).rows;assert.equal(observations.length,2);assert.equal(new Set(observations.map(x=>x.revision_id)).size,1);
   const provenance=(await pool.query('SELECT source_type,source_namespace,external_identifier FROM opportunity_catalog.provenance WHERE opportunity_id=$1',[row.opportunity_id])).rows;assert.deepEqual(provenance,[{source_type:'OFFICIAL_PROGRAMME',source_namespace:'POCTEP',external_identifier:expected.externalIdentifier}]);
   stored.push({opportunityId:row.opportunity_id,revisionId:row.current_revision_id,externalIdentifier:expected.externalIdentifier,fields:expected.fields,observationCount:2});
  }
  stage='preservation';for(const [table,hashes]of Object.entries(before.hashes)){
   const now=(await pool.query(`SELECT to_jsonb(t)::text row FROM opportunity_catalog.${cfg.identifier(table)} t`)).rows;const set=new Set(now.map(r=>createHash('sha256').update(r.row).digest('hex')));assert(hashes.every(h=>set.has(h)),`Prior rows changed: ${table}`);
  }
  assert.deepEqual(await fingerprint(tenant,['opportunity_catalog','organizational_scope','organizational_profile']),before.tenantHash);
  const counts=(await pool.query("SELECT (SELECT count(*)::int FROM opportunity_catalog.funding_identity) identities,(SELECT count(*)::int FROM opportunity_catalog.funding_run) runs,(SELECT count(*)::int FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING')) active")).rows[0];assert.equal(counts.identities,before.identities+2);assert.equal(counts.runs,before.runs+4);assert.equal(counts.active,0);
  const history=await status(),dbHistory=(await pool.query('SELECT run_id,source_code,result_count FROM opportunity_catalog.funding_run ORDER BY created_at DESC,run_id DESC LIMIT 100')).rows;
  assert.deepEqual(history.runs.map(r=>[r.runId,r.source,r.received]),dbHistory.map(r=>[r.run_id,r.source_code,r.result_count]));
  async function capture(page,name,width){await page.setViewportSize({width,height:1000});const close=page.getByRole('button',{name:'Fechar menu',exact:true});if(width===390&&await close.isVisible())await close.click();await page.waitForLoadState('networkidle');await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('main')?.scrollTo(0,0)});await page.screenshot({path:path.join(out,`${name}-${width}.png`),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  stage='history-ui';for(const width of [1440,390])await capture(page,'sources',width);
  stage='member-catalog';const member=await login(access.hugo);assert.equal(await member.evaluate(async()=>(await fetch('/api/admin/integrations/funding-tenders')).status),403);
  const read=async route=>{const result=await member.evaluate(async({route,organization})=>{const r=await fetch(route,{headers:{'X-C4G-Organization':organization}});return{status:r.status,body:await r.json()};},{route,organization:state.organizationId});assert.equal(result.status,200);return result.body;};
  const list=await read('/api/central-opportunities?programme=POCTEP');assert.equal(list.items.length,2);assert(list.items.every(x=>x.source==='POCTEP'));
  await member.goto(origin+'/catalogo?view=filtered&period=all&programme=POCTEP');for(const row of stored)await member.getByRole('link',{name:row.fields.title,exact:true}).waitFor();
  assert.equal(await member.locator('td[data-label="Fonte"]').filter({hasText:'POCTEP'}).count(),2);await capture(member,'poctep-list',1440);
  for(const row of stored){stage='detail-'+row.externalIdentifier;const detail=await read('/api/central-opportunities/'+row.opportunityId);assert.equal(detail.source,'POCTEP');assert.equal(detail.revisionId,row.revisionId);
   await member.goto(origin+'/catalogo/'+row.opportunityId);await member.getByRole('heading',{name:row.fields.title,exact:true}).waitFor();await member.getByRole('link',{name:'Registar interesse',exact:true}).waitFor();assert.equal(await member.getByRole('link',{name:'Consultar fonte oficial',exact:true}).getAttribute('href'),row.fields.officialUrl);
   await member.getByRole('button',{name:'Ler descrição completa'}).click();await member.getByText(/14:00.*hora peninsular española/).waitFor();
   for(const width of [1440,390])await capture(member,'poctep-'+row.externalIdentifier.split(':').at(-1),width);
  }
  assert.equal(errors.length,0);assert(writes.length<=4);
  const proof={status:'PASS',observedAt:new Date().toISOString(),workerMode:'PROCESSING',runs,...counts,records:stored,publicReadMatchesStoredFields:true,repeatKeepsRevision:true,previousRowsAndHistoryUnchanged:true,tenantDataUnchanged:true,historyMatchesDatabase:true,memberDeniedAdministration:true,memberCatalogAndDetails:true,pageErrors:errors,realImportRequests:writes.length};
  fs.writeFileSync(path.join(proofDir,'real-import-verification.json'),JSON.stringify(proof,null,2));fs.writeFileSync(path.join(out,'native-verification.json'),JSON.stringify({...proof,records:stored.map(r=>({opportunityId:r.opportunityId,externalIdentifier:r.externalIdentifier}))},null,2));console.log('OFFICIAL_REAL_IMPORT_VERIFICATION_PASS',counts.identities,counts.runs);
 }finally{await browser.close();await pool.end();await tenant.end();}
}
main().catch(e=>{console.error('OFFICIAL_REAL_IMPORT_FAILED',stage,e.code||e.name,e.message?.slice(0,180));process.exitCode=1});
