'use strict';
const assert=require('node:assert/strict'),{randomUUID,randomBytes}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {centralAuthorityFixture}=require('../f13/central-authority-fixture');
const {createOnboardingService}=require('../../../backend/src/platformOnboarding/service');
const {createOnboardingAudit}=require('../../../backend/src/platformOnboarding/audit');
const {prepareDirectory}=require('./service-fixtures');
const {hash}=require('../../../backend/src/platformOnboarding/contracts');
async function run(){
 const url=new URL(process.env.F13_S2_ADMIN_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'5599');
 const central=await centralAuthorityFixture(url.toString()),{pool,coordinator}=central,passed=[];
 const check=async(name,fn)=>{await fn();passed.push(name);console.log('PASS '+name);};
 try{
  const actor=randomUUID(),sid=randomBytes(32).toString('hex');
  await pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'C4G Synthetic','admin@example.invalid','ACTIVE')",[actor]);
  await pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),actor]);
  await pool.query("INSERT INTO public.application_session(sid,global_user_id,status,revocation_version,created_at,last_seen_at,expires_at) VALUES($1,$2,'ACTIVE',1,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour')",[sid,actor]);
  const request={sessionID:sid,authContext:{sessionId:sid},user:{id:actor}},issuer='https://identity.example.invalid/realms/c4g';
  let externalFailure=null,auditFailure=false,wrongSubject=false,hook=null;
  const identities=new Map(),calls=[];
  const echo=x=>({operationId:x.operationId,organizationId:x.organizationId,globalUserId:x.globalUserId,membershipId:x.membershipId});
  const audit=createOnboardingAudit();
  const options={coordinator,issuer,policyVersion:'c4g-assurance-v1',assuranceRequirements:central.requirement,mfaPolicyCode:'OPTIONAL',dataResidencyCode:'EU',
   identity:{async ensure(x){calls.push(x);if(!identities.has(x.operationId))identities.set(x.operationId,x.input.expectedSubject||randomUUID());if(hook)await hook(x);if(externalFailure==='IDENTITY'){externalFailure=null;throw new Error('secret-provider-message');}return {...echo(x),issuer,subject:identities.get(x.operationId),mode:x.input.expectedSubject?'EXISTING':'CREATED'};}},
   tenant:{async ensure(x){await prepareDirectory(pool,x.organizationId).catch(e=>{console.error('Synthetic directory:',e.code,e.message);throw e;});if(externalFailure==='TENANT'){externalFailure=null;throw new Error('secret-provider-message');}return echo(x);}},
   projection:{async ensure(x){return {...echo(x),projected:true};}},
   verification:{async verify(x){return {issuer,subject:wrongSubject?randomUUID():x.expectedSubject,exchangeDigest:x.exchangeDigest,bindingDigest:x.bindingDigest,passwordSetupComplete:true};}},
   audit:async(c,event)=>{if(auditFailure&&event.eventCode==='PLATFORM_ADMINISTRATOR_ACTIVATED')throw new Error('F7_FAILURE');return audit(c,event);}};
  const service=createOnboardingService(options),data=(email='first@example.invalid')=>({requestId:randomUUID(),name:'Entity Synthetic',legalName:'Entity Synthetic Legal',slug:'synthetic-'+randomUUID(),type:'COMPANY',country:'PT',currency:'EUR',adminName:'First Administrator',adminEmail:email});
  const denied=(fn,code)=>assert.rejects(fn,e=>e.code===code);
  let op,invite,exchange,binding=randomBytes(32).toString('hex');const payload=data();
  await check('C4G authorization and trusted session required',async()=>{
   await denied(()=>service.create(payload,{...request,sessionID:'wrong'}),'C4G_ADMIN_REQUIRED');
   await pool.query("UPDATE public.platform_admin_assignment SET status='REVOKED' WHERE global_user_id=$1",[actor]);
   await denied(()=>service.create(payload,request),'C4G_ADMIN_REQUIRED');
   await pool.query("UPDATE public.platform_admin_assignment SET status='ACTIVE' WHERE global_user_id=$1",[actor]);
   assert.equal((await pool.query('SELECT count(*)::int n FROM public.platform_onboarding_operation')).rows[0].n,0);
  });
  await check('concurrent create and changed intent',async()=>{
   const results=await Promise.all([service.create(payload,request),service.create(payload,request)]);assert.equal(results[0].id,results[1].id);op=results[0];
   await denied(()=>service.create({...payload,name:'Different'},request),'ONBOARDING_CONFLICT');
  });
  await check('external identity outcome recovered without duplicate',async()=>{
   externalFailure='IDENTITY';await denied(()=>service.resume(op.id,request),'ONBOARDING_STEP_UNCONFIRMED');assert.equal((await service.get(op.id,request)).status,'FAILED');
   op=await createOnboardingService(options).resume(op.id,request);assert.equal(op.phase,'TENANT');assert.equal(identities.size,1);assert.equal(calls[0].globalUserId,calls[1].globalUserId);
  });
  await check('tenant retry and pending membership before activation',async()=>{
   externalFailure='TENANT';await denied(()=>service.resume(op.id,request),'ONBOARDING_STEP_UNCONFIRMED');op=await service.resume(op.id,request);assert.equal(op.phase,'PROJECTION');op=await service.resume(op.id,request);assert.equal(op.phase,'READY');
   assert.equal((await pool.query('SELECT status FROM public.organization_membership WHERE organization_id=$1',[op.organizationId])).rows[0].status,'PENDING_PROJECTION');
   assert.equal((await pool.query('SELECT count(*)::int n FROM public.authority_f5_state WHERE organization_id=$1',[op.organizationId])).rows[0].n,0);
  });
  await check('manual invitation digest only and idempotent issue',async()=>{
   const intent={requestId:randomUUID()};invite=await service.issue(op.id,intent,request);const replay=await service.issue(op.id,intent,request);assert.equal(replay.id,invite.id);assert.equal(replay.secret,undefined);assert.equal(replay.secretUnavailable,true);
   const stored=(await pool.query('SELECT * FROM public.platform_onboarding_invitation WHERE id=$1',[invite.id])).rows[0];assert.equal(stored.digest,hash(invite.secret));assert(!JSON.stringify(stored).includes(invite.secret));
  });
  await check('replacement, browser binding, old exchange and wrong identity denied',async()=>{
   const old=invite;invite=await service.issue(op.id,{requestId:randomUUID(),replace:true},request);await denied(()=>service.beginActivation(old.secret,binding),'ACTIVATION_INVALID');
   const previous=await service.beginActivation(invite.secret,binding);exchange=await service.beginActivation(invite.secret,binding);
   await denied(()=>service.activate(previous.exchange,binding,{}),'ACTIVATION_INVALID');await denied(()=>service.activate(exchange.exchange,randomBytes(32).toString('hex'),{}),'ACTIVATION_INVALID');
   wrongSubject=true;await denied(()=>service.activate(exchange.exchange,binding,{}),'ACTIVATION_INVALID');wrongSubject=false;
  });
  await check('F7 failure rolls back membership grants invite and completion',async()=>{
   auditFailure=true;await assert.rejects(()=>service.activate(exchange.exchange,binding,{}),/F7_FAILURE/);auditFailure=false;
   assert.equal((await pool.query('SELECT status FROM public.organization_membership WHERE organization_id=$1',[op.organizationId])).rows[0].status,'PENDING_PROJECTION');
   assert.equal((await pool.query('SELECT count(*)::int n FROM public.authority_f5_state WHERE organization_id=$1',[op.organizationId])).rows[0].n,0);
   assert.equal((await pool.query('SELECT status FROM public.platform_onboarding_invitation WHERE id=$1',[invite.id])).rows[0].status,'OPEN');assert.equal((await service.get(op.id,request)).phase,'READY');
  });
  await check('restart and lost response replay activate once with own fixed grants',async()=>{
   const result=await createOnboardingService(options).activate(exchange.exchange,binding,{});assert.equal(result.activated,true);assert.deepEqual(await service.activate(exchange.exchange,binding,{}),result);
   const state=(await pool.query('SELECT * FROM public.authority_f5_state WHERE organization_id=$1',[op.organizationId])).rows[0];assert(state.grants.length>10);assert(state.grants.every(g=>g.scope.organizationId===op.organizationId));
   assert.equal((await pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code='PLATFORM_ADMINISTRATOR_ACTIVATED'")).rows[0].n,1);
  });
  await check('existing identity cannot get a second active entity membership',async()=>{
   await denied(()=>service.create(data(),request),'MEMBERSHIP_ALREADY_EXISTS');
   assert.equal((await pool.query("SELECT count(*)::int n FROM public.global_user WHERE primary_email='first@example.invalid'")).rows[0].n,1);
   assert.equal((await pool.query("SELECT count(*)::int n FROM public.organization_membership WHERE status='ACTIVE'")).rows[0].n,1);
   assert.equal((await pool.query('SELECT count(*)::int n FROM public.organization_membership WHERE global_user_id=$1',[actor])).rows[0].n,0);
  });
  await check('C4G revoked during external step prevents confirmation',async()=>{
   const target=await service.create(data('third@example.invalid'),request);hook=async()=>pool.query("UPDATE public.platform_admin_assignment SET status='REVOKED' WHERE global_user_id=$1",[actor]);
   await denied(()=>service.resume(target.id,request),'C4G_ADMIN_REQUIRED');hook=null;
   assert.equal((await pool.query('SELECT phase FROM public.platform_onboarding_operation WHERE id=$1',[target.id])).rows[0].phase,'IDENTITY');
   await pool.query("UPDATE public.platform_admin_assignment SET status='ACTIVE' WHERE global_user_id=$1",[actor]);
   await pool.query("UPDATE public.platform_onboarding_operation SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[target.id]);await service.resume(target.id,request);
  });
  await check('runtime cannot write onboarding tables directly',async()=>{await assert.rejects(()=>central.authorityPool.query('UPDATE public.platform_onboarding_operation SET phase=\'COMPLETE\''),e=>e.code==='42501');});
  await check('expired revoked and suspended sessions denied',async()=>{
   for(const status of ['EXPIRED','REVOKED','SUSPENDED']){
    const user=randomUUID(),session=randomBytes(32).toString('hex');
    await pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Synthetic',$2,$3)",[user,user+'@example.invalid',status==='SUSPENDED'?'SUSPENDED':'ACTIVE']);
    await pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),user]);
    await pool.query("INSERT INTO public.application_session(sid,global_user_id,status,revocation_version,created_at,last_seen_at,expires_at,revoked_at) VALUES($1,$2,$3,1,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '2 hours',$4,CASE WHEN $3='REVOKED' THEN clock_timestamp() ELSE NULL END)",[session,user,status==='REVOKED'?'REVOKED':'ACTIVE',new Date(Date.now()+(status==='EXPIRED'?-60000:60000))]);
    await denied(()=>service.list({sessionID:session,authContext:{sessionId:session},user:{id:user}}),'C4G_ADMIN_REQUIRED');
   }
  });
  await check('busy lease and stale external completion cannot advance',async()=>{
   const target=await service.create(data('lease@example.invalid'),request);
   hook=async()=>{await denied(()=>service.resume(target.id,request),'ONBOARDING_BUSY');await pool.query("UPDATE public.platform_onboarding_operation SET fence=fence+1,lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[target.id]);};
   await denied(()=>service.resume(target.id,request),'ONBOARDING_STALE');hook=null;
   assert.equal((await pool.query('SELECT count(*)::int n FROM public.organization_membership WHERE organization_id=$1',[target.organizationId])).rows[0].n,0);
   assert.equal((await service.resume(target.id,request)).phase,'TENANT');
  });
  await check('expiry revocation and issuer revocation prevent activation',async()=>{
   const target=await service.create(data('expiry@example.invalid'),request);for(let i=0;i<3;i++)await service.resume(target.id,request);
   let i=await service.issue(target.id,{requestId:randomUUID()},request);const b=randomBytes(32).toString('hex');
   await pool.query("UPDATE public.platform_onboarding_invitation SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' WHERE id=$1",[i.id]);await denied(()=>service.beginActivation(i.secret,b),'ACTIVATION_INVALID');
   i=await service.issue(target.id,{requestId:randomUUID(),replace:true},request);let x=await service.beginActivation(i.secret,b);
   await service.revoke(target.id,i.id,request);await denied(()=>service.activate(x.exchange,b,{}),'ACTIVATION_INVALID');
   i=await service.issue(target.id,{requestId:randomUUID()},request);x=await service.beginActivation(i.secret,b);
   await pool.query("UPDATE public.platform_admin_assignment SET status='REVOKED' WHERE global_user_id=$1",[actor]);await denied(()=>service.activate(x.exchange,b,{}),'ACTIVATION_INVALID');
   await pool.query("UPDATE public.platform_admin_assignment SET status='ACTIVE' WHERE global_user_id=$1",[actor]);
   const results=await Promise.all([service.activate(x.exchange,b,{}),service.activate(x.exchange,b,{})]);assert.deepEqual(results[0],results[1]);
   assert.equal((await pool.query('SELECT count(*)::int n FROM public.organization_membership WHERE organization_id=$1 AND status=\'ACTIVE\'',[target.organizationId])).rows[0].n,1);
  });
  await check('actual COMMIT acknowledgement loss returns persisted receipt on retry',async()=>{
   const target=await service.create(data('commit@example.invalid'),request);for(let i=0;i<3;i++)await service.resume(target.id,request);
   const i=await service.issue(target.id,{requestId:randomUUID()},request),b=randomBytes(32).toString('hex'),x=await service.beginActivation(i.secret,b);
   let lost=false;
   const faultPool={query:(...args)=>central.authorityPool.query(...args),async connect(){
    const client=await central.authorityPool.connect();let completing=false;
    return {on:(...a)=>client.on(...a),removeListener:(...a)=>client.removeListener(...a),release:e=>client.release(e),async query(sql,values){
     const result=await client.query(sql,values);
     if(sql==='SELECT authority_api.execute($1,$2::text[],$3) AS result'&&values[0]===hash(require('../../../backend/src/platformOnboarding/sql').complete))completing=true;
     if(sql==='COMMIT'&&completing&&!lost){lost=true;throw Object.assign(new Error('SYNTHETIC_COMMIT_ACK_LOST'),{code:'SYNTHETIC_COMMIT_ACK_LOST'});}return result;
    }};
   }};
   const faultCoordinator=require('../../../backend/src/security/authorityCoordinator').createAuthorityCoordinator({pool:faultPool,permitSecret:central.permitSecret});
   await assert.rejects(()=>createOnboardingService({...options,coordinator:faultCoordinator}).activate(x.exchange,b,{}),/SYNTHETIC_COMMIT_ACK_LOST/);assert.equal(lost,true);
   assert.equal((await createOnboardingService(options).activate(x.exchange,b,{})).activated,true);
   assert.equal((await pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code='PLATFORM_ADMINISTRATOR_ACTIVATED' AND event_data->'resource'->>'id'=$1",[target.id])).rows[0].n,1);
  });
  await check('provider receipt alone cannot publish an unprepared tenant',async()=>{
   const target=await service.create(data('notready@example.invalid'),request);await service.resume(target.id,request);
   const unprepared=createOnboardingService({...options,tenant:{ensure:async x=>echo(x)}});
   await denied(()=>unprepared.resume(target.id,request),'ONBOARDING_NOT_READY');
   await denied(()=>service.issue(target.id,{requestId:randomUUID()},request),'ONBOARDING_NOT_READY');
   assert.equal((await service.get(target.id,request)).phase,'TENANT');
  });
  await check('HTTP boundary requires session CSRF and server activation binding',async()=>{
   const express=require('../../../backend/node_modules/express'),app=express();app.use(express.json({limit:'16kb'}));
   const requireSession=(req,res,next)=>{if(req.get('X-Fixture-Session')!=='admin')return res.sendStatus(401);Object.assign(req,request);next();};
   const requireCsrf=(req,res,next)=>req.get('X-Fixture-Csrf')==='valid'?next():res.sendStatus(403);
   const requireActivationContext=(req,res,next)=>{if(req.get('X-Fixture-Binding')!=='valid')return res.sendStatus(403);req.activationContext={binding};next();};
   app.use('/isolated',require('../../../backend/src/routes/platformOnboardingRoutes').createPlatformOnboardingRoutes({service,requireSession,requireCsrf,requireActivationContext}));
   const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
   const base=`http://127.0.0.1:${server.address().port}/isolated`;
   try{
    const post=(route,body,headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
    assert.equal((await post('/entities',{...payload,role:'C4G_ADMIN'})).status,401);
    assert.equal((await post('/entities',payload,{'X-Fixture-Session':'admin'})).status,403);
    const response=await post('/entities',payload,{'X-Fixture-Session':'admin','X-Fixture-Csrf':'valid'});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).id,op.id);
    assert.equal((await post('/activation/begin',{secret:invite.secret,binding})).status,403);
    const forged=await post('/activation/complete',{exchange:exchange.exchange,callback:{issuer,subject:'forged'},binding},{'X-Fixture-Binding':'valid','X-Fixture-Csrf':'valid'});
    assert.equal(forged.status,200); // prior completed exchange only returns its receipt
    const unknown=await post('/activation/complete',{exchange:randomBytes(32).toString('hex'),callback:{issuer,subject:'forged'}},{'X-Fixture-Binding':'valid','X-Fixture-Csrf':'valid'});assert.equal(unknown.status,400);
   }finally{await new Promise(resolve=>server.close(resolve));}
  });
  const report={result:'PASS',checks:passed,limits:['IdP, tenant execution and OIDC verification are injected trusted test ports; this gate validates the persisted service, not a deployed provider adapter.','No usual environment or UI changed.']};
  fs.mkdirSync(path.resolve(__dirname,'../../../output/playwright/c4g-onboarding-service'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../../../output/playwright/c4g-onboarding-service/verification.json'),JSON.stringify(report,null,2));
 }catch(e){console.error('SQL failures',central.observations.filter(x=>x.errorCode).map(x=>({code:x.errorCode,statement:x.sql})));throw e;}finally{await central.close();}
}
run().catch(e=>{console.error(e.code||e.name,e.message,e.stack?.split('\n').slice(1,4).join('\n'));process.exitCode=1});
