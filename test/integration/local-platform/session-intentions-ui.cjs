'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const root=path.resolve(__dirname,'../../..'),dist=path.join(root,'frontend/dist'),out=path.join(root,'output/playwright/session-intentions');
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
  let org='org-A',user='user-A',profile='admin',expired=false,writes=0;
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());let body={items:[]};
 if(route.request().method()!=='GET'&&url.pathname.startsWith('/api/applications'))writes++;
 if(expired&&url.pathname.endsWith('/work'))return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{code:'SESSION_EXPIRED'}})});
 if(url.pathname==='/api/auth/csrf')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({csrfToken:'synthetic'})});
 if(url.pathname==='/api/auth/logout')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({redirectUrl:'/login'})});
   if(url.pathname.includes('/auth/session'))body={user:{id:user,displayName:'Teste',platformRoles:[]},organization:{id:org,name:org}};
   else if(/^\/api\/applications\/[0-9a-f-]+$/.test(url.pathname))body={applicationId:uid(1),opportunityId:uid(2),opportunityTitle:'Aviso de investigação',title:'Preparação do consórcio',responsibleMembershipId:uid(3),deadline:'2027-01-30',status:'IDENTIFIED',revision:1,canEdit:profile==='admin',allowedTransitions:[],unitIds:[]};
   else if(url.pathname==='/api/applications/responsibles')body={items:[{membershipId:uid(3),name:'Ana Coordenadora'},{membershipId:uid(4),name:'Bruno Técnico'}]};
   else if(url.pathname.endsWith('/work'))body={canEdit:profile==='admin',revision:1,participants:[{membershipId:uid(3),active:true,eligible:true}],tasks:[{taskId:uid(5),title:'Preparar orçamento',responsibleMembershipId:uid(3),deadline:'2027-01-20',status:'OPEN'},{taskId:uid(6),title:'Rever documentos do consórcio',responsibleMembershipId:uid(4),deadline:'2027-02-01',status:'OPEN'}]};
   else if(url.pathname.endsWith('/partners'))body={items:[],revision:1,total:0,canEdit:profile==='admin'};
   else if(url.pathname.endsWith('/documents'))body={capabilities:{canEdit:profile==='admin',canDecide:profile==='admin',canUpload:profile==='admin'},revision:1,documents:[],reviews:[]};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  const base='http://127.0.0.1:'+server.address().port;
  page.setDefaultTimeout(15000);
  const ready=async()=>{await page.getByRole('region',{name:'Equipa e tarefas'}).getByText('Preparar orçamento',{exact:true}).waitFor();await page.getByRole('region',{name:'Parceiros da candidatura'}).getByText('Sem parceiros nesta candidatura.').waitFor();await page.getByRole('region',{name:'Documentos e revisão interna'}).getByText('Sem documentos associados.').waitFor();};
  const saved=()=>page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage).filter(([key])=>key.startsWith('c4g.application.'))));
  for(profile of ['admin','member']){
   user='user-A';org='org-A';expired=false;await page.goto(base+'/candidaturas/'+uid(1));await ready();
   await page.evaluate(app=>{sessionStorage.clear();for(const kind of ['work','partners','documents'])sessionStorage.setItem('c4g.application.'+kind+'.intention.v1:user-A:org-A:'+app,JSON.stringify({userId:'user-A',organizationId:'org-A',applicationId:app,method:kind==='work'?'taskComplete':kind==='partners'?'partnerRemove':'reviewRequest',payload:{expectedRevision:1},idempotencyKey:app}));},uid(1));
   const before=await saved();expired=true;await page.reload();await page.waitForURL(url=>url.pathname==='/login');assert.deepEqual(await saved(),before);
   expired=false;
   for(const [u,o,app,own] of [['user-B','org-A',uid(1),false],['user-A','org-B',uid(1),false],['user-A','org-A',uid(88),false],['user-A','org-A',uid(1),true]]){
    user=u;org=o;await page.goto(base+'/candidaturas/'+app);await ready();
    assert.equal(await page.getByRole('button',{name:/^Repetir (o mesmo envio|envio de parceiros)$/}).count(),own&&profile==='admin'?3:0);
    assert.deepEqual(await saved(),before);assert.equal(writes,0);
   }
   await page.getByRole('button',{name:'Sair',exact:true}).click();await page.waitForURL(url=>url.pathname==='/login');assert.deepEqual(await saved(),{});
  }
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:'PASS',mockedApi:true,profiles:['admin','member'],expiryPreserves:true,identityOrganizationApplicationIsolation:true,noAutomaticWrites:true,explicitLogoutClears:true},null,2));console.log('SESSION_INTENTIONS_UI_PASS');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

