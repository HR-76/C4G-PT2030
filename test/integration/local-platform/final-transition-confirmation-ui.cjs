'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const root=path.resolve(__dirname,'../../..'),dist=path.join(root,'frontend/dist'),out=path.join(root,'output/playwright/final-transition-confirmation');
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
  let profile='admin',status='SUBMITTED',revision=1;const writes=[];
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());let body={items:[]};
 if(url.pathname==='/api/auth/csrf')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({csrfToken:'synthetic'})});
 if(url.pathname.endsWith('/transitions')&&route.request().method()==='POST'){const input=route.request().postDataJSON();writes.push(input);status=input.status;revision++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({applicationId:uid(1),status,revision,title:'Preparação do consórcio',responsibleMembershipId:uid(3),deadline:'2027-01-30'})});}
   if(url.pathname.includes('/auth/session'))body={user:{id:'ui-fixture',displayName:'Teste',platformRoles:[]},organization:{id:'org-fixture',name:'Organização teste'}};
   else if(url.pathname==='/api/applications/'+uid(1))body={applicationId:uid(1),opportunityId:uid(2),opportunityTitle:'Aviso de investigação',title:'Preparação do consórcio',responsibleMembershipId:uid(3),deadline:'2027-01-30',status,revision,canEdit:profile==='admin',allowedTransitions:profile==='admin'&&status==='SUBMITTED'?['APPROVED','REJECTED','CANCELLED','ARCHIVED']:[],unitIds:[]};
   else if(url.pathname==='/api/applications/responsibles')body={items:[{membershipId:uid(3),name:'Ana Coordenadora'},{membershipId:uid(4),name:'Bruno Técnico'}]};
   else if(url.pathname==='/api/applications/'+uid(1)+'/work')body={canEdit:true,revision:1,participants:[{membershipId:uid(3),active:true,eligible:true}],tasks:[{taskId:uid(5),title:'Preparar orçamento',responsibleMembershipId:uid(3),deadline:'2027-01-20',status:'OPEN'},{taskId:uid(6),title:'Rever documentos do consórcio',responsibleMembershipId:uid(4),deadline:'2027-02-01',status:'OPEN'}]};
   else if(url.pathname==='/api/applications/'+uid(1)+'/partners')body={items:[],revision:1,total:0,canEdit:false};
   else if(url.pathname==='/api/applications/'+uid(1)+'/documents')body={revision:1,documents:[],reviews:[]};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  const base='http://127.0.0.1:'+server.address().port;
  page.setDefaultTimeout(15000);
  for(const [target,label] of [['APPROVED','Aprovada'],['REJECTED','Reprovada'],['CANCELLED','Cancelada'],['ARCHIVED','Arquivada']]){
   status='SUBMITTED';revision=1;await page.goto(base+'/candidaturas/'+uid(1));await page.getByLabel('Motivo',{exact:true}).fill('Decisão confirmada pela organização');
   const count=writes.length;await page.getByRole('button',{name:label,exact:true}).click();let dialog=page.getByRole('dialog',{name:'Confirmar alteração para '+label+'?'});await dialog.waitFor();assert.equal(writes.length,count);
   assert((await dialog.innerText()).includes('Preparação do consórcio'));assert((await dialog.innerText()).includes('Decisão confirmada pela organização'));
   assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Voltar');await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);assert.equal(writes.length,count);assert.equal(await page.getByLabel('Motivo',{exact:true}).inputValue(),'Decisão confirmada pela organização');
   await page.getByRole('button',{name:label,exact:true}).click();await dialog.waitFor();
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await dialog.screenshot({path:path.join(out,target+'-'+width+'.png')});assert(await dialog.evaluate(n=>n.scrollWidth<=n.clientWidth+1));}
   await dialog.getByRole('button',{name:'Confirmar alteração'}).click();await page.getByText('Alteração guardada.',{exact:true}).waitFor();assert.equal(writes.length,count+1);assert.equal(writes.at(-1).status,target);assert.equal(writes.at(-1).reason,'Decisão confirmada pela organização');assert.equal(writes.at(-1).expectedRevision,1);
  }
  profile='member';status='SUBMITTED';await page.goto(base+'/candidaturas/'+uid(1));await page.getByText(/Estado: Submetida/).waitFor();assert.equal(await page.getByLabel('Motivo',{exact:true}).count(),0);assert.equal(writes.length,4);
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:'PASS',mockedApi:true,finalTransitions:4,cancelPreservesReason:true,noWriteBeforeConfirmation:true,memberNoActions:true,viewports:[1440,390]},null,2));console.log('FINAL_TRANSITION_CONFIRMATION_UI_PASS');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

