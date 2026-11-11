'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const root=path.resolve(__dirname,'../../..'),dist=path.join(root,'frontend/dist'),out=path.join(root,'output/playwright/partner-pending-permissions');
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
  let profile='admin',refuse=true;const writes=[];
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());let body={items:[]};
   if(url.pathname.includes('/partners')&&route.request().method()!=='GET'){writes.push(route.request().postDataJSON());return route.fulfill({status:refuse?403:200,contentType:'application/json',body:JSON.stringify(refuse?{error:{code:'NOT_AUTHORIZED'}}:{revision:2})});}
   if(url.pathname==='/api/auth/csrf')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({csrfToken:'synthetic'})});
   if(url.pathname.includes('/auth/session'))body={user:{id:'ui-fixture',displayName:'Teste',platformRoles:[]},organization:{id:'org-fixture',name:'Organização teste'}};
   else if(url.pathname==='/api/applications/'+uid(1))body={applicationId:uid(1),opportunityId:uid(2),opportunityTitle:'Aviso de investigação',title:'Preparação do consórcio',responsibleMembershipId:uid(3),deadline:'2027-01-30',status:'IDENTIFIED',revision:1,canEdit:true,allowedTransitions:[],unitIds:[]};
   else if(url.pathname==='/api/applications/responsibles')body={items:[{membershipId:uid(3),name:'Ana Coordenadora'},{membershipId:uid(4),name:'Bruno Técnico'}]};
   else if(url.pathname==='/api/applications/'+uid(1)+'/work')body={revision:1,participants:[{membershipId:uid(3),active:true,eligible:true}],tasks:[{taskId:uid(5),title:'Preparar orçamento',responsibleMembershipId:uid(3),deadline:'2027-01-20',status:'OPEN'},{taskId:uid(6),title:'Rever documentos do consórcio',responsibleMembershipId:uid(4),deadline:'2027-02-01',status:'OPEN'}]};
   else if(url.pathname==='/api/applications/'+uid(1)+'/partners')body={items:[{id:uid(20),entity_name:'Instituto Parceiro',country:'Portugal',research_area_interest:'Saúde',responsible_person:'Ana',contact:'',email:'',people:[]}],revision:1,total:1,canEdit:profile==='admin'};
   else if(url.pathname==='/api/applications/'+uid(1)+'/documents')body={capabilities:{canEdit:true,canDecide:true,canUpload:true},revision:2,documents:[{documentId:uid(10),versionId:uid(11),filename:'Orçamento do consórcio.pdf',versionNumber:1,state:'AVAILABLE',scanState:'CLEAN',usable:true}],reviews:[{requestId:uid(12),requestedBy:uid(3),requestedAt:'2026-11-02T10:00:00Z',documents:[{documentId:uid(10),versionId:uid(11)}],stale:false,decision:null}]};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  const base='http://127.0.0.1:'+server.address().port;
  page.setDefaultTimeout(15000);
  for(profile of ['admin','member']){
   await page.goto(base+'/candidaturas/'+uid(1));const p=page.getByRole('region',{name:'Parceiros da candidatura'});
   await p.getByText('Instituto Parceiro',{exact:true}).waitFor();
   assert.equal(await p.getByRole('button',{name:'Adicionar parceiro',exact:true}).count(),profile==='admin'?1:0);
   assert.equal(await p.getByTitle('Editar',{exact:true}).count(),profile==='admin'?1:0);
   assert.equal(await p.getByRole('button',{name:'Remover',exact:true}).count(),profile==='admin'?1:0);
  }
  const key='c4g.application.partners.intention.v1:ui-fixture:org-fixture:'+uid(1);
  await page.evaluate(({key,id,partner})=>sessionStorage.setItem(key,JSON.stringify({userId:'ui-fixture',organizationId:'org-fixture',applicationId:id,method:'partnerRemove',payload:{partnerId:partner,expectedRevision:1,idempotencyKey:'00000000-0000-4000-8000-000000000099'}})),{key,id:uid(1),partner:uid(20)});
  await page.reload();const p=page.getByRole('region',{name:'Parceiros da candidatura'});await p.getByText('Instituto Parceiro',{exact:true}).waitFor();
  assert.equal(await p.getByRole('button',{name:'Repetir envio de parceiros'}).count(),0);assert.equal(writes.length,0);
  const preserved=await page.evaluate(key=>sessionStorage.getItem(key),key);
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await p.screenshot({path:path.join(out,'member-'+width+'.png')});assert(await p.evaluate(n=>n.scrollWidth<=n.clientWidth+1));}
  profile='admin';await p.getByRole('button',{name:'Recarregar parceiros'}).click();const retry=p.getByRole('button',{name:'Repetir envio de parceiros'});await retry.waitFor();assert.equal(writes.length,0);
  await retry.click();await p.getByRole('alert').waitFor();assert.equal(await retry.count(),0);assert.equal(await p.getByText('Instituto Parceiro',{exact:true}).count(),0);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),preserved);
  refuse=false;await p.getByRole('button',{name:'Recarregar parceiros'}).click();await retry.waitFor();assert.equal(writes.length,1);
  await retry.click();await p.getByText('Parceiros atualizados.',{exact:true}).waitFor();assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null);
  await p.getByText('Instituto Parceiro',{exact:true}).waitFor();
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await p.screenshot({path:path.join(out,'admin-'+width+'.png')});assert(await p.evaluate(n=>n.scrollWidth<=n.clientWidth+1));}
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:'PASS',mockedApi:true,profiles:['admin','member'],viewports:[1440,390],pendingPreserved:true,denialBlocks:true,explicitRecovery:true,sameCommand:true,noAutomaticRetry:true},null,2));console.log('PARTNER_PENDING_PERMISSIONS_UI_PASS');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

