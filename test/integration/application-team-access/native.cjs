'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright'),{Pool}=require('../../../backend/node_modules/pg');
const cfg=require('../../../backend/scripts/localPlatform/config'),{fingerprint}=require('../../../backend/scripts/localPlatform/officialSources');
async function main(){
 const out=path.join(cfg.root,'output/playwright/c4g-team-access');fs.mkdirSync(out,{recursive:true});
 const config=cfg.readConfig(),access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json'))),origin='http://localhost:3000';
 const central=new Pool(cfg.connection(config,config.centralDatabase)),tenant=new Pool(cfg.connection(config,config.tenantDatabase));
 const authorityDigest=async()=>{const values=[];for(const table of ['organization_membership','authority_f5_state'])values.push((await central.query(`SELECT to_jsonb(t)::text row FROM public.${table} t ORDER BY to_jsonb(t)::text`)).rows);return createHash('sha256').update(JSON.stringify(values)).digest('hex')};
 const schemas=['opportunity_catalog','organizational_scope','organization_profile','document_storage'];
 const before={central:await fingerprint(central,['opportunity_catalog']),tenant:await fingerprint(tenant,schemas),authority:await authorityDigest()};
 const errors=[],writes=[];let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.name));
  await page.route('**/api/**',route=>{const r=route.request(),u=new URL(r.url());if(!u.pathname.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(r.method())&&!(r.method()==='POST'&&u.pathname==='/api/notifications/check-deadlines')){writes.push(u.pathname);return route.abort()}return route.continue()});
  await page.goto(origin+'/login');await page.getByRole('button',{name:'Entrar na C4G',exact:true}).click();await page.locator('#username').fill(access.hugo.username);await page.locator('#password').fill(access.hugo.password);await page.locator('#kc-login').click();await page.waitForURL(u=>u.origin===origin&&u.pathname!=='/login');await page.waitForLoadState('networkidle');
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/applications/browse');response.catch(()=>{});await page.goto(origin+'/candidaturas');const result=await response;assert.equal(result.status(),200);const list=await result.json();await page.waitForLoadState('networkidle');
  await page.screenshot({path:path.join(out,'native-applications-1440.png'),fullPage:true,animations:'disabled'});
  const reportResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/applications/report');reportResponse.catch(()=>{});await page.goto(origin+'/dashboard');const report=await reportResponse;assert.equal(report.status(),200);const data=await report.json();assert.equal(data.total,list.total);await page.waitForLoadState('networkidle');
  assert.deepEqual(await fingerprint(central,['opportunity_catalog']),before.central);assert.deepEqual(await fingerprint(tenant,schemas),before.tenant);assert.equal(await authorityDigest(),before.authority);assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  fs.writeFileSync(path.join(out,'native-verification.json'),JSON.stringify({result:'PASS',observedAt:new Date().toISOString(),oidc:true,applications:list.total,reportTotal:data.total,businessDataUnchanged:true,membershipsAndGrantsUnchanged:true,technicianProof:'disposable PostgreSQL fixture, no real accounts provisioned'},null,2));console.log('TEAM_ACCESS_NATIVE_OIDC_PASS');
 }finally{await browser?.close();await central.end();await tenant.end()}
}
main().catch(e=>{console.error('TEAM_ACCESS_NATIVE_FAILED',e.code||e.name);process.exitCode=1});
