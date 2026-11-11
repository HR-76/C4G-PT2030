'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright'),{Pool}=require('../../../backend/node_modules/pg');
const cfg=require('../../../backend/scripts/localPlatform/config'),{fingerprint}=require('../../../backend/scripts/localPlatform/officialSources');
async function main(){
 const out=path.join(cfg.root,'output/playwright/c4g-platform-directory');fs.mkdirSync(out,{recursive:true});
 const config=cfg.readConfig(),access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json'))),origin='http://localhost:3000';
 const central=new Pool(cfg.connection(config,config.centralDatabase)),tenant=new Pool(cfg.connection(config,config.tenantDatabase));
 const authorityDigest=async()=>{const values=[];for(const table of ['organization','global_user','organization_membership','authority_f5_state','platform_admin_assignment'])values.push((await central.query(`SELECT to_jsonb(t)::text row FROM public.${table} t ORDER BY to_jsonb(t)::text`)).rows);return createHash('sha256').update(JSON.stringify(values)).digest('hex')};
 const schemas=['opportunity_catalog','organizational_scope','organization_profile','document_storage'];
 const before={central:await fingerprint(central,['opportunity_catalog']),tenant:await fingerprint(tenant,schemas),authority:await authorityDigest()};
 const errors=[],writes=[];let browser,page,stage='launch';
 const login=async(page,account)=>{
  await page.goto(origin+'/login');await page.getByRole('button',{name:'Entrar na C4G',exact:true}).click();
  await page.locator('#username').fill(account.username);await page.locator('#password').fill(account.password);await page.locator('#kc-login').click();
  await page.waitForURL(u=>u.origin===origin&&u.pathname!=='/login');await page.waitForLoadState('networkidle');
 };
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.name));
  page.on('response',async r=>{if(new URL(r.url()).pathname.startsWith('/api/admin/directory'))console.log('DIRECTORY_HTTP',new URL(r.url()).pathname,r.status())});
  await page.route('**/api/**',route=>{const r=route.request(),u=new URL(r.url());if(!u.pathname.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(r.method())){writes.push(u.pathname);return route.abort()}return route.continue()});
  stage='C4G login';await login(page,access.admin);
  stage='entities';await page.getByRole('link',{name:'Entidades e utilizadores',exact:true}).click();
  await page.getByRole('table',{name:'Entidades registadas'}).waitFor();
  const entities=await page.request.get(origin+'/api/admin/directory/entities');assert.equal(entities.status(),200);const list=await entities.json();assert(list.items.length);
  const capture=async(name)=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(out,`${name}-${width}.png`),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}await page.setViewportSize({width:1440,height:1000})};
  await capture('native-entities');
  stage='entity detail';await page.getByRole('link',{name:`Consultar ${list.items[0].name}`,exact:true}).click();
  await page.getByRole('region',{name:'Dados da entidade'}).waitFor();await page.getByRole('table',{name:'Contas e acessos'}).waitFor();await capture('native-entity');
  stage='users';await page.getByRole('link',{name:'Voltar às entidades'}).click();await page.getByRole('link',{name:'Utilizadores',exact:true}).click();
  await page.getByRole('table',{name:'Contas e acessos'}).waitFor();assert(await page.getByText('Sem vínculo a entidades',{exact:true}).count()>0);await capture('native-users');
  stage='named admin search';await page.getByRole('searchbox').fill('hugo.romao@c4g.pt');await page.getByRole('button',{name:'Pesquisar',exact:true}).click();
  await page.waitForURL('**?q=hugo.romao%40c4g.pt');await page.getByRole('table',{name:'Contas e acessos'}).waitFor();
  assert.equal(await page.getByRole('table').locator('tbody tr').count(),1);assert(await page.getByRole('table').getByText('Administrador C4G',{exact:true}).count()>0);
  stage='organization admin denial';const member=await browser.newPage();member.setDefaultTimeout(30000);await login(member,access.hugo);
  assert.equal(await member.getByRole('link',{name:'Entidades e utilizadores',exact:true}).count(),0);
  assert.equal((await member.request.get(origin+'/api/admin/directory/users')).status(),403);
  stage='fingerprints';assert.deepEqual(await fingerprint(central,['opportunity_catalog']),before.central);assert.deepEqual(await fingerprint(tenant,schemas),before.tenant);assert.equal(await authorityDigest(),before.authority);assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  fs.writeFileSync(path.join(out,'native-verification.json'),JSON.stringify({result:'PASS',observedAt:new Date().toISOString(),oidc:true,entities:list.total,namedAdminListed:true,entityAdminDenied:true,businessDataUnchanged:true,authorityUnchanged:true,viewports:[1440,390]},null,2));console.log('PLATFORM_DIRECTORY_NATIVE_OIDC_PASS');
 }catch(e){console.error('PLATFORM_DIRECTORY_NATIVE_FAILED',stage,e.code||e.name);if(page&&new URL(page.url()).origin===origin){console.log('FAILED_PATH',new URL(page.url()).pathname);await page.screenshot({path:path.join(out,'native-failed.png'),fullPage:true})}process.exitCode=1}finally{await browser?.close();await central.end();await tenant.end()}
}
main().catch(e=>{console.error('PLATFORM_DIRECTORY_NATIVE_FAILED',e.code||e.name);process.exitCode=1});
