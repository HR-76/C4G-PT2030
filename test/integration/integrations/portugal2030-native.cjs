'use strict';
// Native read-only availability + isolated HTTP fixtures, never live imports.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const {Pool}=require('../../../backend/node_modules/pg'),xlsx=require('../../../backend/node_modules/xlsx');
const cfg=require('../../../backend/scripts/localPlatform/config'),{fingerprint}=require('../../../backend/scripts/localPlatform/officialSources');
const parser=require('../../../backend/src/opportunityImports/portugal2030Xlsx');
const out=path.join(cfg.root,'output/playwright/c4g-portugal2030');let stage='setup';
async function main(){
 const config=cfg.readConfig(),access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json'))),origin='http://localhost:3000';
 const central=new Pool(cfg.connection(config,config.centralDatabase)),tenant=new Pool(cfg.connection(config,config.tenantDatabase));
 const before={central:await fingerprint(central,['opportunity_catalog']),tenant:await fingerprint(tenant,['opportunity_catalog','organizational_scope','organizational_profile'])};
 fs.mkdirSync(out,{recursive:true});
 const official=fs.readFileSync(path.join(cfg.root,'output/portugal2030/official-plan-20260914.xlsx')),officialPreview=parser.inspectPortugal2030Xlsx(official,{sheetName:'Sheet1'});
 assert.equal(officialPreview.totalRows,177);assert.equal(officialPreview.errorRows,0);
 const headers=['ID','Designação do Aviso','Programa','Data Início Prevista','Data Fim Prevista','Nota de ensaio'];
 const rows=[['ENSAIO-1','Ensaio: investigação e inovação','NORTE2030','18/10/2026','01/12/2026','teste'],['ENSAIO-2','Ensaio: aviso já existente','CENTRO2030','01/10/2026','31/12/2026','teste'],['ENSAIO-3','Ensaio: possível correspondência','ALENTEJO2030','01/11/2026','31/01/2027','teste'],['ENSAIO-4','','NORTE2030','01/11/2026','31/12/2026','teste']];
 const wb=xlsx.utils.book_new();xlsx.utils.book_append_sheet(wb,xlsx.utils.aoa_to_sheet([headers,...rows]),'Avisos');
 const buffer=xlsx.write(wb,{type:'buffer',bookType:'xlsx'}),fixturePath=path.join(out,'synthetic-plan.xlsx');fs.writeFileSync(fixturePath,buffer);
 const inspected=parser.inspectPortugal2030Xlsx(buffer,{sheetName:'Avisos',headerDecisions:{'Nota de ensaio':'IGNORE'}});
 assert.equal(inspected.validRows,3);assert.equal(inspected.errorRows,1);
 const job={importId:'00000000-0000-4000-8000-000000000001',state:'UPLOADED',createdAt:'2026-10-18T12:00:00Z',totalRows:0,validRows:0,errorRows:0,processedRows:0,createdRows:0,exactRows:0,possibleRows:0,rejectedRows:0,conflictRows:0};
 const preview={...inspected,importId:job.importId,created:0};delete preview.rows;
 const outcomes=[{line:2,state:'CREATED',code:'IMPORT_CREATED',resultId:'00000000-0000-4000-8000-000000000002'},{line:3,state:'EXACT',code:'IMPORT_EXACT_DUPLICATE',conflictId:'00000000-0000-4000-8000-000000000003'},{line:4,state:'POSSIBLE',code:'IMPORT_POSSIBLE_DUPLICATE',conflictId:'00000000-0000-4000-8000-000000000004'},{line:5,state:'INVALID',code:'IMPORT_TITLE_REQUIRED'}];
 let uploaded=false,confirmations=0;const writes=[],mockRequests=[],errors=[];
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.name));page.setDefaultTimeout(15000);
  await page.route('**/api/**',route=>{const r=route.request(),u=new URL(r.url());if(u.origin===origin&&!u.pathname.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(r.method())){writes.push(u.pathname);return route.abort()}return route.continue()});
  stage='login';await page.goto(origin+'/login');await page.getByRole('button',{name:'Entrar na C4G',exact:true}).click();await page.locator('#username').fill(access.hugo.username);await page.locator('#password').fill(access.hugo.password);await page.locator('#kc-login').click();await page.waitForURL(u=>u.origin===origin&&u.pathname!=='/login');
  stage='native';await page.goto(origin+'/importar');await page.getByText(/aguarda a configuração/).waitFor();assert.equal(await page.locator('#portugal-file').isDisabled(),true);
  const nativeStatus=await page.evaluate(async()=>{const r=await fetch('/api/imports');return{status:r.status,body:await r.json()}});assert.equal(nativeStatus.status,503);assert.equal(nativeStatus.body.error.code,'OPPORTUNITY_IMPORT_NOT_CONFIGURED');
  async function shots(prefix){for(const width of [1440,390]){await page.setViewportSize({width,height:1000});const close=page.getByRole('button',{name:'Fechar menu',exact:true});if(width===390&&await close.isVisible())await close.click();await page.waitForLoadState('networkidle');await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('main')?.scrollTo(0,0)});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`${prefix}-${width}.png`),fullPage:true,animations:'disabled'});}}
  await shots('native-pending');
  stage='fixture';await page.route('**/api/imports**',async route=>{
   const r=route.request(),u=new URL(r.url()),method=r.method();mockRequests.push(`${method} ${u.pathname}`);
   const json=(data,status=200)=>route.fulfill({status,json:data});
   if(u.pathname==='/api/imports'&&method==='GET')return json(uploaded?[job]:[]);
   if(u.pathname==='/api/imports/xlsx'&&method==='POST'){uploaded=true;return json({job,sheets:[{index:0,name:'Avisos'}]},201)}
   if(u.pathname.endsWith('/preview')){const body=r.postDataJSON();if(body.headerDecisions['Nota de ensaio']!=='IGNORE')return json({error:{code:'IMPORT_HEADER_DECISION_REQUIRED',details:{headers:['Nota de ensaio']}}},400);Object.assign(job,{state:'READY_FOR_CONFIRMATION',sheetName:'Avisos',mapping:inspected.mapping,totalRows:4,validRows:3,errorRows:1});return json(preview)}
   if(u.pathname.endsWith('/confirm')){confirmations++;Object.assign(job,{state:'COMPLETED_WITH_ISSUES',processedRows:4,createdRows:1,exactRows:1,possibleRows:1,rejectedRows:1,reportDocumentVersionId:'fixture-report'});return json(job,202)}
   if(u.pathname.endsWith('/possible/4/review')){assert.equal(r.postDataJSON().decision,'REJECT');Object.assign(outcomes[2],{state:'REJECTED',code:'IMPORT_POSSIBLE_REJECTED'});job.possibleRows=0;job.rejectedRows=2;return json(outcomes[2])}
   if(u.pathname.endsWith('/report'))return route.fulfill({contentType:'text/csv; charset=utf-8',body:'\uFEFFline,state,code,conflict,result\r\n2,CREATED,IMPORT_CREATED,,fixture\r\n'});
   if(method==='GET'&&u.pathname===`/api/imports/${job.importId}`)return json({job,outcomes,sheets:[{index:0,name:'Avisos'}]});
   throw Error('UNEXPECTED_FIXTURE_REQUEST');
  });
  await page.setViewportSize({width:1440,height:1000});await page.reload();await page.getByText('Ainda não existem importações nesta organização.').waitFor();
  await page.evaluate(()=>{const notice=document.createElement('p');notice.textContent='ENSAIO VISUAL — respostas HTTP simuladas; nenhuma importação real.';notice.className='alert';document.querySelector('main').prepend(notice)});
  await page.locator('#portugal-file').setInputFiles(fixturePath);await page.getByRole('heading',{name:'Validar ficheiro',exact:true}).waitFor().catch(async e=>{await page.screenshot({path:path.join(out,'debug-upload.png'),fullPage:true});console.log(JSON.stringify({mockRequests,alerts:await page.getByRole('alert').allTextContents()}));throw e});await page.getByLabel('Folha',{exact:true}).selectOption('Avisos');await page.getByRole('button',{name:'Validar e pré-visualizar',exact:true}).click();await page.getByLabel('Nota de ensaio',{exact:true}).selectOption('IGNORE');await page.getByRole('button',{name:'Validar e pré-visualizar',exact:true}).click();await page.getByRole('heading',{name:'Pré-visualização',exact:true}).waitFor();assert.equal(confirmations,0);await shots('fixture-preview');
  await page.getByRole('button',{name:'Importar 3 linhas válidas',exact:true}).click();await page.getByRole('heading',{name:'Resultado da importação',exact:true}).waitFor();assert.equal(confirmations,1);await shots('fixture-result');
  await page.getByRole('button',{name:'Não importar',exact:true}).click();await page.getByText('Criação rejeitada na revisão.').waitFor();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Descarregar relatório CSV',exact:true}).click();const report=await download;await report.saveAs(path.join(out,'fixture-report.csv'));
  assert.equal(errors.length,0);assert.equal(writes.length,0);
  assert.deepEqual(await fingerprint(central,['opportunity_catalog']),before.central);assert.deepEqual(await fingerprint(tenant,['opportunity_catalog','organizational_scope','organizational_profile']),before.tenant);
  fs.writeFileSync(path.join(out,'native-verification.json'),JSON.stringify({status:'PASS',observedAt:new Date().toISOString(),nativeAvailability:'NOT_CONFIGURED',nativeStatus:503,realImports:0,officialFileRows:177,officialFileErrors:0,officialFileDigest:officialPreview.fileDigest,previewAndResult:'SYNTHETIC_HTTP_FIXTURE',mockRequests,widths:[1440,390],businessDataUnchanged:true,businessWrites:writes,pageErrors:errors},null,2));console.log('PORTUGAL2030_NATIVE_AND_FIXTURE_PASS');
 }finally{await browser.close();await central.end();await tenant.end()}
}
main().catch(error=>{console.error('PORTUGAL2030_NATIVE_FAILED',stage,error.code||error.name,error.message?.slice(0,160));process.exitCode=1});
