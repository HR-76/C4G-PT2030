'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../frontend/test-harness/node_modules/playwright');
async function run({profile,message,record,organizationId,userId,canRead,revokeAccess}){
 const link=new URL(message.text.split('Abrir candidatura: ')[1].trim());assert.equal(link.searchParams.get('organizacao'),organizationId);assert.equal(link.pathname,'/candidaturas/'+record.applicationId);
 const dist=path.resolve(__dirname,'../../frontend/dist');
 const server=http.createServer((req,res)=>{let file=path.resolve(dist,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}if(!fs.existsSync(file)||!fs.statSync(file).isFile())file=path.join(dist,'index.html');res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const page=await browser.newPage();let selected='00000000-0000-4000-8000-000000000099',reads=0,selections=0;
 const session=()=>({user:{id:userId,name:'Fixture',role:profile==='ORG_ADMIN'?'ADMIN':'MEMBER',platformRoles:[]},organization:{id:selected,displayName:'Fixture'},csrfToken:'isolated'});
 await page.route('**/api/**',async route=>{const request=route.request(),p=new URL(request.url()).pathname;let data={items:[]},status=200;
 if(p==='/api/auth/session')data=session();
 else if(p==='/api/auth/csrf')data={csrfToken:'isolated'};
 else if(p==='/api/auth/organizations')data={organizations:[{id:organizationId,displayName:'Organização do email'}]};
 else if(p==='/api/auth/organization'){assert.equal(request.method(),'POST');assert.equal(request.postDataJSON().organizationId,organizationId);selected=organizationId;selections++;data=session();}
 else if(p==='/api/applications/'+record.applicationId){reads++;assert.equal(selected,organizationId);if(await canRead())data={...record,canEdit:false,allowedTransitions:[]};else {status=403;data={error:{code:'FORBIDDEN'}};}}
 else if(p.endsWith('/work'))data={revision:1,participants:[],tasks:[],canEdit:false};
 else if(p.endsWith('/documents'))data={revision:1,documents:[],reviews:[],canEdit:false};
 else if(p.endsWith('/partners'))data={revision:1,items:[],total:0,canEdit:false};
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 const origin='http://127.0.0.1:'+server.address().port;
 await page.goto(origin+link.pathname+link.search);await page.getByRole('button',{name:'Confirmar organização',exact:true}).waitFor();assert.equal(reads,0);assert.equal(selections,0);
 await page.getByRole('button',{name:'Confirmar organização',exact:true}).click();await page.getByRole('heading',{name:record.title,exact:true}).waitFor();assert.equal(selections,1);assert.ok(reads>0);
 const before=reads;await page.goto(origin+link.pathname+'?organizacao=00000000-0000-4000-8000-000000000098');await page.getByRole('heading',{name:'Link indisponível'}).waitFor();assert.equal(reads,before);
 await revokeAccess();await page.goto(origin+link.pathname+link.search);await page.getByText('Sem permissão para esta candidatura.',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:record.title,exact:true}).count(),0);
 console.log('PASS '+profile+': persisted message link, explicit organization confirmation, database record shown; foreign context blocked. HTTP/session fixture.');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
module.exports={run};
