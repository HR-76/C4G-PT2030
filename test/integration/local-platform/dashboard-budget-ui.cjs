'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const root=path.resolve(__dirname,'../../..'),dist=path.join(root,'frontend/dist'),out=path.join(root,'output/playwright/dashboard-budget');
const money=(total,missing=0,count=1)=>({total,missing,count});
const metric=(total,organizationBudget,totalBudget)=>({total,organizationBudget,totalBudget});
const labels={IDENTIFIED:'Identificada',PREPARATION:'Em preparação',SUBMITTED:'Submetida',APPROVED:'Aprovada',REJECTED:'Reprovada'};
async function main(){
 fs.mkdirSync(out,{recursive:true});
 const server=http.createServer((req,res)=>{
  const requested=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  let file=path.resolve(dist,'.'+requested);
  if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())file=path.join(dist,'index.html');
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const base='http://127.0.0.1:'+server.address().port,results=[];
  for(const role of ['ORG_ADMIN','VIEWER']){
   const admin=role==='ORG_ADMIN',page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],writes=[];
   page.on('console',m=>{if(m.type()==='error')console.error(m.text());});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
   const states=admin?{
    IDENTIFIED:metric(0,money('0.00',0,0),money('0.00',0,0)),
    PREPARATION:metric(2,money('45000.00',1,2),money('9999999999999999.99',1,2)),
    SUBMITTED:metric(3,money('150000.25',0,3),money('600000.50',0,3)),
    APPROVED:metric(1,money('1234567.89'),money('2345678.90')),
    REJECTED:metric(1,money(null,1),money(null,1)),
    ARCHIVED:metric(1,money('1000.00'),money('2000.00')),
   }:{SUBMITTED:metric(1,money('500.25'),money('1500.25'))};
   const total=Object.values(states).reduce((sum,value)=>sum+value.total,0);
   const summary={role:'ORGANIZATION',today:'2026-11-03',report:{organizationId:'org-fixture',generatedAt:'2026-11-03T10:00:00Z',digest:'ui-fixture',states,items:[],units:[],unitsAvailable:false},
    opportunities:{total:10,open:5,closing_soon:2},applications:{total,active:5,by_status:Object.fromEntries(Object.entries(states).map(([key,value])=>[key,value.total])),submittedBudget:money('999999999999.99')},
    budget:{total:admin?'1430568.14':'500.25',missing:admin?2:0},deadlines:[],deadline_total:0,source_totals:[],recent_opportunities:[],unit_totals:null,budget_by_status:[]};
   await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());let body={items:[]};
    if(!['GET','HEAD'].includes(request.method()))writes.push(url.pathname);
    if(url.pathname.includes('/auth/session'))body={user:{id:'ui-fixture',name:'Utilizador de teste',platformRoles:[]},organization:{id:'org-fixture',name:'Entidade de teste',profileCode:role,profileLabel:admin?'Administrador do cliente':'Membro da organização'}};
    else if(url.pathname==='/api/auth/csrf')body={csrfToken:'synthetic-ui-token'};
    else if(url.pathname==='/api/organizations/org-fixture/dashboard/summary')body=summary;
    else if(url.pathname==='/api/applications/browse')body={items:[],total:0,page:1,pageSize:25,countsByStatus:{},nextCursor:null,previousCursor:null};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   });
   const widths=[];
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1100});await page.goto(base+'/dashboard');await page.getByRole('button',{name:'Indicadores operacionais',exact:true}).click({timeout:5000}).catch(async error=>{console.error(page.url(),(await page.locator('body').innerText()).slice(0,600),errors);throw error;});
    const section=page.getByRole('region',{name:'Orçamentos por estado'});await section.waitFor();
    const colors=[];
    for(const [status,label] of Object.entries(labels)){
     const row=section.locator(`li[data-status="${status}"]`),link=row.getByRole('link',{name:label,exact:true});
     assert.equal(await link.count(),1,'PRIMARY_STATE_MISSING');
     assert.equal(await link.getAttribute('href'),'/candidaturas?status='+status);
     colors.push(await row.evaluate(node=>getComputedStyle(node).borderLeftColor));
    }
    if(admin){
     assert.equal(await section.locator('li[data-status="REJECTED"]').getByText('Não disponível',{exact:true}).count(),1);
     assert.equal(await section.locator('li[data-status="PREPARATION"]').getByText('1 sem valor',{exact:true}).count(),1);
     assert.equal(await section.locator('li[data-status="SUBMITTED"]').getByText('150 000,25 €',{exact:true}).count(),1);
     assert.equal(await section.locator('li[data-status="ARCHIVED"]').count(),1);
    }else{
     assert.equal(await section.locator('li[data-status="SUBMITTED"]').getByText('500,25 €',{exact:true}).count(),1);
     assert.equal(await section.locator('li[data-status="ARCHIVED"]').count(),0);
     assert.equal(await section.getByText('1 234 567,89 €',{exact:true}).count(),0,'UNRELATED_SCOPE_VISIBLE');
    }
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'PAGE_OVERFLOW');
    assert(await section.evaluate(node=>node.scrollWidth<=node.clientWidth+1),'BUDGET_SECTION_OVERFLOW');
    await page.screenshot({path:path.join(out,role+'-'+width+'.png'),fullPage:true,animations:'disabled'});
    if(width===1440)await section.screenshot({path:path.join(out,role+'-budget-'+width+'.png'),animations:'disabled'});
    const submitted=section.locator('li[data-status="SUBMITTED"]').getByRole('link',{name:'Submetida',exact:true});
    await submitted.focus();await page.keyboard.press('Enter');
    await page.waitForURL('**/candidaturas?status=SUBMITTED');
    assert.equal(new URL(page.url()).searchParams.get('status'),'SUBMITTED');
    widths.push({width,colors,keyboardFilterLink:true,overflow:false});
   }
   assert.deepEqual(errors,[],'PAGE_ERRORS');assert.deepEqual(writes.filter(url=>!['/api/notifications/check-deadlines','/api/notifications/refresh-list'].includes(url)),[],'BUSINESS_WRITES');
   results.push({role,widths,exactAmounts:true,missingAmounts:true,scopedSummary:true});await page.close();
  }
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:'PASS',mockedApi:true,realLogin:false,results},null,2));console.log('DASHBOARD_BUDGET_UI_PASS');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
