'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const root=path.resolve(__dirname,'../../..'),dist=path.join(root,'frontend/dist'),out=path.join(root,'output/playwright/team-pending-permissions');
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
  let profile='admin',status=403;const writes=[];
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());let body={items:[]};
 if(url.pathname.includes('/work/')&&route.request().method()==='POST'){writes.push({path:url.pathname,body:route.request().postDataJSON()});return route.fulfill({status,contentType:'application/json',body:JSON.stringify(status===200?{revision:2}:{error:{code:'NOT_AUTHORIZED'}})});}
 if(url.pathname==='/api/auth/csrf')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({csrfToken:'synthetic'})});
   if(url.pathname.includes('/auth/session'))body={user:{id:'ui-fixture',displayName:'Teste',platformRoles:[]},organization:{id:'org-fixture',name:'Organização teste'}};
   else if(url.pathname==='/api/applications/'+uid(1))body={applicationId:uid(1),opportunityId:uid(2),opportunityTitle:'Aviso de investigação',title:'Preparação do consórcio',responsibleMembershipId:uid(3),deadline:'2027-01-30',status:'IDENTIFIED',revision:1,canEdit:profile==='admin',allowedTransitions:[],unitIds:[]};
   else if(url.pathname==='/api/applications/responsibles')body={items:[{membershipId:uid(3),name:'Ana Coordenadora'},{membershipId:uid(4),name:'Bruno Técnico'}]};
   else if(url.pathname==='/api/applications/'+uid(1)+'/work')body={canEdit:profile==='admin',revision:1,participants:[{membershipId:uid(3),active:true,eligible:true}],tasks:[{taskId:uid(5),title:'Preparar orçamento',responsibleMembershipId:uid(3),deadline:'2027-01-20',status:'OPEN'},{taskId:uid(6),title:'Rever documentos do consórcio',responsibleMembershipId:uid(4),deadline:'2027-02-01',status:'OPEN'}]};
   else if(url.pathname==='/api/applications/'+uid(1)+'/partners')body={items:[],revision:1,total:0,canEdit:false};
   else if(url.pathname==='/api/applications/'+uid(1)+'/documents')body={revision:1,documents:[],reviews:[]};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  const base='http://127.0.0.1:'+server.address().port;
  page.setDefaultTimeout(15000);await page.goto(base+'/candidaturas/'+uid(1));await page.getByRole('tab',{name:'Equipa e tarefas',exact:true}).click();
  const team=page.getByRole('region',{name:'Equipa e tarefas'}),key='c4g.application.work.intention.v1:ui-fixture:org-fixture:'+uid(1),legacy='c4g.application.work.intention.v1:ui-fixture:org-fixture';
  await team.getByText('Preparar orçamento',{exact:true}).waitFor();await team.getByRole('button',{name:'Concluir',exact:true}).first().click();await team.getByRole('alert').waitFor();
  assert.equal(await team.getByRole('button',{name:'Repetir o mesmo envio'}).count(),0);assert.equal(await team.getByText('Preparar orçamento',{exact:true}).count(),0);
  const preserved=await page.evaluate(key=>sessionStorage.getItem(key),key);assert(preserved);
  profile='member';await team.getByRole('button',{name:'Recarregar equipa e tarefas'}).click();await team.getByText('Preparar orçamento',{exact:true}).waitFor();assert.equal(await team.getByRole('button',{name:'Concluir',exact:true}).count(),0);assert.equal(await team.getByRole('button',{name:'Repetir o mesmo envio'}).count(),0);assert.equal(writes.length,1);
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await team.screenshot({path:path.join(out,'member-'+width+'.png')});assert(await team.evaluate(n=>n.scrollWidth<=n.clientWidth+1));}
  profile='admin';status=200;await team.getByRole('button',{name:'Recarregar equipa e tarefas'}).click();const retry=team.getByRole('button',{name:'Repetir o mesmo envio'});await retry.waitFor();assert.equal(writes.length,1);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),preserved);
  await retry.click();await team.getByText('Alteração confirmada.',{exact:true}).waitFor();assert.deepEqual(writes[1],writes[0]);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null);
  await page.evaluate(({legacy,id})=>sessionStorage.setItem(legacy,JSON.stringify({userId:'ui-fixture',organizationId:'org-fixture',applicationId:id,method:'taskComplete',payload:{taskId:'synthetic',expectedRevision:1},idempotencyKey:'synthetic'})),{legacy,id:uid(88)});
  await page.reload();await page.getByRole('tab',{name:'Equipa e tarefas',exact:true}).click();await team.getByText('Preparar orçamento',{exact:true}).waitFor();assert.equal(await retry.count(),0);assert(await page.evaluate(key=>sessionStorage.getItem(key),legacy));assert.equal(writes.length,2);
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await team.screenshot({path:path.join(out,'admin-'+width+'.png')});assert(await team.evaluate(n=>n.scrollWidth<=n.clientWidth+1));}
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:'PASS',mockedApi:true,profiles:['admin','member'],viewports:[1440,390],pendingPreserved:true,foreignLegacyBlocked:true,noAutomaticRetry:true,identicalRecovery:true},null,2));console.log('TEAM_PENDING_PERMISSIONS_UI_PASS');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

