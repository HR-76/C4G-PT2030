'use strict';
// Post-upgrade verification in the native installation. No business-data mutations.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Pool}=require('../../../backend/node_modules/pg');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const cfg=require('../../../backend/scripts/localPlatform/config'),{totp}=require('../local-platform/login');
async function fingerprint(){
 const config=cfg.readConfig(),result={};
 for(const [database,tables] of [[config.centralDatabase,['public.global_user','public.organization','public.organization_membership','opportunity_catalog.opportunity','opportunity_catalog.revision']],[config.tenantDatabase,['organizational_scope.scope','organizational_scope.person','organizational_scope.person_unit','organizational_scope.person_profile','opportunity_catalog.application']]]){
  const pool=new Pool(cfg.connection(config,database));try{for(const table of tables)result[table]=(await pool.query(`SELECT count(*)::int AS count,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS digest FROM ${table} t`)).rows[0];
   const owner=(await pool.query("SELECT rolsuper,rolcanlogin,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='c4g_f12_admin'")).rows[0];assert.deepEqual(owner,{rolsuper:false,rolcanlogin:false,rolcreatedb:false,rolcreaterole:false});
  }finally{await pool.end()}
 }return result;
}
async function main(){
 const captureOnly=process.argv.includes('--capture-only');
 const state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json'))),access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json')));
 const origin='http://localhost:3000';assert.equal(state.identity.origin,origin);assert.equal(state.snapshot.schema.currentVersion,'026_personal_profile');
 const before=await fingerprint(),out=path.join(cfg.root,'output/playwright/c4g-pilot-people/native');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),writes=[],errors=[],checks=[];
 let stage='LOGIN';const progress=setInterval(()=>console.log('NATIVE_DELIVERY_2',stage),25000);
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.name));
  await page.route('**/api/**',route=>{const r=route.request(),u=new URL(r.url());if(u.origin===origin&&!u.pathname.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(r.method())){writes.push(u.pathname);return route.abort()}return route.continue()});
  await page.goto(origin+'/login');await page.getByRole('button',{name:'Entrar na C4G',exact:true}).click();await page.locator('#username').fill(access.hugo.username);await page.locator('#password').fill(access.hugo.password);await page.locator('#kc-login').click();
  if(access.hugo.totpSecret){await page.locator('#otp').fill(totp(access.hugo.totpSecret));await page.locator('#kc-login').click()}
  await page.waitForURL(origin+'/catalogo');await page.waitForLoadState('networkidle');
  for(const route of captureOnly?[]:['/dashboard','/catalogo','/perfil-organizacao/unidades','/perfil-organizacao/pessoas']){
   stage=route;await page.goto(origin+route);await page.waitForLoadState('networkidle');assert.equal(await page.locator('[role=alert]').count(),0,'NATIVE_PAGE_ALERT');checks.push(route);
  }
  const get=async route=>{const result=await page.evaluate(async({route,org})=>{const response=await fetch(route,{headers:{'X-C4G-Organization':org}});return {status:response.status,data:await response.json()}},{route,org:state.organizationId});assert.equal(result.status,200,route);checks.push(route);return result.data};
  const people=await get('/api/organization-directory/people');assert(people.items.length>0);
  const person=people.items[0];const detail=await get('/api/organization-directory/people/'+person.personId);assert.equal(detail.areas.length,30);assert.equal(detail.permissions.edit,true);
  const own=await get('/api/organization-directory/me');assert.equal(own.person,null);
  assert.equal((await get('/api/organization-directory/matching')).state,'PROFILE_NOT_LINKED');
  assert.equal((await get('/api/organization-directory/matching?personId='+person.personId)).state,'NO_AREAS');
  const memberships=await get('/api/organization-directory/memberships');assert.equal(memberships.canManage,true);assert(memberships.items.some(m=>m.membershipId===state.membershipId));
  const scenes=[['person','/perfil-organizacao/pessoas/'+person.personId,'Ficha da pessoa'],['self','/perfil','Perfil ainda não associado'],['matching','/matching?pessoa='+person.personId,'Perfil sem áreas temáticas'],['access','/utilizadores','Acessos da organização']];
  for(const [name,route,heading] of scenes){stage=name;await page.goto(origin+route);await page.getByRole('heading',{name:heading,exact:true}).waitFor();await page.waitForLoadState('networkidle');assert.equal(await page.locator('[role=alert]').count(),0);
   if(name==='person'){await page.getByRole('button',{name:'Consultar associação e contas'}).click();await page.getByLabel('Conta da organização').waitFor();assert.equal(await page.getByLabel('Conta da organização').inputValue(),'');assert.equal(await page.locator('.area-checkboxes input').count(),30)}
   if(name==='access')await page.getByRole('button',{name:'Suspender acesso'}).first().waitFor();
   for(const width of name==='person'||name==='matching'?[1440,1008,390]:[1440]){await page.setViewportSize({width,height:1000});if(width<769)await page.waitForFunction(()=>document.querySelector('#primary-navigation')?.getAttribute('aria-hidden')==='true');await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0)});await page.waitForFunction(()=>window.scrollY===0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`${name}-${width}.png`),fullPage:true,animations:'disabled'})}
   await page.setViewportSize({width:1440,height:1000});checks.push(route);
  }
  const after=await fingerprint();assert.deepEqual(after,before);
  for(const route of captureOnly?[]:['/api/organization-directory','/api/organization-directory/units','/api/organization-directory/people','/api/opportunities','/api/applications']){
   const status=await page.evaluate(async({route,org})=>(await fetch(route,{headers:{'X-C4G-Organization':org}})).status,{route,org:state.organizationId});assert.equal(status,200,route);checks.push(route);
  }
  assert.equal(writes.length,0);assert.equal(errors.length,0);
  if(!captureOnly)fs.writeFileSync(path.join(cfg.root,'output/playwright/c4g-pilot-people/native-delivery-2.json'),JSON.stringify({result:'PASS',identity:'existing OIDC manager',schema:'016/026',newDeliveryActivated:true,businessDataUnchanged:true,temporaryPrivilegesRemoved:true,ownProfile:'not linked; explicit association required',personAreas:'not filled; no matches invented',businessWrites:writes,pageErrors:errors,checks},null,2));
  console.log(captureOnly?'NATIVE_DELIVERY_2_CAPTURES_PASS':'NATIVE_DELIVERY_2_OIDC_READ_PASS');
 }finally{clearInterval(progress);await browser.close()}
}
main().catch(e=>{console.error(e.code||e.name,e.message?.replace(/https?:\/\/\S+/g,'[local]'));process.exitCode=1});
