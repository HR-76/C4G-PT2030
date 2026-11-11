'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const root=path.resolve(__dirname,'../../..'),dist=path.join(root,'frontend/dist'),out=path.join(root,'output/playwright/partner-card');
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
   else if(url.pathname==='/api/applications/partners')body={items:[{id:'partner-one',entity_name:'Instituto Parceiro',country:'Portugal',research_area_interest:'Investigação aplicada e colaboração em projetos',responsible_person:'Maria',contact:'210000000',email:'geral@example.org',people:[{id:'one',name:'Ana',role:'INVESTIGADOR',research_area:'Saúde',contact:'220000000',email:'ana@example.org'}],application_id:'app',application_title:'Projeto conjunto',application_status:'IDENTIFIED'}],countries:['Portugal'],page:1,total:1,nextCursor:null,previousCursor:null};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  const base='http://127.0.0.1:'+server.address().port;
  page.setDefaultTimeout(15000);await page.goto(base+'/parceiros');
  await page.getByRole('button',{name:'Ver ficha de Instituto Parceiro'}).click();
  const dialog=page.getByRole('dialog',{name:'Ficha de parceiro'});
  await dialog.waitFor();assert((await dialog.innerText()).includes('ana@example.org'));
  assert.equal(await dialog.getByRole('link',{name:'Abrir parceiros da candidatura'}).getAttribute('href'),'/candidaturas/app#parceiros');
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    await page.screenshot({path:path.join(out,'card-'+width+'.png'),fullPage:true,animations:'disabled'});
    assert(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1),'DIALOG_OVERFLOW');
  }
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:'PASS',mockedApi:true,viewports:[1440,390],card:true,noHorizontalOverflow:true},null,2));console.log('PARTNER_CARD_UI_PASS');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

