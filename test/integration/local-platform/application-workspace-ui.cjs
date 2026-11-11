'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const root=path.resolve(__dirname,'../../..'),dist=path.join(root,'frontend/dist'),out=path.join(root,'output/playwright/application-workspace');
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
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
 const base='http://127.0.0.1:'+server.address().port,results=[];let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  for(const canEdit of [true,false]){
   const role=canEdit?'ORG_ADMIN':'VIEWER',page=await browser.newPage({viewport:{width:1440,height:1000}}),writes=[],errors=[];
   page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());let body={items:[]};
    if(!['GET','HEAD'].includes(request.method()))writes.push({method:request.method(),path:url.pathname});
    if(url.pathname.includes('/auth/session'))body={user:{id:uid(20),name:'Utilizador de teste',platformRoles:[]},organization:{id:uid(21),displayName:'Entidade de teste',profileLabel:canEdit?'Administrador do cliente':'Consulta'}};
    else if(url.pathname==='/api/applications/'+uid(1))body={applicationId:uid(1),opportunityId:uid(2),opportunityTitle:'Aviso de investigação',title:'Preparação do consórcio',responsibleMembershipId:uid(3),deadline:'2027-01-30',status:'IDENTIFIED',revision:1,canEdit,allowedTransitions:[],unitIds:[],totalBudget:'125000.00',organizationBudget:'45000.00',notes:'Preparar proposta conjunta.',createdAt:'2026-11-01T12:00:00Z'};
    else if(url.pathname==='/api/applications/responsibles')body={items:[{membershipId:uid(3),name:'Ana Coordenadora'},{membershipId:uid(4),name:'Bruno Técnico'}]};
    else if(url.pathname==='/api/applications/'+uid(1)+'/work')body={canEdit,revision:1,participants:[{membershipId:uid(3),active:true,eligible:true}],tasks:[{taskId:uid(5),title:'Preparar orçamento',responsibleMembershipId:uid(3),deadline:'2027-01-20',status:'OPEN'},{taskId:uid(6),title:'Rever documentos do consórcio',responsibleMembershipId:uid(4),deadline:'2027-02-01',status:'OPEN'}]};
    else if(url.pathname==='/api/applications/'+uid(1)+'/partners')body={items:[],revision:1,total:0,canEdit};
    else if(url.pathname==='/api/applications/'+uid(1)+'/documents')body={capabilities:{canEdit,canDecide:canEdit,canUpload:canEdit},revision:1,documents:[{documentId:uid(7),versionId:uid(8),filename:'Budget.xlsx',usable:false,state:'QUARANTINED'}],reviews:[{requestId:uid(9),requestedBy:uid(4),requestedAt:'2026-11-02T12:00:00Z',documents:[],decision:'CHANGES_REQUESTED',comment:'Rever as rubricas do orçamento.',decidedAt:null,stale:false,documentsRestricted:false}]};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   });
   const tabs=page.getByRole('tablist',{name:'Secções da candidatura'});
   const choose=async name=>{await tabs.getByRole('tab',{name,exact:true}).click();assert.equal(await page.getByRole('tabpanel').count(),1,'ONLY_ONE_VISIBLE_PANEL');};
   const capture=async(name,width)=>{
    await page.screenshot({path:path.join(out,role+'-'+name+'-'+width+'.png'),fullPage:true,animations:'disabled'});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'PAGE_OVERFLOW_'+name);
   };
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.goto(base+'/candidaturas/'+uid(1));
    const summary=page.getByRole('region',{name:'Resumo de preparação'});
    await summary.getByText('Tarefas abertas: 2.').waitFor();
    await summary.getByText('Versões associadas: 1 · Indisponíveis: 1.').waitFor();
    assert.equal(await page.getByRole('tabpanel').count(),1);
    assert.equal(await tabs.getByRole('tab').count(),5);
    assert.equal(await tabs.getByRole('tab',{name:'Resumo',exact:true}).getAttribute('aria-selected'),'true');
    await capture('overview',width);
    await tabs.getByRole('tab',{name:'Resumo',exact:true}).focus();await page.keyboard.press('ArrowRight');
    assert.equal(await tabs.getByRole('tab',{name:'Documentos',exact:true}).getAttribute('aria-selected'),'true');
    await choose('Resumo');
    if(canEdit){
     const edit=page.getByRole('button',{name:'Editar dados e orçamento',exact:true});await edit.click();
     const dialog=page.getByRole('dialog',{name:'Editar dados e orçamento'});await dialog.waitFor();
     assert.equal(await page.evaluate(()=>document.activeElement.id),'application-title','INITIAL_MODAL_FOCUS');
     await dialog.getByLabel('Título',{exact:true}).fill('Rascunho preservado');
     await dialog.getByRole('button',{name:'Guardar alterações'}).focus();await page.keyboard.press('Tab');
     assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Fechar','FOCUS_TRAP_FORWARD');
     await page.keyboard.press('Shift+Tab');
     assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Guardar alterações','FOCUS_TRAP_BACKWARD');
     await capture('data-modal',width);await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
     assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Editar dados e orçamento','FOCUS_RETURN');
     await choose('Documentos');await choose('Resumo');await edit.click();
     assert.equal(await dialog.getByLabel('Título',{exact:true}).inputValue(),'Rascunho preservado','DRAFT_RETAINED');
     await dialog.getByRole('button',{name:'Fechar',exact:true}).click();
    }else assert.equal(await page.getByRole('button',{name:'Editar dados e orçamento',exact:true}).count(),0);
    for(const [label,target,tab] of [['Preparar orçamento','tarefa-'+uid(5),'Equipa e tarefas'],['Budget.xlsx','documento-'+uid(7),'Documentos'],['Rever alterações solicitadas','revisao-'+uid(9),'Documentos']]){
     await choose('Resumo');await summary.getByRole('link',{name:label,exact:true}).click();
     assert.equal(await tabs.getByRole('tab',{name:tab,exact:true}).getAttribute('aria-selected'),'true','SUMMARY_REVEALS_PANEL');
     assert.equal(await page.evaluate(()=>document.activeElement.id),target,'SUMMARY_FOCUSES_TARGET');
     assert(await page.locator('#'+target).isVisible());
    }
    await choose('Documentos');assert.equal(await page.getByText(/Invalid Date/).count(),0);await capture('documents',width);
    await choose('Equipa e tarefas');await capture('team',width);
    if(canEdit){
     await page.getByRole('button',{name:'Nova tarefa',exact:true}).click();
     const task=page.getByRole('dialog',{name:'Nova tarefa'});await task.getByLabel('Título da tarefa').fill('Rascunho de tarefa');
     await page.keyboard.press('Escape');await choose('Documentos');await choose('Equipa e tarefas');
     await page.getByRole('button',{name:'Nova tarefa',exact:true}).click();assert.equal(await task.getByLabel('Título da tarefa').inputValue(),'Rascunho de tarefa');await page.keyboard.press('Escape');
     const addMember=page.getByRole('tabpanel',{name:'Equipa e tarefas'}).getByRole('button',{name:'Adicionar membro',exact:true});
     await addMember.press('Enter');
     const member=page.getByRole('dialog',{name:'Adicionar membro'});
     await member.getByLabel('Membro da equipa',{exact:true}).selectOption(uid(4));
     await capture('member-modal',width);
     await page.keyboard.press('Escape');await member.waitFor({state:'hidden'});
     assert(await addMember.evaluate(button=>document.activeElement===button),'MEMBER_FOCUS_RETURN');
    }else{
     assert.equal(await page.getByRole('button',{name:'Nova tarefa',exact:true}).count(),0);
     assert.equal(await page.getByRole('button',{name:'Adicionar membro',exact:true}).count(),0);
    }
    await choose('Parceiros');await capture('partners',width);
    if(canEdit){
     const addPartner=page.getByRole('tabpanel',{name:'Parceiros'}).getByRole('button',{name:'Adicionar parceiro',exact:true});
     await addPartner.click();const partner=page.getByRole('dialog',{name:'Adicionar parceiro'});
     await partner.getByLabel('Nome da entidade *',{exact:true}).fill('Entidade parceira');await capture('partner-modal',width);await page.keyboard.press('Escape');
     await partner.waitFor({state:'hidden'});
     assert(await page.getByRole('button',{name:'Continuar ficha de parceiro'}).evaluate(button=>document.activeElement===button),'PARTNER_FOCUS_RETURN');
     await choose('Resumo');await choose('Parceiros');await page.getByRole('button',{name:'Continuar ficha de parceiro'}).click();
     assert.equal(await partner.getByLabel('Nome da entidade *',{exact:true}).inputValue(),'Entidade parceira');await page.keyboard.press('Escape');
    }else assert.equal(await page.getByRole('button',{name:'Adicionar parceiro',exact:true}).count(),0);
    await choose('Histórico');await capture('history',width);
   }
   const automaticNotifications=['/api/notifications/check-deadlines','/api/notifications/refresh-list'];
   assert.deepEqual(writes.filter(request=>request.method!=='POST'||!automaticNotifications.includes(request.path)),[],'UNEXPECTED_BUSINESS_WRITE');assert.deepEqual(errors,[],'PAGE_ERRORS');
   results.push({role,widths:[1440,390],tabs:true,modalDraftsPreserved:canEdit,noBusinessWrites:true,mockedNotificationRequests:writes.length});await page.close();
  }
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:'PASS',mockedApi:true,realLogin:false,results},null,2));console.log('APPLICATION_WORKSPACE_UI_PASS');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

