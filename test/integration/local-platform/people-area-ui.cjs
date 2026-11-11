'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const root=path.resolve(__dirname,'../../..'),dist=path.join(root,'frontend/dist'),out=path.join(root,'output/playwright/people-area');
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
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());let body={items:[]};
   if(url.pathname.includes('/auth/session'))body={user:{id:'ui-fixture',displayName:'Teste',platformRoles:[]},organization:{id:'org-fixture',name:'Organização teste'}};
   else if(url.pathname==='/api/organization-directory')body={organization:{id:'org-fixture',name:'Organização teste'},profile:{},permissions:{edit:false,units:false}};
   else if(url.pathname==='/api/organization-directory/people'){calls.push(Object.fromEntries(url.searchParams));body={items:[],nextCursor:null,areas:require('../../../backend/src/organizationDirectory/thematicAreas').areas};}
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  const base='http://127.0.0.1:'+server.address().port;
  page.setDefaultTimeout(15000);await page.goto(base+'/perfil-organizacao/pessoas');
  const area=require('../../../backend/src/organizationDirectory/thematicAreas').areas[0];
  await page.getByRole('option',{name:area.name,exact:true}).waitFor({state:'attached'});
  await page.getByLabel('Área temática',{exact:true}).selectOption(area.id);
  const response=page.waitForResponse(r=>r.url().includes('/organization-directory/people?')&&r.url().includes('areaId='));
  await page.getByRole('button',{name:'Aplicar filtros'}).click();await response;
  assert.equal(calls.at(-1).areaId,area.id);
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    await page.screenshot({path:path.join(out,'people-'+width+'.png'),fullPage:true,animations:'disabled'});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'HORIZONTAL_OVERFLOW');
  }
  await page.getByRole('button',{name:'Limpar filtros'}).click();
  assert.equal(await page.getByLabel('Área temática',{exact:true}).inputValue(),'');
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:'PASS',mockedApi:true,viewports:[1440,390],areaFilter:true,noHorizontalOverflow:true},null,2));console.log('PEOPLE_AREA_UI_PASS');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

