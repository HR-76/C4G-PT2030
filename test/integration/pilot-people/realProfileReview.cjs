'use strict';
// Read-only review of the real profile saved by its owner; no profile fixtures.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Pool}=require('../../../backend/node_modules/pg');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const cfg=require('../../../backend/scripts/localPlatform/config'),{totp}=require('../local-platform/login');
async function fingerprint(){
 const config=cfg.readConfig(),result={};
 for(const [database,tables] of [[config.centralDatabase,['public.global_user','public.organization','public.organization_membership','opportunity_catalog.opportunity','opportunity_catalog.revision']],[config.tenantDatabase,['organizational_scope.scope','organizational_scope.person','organizational_scope.person_unit','organizational_scope.person_profile','opportunity_catalog.application']]]){
  const pool=new Pool(cfg.connection(config,database));try{for(const table of tables)result[table]=(await pool.query(`SELECT count(*)::int AS count,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS digest FROM ${table} t`)).rows[0]}finally{await pool.end()}
 }return result;
}
async function main(){
 const state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json'))),access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json')));
 const origin='http://localhost:3000',root='/api/organization-directory';assert.equal(state.identity.origin,origin);
 const before=await fingerprint(),out=path.join(cfg.root,'output/playwright/c4g-pilot-people/real-profile');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),writes=[],errors=[],checks=[];
 let stage='LOGIN';const progress=setInterval(()=>console.log('REAL_PROFILE_REVIEW',stage),25000);
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.name));
  await page.route('**/api/**',route=>{const r=route.request(),u=new URL(r.url());if(u.origin===origin&&!u.pathname.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(r.method())){writes.push(u.pathname);return route.abort()}return route.continue()});
  await page.goto(origin+'/login');await page.getByRole('button',{name:'Entrar na C4G',exact:true}).click();await page.locator('#username').fill(access.hugo.username);await page.locator('#password').fill(access.hugo.password);await page.locator('#kc-login').click();
  if(access.hugo.totpSecret){await page.locator('#otp').fill(totp(access.hugo.totpSecret));await page.locator('#kc-login').click()}
  await page.waitForURL(origin+'/catalogo');await page.waitForLoadState('networkidle');
  const get=async route=>{const r=await page.evaluate(async({route,org})=>{const res=await fetch(route,{headers:{'X-C4G-Organization':org}});return {status:res.status,data:await res.json()}},{route,org:state.organizationId});assert.equal(r.status,200,route);checks.push(route);return r.data};
  const own=await get(root+'/me');assert(own.person);assert.equal(own.profile.membershipId,state.membershipId);assert(own.profile.areaIds.length>0);
  const selected=own.areas.filter(a=>own.profile.areaIds.includes(a.id));assert.equal(selected.length,own.profile.areaIds.length);
  for(const route of ['/perfil-organizacao','/perfil-organizacao/unidades','/perfil-organizacao/pessoas']){stage=route;await page.goto(origin+route);await page.waitForLoadState('networkidle');assert.equal(await page.locator('[role=alert]').count(),0);checks.push(route)}
  await page.getByRole('link',{name:own.person.name,exact:true}).click();await page.getByRole('heading',{name:'Ficha da pessoa',exact:true}).waitFor();checks.push('people -> person');
  stage='PROFILE';await page.goto(origin+'/perfil');await page.getByLabel('Biografia').waitFor();
  // Wrapped textarea labels include their initial text in Playwright's label lookup.
  assert.equal(await page.getByLabel(/^Biografia/).inputValue(),own.profile.biography);assert.equal(await page.getByLabel(/^Palavras-chave/).inputValue(),own.profile.keywords);
  for(const area of own.areas)assert.equal(await page.getByLabel(area.name,{exact:true}).isChecked(),own.profile.areaIds.includes(area.id));
  await page.screenshot({path:path.join(out,'profile-1440.png'),fullPage:true,animations:'disabled'});checks.push('saved profile fields equal API');
  await page.getByRole('link',{name:'Ver oportunidades correspondentes',exact:true}).click();await page.getByRole('heading',{name:'Matching',exact:true}).waitFor();await page.locator('.pilot-matching .table-meta').waitFor();
  const matching=await get(root+'/matching');assert.equal(matching.state,'READY');assert(matching.items.length>0);assert.equal(matching.person.personId,own.person.personId);
  assert.deepEqual((await get(root+'/matching?personId='+own.person.personId)).items,matching.items);
  assert.equal(await page.locator('.pilot-matching tbody tr').count(),matching.items.length);
  for(const row of matching.items){assert(row.matchedAreas.length>0);for(const area of row.matchedAreas){assert(own.profile.areaIds.includes(area.id));assert(area.keywords.length>0)}assert.equal(await page.getByRole('link',{name:row.title,exact:true}).getAttribute('href'),row.href)}
  for(const detail of await page.locator('.pilot-matching details').all())await detail.locator('summary').click();
  for(const width of [1440,1008,390]){stage='MATCHING '+width;await page.setViewportSize({width,height:1000});if(width<769)await page.waitForFunction(()=>document.querySelector('#primary-navigation')?.getAttribute('aria-hidden')==='true');await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0)});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`matching-${width}.png`),fullPage:true,animations:'disabled'})}
  await page.setViewportSize({width:1440,height:1000});
  for(const row of matching.items){stage='OPPORTUNITY';await page.goto(origin+row.href);await page.waitForLoadState('networkidle');assert.equal(await page.locator('[role=alert]').count(),0);assert((await page.locator('main').innerText()).includes(row.title));
   const reverse=await get(root+'/matching?opportunityId='+row.opportunityId+'&origin='+row.origin);assert(reverse.items.some(p=>p.personId===own.person.personId));checks.push(row.href+' -> matching person');
  }
  const afterProfile=await get(root+'/me');assert.deepEqual(afterProfile.profile,own.profile);assert.deepEqual(await fingerprint(),before);assert.equal(writes.length,0);assert.equal(errors.length,0);
  const proof={result:'PASS',checkedAt:new Date().toISOString(),identity:'existing OIDC manager',businessDataUnchanged:true,businessWrites:writes,pageErrors:errors,profile:{name:own.person.name,revision:own.profile.revision,associatedWithCurrentMembership:true,biographyPresent:Boolean(own.profile.biography),keywordsPresent:Boolean(own.profile.keywords),selectedAreas:selected.map(a=>a.name),uiEqualsSavedProfile:true},matching:{state:matching.state,items:matching.items.map(({opportunityId,title,origin,href,closingDate,matchedAreas})=>({opportunityId,title,origin,href,closingDate,matchedAreas})),explanation:matching.explanation},checks};
  fs.writeFileSync(path.join(out,'review.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof,null,2));
 }catch(error){
  const page=browser.contexts()[0]?.pages()[0];
  if(stage!=='LOGIN'&&page)await page.screenshot({path:path.join(out,'review-failure.png'),fullPage:true,animations:'disabled'});
  throw error;
 }finally{clearInterval(progress);await browser.close()}
}
main().catch(e=>{console.error(e.code||e.name,e.message?.replace(/https?:\/\/\S+/g,'[local]'));process.exitCode=1});
