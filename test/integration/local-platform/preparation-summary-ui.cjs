'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const root=path.resolve(__dirname,'../../..'),dist=path.join(root,'frontend/dist'),out=path.join(root,'output/playwright/preparation-summary');
async function main(){
 fs.mkdirSync(out,{recursive:true});
 const server=http.createServer((req,res)=>{
  const requested=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  let file=path.resolve(dist,'.'+requested);
  if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())file=path.join(dist,'index.html');
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),calls=[];
  const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());calls.push(url.pathname);let body={items:[]};
   if(url.pathname.includes('/auth/session'))body={user:{id:'ui-fixture',displayName:'Teste',platformRoles:[]},organization:{id:'org-fixture',name:'Organização teste'}};
   else if(url.pathname==='/api/applications/'+uid(1))body={applicationId:uid(1),opportunityId:uid(2),opportunityTitle:'Aviso de investigação',title:'Preparação do consórcio',responsibleMembershipId:uid(3),deadline:'2027-01-30',status:'IDENTIFIED',revision:1,canEdit:true,allowedTransitions:[],unitIds:[]};
   else if(url.pathname==='/api/applications/responsibles')body={items:[{membershipId:uid(3),name:'Ana Coordenadora'},{membershipId:uid(4),name:'Bruno Técnico'}]};
   else if(url.pathname==='/api/applications/'+uid(1)+'/work')body={canEdit:true,revision:1,participants:[{membershipId:uid(3),active:true,eligible:true}],tasks:[{taskId:uid(5),title:'Preparar orçamento',responsibleMembershipId:uid(3),deadline:'2027-01-20',status:'OPEN'},{taskId:uid(6),title:'Rever documentos do consórcio',responsibleMembershipId:uid(4),deadline:'2027-02-01',status:'OPEN'}]};
   else if(url.pathname==='/api/applications/'+uid(1)+'/partners')body={items:[],revision:1,total:0,canEdit:false};
   else if(url.pathname==='/api/applications/'+uid(1)+'/documents')body={revision:1,documents:[{documentId:uid(7),versionId:uid(8),filename:'Dossier.pdf',usable:false,state:'QUARANTINED'}],reviews:[{requestId:uid(9),requestedBy:uid(4),requestedAt:'2026-11-02T12:00:00Z',documents:[],decision:'CHANGES_REQUESTED',stale:false,documentsRestricted:false}]};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  const base='http://127.0.0.1:'+server.address().port;
  page.setDefaultTimeout(15000);await page.goto(base+'/candidaturas/'+uid(1));
  const summary=page.getByRole('region',{name:'Resumo de preparação'});
  await summary.getByText('Tarefas abertas apresentadas: 2.').waitFor();
  await summary.getByText('Versões associadas: 1 · Indisponíveis: 1.').waitFor();
  assert.equal(calls.filter(url=>url.endsWith('/work')).length,1);
  assert.equal(calls.filter(url=>url.endsWith('/documents')).length,1);
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await summary.screenshot({path:path.join(out,'summary-'+width+'.png'),animations:'disabled'}); await page.screenshot({path:path.join(out,'application-'+width+'.png'),fullPage:true});
   assert(await summary.evaluate(node=>node.scrollWidth<=node.clientWidth+1),'SUMMARY_OVERFLOW');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'PAGE_OVERFLOW');
  }
  const navigation=page.getByRole('navigation',{name:'Secções da candidatura'});
  for(const link of await navigation.getByRole('link').all()){ await link.click(); assert(await page.locator(await link.getAttribute('href')).count()===1); }
  for(const [label,target] of [['Preparar orçamento','tarefa-'+uid(5)],['Dossier.pdf','documento-'+uid(7)],['Rever alterações solicitadas','revisao-'+uid(9)]]){
   await summary.getByRole('link',{name:label,exact:true}).click();
   assert.equal(await page.evaluate(()=>document.activeElement.id),target);
   assert(new URL(page.url()).hash==='#'+target);
  }
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:'PASS',mockedApi:true,viewports:[1440,390],exactNavigation:true,noDuplicateReads:true},null,2));console.log('PREPARATION_SUMMARY_UI_PASS');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});


