'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const root=path.resolve(__dirname,'../../..'),dist=path.join(root,'frontend/dist'),out=path.join(root,'output/playwright/manual-classification');
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
   else if(url.pathname==='/api/admin/central-opportunities'){calls.push(Object.fromEntries(url.searchParams));body={items:[],nextCursor:null,programmes:require('../../../backend/src/fundingTenders/catalogOptions').catalogueProgrammes(['CENTRO2030']),opportunityTypes:require('../../../backend/src/opportunities/manualClassification').OPPORTUNITY_TYPES,interventionAreas:[{code:'DIGITAL',label:'Digitalização'}],sourceMode:'fixture'};}
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  const base='http://127.0.0.1:'+server.address().port;
  page.setDefaultTimeout(15000);await page.goto(base+'/administracao/oportunidades/nova');
  await page.getByRole('option',{name:'Horizon Europe (HORIZON)',exact:true}).waitFor({state:'attached'});
  await page.getByLabel('Programa',{exact:true}).selectOption({label:'Horizon Europe (HORIZON)'});
  await page.getByLabel('Tipo de oportunidade',{exact:true}).selectOption('Concurso');
  await page.getByLabel('Área de intervenção',{exact:true}).selectOption('DIGITAL');
  await page.getByLabel('URL oficial',{exact:true}).fill('https://example.org/official');
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    await page.screenshot({path:path.join(out,'form-'+width+'.png'),fullPage:true,animations:'disabled'});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'HORIZONTAL_OVERFLOW');
  }
  assert.equal(await page.getByLabel('Programa',{exact:true}).inputValue(),'Horizon Europe (HORIZON)');
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:'PASS',mockedApi:true,realBackend:false,viewports:[1440,390],classificationSelections:true,noHorizontalOverflow:true},null,2));console.log('MANUAL_CLASSIFICATION_UI_PASS');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

