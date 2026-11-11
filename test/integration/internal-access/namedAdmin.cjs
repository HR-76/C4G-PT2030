'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright'),{Pool}=require('../../../backend/node_modules/pg');
const cfg=require('../../../backend/scripts/localPlatform/config');
(async()=>{
 const record=JSON.parse(fs.readFileSync(path.join(cfg.folder,'named-admins/hugo.romao-at-c4g.pt.json'))),config=cfg.readConfig();
 assert.equal(record.status,'READY');const pool=new Pool(cfg.connection(config,config.centralDatabase));let browser;
 try{
  const identity=await require('../../../backend/src/security/identityRepository').createIdentityRepository(pool).resolve({iss:record.issuer,sub:record.subject});assert.deepEqual(identity.platformRoles,['C4G_ADMIN']);
  await require('../../../backend/src/fundingTenders/repository').createFundingRepository({pool}).status(identity.id);
  const memberships=(await pool.query('SELECT count(*)::int n FROM public.organization_membership WHERE global_user_id=$1',[identity.id])).rows[0].n;assert.equal(memberships,0);
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const page=await browser.newPage();page.setDefaultTimeout(40000);
  await page.goto('http://localhost:3000/login');await page.getByRole('button',{name:'Entrar na C4G',exact:true}).click();await page.locator('#username').fill(record.username);await page.locator('#password').fill(record.password);await page.locator('#kc-login').click();
  await page.locator('#password-new').waitFor();await page.locator('#password-confirm').waitFor();assert.equal(await page.locator('#password-new').inputValue(),'');
  // Do not choose the user's permanent password or complete the required action.
  const out=path.join(cfg.root,'output/playwright/c4g-internal-access/named-admin-verification.json');fs.writeFileSync(out,JSON.stringify({result:'PASS',observedAt:new Date().toISOString(),platformRole:'C4G_ADMIN',platformReadAllowed:true,privateMemberships:memberships,temporaryPasswordAccepted:true,firstLoginPasswordChangeRequired:true,passwordChangeCompleted:false},null,2));console.log('NAMED_ADMIN_FIRST_LOGIN_PASS');
 }finally{await browser?.close();await pool.end()}
})().catch(e=>{console.error('NAMED_ADMIN_FIRST_LOGIN_FAILED',e.code||e.name);process.exitCode=1});
