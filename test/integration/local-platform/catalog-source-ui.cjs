'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const root=path.resolve(__dirname,'../../..'),dist=path.join(root,'frontend/dist'),out=path.join(root,'output/playwright/catalog-source');
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
   if(url.pathname.includes('/auth/session'))body={user:{id:'ui-fixture',displayName:'C4G Teste',platformRoles:['C4G_ADMIN']},organization:null};
   else if(url.pathname==='/api/admin/central-opportunities'){calls.push(Object.fromEntries(url.searchParams));body={items:[],nextCursor:null,programmes:require('../../../backend/src/fundingTenders/catalogOptions').catalogueProgrammes(['CENTRO2030']),interventionAreas:[{code:'DIGITAL',label:'Digitalização'}],sourceMode:'fixture'};}
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  assert.equal(await page.getByRole('option',{name:'Registo manual C4G'}).count(),0);
  const base='http://127.0.0.1:'+server.address().port;
  page.setDefaultTimeout(15000);await page.goto(base+'/catalogo');await page.getByLabel('Fonte',{exact:true}).waitFor();
  assert.equal(await page.getByRole('option',{name:'Portugal 2030',exact:true}).count(),1);
  assert.equal(await page.getByRole('option',{name:'Registo manual C4G'}).count(),0);
  await page.getByRole('option',{name:'Horizon Europe (HORIZON)',exact:true}).waitFor({state:'attached'});
  await page.getByRole('option',{name:'Programme for the Environment and Climate Action (LIFE)',exact:true}).waitFor({state:'attached'});
  await page.getByLabel('Fonte',{exact:true}).selectOption('PORTUGAL2030');const applied=page.waitForResponse(r=>r.url().includes('/api/admin/central-opportunities?source=PORTUGAL2030'));await page.getByRole('button',{name:'Aplicar filtros',exact:true}).click();
  await applied;await page.getByRole('heading',{name:'Sem resultados para estes filtros'}).waitFor();assert.equal(calls.at(-1).source,'PORTUGAL2030');
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   await page.reload();await page.getByLabel('Fonte',{exact:true}).waitFor();
   await page.screenshot({path:path.join(out,'source-'+width+'.png'),fullPage:true,animations:'disabled'});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'HORIZONTAL_OVERFLOW');
  }
  await page.reload();await page.getByLabel('Fonte',{exact:true}).waitFor();assert.equal(await page.getByLabel('Fonte',{exact:true}).inputValue(),'PORTUGAL2030');
  await page.getByRole('button',{name:'Remover filtro de fonte'}).click();
  await page.waitForFunction(()=>!new URL(location.href).searchParams.has('source'));
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:'PASS',mockedApi:true,realBackend:false,viewports:[1440,390],sourceApplyReloadRemove:true,noHorizontalOverflow:true},null,2));console.log('CATALOG_SOURCE_UI_PASS');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

