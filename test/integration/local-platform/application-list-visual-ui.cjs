'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const root=path.resolve(__dirname,'../../..'),dist=path.join(root,'frontend/dist'),out=path.join(root,'output/playwright/application-list-visual');
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const rows=[
 {applicationId:uid(1),opportunityId:uid(11),origin:'CENTRAL',title:'Eficiência solar e armazenamento de energia nas infraestruturas municipais',opportunityTitle:'Portugal 2030 — Transição energética e eficiência dos edifícios públicos',responsibleName:'Ana Maria Rodrigues da Silva',status:'IDENTIFIED',statusChangedAt:'2026-11-02T12:00:00Z',totalBudget:'0',organizationBudget:'125000.00',opportunityClosingDate:'2027-03-31',revision:1,units:[{unitId:uid(40),label:'Departamento de Projetos e Investimentos'}]},
 {applicationId:uid(2),opportunityId:uid(12),origin:'CENTRAL',title:'Consórcio internacional para investigação aplicada à mobilidade sustentável',opportunityTitle:'Horizon Europe — Climate, Energy and Mobility',responsibleName:'João Pedro Almeida e Costa',status:'PREPARATION',statusChangedAt:'2026-10-28T12:00:00Z',totalBudget:'99999999999999.99',organizationBudget:'3250000.25',opportunityClosingDate:'2027-05-14',revision:2,units:[]},
 {applicationId:uid(3),opportunityId:uid(13),origin:'CENTRAL',title:'Capacitação de equipas para transformação digital',opportunityTitle:'Programa de apoio à inovação e qualificação das organizações',responsibleName:null,status:'SUBMITTED',statusChangedAt:null,totalBudget:null,organizationBudget:null,opportunityClosingDate:null,revision:3,units:[]},
 {applicationId:uid(4),opportunityId:uid(14),origin:'CENTRAL',title:'Modernização de laboratórios',opportunityTitle:'Apoio à investigação',responsibleName:'Ana Rodrigues',status:'APPROVED',statusChangedAt:'2026-11-01T12:00:00Z',totalBudget:'150000.00',organizationBudget:'100000.00',opportunityClosingDate:null,revision:2,units:[]},
 {applicationId:uid(5),opportunityId:uid(15),origin:'CENTRAL',title:'Rede de formação regional',opportunityTitle:'Apoio à capacitação regional',responsibleName:'João Costa',status:'REJECTED',statusChangedAt:'2026-11-02T12:00:00Z',totalBudget:'200000.00',organizationBudget:'90000.00',opportunityClosingDate:null,revision:4,units:[]}
];
async function main(){
 fs.mkdirSync(out,{recursive:true});
 const server=http.createServer((req,res)=>{
  const requested=decodeURIComponent(new URL(req.url,'http://localhost').pathname),candidate=path.resolve(dist,'.'+requested);
  if(!candidate.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
  const file=fs.existsSync(candidate)&&fs.statSync(candidate).isFile()?candidate:path.join(dist,'index.html');
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;const results=[];
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const base='http://127.0.0.1:'+server.address().port;
  for(const canEdit of [true,false]){
   const role=canEdit?'ORG_ADMIN':'VIEWER',page=await browser.newPage({viewport:{width:1440,height:1000}}),writes=[],errors=[],queries=[];
   page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());let body={items:[]};
    if(!['GET','HEAD'].includes(request.method()))writes.push({method:request.method(),path:url.pathname});
    if(url.pathname==='/api/auth/session')body={user:{id:uid(20),name:'Utilizador de teste',platformRoles:[]},organization:{id:uid(21),displayName:'Entidade de teste',profileLabel:canEdit?'Administrador do cliente':'Consulta'}};
    else if(url.pathname==='/api/applications/units')body={items:[{unitId:uid(40),label:'Projetos e Investimentos',lifecycle:'ACTIVE'}]};
    else if(url.pathname==='/api/applications/browse'){
     const query=Object.fromEntries(url.searchParams);queries.push(query);
     let items=rows.map(row=>({...row,allowedTransitions:canEdit?[row.status==='IDENTIFIED'?'PREPARATION':'ARCHIVED']:[]}));
     if(query.q)items=items.filter(row=>[row.title,row.opportunityTitle,row.responsibleName].filter(Boolean).join(' ').toLocaleLowerCase('pt-PT').includes(query.q.toLocaleLowerCase('pt-PT')));
     if(query.status)items=items.filter(row=>row.status===query.status);
     if(query.unitId)items=items.filter(row=>query.unitId==='NONE'?!row.units.length:row.units.some(unit=>unit.unitId===query.unitId));
     if(query.sort)items.sort((a,b)=>String(a[query.sort]??'').localeCompare(String(b[query.sort]??''),'pt-PT')*(query.direction==='desc'?-1:1));
     const filtered=Boolean(query.q||query.status||query.unitId);
     body={items,total:filtered?items.length:10,countsByStatus:{IDENTIFIED:2,PREPARATION:2,SUBMITTED:2,APPROVED:2,REJECTED:2},page:query.cursor==='next'?2:1,pageSize:5,nextCursor:filtered||query.cursor==='next'?null:'next',previousCursor:query.cursor==='next'?'previous':null};
    }else if(url.pathname.startsWith('/api/applications/')&&!url.pathname.slice('/api/applications/'.length).includes('/')){
     const row=rows.find(row=>url.pathname.endsWith(row.applicationId));if(row)body={...row,responsibleMembershipId:uid(30),deadline:'2027-03-01',canEdit,allowedTransitions:[],unitIds:[]};
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   });
   for(const width of [1440,1024,390]){
    await page.setViewportSize({width,height:1000});await page.goto(base+'/candidaturas');
    await page.getByRole('link',{name:rows[0].title,exact:true}).waitFor();
    assert.equal(await page.locator('tbody tr').count(),5,'FIVE_MAIN_STATES');
    assert.equal(await page.locator('thead th').count(),9,'PRESERVE_DATA_AND_ADD_FINAL_ACTION');
    assert.equal(await page.locator('thead th:last-child').textContent(),'Ações','OPEN_ACTION_LAST');
    const openAction=page.getByRole('link',{name:'Abrir candidatura '+rows[0].title,exact:true});
    assert.equal(await openAction.getAttribute('href'),await page.getByRole('link',{name:rows[0].title,exact:true}).getAttribute('href'),'EXPLICIT_OPEN_ACTION');
    assert.equal(await page.getByRole('link',{name:'Nova candidatura',exact:true}).getAttribute('href'),'/candidaturas?ver=interesses','NEW_APPLICATION_DESTINATION');
    assert.equal(new Set(await page.locator('tbody tr').evaluateAll(items=>items.map(row=>getComputedStyle(row).backgroundColor))).size,5,'STATE_ROW_COLOURS');
    for(const label of ['Identificada','Em preparação','Submetida','Aprovada','Reprovada'])assert(await page.getByRole('button',{name:label+' 2',exact:true}).isVisible(),'MAIN_STATE_VISIBLE');
    assert(await page.getByRole('link',{name:rows[0].title,exact:true}).getAttribute('href').then(href=>href.startsWith('/candidaturas/'+uid(1)+'?retorno=')),'DETAIL_LINK');
    assert.equal(await page.getByLabel('Estado de '+rows[0].title,{exact:true}).count(),canEdit?1:0,'CAPABILITY_CONTROL');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'PAGE_OVERFLOW_'+width);
    const clipped=await page.locator('tbody td').evaluateAll(cells=>cells.filter(cell=>cell.scrollWidth>cell.clientWidth+2).map(cell=>({label:cell.dataset.label,text:cell.textContent.slice(0,50)})));
    assert.deepEqual(clipped,[],'CLIPPED_CELLS_'+width);
    const clippedStates=await page.locator('tbody button.status-select').evaluateAll(selects=>selects.filter(select=>{const style=getComputedStyle(select),canvas=document.createElement('canvas'),context=canvas.getContext('2d');context.font=style.fontWeight+' '+style.fontSize+' '+style.fontFamily;return context.measureText(select.textContent).width+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)>select.clientWidth+1;}).map(select=>select.textContent));
    assert.deepEqual(clippedStates,[],'CLIPPED_STATE_LABEL_'+width);
    await page.screenshot({path:path.join(out,role+'-list-'+width+'.png'),fullPage:true,animations:'disabled'});
    const region=page.getByRole('region',{name:'Tabela de candidaturas',exact:true});
    assert.equal(await region.getAttribute('tabindex'),'0','KEYBOARD_TABLE_ACCESS');
    if(width>768)assert(await openAction.evaluate(node=>{const bounds=node.getBoundingClientRect(),region=node.closest('.table-wrap').getBoundingClientRect();return bounds.left>=region.left&&bounds.right<=region.right+1;}),'OPEN_ACTION_VISIBLE_WITHOUT_SCROLL');
    if(width>768){await region.evaluate(node=>{node.scrollLeft=node.scrollWidth;});assert(await region.evaluate(node=>{const edge=node.getBoundingClientRect().right,last=node.querySelector('thead th:last-child').getBoundingClientRect().right;return last<=edge+1;}),'LAST_COLUMN_REACHABLE');await page.screenshot({path:path.join(out,role+'-list-end-'+width+'.png'),fullPage:true,animations:'disabled'});await region.evaluate(node=>{node.scrollLeft=0;});}
    if(width===390){
     await page.getByLabel('Ordenar por',{exact:true}).selectOption('totalBudget');
     await page.waitForFunction(()=>new URL(location.href).searchParams.get('sort')==='totalBudget');
    }else await page.getByRole('button',{name:'Orç. total',exact:true}).click();
    await page.getByRole('link',{name:rows[0].title,exact:true}).waitFor();
    assert(queries.some(query=>query.sort==='totalBudget'),'SORT_READ_REQUEST');
    await page.getByRole('searchbox',{name:'Pesquisar candidaturas'}).fill('Eficiência');
    await page.getByText('1 candidatura',{exact:true}).waitFor();
    const link=page.getByRole('link',{name:rows[0].title,exact:true}),href=await link.getAttribute('href');
    assert(decodeURIComponent(new URL(href,base).searchParams.get('retorno')).includes('q=Eficiência'),'FILTERED_RETURN');
    await page.getByRole('button',{name:'Limpar filtros',exact:true}).click();await page.getByText('10 candidaturas',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Seguinte',exact:true}).click();await page.getByText('Página 2 de 2',{exact:true}).waitFor();
    assert(queries.some(query=>query.cursor==='next'),'PAGINATION_READ_REQUEST');
    await page.getByRole('button',{name:'Anterior',exact:true}).click();await page.getByText('Página 1 de 2',{exact:true}).waitFor();
    if(canEdit){
     await page.getByLabel('Estado de '+rows[0].title,{exact:true}).click();await page.getByLabel('Novo estado',{exact:true}).selectOption('PREPARATION');
     await page.getByRole('heading',{name:'Alterar estado: '+rows[0].title,exact:true}).waitFor();
     assert(await page.getByRole('button',{name:'Confirmar alteração',exact:true}).isDisabled(),'REASON_REQUIRED');
     await page.getByLabel('Motivo',{exact:true}).fill('Revisão interna concluída');
     assert(await page.getByRole('button',{name:'Confirmar alteração',exact:true}).isEnabled(),'EXPLICIT_CONFIRMATION');
     await page.screenshot({path:path.join(out,role+'-transition-'+width+'.png'),fullPage:true,animations:'disabled'});
     await page.getByRole('button',{name:'Cancelar',exact:true}).click();
    }
   }
   assert.deepEqual(writes.filter(request=>request.path!=='/api/notifications/check-deadlines'),[],'UNEXPECTED_BUSINESS_WRITES');
   assert.deepEqual(errors,[],'PAGE_ERRORS');
   results.push({role,widths:[1440,1024,390],preservedDataColumns:8,finalActionColumn:true,fiveStateRowColours:true,filterSortPagination:true,permissionActions:true,noClippedCells:true,noBusinessWrites:true,mockedDeadlineChecks:writes.length});await page.close();
  }
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:'PASS',mockedApi:true,realLogin:false,results},null,2));console.log('APPLICATION_LIST_VISUAL_UI_PASS');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});



