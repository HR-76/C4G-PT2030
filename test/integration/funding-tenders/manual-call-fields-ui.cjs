'use strict';
// Real built UI, synthetic intercepted API. No habitual API or database writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const root=path.resolve(__dirname,'../../..'),dist=path.join(root,'frontend/dist');
const output=path.join(root,'output/playwright/manual-call-fields');
async function main(){
  assert.equal(process.argv[2],'--isolated');fs.mkdirSync(output,{recursive:true});
  const report={status:'RUNNING',checks:[],scope:'BUILT_UI_WITH_SYNTHETIC_API_ONLY'};
  const state={posts:[],status:502,unexpected:[],errors:[]};
  const id='00000000-0000-4000-8000-000000000002';
  const server=http.createServer((req,res)=>{
    const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'');
    let file=path.resolve(dist,relative);
    if(!file.startsWith(dist+path.sep)){res.writeHead(404);return res.end();}
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())file=path.join(dist,'index.html');
    const type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[path.extname(file)]||'application/octet-stream';
    res.writeHead(200,{'content-type':type});fs.createReadStream(file).pipe(res);
  });
  let browser;
  const check=(name,condition)=>{assert.ok(condition,name);report.checks.push({name,status:'PASS'});};
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
    page.on('pageerror',error=>state.errors.push(error.message));
    await context.route('**/api/**',async route=>{
      const req=route.request(),pathname=new URL(req.url()).pathname;let data={},status=200;
      if(pathname==='/api/auth/session')data={user:{id:'00000000-0000-4000-8000-000000000001',name:'Admin sintético',platformRoles:['C4G_ADMIN']},organization:null};
      else if(pathname==='/api/auth/csrf')data={csrfToken:'synthetic-only'};
      else if(pathname==='/api/catalog-read/v1/availability'){status=503;data={error:{code:'SIMULATED_CATALOG_DISABLED'}};}
      else if(pathname==='/api/admin/central-opportunities'&&req.method()==='POST'){
        state.posts.push(req.postDataJSON());status=state.status;
        data=status===201?{opportunityId:id,revisionId:id,rowVersion:1,revisionNumber:1}:{error:{code:'SIMULATED_FAILURE'}};
      }else if(pathname==='/api/admin/central-opportunities/'+id)data={opportunityId:id,revisionId:id,source:'C4G_MANUAL',snapshot:{...state.posts.at(-1)?.fields,lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW'}};
      else if(pathname==='/api/admin/central-opportunities')data={items:[],programmes:[],nextCursor:null};
      else {state.unexpected.push({method:req.method(),pathname});status=503;}
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    });
    const formUrl=origin+'/administracao/oportunidades/nova';
    await page.goto(formUrl);
    const values={title:'Oportunidade de ensaio',funderName:'Financiador de ensaio',geographySummary:'Portugal e Espanha\nAtividades presenciais ou remotas.',eligibleGroups:'Universidades, PME e associações.',eligibilitySummary:'Consórcio de duas entidades.\nApresentar plano e orçamento. <b>Texto literal</b>'};
    for(const [name,value] of Object.entries(values))await page.locator(`[name="${name}"]`).fill(value);
    check('optional_fields_are_not_required',await page.locator('[name="geographySummary"]').getAttribute('required')===null&&await page.locator('[name="eligibleGroups"]').getAttribute('required')===null);
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:1000});
      await page.screenshot({path:path.join(output,`form-${width}.png`),fullPage:true});
      check(`form_no_overflow_${width}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
    await page.getByRole('button',{name:'Criar',exact:true}).click();
    const retry=page.getByRole('button',{name:'Repetir confirmação',exact:true});await retry.waitFor();
    const original=JSON.stringify(state.posts[0]);
    for(const name of Object.keys(values))check(`submitted_${name}`,state.posts[0].fields[name]===values[name]);
    await page.reload();await retry.waitFor();
    check('no_automatic_resubmit',state.posts.length===1);
    for(const [name,value] of Object.entries(values))check(`recovered_${name}`,await page.locator(`[name="${name}"]`).inputValue()===value&&await page.locator(`[name="${name}"]`).isDisabled());
    state.status=201;await retry.click();await page.getByRole('heading',{name:values.title,exact:true}).waitFor();
    check('identical_retry',state.posts.length===2&&JSON.stringify(state.posts[1])===original);
    for(const name of ['geographySummary','eligibleGroups','eligibilitySummary'])check(`detail_${name}`,await page.getByText(values[name],{exact:true}).isVisible());
    check('html_is_literal',await page.getByText(values.eligibilitySummary,{exact:true}).locator('b').count()===0);
    await page.getByRole('button',{name:'Fechar notificação',exact:true}).click();
    for(const width of [390,1440]){
      await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(output,`detail-${width}.png`),fullPage:true});
      check(`detail_no_overflow_${width}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
    await page.goto(formUrl);await page.getByRole('button',{name:'Criar',exact:true}).waitFor();
    check('successful_creation_clears_recovery',await page.locator('[name="geographySummary"]').inputValue()==='');
    check('no_unexpected_api_or_script_error',state.unexpected.length===0&&state.errors.length===0);
    report.status='PASS';report.postAttempts=state.posts.length;report.uniqueRequestIds=new Set(state.posts.map(p=>p.requestId)).size;
  }catch(error){report.status='FAIL';report.error=error.message;report.unexpected=state.unexpected;report.pageErrors=state.errors;process.exitCode=1;}
  finally{await browser?.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
