'use strict';
// Disposable feasibility harness. No production routes, migrations, or credentials.
const assert=require('node:assert/strict'),{randomBytes,randomUUID,createHash,timingSafeEqual}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const express=require('../../../backend/node_modules/express');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const hash=s=>createHash('sha256').update(s).digest('hex'),secret=()=>randomBytes(32).toString('hex');
const origin='http://localhost:5283',kc='http://localhost:8283',realm='c4g-manual-proof',issuer=kc+'/realms/'+realm;
async function run({central,tenants,runtime,base,http,actor,userA,userB}){
 assert.equal(new URL(process.env.F13_S2_ADMIN_URL).port,'5598');
 const out=path.resolve(__dirname,'../../../output/playwright/c4g-onboarding-proof');fs.mkdirSync(out,{recursive:true});
 const evidence={result:'RUNNING',synthetic:true,keycloakVersion:'26.8.0',realOidc:true,usualEnvironmentTouched:false,checks:[]};
 const checks=evidence.checks,transactions=new Map(),activated=new Map(),forms=new Map();let server,browser,configuration,token;
 const openid=await import('../../../backend/node_modules/openid-client/build/index.js');
 const adminLogin=await fetch(kc+'/realms/master/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:'proof-admin',password:process.env.KC_BOOTSTRAP_ADMIN_PASSWORD})});
 assert.equal(adminLogin.status,200,'Disposable identity administration');token=(await adminLogin.json()).access_token;
 async function admin(p,method='GET',body){const r=await fetch(kc+'/admin/realms'+p,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert(r.ok,'Disposable Keycloak administration failed: '+method+' '+p+' '+r.status);return r.status===204||r.headers.get('content-length')==='0'?null:r.json();}
 const bridgeSecret=process.env.C4G_PROOF_BRIDGE_SECRET;
 async function current(ticket,subject=''){
  const row=(await central.pool.query("SELECT * FROM proof_manual.invite WHERE ticket_digest=$1 AND status='OPEN' AND expires_at>clock_timestamp()",[hash(ticket)])).rows[0];
  return row&&(!subject||subject===row.subject)?row:null;
 }
 async function invite(subject,org,kind='new',ttl=3600){const raw=secret(),id=randomUUID();await central.pool.query("INSERT INTO proof_manual.invite(id,subject,organization_id,kind,digest,status,expires_at) VALUES($1,$2,$3,$4,$5,'OPEN',clock_timestamp()+$6*interval '1 second')",[id,subject,org,kind,hash(raw),ttl]);return{id,raw,subject,org,kind};}
 async function status(i){return(await central.pool.query('SELECT status FROM proof_manual.invite WHERE id=$1',[i.id])).rows[0].status;}
 async function revoke(i){await central.pool.query("UPDATE proof_manual.invite SET status='REVOKED' WHERE id=$1 AND status='OPEN'",[i.id]);}
 async function user(label,password){await admin('/'+realm+'/users','POST',{username:label,email:label+'@example.invalid',firstName:'Ensaio',lastName:label,enabled:true,emailVerified:false,...(password?{credentials:[{type:'password',value:password,temporary:false}]}:{})});return(await admin('/'+realm+'/users?username='+label+'&exact=true'))[0].id;}
 async function begin(raw){
  const ticket=secret();const row=(await central.pool.query("UPDATE proof_manual.invite SET ticket_digest=$2 WHERE digest=$1 AND status='OPEN' AND expires_at>clock_timestamp() AND ticket_digest IS NULL RETURNING *",[hash(raw),hash(ticket)])).rows[0];
  if(!row)throw Error('INVITATION_UNAVAILABLE');
  const verifier=openid.randomPKCECodeVerifier(),state=openid.randomState(),nonce=openid.randomNonce();
  transactions.set(state,{ticket,verifier,nonce,inviteId:row.id,kind:row.kind});
  const config=row.kind==='new'?configuration.manual:configuration.existing;
  const target=openid.buildAuthorizationUrl(config,{redirect_uri:origin+'/callback',scope:'openid profile email',response_type:'code',code_challenge:await openid.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',state,nonce,...(row.kind==='new'?{c4g_ticket:ticket}:{prompt:'login'})});return target.href;
 }
 async function consume(ticket,subject,fail=false){const client=await central.pool.connect();try{await client.query('BEGIN');const row=(await client.query("UPDATE proof_manual.invite SET status='USED' WHERE ticket_digest=$1 AND subject=$2 AND status='OPEN' AND expires_at>clock_timestamp() RETURNING *",[hash(ticket),subject])).rows[0];if(!row)throw Error('INVITATION_UNAVAILABLE');if(fail)throw Error('INJECTED_AFTER_CONSUME');await client.query('COMMIT');return row;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
 try{
  evidence.directory=await require('./directory').prepare({central,tenants,runtime});checks.push('real central directory; B preparation failure/retry; early publication refused; API/worker database isolation');
  const created=await http(userA,'/api/applications','POST',{opportunityId:tenants[0].seed.opportunityId,evaluationId:null,title:'Candidatura privada A preservada',responsibleMembershipId:userA.membershipId,deadline:'2027-12-31',idempotencyKey:randomUUID()});assert.equal(created.status,201);
  const applicationId=created.data.applicationId,work=await http(userA,'/api/applications/'+applicationId+'/work');assert.equal(work.status,200);
  const task=await http(userA,'/api/applications/'+applicationId+'/work/tasks','POST',{title:'Tarefa existente preservada',responsibleMembershipId:userA.membershipId,deadline:'2027-11-30',expectedRevision:work.data.revision,idempotencyKey:randomUUID()});assert.equal(task.status,200);
  const preservedTasks=(await tenants[0].pool.query('SELECT to_jsonb(t) row FROM opportunity_catalog.application_task t ORDER BY task_id')).rows;
  await central.pool.query("CREATE SCHEMA proof_manual; CREATE TABLE proof_manual.invite(id uuid PRIMARY KEY,subject text NOT NULL,organization_id uuid NOT NULL REFERENCES public.organization(id),kind text NOT NULL,digest text UNIQUE NOT NULL,ticket_digest text UNIQUE,status text NOT NULL CHECK(status IN('OPEN','REVOKED','USED')),expires_at timestamptz NOT NULL)");
  await admin('','POST',{realm,enabled:true,sslRequired:'none',registrationAllowed:false,resetPasswordAllowed:false,verifyEmail:false,passwordPolicy:'length(12)',loginTheme:'keycloak'});
  await admin('/'+realm+'/authentication/flows','POST',{alias:'manual-proof',providerId:'basic-flow',topLevel:true,builtIn:false});
  await admin('/'+realm+'/authentication/flows/manual-proof/executions/execution','POST',{provider:'c4g-proof-manual'});
  const execution=(await admin('/'+realm+'/authentication/flows/manual-proof/executions'))[0];
  await admin('/'+realm+'/authentication/flows/manual-proof/executions','PUT',{...execution,requirement:'REQUIRED'});
  await admin('/'+realm+'/authentication/register-required-action','POST',{name:'Manual proof password',providerId:'c4g-proof-password'});
  await admin('/'+realm+'/authentication/required-actions/c4g-proof-password','PUT',{alias:'c4g-proof-password',name:'Manual proof password',providerId:'c4g-proof-password',enabled:true,defaultAction:false,priority:10});
  const flow=(await admin('/'+realm+'/authentication/flows')).find(f=>f.alias==='manual-proof');
  for(const id of ['manual-proof','existing-proof'])await admin('/'+realm+'/clients','POST',{clientId:id,protocol:'openid-connect',enabled:true,publicClient:true,standardFlowEnabled:true,directAccessGrantsEnabled:false,redirectUris:[origin+'/callback'],webOrigins:[origin],...(id==='manual-proof'?{authenticationFlowBindingOverrides:{browser:flow.id}}:{})});
  const metadata=await(await fetch(issuer+'/.well-known/openid-configuration')).json();
  configuration={manual:new openid.Configuration(metadata,'manual-proof'),existing:new openid.Configuration(metadata,'existing-proof')};Object.values(configuration).forEach(c=>{openid.allowInsecureRequests(c);openid.enableNonRepudiationChecks(c);});
  const app=express();app.disable('x-powered-by');app.use(express.json());app.use(express.urlencoded({extended:false}));
  app.use((req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});next();});
  app.post('/bridge/check',async(req,res)=>{const supplied=Buffer.from(req.get('X-Proof-Bridge')||''),expected=Buffer.from(bridgeSecret);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return res.sendStatus(403);const row=typeof req.body.ticket==='string'?await current(req.body.ticket,req.body.subject):null;res.status(row?200:403).type('text').send(row?.subject||'Unavailable');});
  app.get('/activate',(req,res)=>{const nonce=secret();forms.set(hash(nonce),Date.now()+600000);res.cookie('proof_form',nonce,{httpOnly:true,sameSite:'strict',path:'/',maxAge:600000});res.type('html').send('<!doctype html><html lang="pt"><meta charset="utf-8"><title>Ensaio isolado C4G</title><h1>Ativar acesso à entidade</h1><p>Ensaio descartável — sem clientes reais.</p><form method="post" action="/begin"><input type="hidden" name="csrf" value="'+nonce+'"><input type="hidden" name="token" id="token"><button>Continuar ativação</button></form><script>document.getElementById("token").value=location.hash.slice(1);history.replaceState(null,"","/activate")</script></html>');});
  app.post('/begin',async(req,res)=>{const cookie=(req.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('proof_form='))?.slice(11),nonce=req.body.csrf;
   if(typeof nonce!=='string'||nonce!==cookie||!(forms.get(hash(nonce))>Date.now())||req.get('sec-fetch-site')!=='same-origin'||![origin,'null'].includes(req.get('origin')))return res.sendStatus(403);
   forms.delete(hash(nonce));try{res.redirect(303,await begin(req.body.token));}catch{res.status(403).send('Ligação indisponível');}});
  app.get('/callback',async(req,res)=>{
   const tx=transactions.get(req.query.state);transactions.delete(req.query.state);
   if(!tx)return res.status(403).send('Ativação recusada');
   try{
    const tokens=await openid.authorizationCodeGrant(tx.kind==='new'?configuration.manual:configuration.existing,new URL(req.originalUrl,origin),{pkceCodeVerifier:tx.verifier,expectedState:req.query.state,expectedNonce:tx.nonce,idTokenExpected:true});
    const claims=tokens.claims();assert.equal(claims.iss,issuer);const pending=await current(tx.ticket,claims.sub);if(!pending)throw Error('INVITATION_UNAVAILABLE');
    const existingGlobal=(await central.pool.query('SELECT global_user_id FROM public.auth_identity_ref WHERE issuer=$1 AND subject=$2',[issuer,claims.sub])).rows[0]?.global_user_id;
    if(existingGlobal){const linked=(await central.pool.query("SELECT organization_id FROM public.organization_membership WHERE global_user_id=$1 AND status IN ('PENDING_PROJECTION','ACTIVE','SUSPENDED') LIMIT 1",[existingGlobal])).rows[0];if(linked&&linked.organization_id!==pending.organization_id)throw Object.assign(Error('MEMBERSHIP_ALREADY_EXISTS'),{code:'MEMBERSHIP_ALREADY_EXISTS'});}
    const row=await consume(tx.ticket,claims.sub);
    // Existing application/session fixture remains explicit; this is not the final provisioning coordinator.
    const globalId=(await central.pool.query('SELECT global_user_id FROM public.auth_identity_ref WHERE issuer=$1 AND subject=$2',[issuer,claims.sub])).rows[0]?.global_user_id||randomUUID();
    const grantCodes=require('../../../backend/src/organizationDirectory/accessProfiles').grantsForProfile({organizationId:row.organization_id,profileCode:'ORG_ADMIN'}).map(g=>g.permission);
    const person=await actor(row.organization_id,grantCodes,globalId,{profileCode:'ORG_ADMIN',displayName:'Administrador de ensaio'});
    await central.pool.query('INSERT INTO public.auth_identity_ref(id,global_user_id,issuer,subject) VALUES($1,$2,$3,$4) ON CONFLICT(issuer,subject) DO NOTHING',[randomUUID(),globalId,issuer,claims.sub]);
    assert.equal((await require('../../../backend/src/security/identityRepository').createIdentityRepository(central.coordinator).resolve(claims)).id,globalId);
    activated.set(row.id,{person,claims});res.redirect(303,'/complete');
   }catch(e){evidence.lastCallbackError={name:e.name,code:e.code||null};res.status(403).send('Ativação recusada');}
  });
  app.get('/complete',(req,res)=>res.type('html').send('<!doctype html><html lang="pt"><meta charset="utf-8"><h1>Acesso ativado</h1><p>Prova isolada C4G — identidade OIDC validada e acesso de ensaio associado.</p></html>'));
  server=app.listen(5283,'0.0.0.0');await new Promise(resolve=>server.once('listening',resolve));
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const newPage=async()=>{const ctx=await browser.newContext({viewport:{width:1280,height:850}});return ctx.newPage();};
  const open=async(i)=>{const before=await status(i),p=await newPage();await p.goto(origin+'/activate#'+i.raw);assert.equal(await status(i),before);await p.getByRole('button',{name:'Continuar ativação'}).click();return p;};
  const setPassword=async(p,pw)=>{await p.locator('#password-new').fill(pw);await p.locator('#password-confirm').fill(pw);await p.locator('input[type=submit],button[type=submit]').last().click();};
  const pw=secret()+'aZ9!';
  const newSubject=await user('new-admin'),i=await invite(newSubject,tenants[1].org);
  const scanner=await fetch(origin+'/activate#'+i.raw);assert.equal(scanner.status,200);assert.equal(await status(i),'OPEN');checks.push('scanner GET does not consume');
  const p=await open(i);await p.locator('#password-new').waitFor();assert.equal(new URL(p.url()).port,'8283');await p.screenshot({path:path.join(out,'native-password-form.png')});await setPassword(p,pw);await p.getByRole('heading',{name:'Acesso ativado'}).waitFor();
  assert.equal(await status(i),'USED');assert(activated.has(i.id));assert.equal((await admin('/'+realm+'/users/'+newSubject)).emailVerified,false);checks.push('new account defines password on real Keycloak; signed OIDC callback verified; email remains unverified');
  await p.screenshot({path:path.join(out,'activation-complete.png')});
  const replay=await open(i);assert.equal(await replay.textContent('body'),'Ligação indisponível');checks.push('used invitation denied');
  const bad=await invite(await user('expired'),tenants[1].org,'new',-1);const expired=await open(bad);assert.equal(await expired.textContent('body'),'Ligação indisponível');checks.push('expired invitation denied');
  const revoked=await invite(await user('revoked'),tenants[1].org);await revoke(revoked);const rev=await open(revoked);assert.equal(await rev.textContent('body'),'Ligação indisponível');checks.push('revoked invitation denied');
  const mid=await invite(await user('revoked-open'),tenants[1].org);const midPage=await open(mid);await midPage.locator('#password-new').waitFor();await revoke(mid);await setPassword(midPage,pw);await midPage.waitForLoadState('networkidle');assert(!activated.has(mid.id));assert.equal((await admin('/'+realm+'/users/'+mid.subject+'/credentials')).filter(c=>c.type==='password').length,0);checks.push('revoked after password form opened: no password stored and no membership activated');
  const replacement=await invite(mid.subject,tenants[1].org);const replacementPage=await open(replacement);await setPassword(replacementPage,pw);await replacementPage.getByRole('heading',{name:'Acesso ativado'}).waitFor();assert.equal(await status(mid),'REVOKED');checks.push('new invitation works; old invitation stays revoked');
  const existingPw=secret()+'aZ9!',existingSubject=await user('existing-admin',existingPw);
  await central.pool.query('INSERT INTO public.auth_identity_ref(id,global_user_id,issuer,subject) VALUES($1,$2,$3,$4)',[randomUUID(),userA.id,issuer,existingSubject]);
  const previous=(await central.pool.query('SELECT to_jsonb(m) row FROM public.organization_membership m WHERE id=$1',[userA.membershipId])).rows;
  const existing=await invite(existingSubject,tenants[1].org,'existing'),ep=await open(existing);
  await ep.locator('#username').fill('existing-admin');await ep.locator('#password').fill(existingPw);await ep.locator('#kc-login').click();await ep.getByText('AtivaÃ§Ã£o recusada',{exact:true}).waitFor();
  assert(!activated.has(existing.id));assert.equal(await status(existing),'OPEN');assert.deepEqual((await central.pool.query('SELECT to_jsonb(m) row FROM public.organization_membership m WHERE id=$1',[userA.membershipId])).rows,previous);assert.equal((await central.pool.query("SELECT count(*)::int n FROM public.organization_membership WHERE global_user_id=$1 AND status IN ('PENDING_PROJECTION','ACTIVE','SUSPENDED')",[userA.id])).rows[0].n,1);checks.push('existing identity/password preserved; second entity membership refused');
  const wrong=await invite(existingSubject,tenants[1].org,'existing'),wp=await open(wrong);await wp.locator('#username').fill('new-admin');await wp.locator('#password').fill(pw);await wp.locator('#kc-login').click();await wp.getByText('Ativação recusada',{exact:true}).waitFor();assert.equal(await status(wrong),'OPEN');checks.push('wrong authenticated subject denied');
  const retry=await invite(existingSubject,tenants[1].org,'existing');await begin(retry.raw);const retryTx=[...transactions.values()].find(t=>t.inviteId===retry.id);await assert.rejects(()=>consume(retryTx.ticket,existingSubject,true),/INJECTED/);assert.equal(await status(retry),'OPEN');
  const race=await Promise.allSettled([consume(retryTx.ticket,existingSubject),consume(retryTx.ticket,existingSubject)]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);checks.push('SQL consume rollback and concurrent one-use');
  const second=activated.get(i.id).person;
  assert.equal((await http(second,'/api/organization-directory/access')).status,200);
  assert.equal((await http(second,'/api/applications/'+applicationId)).status,404);
  assert(!(await http(second,'/api/applications/browse')).data.items.some(a=>a.applicationId===applicationId));
  assert.deepEqual((await tenants[0].pool.query('SELECT to_jsonb(t) row FROM opportunity_catalog.application_task t ORDER BY task_id')).rows,preservedTasks);
  const catalogA=await http(userA,'/api/central-opportunities'),catalogB=await http(second,'/api/central-opportunities');assert.equal(catalogA.status,200);assert.equal(catalogB.status,200);assert.deepEqual(catalogA.data.items,catalogB.data.items);
  checks.push('ORG_ADMIN fixed grants; accesses screen allowed; private application A hidden from B; tasks preserved; shared catalog readable by both (empty fixture)');
  let r=await http(second,'/api/opportunities');assert.equal(r.status,200);assert(r.data.items.some(o=>o.opportunityId===tenants[1].seed.opportunityId));assert(!r.data.items.some(o=>o.opportunityId===tenants[0].seed.opportunityId));
  assert.equal((await http(second,'/api/opportunities/'+tenants[0].seed.opportunityId)).status,404);
  assert.equal((await http(userA,'/api/opportunities/'+tenants[1].seed.opportunityId)).status,404);
  assert.equal((await http(second,'/api/auth/organization','POST',{organizationId:tenants[0].org})).status,403);
  for(const t of tenants){assert.equal((await t.limitedPool.query('SELECT current_database() name')).rows[0].name,t.name);assert.equal((await t.pool.query('SELECT count(*)::int n FROM c4g_system.schema_migration')).rows[0].n,require('../../../backend/src/security/tenantMigrationManifest').manifest.length);}
  checks.push('second tenant fully migrated; dedicated API credentials; private A/B HTTP reads and selection isolated');
  const beforeA=(await tenants[0].pool.query('SELECT to_jsonb(t) row FROM opportunity_catalog.opportunity t ORDER BY opportunity_id')).rows;
  assert.equal((await http(second,'/api/auth/session')).status,200);assert.deepEqual((await tenants[0].pool.query('SELECT to_jsonb(t) row FROM opportunity_catalog.opportunity t ORDER BY opportunity_id')).rows,beforeA);
  evidence.result='PASS';evidence.organizations=2;evidence.limits=['Disposable SPI only; not installed in usual realm','OIDC token verified by harness; final application onboarding coordinator and OIDC session handoff not implemented','Tenant migrations and directory real; membership activation/session use existing test fixtures; worker credentials not exercised in an actual job','No production provisioning, public HTTPS delivery, billing, email, R2 or antivirus'];
  console.log('MANUAL_ACTIVATION_AND_SECOND_TENANT_PROOF_PASS');
 }catch(e){evidence.result='FAIL';evidence.failure=e.name;
  if(browser){evidence.pages=[];for(const ctx of browser.contexts())for(const page of ctx.pages()){evidence.pages.push({path:new URL(page.url()).pathname,text:(await page.textContent('body').catch(()=>''))?.slice(0,650).replace(/[a-f0-9]{64}/g,'[redacted]')});}await browser.contexts().at(-1)?.pages().at(-1)?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
  throw e;
 }finally{fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(evidence,null,2));await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
}
module.exports={run};
