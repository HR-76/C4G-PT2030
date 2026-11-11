'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID,randomBytes}=require('node:crypto'),express=require('../../../backend/node_modules/express');
async function verify({central,kc,origin,ap,browser,http,login,mount,profileProbe,completionPorts}){
 const out=path.resolve(__dirname,'../../../output/playwright/c4g-admission');fs.mkdirSync(out,{recursive:true});
 // Disposable realm only: reuse the already tested native SPI with its own callback.
 for(const clientId of ['c4g-member-activation','c4g-member-existing']){const c=(await kc.kc('clients?clientId='+clientId))[0];await kc.kc('clients/'+c.id,'PUT',{...c,redirectUris:[...c.redirectUris,origin+'/api/admission-activation/callback']});}
 const workerClient=(await kc.kc('clients?clientId=c4g-member-worker'))[0],workerFile=path.join(process.env.ONBOARDING_JOURNAL_DIR,'admission-worker.json');
 fs.writeFileSync(workerFile,JSON.stringify({purpose:'ADMISSION',issuer:kc.issuer,clientId:workerClient.clientId,clientSecret:(await kc.kc('clients/'+workerClient.id+'/client-secret')).value,certificate:process.env.NODE_EXTRA_CA_CERTS,ownershipKey:randomBytes(32).toString('hex')}),{mode:0o600});
 const worker=require('../../../backend/src/platformOnboarding/memberWorkerClient').createMemberWorkerClient(workerFile);let oidc,bridgeServer;
 const report={result:'RUNNING',stage:'composition',usualEnvironmentTouched:false,checks:[]};
 try{
  const completion=completionPorts?require('../../../backend/src/entityAdmission/completionService').createCompletionService({coordinator:central.coordinator,issuer:kc.issuer,policyVersion:'c4g-user-mfa-v1',assuranceRequirements:{mfa:false,maxAgeSeconds:300,acceptedAcr:['c4g-loa1'],acceptedAmr:['pwd'],amrMode:'any'},mfaPolicyCode:'USER_OPTIONAL',dataResidencyCode:'EU',...completionPorts}):null;
  const service=require('../../../backend/src/entityAdmission/service').createAdmissionService({coordinator:central.coordinator,issuer:kc.issuer,completion,identity:{ensure:x=>worker.call('identity',x)},verification:{verify:x=>oidc.verify(x)}});
  oidc=await require('../../../backend/src/platformOnboarding/oidcActivationAdapter').createOidcActivationAdapter({issuer:kc.issuer,origin,manualClientId:'c4g-member-activation',existingClientId:'c4g-member-existing',callbackPath:'/api/admission-activation/callback',service,passwordReady:subject=>worker.call('passwordReady',{subject})});
  const activation=require('../../../backend/src/platformOnboarding/activationHttp').createActivationHttp({express,service,oidc,origin,identityOrigin:new URL(kc.issuer).origin,bridgeSecret:process.env.C4G_PROOF_BRIDGE_SECRET,purpose:'ADMISSION'});
  const handler=express.Router();handler.use('/api/admission-activation',activation.router);
  handler.use('/assets',express.static(path.resolve(__dirname,'../../../frontend/dist/assets')));
  handler.get('/logo-c4g.png',(req,res)=>res.sendFile(path.resolve(__dirname,'../../../frontend/dist/logo-c4g.png')));
  handler.get(/^\/(?:adesao(?:\/.*)?|perfil-organizacao(?:\/.*)?|login)$/, (req,res)=>res.sendFile(path.resolve(__dirname,'../../../frontend/dist/index.html')));
  mount(handler,service);
  const bridge=express();bridge.use('/bridge',activation.bridge);bridgeServer=bridge.listen(Number(process.env.C4G_MEMBER_BRIDGE_PORT||5285),'0.0.0.0');await new Promise(r=>bridgeServer.once('listening',r));
  const prefix='/api/admin/directory/admissions';
  report.stage='csrf';
  const noCsrf=await ap.context().request.post(origin+prefix,{headers:{Origin:origin},data:{name:'Sem CSRF',email:'csrf@example.invalid',requestId:randomUUID()}});assert.equal(noCsrf.status(),403);
  const create=async email=>{let r=await http(ap,prefix,'POST',{name:'Administrador convidado',email,requestId:randomUUID()});assert.equal(r.status,200,JSON.stringify(r.data));const id=r.data.id;r=await http(ap,prefix+'/'+id+'/resume','POST',{});assert.equal(r.status,200,JSON.stringify(r.data));return id;};
  const issue=async id=>{const r=await http(ap,prefix+'/'+id+'/invitations','POST',{requestId:randomUUID()});assert.equal(r.status,200);return r.data;};
  const before=(await central.pool.query('SELECT (SELECT count(*) FROM public.organization)::int orgs,(SELECT count(*) FROM public.organization_membership)::int members')).rows[0];
  report.stage='new-identity';
  const id=await create('admission-real@example.invalid'),invitation=await issue(id),p=await browser.newPage(),pw=randomBytes(32).toString('hex')+'aZ9!';
  await p.goto(origin+'/api/admission-activation#'+invitation.secret);await p.getByRole('button',{name:/^Continuar/}).click();await p.locator('#password-new').waitFor();await p.locator('#password-new').fill(pw);await p.locator('#password-confirm').fill(pw);await p.locator('input[type=submit],button[type=submit]').last().click();await p.getByRole('heading',{name:'Convite aceite'}).waitFor();
  for(const width of [1440,390]){await p.setViewportSize({width,height:1000});await p.screenshot({path:path.join(out,`accepted-${width}.png`),fullPage:true});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  report.stage='limited-session';
  const resumeLink=await p.getByRole('link',{name:'Completar ficha da entidade',exact:true}).getAttribute('href');assert.equal(resumeLink,'/api/auth/oidc/login?returnTo='+encodeURIComponent('/adesao/'+id));
  await login(p,'admission-real@example.invalid',pw);const context=await http(p,'/api/admissions/mine');assert.equal(context.status,200,JSON.stringify(context.data));assert.equal(context.data.limited,true);assert.equal(context.data.items[0].id,id);
  await p.goto(origin+resumeLink);const fichaHeading=p.getByRole('heading',{name:'Completar ficha da entidade',exact:true});await p.locator('#password').or(fichaHeading).waitFor();if(await p.locator('#password').isVisible()){await p.locator('#password').fill(pw);await p.locator('#kc-login').click();}await fichaHeading.waitFor();
  for(const route of ['/api/central-opportunities','/api/applications','/api/organization-directory/access','/api/admin/directory/entities','/api/admissions/other','/api/auth/organizations']){const r=await http(p,route);assert.equal(r.status,403,route);assert.equal(r.data.error.code,'ADMISSION_REQUIRED');}
  assert.equal((await http(p,'/api/auth/session')).status,200);report.checks.push('Native password, real OIDC session, own admission and default-deny operational APIs');
  await require('./draft-browser-flow').verify({p,id,origin,http,report});
  if(profileProbe)await profileProbe();
  assert.deepEqual((await central.pool.query('SELECT (SELECT count(*) FROM public.organization)::int orgs,(SELECT count(*) FROM public.organization_membership)::int members')).rows[0],before);report.checks.push('No entity, membership or operational grant created');
  // Existing identity from the preceding member regression, no password reset.
  report.stage='existing-identity';
  const existingId=await create('member-real@example.invalid'),oldUser=(await central.pool.query("SELECT id FROM public.global_user WHERE primary_email='member-real@example.invalid'")).rows[0];
  const oldMemberships=(await central.pool.query('SELECT to_jsonb(m) row FROM public.organization_membership m WHERE global_user_id=$1 ORDER BY id',[oldUser.id])).rows;
  assert.equal(oldMemberships.length,2);assert.deepEqual((await central.pool.query('SELECT to_jsonb(m) row FROM public.organization_membership m WHERE global_user_id=$1 ORDER BY id',[oldUser.id])).rows,oldMemberships);
  const oldOp=(await central.pool.query('SELECT receipt,global_user_id FROM public.entity_admission WHERE id=$1',[existingId])).rows[0];assert.equal(oldOp.receipt.mode,'EXISTING');assert.equal(oldOp.global_user_id,oldUser.id);report.checks.push('Existing identity reconciled; two memberships preserved');
  const existingFixture=require('./member-real-flow').takeAdmissionFixture(browser);assert(existingFixture);
  const existingInvite=await issue(existingId),ep=existingFixture.page,credentialsBefore=await kc.kc('users/'+oldOp.receipt.subject+'/credentials');
  await ep.goto(origin+'/api/admission-activation#'+existingInvite.secret);await ep.getByRole('button',{name:/^Continuar/}).click();await ep.locator('#password').waitFor();if(await ep.locator('#username').isVisible())await ep.locator('#username').fill('member-real@example.invalid');await ep.locator('#password').fill(existingFixture.password);await ep.locator('#kc-login').click();await ep.getByRole('heading',{name:'Convite aceite'}).waitFor();
  const existingContext=await http(ep,'/api/admissions/mine');assert.equal(existingContext.status,200);assert.equal(existingContext.data.limited,false);assert.equal(existingContext.data.items[0].id,existingId);assert.equal((await http(ep,'/api/central-opportunities')).status,200);assert.deepEqual(await kc.kc('users/'+oldOp.receipt.subject+'/credentials'),credentialsBefore);assert.deepEqual((await central.pool.query('SELECT to_jsonb(m) row FROM public.organization_membership m WHERE global_user_id=$1 ORDER BY id',[oldUser.id])).rows,oldMemberships);report.checks.push('Existing identity accepts admission through OIDC; original catalogue, memberships and password preserved');
  assert.equal((await http(ep,prefix,'POST',{name:'Forbidden',email:'forbidden@example.invalid',requestId:randomUUID()})).status,403);report.checks.push('CSRF and C4G-only invitation creation enforced by real HTTP');
  report.stage='revocation';
  const blockedId=await create('admission-revoked@example.invalid'),blocked=await issue(blockedId),rp=await browser.newPage();await rp.goto(origin+'/api/admission-activation#'+blocked.secret);await rp.getByRole('button',{name:/^Continuar/}).click();await rp.locator('#password-new').waitFor();assert.equal((await http(ap,prefix+'/'+blockedId+'/cancel','POST',{})).status,200);await rp.locator('#password-new').fill(pw);await rp.locator('#password-confirm').fill(pw);await rp.locator('input[type=submit],button[type=submit]').last().click();
  const blockedUser=(await kc.kc('users?username=admission-revoked%40example.invalid&exact=true'))[0];assert(!(await kc.kc('users/'+blockedUser.id+'/credentials')).some(c=>c.type==='password'));report.checks.push('Cancellation while native password form open blocks password commit');
  if(completion){await require('./completion-real-flow').verify({p,id,origin,http,central,completion,completionPorts,report});}
  else {assert.equal((await http(ap,prefix+'/'+id+'/cancel','POST',{})).status,200);const cancelled=await http(p,'/api/admissions/mine');assert.equal(cancelled.data.items.length,0);assert.equal(cancelled.data.limited,true);assert.equal((await http(p,'/api/central-opportunities')).status,403);assert.equal((await http(p,'/api/auth/logout','POST',{})).status,200);report.checks.push('Cancellation closes resume and catalogue; logout remains available');}
  report.result='PASS';console.log('PASS real admission, limited session, native revocation and preservation');
 }catch(e){report.result='FAIL';report.failureCode=e.code||e.name;throw e;}finally{fs.writeFileSync(path.join(out,'real-verification.json'),JSON.stringify(report,null,2));await worker.close();if(bridgeServer)await new Promise(r=>bridgeServer.close(r));}
}
module.exports={verify};
