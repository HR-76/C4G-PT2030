'use strict';
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const {createMemberOnboardingService}=require('../../../backend/src/platformOnboarding/memberService');
const {createOnboardingAudit}=require('../../../backend/src/platformOnboarding/audit');
const {RECOGNIZED_ASSURANCE_POLICIES}=require('../../../backend/src/security/authConfig');
const {prepareDirectory}=require('../platform-onboarding/service-fixtures');

// The caller owns a fresh PostgreSQL cluster. Only identity, projection, OIDC and
// email ports are doubles; service queries, authority permissions and audit are real.
async function run({pool,coordinator,check}){
 const org=randomUUID(),foreign=randomUUID(),actor=randomUUID(),manager=randomUUID(),outsider=randomUUID();
 const managerMembership=randomUUID(),issuer='https://identity.example.invalid/realms/c4g';
 const version='c4g-user-mfa-v1',requirement=RECOGNIZED_ASSURANCE_POLICIES[version].policy['recent-auth'];
 const secret=()=>randomBytes(32).toString('hex');
 for(const organizationId of [org,foreign]){
  await pool.query("INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code,data_residency_code) VALUES($1::uuid,'Synthetic lifecycle entity','Synthetic lifecycle entity',$1::text,'COMPANY','ACTIVE','EUR','OPTIONAL','EU')",[organizationId]);
  await prepareDirectory(pool,organizationId);
 }
 for(const userId of [actor,manager,outsider])await pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Synthetic lifecycle actor',$2,'ACTIVE')",[userId,`${userId}@example.invalid`]);
 await pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),actor]);
 await pool.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at) VALUES($1,$2,$3,'FUNDING_MANAGER','ACTIVE',clock_timestamp())",[managerMembership,manager,org]);
 async function session(userId,selected=false){
  const sid=secret();
  await pool.query("INSERT INTO public.application_session(sid,global_user_id,status,revocation_version,created_at,last_seen_at,expires_at,selected_organization_id,selected_membership_id,selected_membership_version) VALUES($1,$2,'ACTIVE',1,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour',$3,$4,$5)",[sid,userId,selected?org:null,selected?managerMembership:null,selected?1:null]);
  return {sessionID:sid,user:{id:userId},authContext:{sessionId:sid,evidence:{policyVersion:version,authTime:Date.now()/1000,acr:'c4g-loa1',amr:['pwd']}},headers:{'x-c4g-organization':org}};
 }
 const admin=await session(actor),managerRequest=await session(manager,true),outsiderRequest=await session(outsider);
 const subjects=new Map(),invitationSecrets=new Map(),sent=[];
 let failIdentity=false,failEmail=false,failAuditEvent=null,templateCalls=0;
 const actualAudit=createOnboardingAudit();
 const operation=async id=>(await pool.query('SELECT * FROM public.platform_member_operation WHERE id=$1',[id])).rows[0];
 const service=createMemberOnboardingService({coordinator,issuer,policyVersion:version,assuranceRequirements:requirement,mfaPolicyCode:'USER_OPTIONAL',dataResidencyCode:'EU',
  identity:{async ensure(value){
   if(!subjects.has(value.operationId))subjects.set(value.operationId,value.input.expectedSubject||randomUUID());
   if(failIdentity){failIdentity=false;throw Error('SYNTHETIC_IDENTITY_REPLY_LOST');}
   return {...value,issuer,subject:subjects.get(value.operationId),mode:value.input.expectedSubject?'EXISTING':'CREATED'};
  }},
  projection:{async ensure(value){return {...value,projected:true};}},
  verification:{async verify(value){return {issuer,subject:value.expectedSubject,exchangeDigest:value.exchangeDigest,bindingDigest:value.bindingDigest,passwordSetupComplete:true};}},
  prepareEmail:async({organizationId})=>{
   assert.ok([org,foreign].includes(organizationId));templateCalls++;
   return {message:{subject:'Synthetic invitation',html:'<p>Synthetic invitation</p>',text:'Synthetic invitation'},template:{source:'DEFAULT',version:1,organizationId:null}};
  },
  email:{async secret({invitationId}){
   if(!invitationSecrets.has(invitationId))invitationSecrets.set(invitationId,secret());
   return invitationSecrets.get(invitationId);
  },async send(value){
   const stored=(await pool.query('SELECT o.receipt,i.digest FROM public.platform_member_operation o JOIN public.platform_member_invitation i ON i.operation_id=o.id WHERE i.id=$1',[value.invitationId])).rows[0];
   assert.equal(stored.receipt.activationEmail.invitationId,value.invitationId);
   assert.equal(stored.receipt.activationEmail.status,'UNCONFIRMED','the receipt must be committed before external delivery');
   assert.deepEqual(stored.receipt.activationEmail.message,value.message);
   assert.equal(stored.digest,require('node:crypto').createHash('sha256').update(value.secret).digest('hex'));
   assert.equal(JSON.stringify(stored.receipt).includes(value.secret),false);
   sent.push(structuredClone(value));
   if(failEmail){failEmail=false;throw Error('SYNTHETIC_EMAIL_REPLY_LOST');}
   return {status:'ACCEPTED'};
  }},
  audit:async(client,event)=>{
   if(event.eventCode===failAuditEvent)throw Error('SYNTHETIC_AUDIT_FAILURE');
   return actualAudit(client,event);
  }
 });
 const payload=(organizationId=org)=>({requestId:randomUUID(),organizationId,name:'Synthetic invited member',email:`${randomUUID()}@example.invalid`,profileCode:'CONTRIBUTOR'});
 const rejected=(work,code)=>assert.rejects(work,error=>error.code===code);
 let memberOperation;

 await check('invitations: missing authority, session mismatch and cross-organization create are refused',async()=>{
  const input=payload();
  await rejected(()=>service.create(input,outsiderRequest),'NOT_AUTHORIZED');
  await rejected(()=>service.create(input,{...admin,sessionID:secret()}),'NOT_AUTHORIZED');
  await rejected(()=>service.create({...input,organizationId:foreign},managerRequest),'NOT_AUTHORIZED');
  await rejected(()=>service.create({...input,profileCode:'ORG_ADMIN'},managerRequest),'NOT_AUTHORIZED');
  assert.equal((await pool.query('SELECT count(*)::int n FROM public.platform_member_operation WHERE request_key=$1',[input.requestId])).rows[0].n,0);
 });
 await check('invitations: audit failure rolls back a new operation in PostgreSQL',async()=>{
  const input=payload();failAuditEvent='PLATFORM_USER_CREATED';
  try{await assert.rejects(()=>service.create(input,admin),/SYNTHETIC_AUDIT_FAILURE/);}finally{failAuditEvent=null;}
  assert.equal((await pool.query('SELECT count(*)::int n FROM public.platform_member_operation WHERE request_key=$1',[input.requestId])).rows[0].n,0);
 });
 await check('invitations: create is idempotent and rejects a changed intention',async()=>{
  const input=payload();memberOperation=await service.create(input,admin);
  assert.equal((await service.create(input,admin)).id,memberOperation.id);
  await rejected(()=>service.create({...input,name:'Changed intention'},admin),'ONBOARDING_CONFLICT');
 });
 await check('invitations: lost identity reply resumes with the same identity and pending membership',async()=>{
  failIdentity=true;
  await rejected(()=>service.resume(memberOperation.id,admin),'ONBOARDING_STEP_UNCONFIRMED');
  const failed=await operation(memberOperation.id),subject=subjects.get(memberOperation.id);
  assert.equal(failed.status,'FAILED');
  assert.equal((await pool.query('SELECT count(*)::int n FROM public.global_user WHERE id=$1',[failed.global_user_id])).rows[0].n,0);
  assert.equal((await service.resume(memberOperation.id,admin)).phase,'PROJECTION');
  memberOperation=await service.resume(memberOperation.id,admin);
  assert.equal(memberOperation.phase,'READY');assert.equal(subjects.get(memberOperation.id),subject);
  const row=await operation(memberOperation.id);
  assert.equal((await pool.query('SELECT status FROM public.organization_membership WHERE id=$1',[row.membership_id])).rows[0].status,'PENDING_PROJECTION');
 });

 let emailIntention,emailResult;
 await check('invitations: receipt precedes email, failure is retryable and accepted delivery is not resent',async()=>{
  emailIntention={requestId:randomUUID(),replace:false};failEmail=true;
  const first=await service.sendEmail(memberOperation.id,emailIntention,admin);
  assert.equal(first.status,'UNCONFIRMED');assert.equal(sent.length,1);assert.equal(templateCalls,1);
  emailResult=await service.sendEmail(memberOperation.id,emailIntention,admin);
  assert.equal(emailResult.status,'ACCEPTED');assert.equal(sent.length,2);assert.equal(templateCalls,1);
  assert.deepEqual(sent[0],sent[1],'retry must preserve invitation, secret, recipient and message');
  assert.deepEqual(await service.sendEmail(memberOperation.id,emailIntention,admin),emailResult);
  assert.equal(sent.length,2);assert.equal(templateCalls,1);
  const view=await service.get(memberOperation.id,admin),stored=await operation(memberOperation.id);
  assert.equal(stored.receipt.activationEmail.status,'ACCEPTED');
  assert.equal(view.emailDelivery.message,undefined);assert.equal(view.emailDelivery.previous,undefined);
  assert.equal(JSON.stringify(view).includes(invitationSecrets.get(emailResult.invitationId)),false);
  assert.equal(JSON.stringify(stored).includes(invitationSecrets.get(emailResult.invitationId)),false);
 });
 await check('invitations: explicit issue replay hides its secret and replacement revokes the old invitation',async()=>{
  const input=payload(),created=await service.create(input,admin);
  await service.resume(created.id,admin);await service.resume(created.id,admin);
  const intention={requestId:randomUUID()},first=await service.issue(created.id,intention,admin);
  const replay=await service.issue(created.id,intention,admin);
  assert.equal(replay.id,first.id);assert.equal(replay.secret,undefined);assert.equal(replay.secretUnavailable,true);
  const replacement=await service.issue(created.id,{requestId:randomUUID(),replace:true},admin);
  assert.notEqual(first.id,replacement.id);
  await rejected(()=>service.beginActivation(first.secret,secret()),'ACTIVATION_INVALID');
  assert.equal((await pool.query('SELECT status FROM public.platform_member_invitation WHERE id=$1',[first.id])).rows[0].status,'REVOKED');
 });
 await check('invitations: another organization cannot read, issue or send a foreign operation',async()=>{
  const created=await service.create(payload(foreign),admin);
  await service.resume(created.id,admin);await service.resume(created.id,admin);
  const before=await operation(created.id),count=sent.length;
  for(const request of [managerRequest,{...managerRequest,headers:{'x-c4g-organization':foreign}},outsiderRequest]){
   await rejected(()=>service.get(created.id,request),'NOT_AUTHORIZED');
   await rejected(()=>service.issue(created.id,{requestId:randomUUID()},request),'NOT_AUTHORIZED');
   await rejected(()=>service.sendEmail(created.id,{requestId:randomUUID()},request),'NOT_AUTHORIZED');
  }
  assert.deepEqual(await operation(created.id),before);assert.equal(sent.length,count);
  assert.equal((await pool.query('SELECT count(*)::int n FROM public.platform_member_invitation WHERE operation_id=$1',[created.id])).rows[0].n,0);
 });

 let exchange,binding;
 await check('invitations: failed activation audit rolls back membership, grants, consumption and completion',async()=>{
  binding=secret();exchange=await service.beginActivation(invitationSecrets.get(emailResult.invitationId),binding);
  failAuditEvent='PLATFORM_USER_ACTIVATED';
  try{await assert.rejects(()=>service.activate(exchange.exchange,binding,{}),/SYNTHETIC_AUDIT_FAILURE/);}finally{failAuditEvent=null;}
  const row=await operation(memberOperation.id);
  assert.equal(row.phase,'READY');
  assert.equal((await pool.query('SELECT status FROM public.organization_membership WHERE id=$1',[row.membership_id])).rows[0].status,'PENDING_PROJECTION');
  assert.equal((await pool.query('SELECT count(*)::int n FROM public.authority_f5_state WHERE membership_id=$1',[row.membership_id])).rows[0].n,0);
  assert.equal((await pool.query('SELECT status FROM public.platform_member_invitation WHERE id=$1',[emailResult.invitationId])).rows[0].status,'OPEN');
 });
 await check('invitations: activation retry is idempotent, scoped and retains optional MFA',async()=>{
  const first=await service.activate(exchange.exchange,binding,{});
  assert.deepEqual(await service.activate(exchange.exchange,binding,{}),first);
  assert.equal(first.organizationId,org);assert.equal(first.activated,true);
  const row=await operation(memberOperation.id),state=(await pool.query('SELECT * FROM public.authority_f5_state WHERE membership_id=$1',[row.membership_id])).rows[0];
  assert.equal(row.phase,'COMPLETE');assert.equal(state.policy_version,version);assert.deepEqual(state.assurance_requirements,requirement);
  assert.ok(state.grants.length>0);assert.ok(state.grants.every(grant=>grant.scope.organizationId===org));
  assert.equal(state.grants.some(grant=>grant.permission==='organization_membership.manage'),false);
  await rejected(()=>service.beginActivation(invitationSecrets.get(emailResult.invitationId),secret()),'ACTIVATION_INVALID');
 });
 return {organizations:2,externalPorts:'synthetic identity/projection/OIDC/email; no external calls',emailAttempts:sent.length};
}
module.exports={run};
