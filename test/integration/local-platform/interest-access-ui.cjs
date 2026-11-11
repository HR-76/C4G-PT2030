'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const root=path.resolve(__dirname,'../../..'),dist=path.join(root,'frontend/dist'),out=path.join(root,'output/playwright/interest-access');
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
  const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const base='http://127.0.0.1:'+server.address().port,results=[];
  for(const role of ['ORG_ADMIN','CONTRIBUTOR']){
   const canManage=role==='ORG_ADMIN',profileLabel=canManage?'Administrador do cliente':'Membro da organização';
   const page=await browser.newPage({viewport:{width:1440,height:1000}}),writes=[],reads=[],errors=[];
   page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
   const unit={unitId:uid(5),label:'Projetos',lifecycle:'ACTIVE'};
   const interest={interestId:uid(1),opportunityId:uid(2),centralRevisionId:uid(3),revision:2,status:'ACTIVE',title:'Aviso de investigação',snapshot:{title:'Aviso de investigação',officialUrl:'https://example.org/official'},notes:'Análise guardada: reunir o consórcio.',unitIds:[unit.unitId],units:[unit],capabilities:{canManage,canCreateApplication:canManage}};
   let application=null;
   const listPath='/interesses?'+new URLSearchParams({q:'investigação',unitId:unit.unitId,status:'ACTIVE'});
   const businessWrites=()=>writes.filter(request=>request.path!=='/api/notifications/check-deadlines');
   await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());let body={items:[]};
    if(!['GET','HEAD'].includes(request.method()))writes.push({method:request.method(),path:url.pathname,payload:request.postDataJSON()});
    else reads.push(url.pathname);
    if(url.pathname.includes('/auth/session'))body={user:{id:'ui-fixture',name:'Utilizador de teste',platformRoles:[]},organization:{id:'org-fixture',name:'Entidade de teste',profileLabel}};
    else if(url.pathname==='/api/auth/csrf')body={csrfToken:'synthetic-ui-token'};
    else if(url.pathname==='/api/opportunity-interests')body={items:[{...interest,revision:1}],nextCursor:null};
    else if(url.pathname==='/api/opportunity-interests/'+uid(1))body=interest;
    else if(url.pathname==='/api/opportunity-interests/units')body={items:[unit]};
    else if(url.pathname==='/api/central-opportunities/'+uid(2))body={opportunityId:uid(2),revisionId:uid(6),lifecycleState:'ACTIVE',snapshot:interest.snapshot};
    else if(url.pathname==='/api/applications/responsibles')body={items:[{membershipId:uid(4),name:'Responsável de teste'}]};
    else if(url.pathname==='/api/applications'&&request.method()==='POST'){
     application={...request.postDataJSON(),applicationId:uid(10),opportunityTitle:interest.title,units:[unit],status:'IDENTIFIED',revision:1,canEdit:canManage,allowedTransitions:[],createdAt:'2026-11-03T10:00:00Z'};
     body=application;
    }
    else if(url.pathname==='/api/applications/'+uid(10))body=application;
    else if(url.pathname==='/api/applications/'+uid(10)+'/work')body={canEdit:canManage,revision:1,participants:[],tasks:[]};
    else if(url.pathname==='/api/applications/'+uid(10)+'/partners')body={items:[],revision:1,total:0,canEdit:canManage};
    else if(url.pathname==='/api/applications/'+uid(10)+'/documents')body={capabilities:{canEdit:canManage,canDecide:canManage,canUpload:canManage},revision:1,documents:[],reviews:[]};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   });
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.goto(base+listPath);
    const action=page.getByRole('link',{name:'Ver interesse de Aviso de investigação'});
    await action.waitFor();
    assert((await action.getAttribute('href')).includes('retorno='));
    assert(await action.evaluate(node=>node.scrollWidth<=node.clientWidth+1),'ACTION_TEXT_CLIPPED');
    if(width===390)await page.getByRole('button',{name:'Abrir menu',exact:true}).click();
    assert(await page.locator('.sidebar-user-role').isVisible());
    assert.equal(await page.locator('.sidebar-user-role').textContent(),profileLabel);
    await page.screenshot({path:path.join(out,role+'-profile-'+width+'.png'),fullPage:true,animations:'disabled'});
    if(width===390)await page.getByRole('button',{name:'Fechar menu',exact:true}).click();
    await page.screenshot({path:path.join(out,role+'-list-'+width+'.png'),fullPage:true,animations:'disabled'});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'LIST_OVERFLOW');
    const create=page.getByRole('button',{name:'Nova candidatura para Aviso de investigação'});
    const beforeWrites=businessWrites().length;
    if(canManage){
     const beforeReads=reads.length;
     await create.focus();await page.keyboard.press('Enter');
     await page.getByRole('heading',{name:'Nova candidatura',exact:true}).waitFor();
     await page.getByRole('button',{name:'Usar análise nas notas da candidatura'}).waitFor();
     const query=new URL(page.url()).searchParams;
     assert.equal(query.get('interesse'),interest.interestId);
     assert.equal(query.get('interesseRevisao'),'2','USES_CURRENT_INTEREST_REVISION');
     assert.equal(query.get('revisao'),uid(6),'USES_CURRENT_CENTRAL_REVISION');
     assert.equal(query.get('retorno'),listPath,'FILTERED_RETURN');
     const openingReads=reads.slice(beforeReads);
     assert(openingReads.indexOf('/api/opportunity-interests/'+uid(1))<openingReads.indexOf('/api/central-opportunities/'+uid(2)),'INTEREST_REVALIDATED_FIRST');
     assert.equal(await page.getByLabel('Título',{exact:true}).inputValue(),interest.title);
     assert(await page.getByLabel('Projetos',{exact:true}).isChecked());
     assert.equal(await page.getByLabel('Notas',{exact:true}).inputValue(),'','NOTES_ARE_OPT_IN');
     assert.equal(await page.getByRole('link',{name:'Fonte oficial',exact:true}).getAttribute('href'),'https://example.org/official');
     assert.equal(businessWrites().length,beforeWrites,'OPENING_NEVER_CREATES');
     await page.screenshot({path:path.join(out,role+'-form-'+width+'.png'),fullPage:true,animations:'disabled'});
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'FORM_OVERFLOW');
     await page.getByRole('link',{name:'Cancelar',exact:true}).click();
     await action.waitFor();assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,listPath,'CANCEL_PRESERVES_FILTERS');
     assert.equal(businessWrites().length,beforeWrites,'CANCEL_NEVER_CREATES');
     await create.click();
     const copy=page.getByRole('button',{name:'Usar análise nas notas da candidatura'});
     await copy.click();assert.equal(await page.getByLabel('Notas',{exact:true}).inputValue(),interest.notes);
     await page.getByLabel('Responsável da organização').selectOption(uid(4));
     await page.getByLabel('Prazo interno',{exact:true}).fill('2027-01-30');
     assert.equal(businessWrites().length,beforeWrites,'ONLY_EXPLICIT_SUBMIT_CREATES');
     await page.getByRole('button',{name:'Criar candidatura',exact:true}).click();
     await page.getByRole('tablist',{name:'Secções da candidatura'}).waitFor();
     assert.equal(new URL(page.url()).pathname,'/candidaturas/'+uid(10));
     assert.equal(new URL(page.url()).searchParams.get('retorno'),listPath);
     assert.equal(businessWrites().length,beforeWrites+1,'EXACTLY_ONE_CREATE');
     const submitted=businessWrites().at(-1);assert.equal(submitted.path,'/api/applications');
     assert.equal(submitted.payload.sourceInterestId,interest.interestId);
     assert.equal(submitted.payload.sourceInterestRevision,2);
     assert.equal(submitted.payload.notes,interest.notes);
     assert.deepEqual(submitted.payload.unitIds,[unit.unitId]);
     await page.getByRole('link',{name:'Voltar',exact:true}).click();await action.waitFor();
     assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,listPath,'CREATED_RETURN_PRESERVES_FILTERS');
    }else assert.equal(await create.count(),0,'MEMBER_CANNOT_CREATE');
    await action.click();await page.getByRole('heading',{level:1,name:interest.title}).waitFor();
    const prep=page.getByRole('region',{name:'Preparar candidatura'});
    await prep.waitFor();
    assert((await prep.boundingBox()).y < (await page.getByRole('heading',{name:'Oportunidade',exact:true}).boundingBox()).y,'PREPARATION_NOT_FIRST');
    if(canManage){
     assert(await prep.getByRole('button',{name:'Abrir candidatura',exact:true}).isEnabled());
     assert(await prep.getByRole('link',{name:'Ver candidaturas associadas'}).count()===1);
    }else{
     assert(await page.getByRole('button',{name:'Abrir candidatura',exact:true}).count()===0);
     await prep.getByText(/O seu acesso atual não permite preparar/).waitFor();
    }
    await page.screenshot({path:path.join(out,role+'-detail-'+width+'.png'),fullPage:true,animations:'disabled'});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'DETAIL_OVERFLOW');
    assert.equal(await page.getByRole('link',{name:'Voltar',exact:true}).getAttribute('href'),listPath);
    assert.equal(await page.getByRole('link',{name:'Fonte oficial',exact:true}).getAttribute('href'),'https://example.org/official');
    if(canManage){
     await prep.getByRole('button',{name:'Abrir candidatura',exact:true}).click();
     await page.getByRole('heading',{name:'Nova candidatura',exact:true}).waitFor();
     assert.equal(new URL(page.url()).searchParams.get('interesse'),uid(1));
     await page.getByRole('button',{name:'Criar candidatura',exact:true}).waitFor();
    }
   }
   assert.equal(businessWrites().length,canManage?2:0,'ONLY_EXPLICIT_CREATES');assert.deepEqual(errors,[],'PAGE_ERRORS');
   results.push({role,profileLabel,widths:[1440,390],directPreparation:canManage,currentRevisions:canManage,notesOptIn:canManage,explicitCreates:businessWrites().length,filterReturn:true,officialLinks:true,preparationVisible:canManage});await page.close();
  }
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:'PASS',mockedApi:true,realLogin:false,results},null,2));console.log('INTEREST_ACCESS_UI_PASS');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});



