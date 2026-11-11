'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID,randomBytes}=require('node:crypto');
const {centralAuthorityFixture}=require('../f13/central-authority-fixture');
const {createAdmissionService}=require('../../../backend/src/entityAdmission/service');
async function run(){
 const url=new URL(process.env.F13_S2_ADMIN_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'5599');
 const central=await centralAuthorityFixture(url.toString()),{pool,coordinator}=central,checks=[];
 const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name)};
 try{
  const actor=randomUUID(),issuer='https://identity.example.invalid/realms/c4g';
  await pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'C4G','c4g@example.invalid','ACTIVE')",[actor]);
  await pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),actor]);
  const session=async user=>{const sid=randomBytes(32).toString('hex');await pool.query("INSERT INTO public.application_session(sid,global_user_id,status,revocation_version,created_at,last_seen_at,expires_at) VALUES($1,$2,'ACTIVE',1,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour')",[sid,user]);return {sessionID:sid,authContext:{sessionId:sid},user:{id:user}}};
  const req=await session(actor);let failAudit=false;
  const append=require('../../../backend/src/platformOnboarding/audit').createOnboardingAudit();
  const service=createAdmissionService({coordinator,issuer,identity:{async ensure(x){return {...x,issuer,subject:randomUUID(),mode:'CREATED'}}},verification:{async verify(x){return {issuer,subject:x.expectedSubject,exchangeDigest:x.exchangeDigest,bindingDigest:x.bindingDigest,passwordSetupComplete:true}}},
   audit:async(c,r,actor,code,key)=>{if(failAudit&&code==='DRAFT_SAVED')throw Error('audit unavailable');return append(c,{actorId:actor,eventCode:'PLATFORM_ADMISSION_'+code,operationId:r.id,resourceType:'ENTITY_ADMISSION',key:`admission:${r.id}:${key}`})}});
  const op=await service.create({name:'Administrador convidado',email:'draft@example.invalid',requestId:randomUUID()},req);await service.resume(op.id,req);
  const invitation=await service.issue(op.id,{requestId:randomUUID()},req),binding=randomBytes(32).toString('hex'),exchange=await service.beginActivation(invitation.secret,binding);await service.activate(exchange.exchange,binding,{});
  const uid=(await pool.query('SELECT global_user_id FROM public.entity_admission WHERE id=$1',[op.id])).rows[0].global_user_id,own=await session(uid);
  const input={fields:{legalName:'Entidade teste',workerCount:0},expectedRevision:0,requestId:randomUUID()};let saved;
  await check('empty resume and immutable identity; other user and C4G cannot impersonate recipient',async()=>{const d=await service.draft(op.id,own);assert.equal(d.revision,0);assert.equal(d.administrator.email,'draft@example.invalid');assert.equal(d.country,'PT');await assert.rejects(()=>service.draft(op.id,req));await assert.rejects(()=>service.saveDraft(op.id,{...input,fields:{...input.fields,adminName:'forged'}},own));});
  await check('partial save, exact replay after lost response, and restart resume',async()=>{saved=await service.saveDraft(op.id,input,own);assert.equal(saved.revision,1);assert.equal(saved.fields.workerCount,0);assert(saved.savedAt);assert.deepEqual(await service.saveDraft(op.id,input,own),JSON.parse(JSON.stringify(saved)));assert.equal((await service.draft(op.id,own)).fields.legalName,'Entidade teste');await assert.rejects(()=>service.saveDraft(op.id,{...input,fields:{}},own));});
  await check('two sessions cannot overwrite a revision; unchanged replay does not bump revision',async()=>{const second=await session(uid),a={...input,expectedRevision:1,requestId:randomUUID(),fields:{legalName:'A'}},b={...a,requestId:randomUUID(),fields:{legalName:'B'}};const results=await Promise.allSettled([service.saveDraft(op.id,a,own),service.saveDraft(op.id,b,second)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'ONBOARDING_STALE');assert.equal((await service.draft(op.id,own)).revision,2)});
  await check('audit failure rolls back data and receipt; same intention can recover',async()=>{const next={...input,expectedRevision:2,requestId:randomUUID()};failAudit=true;await assert.rejects(()=>service.saveDraft(op.id,next,own));assert.equal((await service.draft(op.id,own)).revision,2);failAudit=false;assert.equal((await service.saveDraft(op.id,next,own)).revision,3)});
  await check('complete server validation creates no entity, membership or grant',async()=>{assert.equal((await service.validateDraft(op.id,{fields:{},step:null},own)).valid,false);for(const table of ['organization','organization_membership'])assert.equal((await pool.query(`SELECT count(*)::int n FROM public.${table}`)).rows[0].n,0);assert.equal((await service.context(own)).limited,true)});
  await check('cancelled admission and revoked session deny even exact replay',async()=>{await service.cancel(op.id,req);await assert.rejects(()=>service.saveDraft(op.id,input,own));await assert.rejects(()=>service.draft(op.id,own));assert.equal((await pool.query('SELECT count(*)::int n FROM public.entity_admission_draft')).rows[0].n,1);await central.registry.revokeSession(own.sessionID,'PROBE');await assert.rejects(()=>service.draft(op.id,own))});
  await check('contact adoption replay tolerates description revision but refuses divergent legacy contacts',async()=>{
   const org=randomUUID();await central.user(org,randomUUID(),randomUUID());
   const registration=require('../../../backend/src/entityAdmission/registrationService').createRegistrationService({coordinator});
   const before=await registration.adoptContacts(org,{revision:1,email:'old@example.org',website:''},req);
   const repeated=await registration.adoptContacts(org,{revision:2,email:'old@example.org',website:''},req);
   assert.equal(repeated.revision,before.revision);await assert.rejects(()=>registration.adoptContacts(org,{revision:2,email:'changed@example.org',website:''},req));
  });
  await check('contacts use real F5 grant and central audit in a single write',async()=>{
   const org=randomUUID(),member=await central.user(org,randomUUID(),randomUUID());
   await central.data.change({organizationId:org,membershipId:member.membershipId,expectedVersion:1,grants:[{permission:'organization_directory.edit',scope:{type:'ORGANIZATION',id:org,organizationId:org}}],assuranceRequirements:central.requirement});
   const authority=require('../../../backend/src/security/authenticatedAuthority').createTaxonomySessionAuthority({sessionStore:central.store,sessionRegistry:central.registry,authorityCoordinator:coordinator,...central.data,policyVersion:'c4g-assurance-v1'});
   const trusted=await authority.resolve(await authority.captureAuthenticatedRequest(member.request));
   const registration=require('../../../backend/src/entityAdmission/registrationService').createRegistrationService({coordinator});
   await registration.adoptContacts(org,{revision:1,email:'old@example.org',website:''},req);
   const authorize=require('../../../backend/src/entityAdmission/registrationAuthorization').createRegistrationAuthorization({catalogs:central.catalogs,data:central.data,policyVersion:'c4g-assurance-v1',recentMfaRequirement:central.requirement});
   const saved=await registration.contacts(org,{expectedRevision:1,requestId:randomUUID(),fields:{institutionalEmail:'new@example.org',institutionalPhone:'',website:''}},member.request,trusted,authorize);
   assert.equal(saved.fields.institutionalEmail,'new@example.org');
  });
  const out=path.resolve(__dirname,'../../../output/playwright/c4g-registration');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'service-verification.json'),JSON.stringify({result:'PASS',checks},null,2));
 }catch(error){console.error(JSON.stringify(central.observations.filter(o=>o.errorCode).slice(-5).map(o=>({code:o.errorCode,constraint:o.constraint,statement:o.sql}))));throw error}finally{await central.close()}
}
run().catch(e=>{console.error(e.code||e.name,e.message);process.exitCode=1});
