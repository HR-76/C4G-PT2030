'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const root=path.resolve(__dirname,'../../..'),dist=path.join(root,'frontend/dist'),out=path.join(root,'output/playwright/interest-continuity');
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
  const interest={interestId:uid(1),opportunityId:uid(2),centralRevisionId:uid(3),revision:1,status:'ACTIVE',title:'Aviso de investigação',snapshot:{title:'Aviso de investigação',officialUrl:'https://example.org/official'},notes:'Análise guardada: reunir o consórcio.',unitIds:[],units:[],capabilities:{canManage:true,canCreateApplication:true}};
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());let body={items:[]};
   if(url.pathname.includes('/auth/session'))body={user:{id:'ui-fixture',displayName:'Teste',platformRoles:[]},organization:{id:'org-fixture',name:'Organização teste'}};
   else if(url.pathname==='/api/auth/csrf')body={csrfToken:'synthetic-ui-token'};
   else if(url.pathname==='/api/opportunity-interests/'+uid(1)){
    if(route.request().method()==='PUT'){Object.assign(interest,route.request().postDataJSON());interest.revision++;}
    body=interest;
   }
   else if(url.pathname==='/api/central-opportunities/'+uid(2))body={opportunityId:uid(2),revisionId:uid(3),snapshot:interest.snapshot};
   else if(url.pathname==='/api/applications/responsibles')body={items:[{membershipId:uid(4),name:'Responsável de teste'}]};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  const base='http://127.0.0.1:'+server.address().port;
  page.setDefaultTimeout(15000);await page.goto(base+'/interesses/'+uid(1));
  await page.getByLabel('Notas').fill('Análise revista: reunir o consórcio.');
  assert(await page.getByRole('button',{name:'Abrir candidatura',exact:true}).isDisabled());
  await page.getByRole('button',{name:'Guardar análise',exact:true}).click();
  await page.getByText('Alteração guardada.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Abrir candidatura',exact:true}).click();
  const copy=page.getByRole('button',{name:'Usar análise nas notas da candidatura'});
  await copy.waitFor();assert.equal(await page.getByLabel('Notas',{exact:true}).inputValue(),'');
  await copy.click();assert.equal(await page.getByLabel('Notas',{exact:true}).inputValue(),'Análise revista: reunir o consórcio.');
  assert(await copy.isDisabled());
  assert.equal(await page.getByRole('link',{name:'Fonte oficial',exact:true}).getAttribute('href'),'https://example.org/official');
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(out,'creation-'+width+'.png'),fullPage:true,animations:'disabled'});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'HORIZONTAL_OVERFLOW');
  }
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:'PASS',mockedApi:true,viewports:[1440,390],saveAnalysisOpenCopy:true,officialLink:true},null,2));console.log('INTEREST_CONTINUITY_UI_PASS');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

