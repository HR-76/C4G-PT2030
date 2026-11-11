'use strict';
// Read-only by default. --populate performs the explicitly authorized initial
// directory entry using the real UI, and refuses to overwrite existing content.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const {folder,root}=require('../../../backend/scripts/localPlatform/config');
const {totp}=require('./login');
const description='A C4G – Consulting and Training Network é uma empresa portuguesa, em atividade desde 2001, dedicada à consultoria de gestão, formação certificada e desenvolvimento de projetos nacionais e internacionais. Apoia organizações no desenvolvimento de competências, inovação e investimento.';
const units=['Departamento de Formação','Gabinete de Projetos e Investimentos','Departamento Internacional'];
async function main(){
 const populate=process.argv.includes('--populate');
 if(process.argv.slice(2).some(a=>a!=='--populate'))throw Error('INVALID_ARGUMENT');
 const state=JSON.parse(fs.readFileSync(path.join(folder,'runtime.json'))),access=JSON.parse(fs.readFileSync(path.join(folder,'access.json')));
 assert.equal(state.identity.origin,'http://localhost:3000');assert.equal(state.funding.source,'live-local');
 const output=path.join(root,'context/reviews/local-platform-consolidation');fs.mkdirSync(output,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 let stage='START',active;const writes=[],errors=[],checks={};
 const diagnostic=setInterval(()=>console.log('BROWSER_PROGRESS',stage),30000);
 try{
  async function login(account){
   stage='LOGIN_'+account.username;const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();active=page;
   context.setDefaultTimeout(20000);context.setDefaultNavigationTimeout(30000);
   page.on('pageerror',e=>errors.push(e.name));
   page.on('request',r=>{const u=new URL(r.url());if(u.origin===state.identity.origin&&u.pathname.startsWith('/api/')&&!u.pathname.startsWith('/api/auth/')&&r.method()!=='GET')writes.push({method:r.method(),path:u.pathname})});
   await page.goto(state.identity.origin+'/login');await page.getByRole('button',{name:'Entrar na C4G',exact:true}).click();
   await page.locator('#username').fill(account.username);await page.locator('#password').fill(account.password);await page.locator('#kc-login').click();
   if(account.totpSecret){await page.locator('#otp').waitFor();await page.locator('#otp').fill(totp(account.totpSecret));await page.locator('#kc-login').click();}
   await page.waitForURL(u=>u.origin===state.identity.origin&&!u.pathname.startsWith('/api/'),{timeout:30000});await page.waitForLoadState('networkidle',{timeout:15000});return page;
  }
  const get=async(page,route,org=state.organizationId)=>{await page.waitForLoadState('networkidle');return page.evaluate(async({route,org})=>{const r=await fetch(route,{headers:{'X-C4G-Organization':org}});return {status:r.status,data:await r.json()}},{route,org})};
  const visit=async(page,route)=>{await page.goto(state.identity.origin+route);await page.waitForLoadState('networkidle');
   // The UI serializes authority requests. Network-idle alone can occur while
   // a request is still queued, so wait for the actual usable page as well.
   if(route==='/perfil-organizacao'){await page.getByRole('button',{name:'Editar dados',exact:true}).waitFor();await page.getByRole('button',{name:'Verificar disponibilidade',exact:true}).waitFor();}
   if(route.endsWith('/unidades'))await page.getByRole('button',{name:'Criar unidade',exact:true}).waitFor();
   if(route.endsWith('/pessoas')){await page.getByRole('button',{name:'Registar pessoa',exact:true}).waitFor();await page.getByText('A consultar pessoas…',{exact:true}).waitFor({state:'hidden'});}
  };
  const hugo=await login(access.hugo);stage='PROFILE';await visit(hugo,'/perfil-organizacao');
  await hugo.getByRole('button',{name:'Editar dados',exact:true}).waitFor();
  let profile=await get(hugo,'/api/organization-directory');assert.equal(profile.status,200);assert.equal(profile.data.permissions.edit,true);
  if(populate&&!profile.data.profile.revision){
   assert.equal(profile.data.profile.description,'');await hugo.getByRole('button',{name:'Editar dados',exact:true}).click();
   await hugo.getByLabel('Descrição',{exact:true}).fill(description);await hugo.getByLabel('Email de contacto',{exact:true}).fill('suporte@c4g.pt');await hugo.getByLabel('Website',{exact:true}).fill('https://www.c4g.pt/');
   await hugo.getByRole('button',{name:'Guardar alterações',exact:true}).click();await hugo.getByText('Alterações guardadas.',{exact:true}).waitFor();await hugo.waitForLoadState('networkidle');
  }
  stage='UNITS';await visit(hugo,'/perfil-organizacao/unidades');
  let list=await get(hugo,'/api/organization-directory/units');assert.equal(list.status,200);
  if(populate)for(const label of units){if(list.data.items.some(u=>u.label===label))continue;
   await hugo.getByRole('button',{name:'Criar unidade',exact:true}).click();await hugo.getByLabel('Nome da unidade',{exact:true}).fill(label);
   await hugo.getByRole('button',{name:'Guardar alterações',exact:true}).click();await hugo.getByText('Alterações guardadas.',{exact:true}).waitFor();await hugo.waitForLoadState('networkidle');
   await hugo.getByRole('button',{name:'Criar unidade',exact:true}).waitFor();
   list=await get(hugo,'/api/organization-directory/units');assert.equal(list.status,200);
  }
  assert.ok(units.every(label=>list.data.items.some(u=>u.label===label)));await hugo.getByRole('button',{name:'Criar unidade',exact:true}).waitFor();await hugo.getByText('Departamento Internacional',{exact:true}).first().waitFor();await hugo.screenshot({path:path.join(output,'units.png'),fullPage:true});
  stage='PEOPLE';await visit(hugo,'/perfil-organizacao/pessoas');
  let people=await get(hugo,'/api/organization-directory/people');assert.equal(people.status,200);
  if(populate&&!people.data.items.some(p=>p.email==='hugo.romao@c4g.pt')){
   assert.ok(!people.data.items.some(p=>p.name==='Hugo Romão'));
   await hugo.getByRole('button',{name:'Registar pessoa',exact:true}).click();
   await hugo.getByLabel('Nome da pessoa',{exact:true}).fill('Hugo Romão');await hugo.getByLabel('Email (opcional)',{exact:true}).fill('hugo.romao@c4g.pt');
   await hugo.getByLabel('Função (opcional)',{exact:true}).fill('Contacto de projetos');await hugo.getByRole('button',{name:'Guardar alterações',exact:true}).click();await hugo.getByText('Alterações guardadas.',{exact:true}).waitFor();await hugo.waitForLoadState('networkidle');
  }
  await visit(hugo,'/perfil-organizacao/pessoas');await hugo.getByRole('button',{name:'Editar Hugo Romão',exact:true}).waitFor();
  people=await get(hugo,'/api/organization-directory/people');const person=people.data.items.find(p=>p.email==='hugo.romao@c4g.pt');assert.equal(person.name,'Hugo Romão');assert.equal(person.primaryUnitId,null);
  await hugo.screenshot({path:path.join(output,'people.png'),fullPage:true});checks.people=people.data.items.length;checks.units=list.data.items.length;
  stage='PROFILE_RELOAD';await visit(hugo,'/perfil-organizacao');profile=await get(hugo,'/api/organization-directory');
  assert.equal(profile.data.profile.description,description);assert.equal(profile.data.profile.email,'suporte@c4g.pt');assert.equal(profile.data.organization.typeCode,'COMPANY');
  await hugo.screenshot({path:path.join(output,'organization.png'),fullPage:true});
  for(const width of [768,390]){await hugo.setViewportSize({width,height:950});await hugo.screenshot({path:path.join(output,'organization-'+width+'.png'),fullPage:true,animations:'disabled'});assert.ok(await hugo.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  await hugo.setViewportSize({width:1440,height:1000});checks.profileRevision=profile.data.profile.revision;
  stage='CATALOG';await visit(hugo,'/catalogo');
  const all=await get(hugo,'/api/central-opportunities'),current=await get(hugo,'/api/central-opportunities?closingFrom='+new Date().toISOString().slice(0,10));
  assert.equal(all.status,200);assert.equal(all.data.items.length,9);assert.equal(current.data.items.length,4);assert.equal(all.data.sourceMode,'live-local');
  await hugo.screenshot({path:path.join(output,'catalog.png'),fullPage:true});
  for(const [index,row] of current.data.items.entries()){const id=row.opportunityId;assert.ok(id);await visit(hugo,'/catalogo/'+id);const detail=await get(hugo,'/api/central-opportunities/'+id);assert.equal(detail.status,200);assert.ok(detail.data.snapshot);
   await hugo.getByRole('heading',{name:detail.data.snapshot.title,exact:true}).waitFor();await hugo.getByRole('link',{name:'Consultar fonte oficial',exact:true}).waitFor();
   await hugo.getByRole('link',{name:'Criar candidatura nesta organização',exact:true}).waitFor();await hugo.screenshot({path:path.join(output,'detail-'+(index+1)+'.png'),fullPage:true});}
  checks.catalog=9;checks.currentDetails=4;
  checks.managerAdminStatus=(await get(hugo,'/api/admin/integrations/funding-tenders')).status;assert.equal(checks.managerAdminStatus,403);
  checks.foreignOrganizationStatus=(await get(hugo,'/api/organization-directory','00000000-0000-4000-8000-000000000099')).status;assert.equal(checks.foreignOrganizationStatus,409);
  checks.privateApplicationsStatus=(await get(hugo,'/api/applications')).status;assert.equal(checks.privateApplicationsStatus,200);
  stage='ADMIN';const admin=await login(access.admin);await visit(admin,'/integracoes');
  await admin.getByRole('heading',{name:'ADMIN · Fontes de oportunidades',exact:true}).waitFor();
  const status=await get(admin,'/api/admin/integrations/funding-tenders');assert.equal(status.status,200);assert.equal(status.data.sourceMode,'live-local');assert.equal(status.data.lastRun.status,'SUCCESS');
  assert.equal(await admin.getByRole('button',{name:'Atualizar agora',exact:true}).isEnabled(),true);
  checks.adminPrivateStatus=(await get(admin,'/api/organization-directory')).status;assert.notEqual(checks.adminPrivateStatus,200);
  await admin.screenshot({path:path.join(output,'admin.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.ok(writes.every(w=>w.path.startsWith('/api/organization-directory')));if(!populate)assert.deepEqual(writes,[]);
  fs.writeFileSync(path.join(output,populate?'population.json':'verification.json'),JSON.stringify({at:new Date().toISOString(),checks,writes,pageErrors:errors,externalCollections:0},null,2));
  console.log('CONSOLIDATED_BROWSER_PASS',JSON.stringify({checks,businessWrites:writes.length}));
 }catch(error){console.error('CONSOLIDATED_BROWSER_STAGE',stage,error.code||error.name);if(active)await active.screenshot({path:path.join(folder,'consolidation/browser-failure.png'),fullPage:true}).catch(()=>{});throw error;
 }finally{clearInterval(diagnostic);await browser.close()}
}
if(require.main===module)main().catch(()=>{process.exitCode=1});
module.exports={main};
