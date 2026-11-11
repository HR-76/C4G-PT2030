'use strict';
const {randomUUID,randomBytes} = require('node:crypto');
const {isAuthorityCoordinator} = require('../security/authorityCoordinator');
const {fail,uuid,hash,token} = require('../platformOnboarding/contracts');
const q = require('./sql');
const draftSql=require('./draftSql'),registration=require('./registrationContract');
const first = async(c,s,p) => (await c.query(s,p)).rows[0];
const view = r => ({id:r.id,name:r.input?.adminName,email:r.input?.adminEmail,phase:r.phase,revision:Number(r.revision),createdAt:r.created_at,acceptedAt:r.accepted_at,cancelledAt:r.cancelled_at});
const invitationView = r => ({id:r.id,status:r.status,revision:Number(r.revision),expiresAt:r.expires_at});
function input(v) {
  if (!v || Object.keys(v).sort().join(',')!=='email,name,requestId' || typeof v.name!=='string' || !v.name.trim() || v.name.length>200 || /[\x00-\x1f\x7f]/.test(v.name) || typeof v.email!=='string' || v.email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) fail('ONBOARDING_INPUT_INVALID');
  return {requestId:uuid(v.requestId),adminName:v.name.trim().normalize('NFC'),adminEmail:v.email.toLowerCase()};
}
// Constructed explicitly when the runtime supplies its admission dependencies.
function createAdmissionService({coordinator,identity,verification,issuer,audit,completion=null,listing=null}) {
  if (!isAuthorityCoordinator(coordinator) || typeof identity?.ensure!=='function' || typeof verification?.verify!=='function' || !issuer?.startsWith('https://')) fail('ONBOARDING_COMPOSITION_INVALID');
  const write = fn => coordinator.write(['POLICY'],fn);
  const append = require('../platformOnboarding/audit').createOnboardingAudit();
  const event = audit || ((c,r,actor,code,key) => append(c,{actorId:actor,eventCode:'PLATFORM_ADMISSION_'+code,operationId:r.id,resourceType:'ENTITY_ADMISSION',key:`admission:${r.id}:${key}`}));
  async function session(c,req,admin=false) {
    if (!req?.user?.id || req.authContext?.sessionId!==req.sessionID || !req.sessionID || !await first(c,admin?q.admin:q.session,[req.sessionID,uuid(req.user.id)])) fail('NOT_AUTHORIZED');
    return req.user.id;
  }
  async function operation(c,id) {const r=await first(c,q.operation,[uuid(id)]);if(!r)fail('ONBOARDING_NOT_FOUND');return r;}
  async function eligible(c,r) {
    if (!['READY','FILLING'].includes(r.phase) || !await first(c,q.issuer,[r.issued_by]) || (await first(c,q.identity,[r.global_user_id,issuer,r.receipt.subject]))?.status!=='ACTIVE') fail('ACTIVATION_INVALID');
  }
  async function ownDraft(c,id,req){
    const actor=await session(c,req),r=await operation(c,id);
    if(r.global_user_id!==actor||r.phase!=='FILLING'||!r.accepted_at)fail('ONBOARDING_NOT_FOUND');
    return {actor,r};
  }
  const draftView=(r,d)=>({admissionId:r.id,revision:Number(d?.revision||0),fields:d?.fields||{},savedAt:d?.saved_at||null,
    administrator:{name:r.input.adminName,email:r.input.adminEmail},country:'PT',addressCountry:'PT',currency:'EUR',types:registration.types,phase:r.phase,completionAvailable:Boolean(completion)});
  return Object.freeze({
    ...(listing?{async list(query,req){const page=require('./listing').listingPage(query);return coordinator.withAuthority(async()=>{await session(coordinator.pool,req,true);const result=await listing(page);await session(coordinator.pool,req,true);return result;});}}:{}),
    ...(completion?{submit:(id,value,req)=>completion.submit(id,value,req),status:(id,req)=>completion.status(id,req)}:{}),
    async draft(id,req){return coordinator.withAuthority(async()=>{const c=coordinator.pool,{r}=await ownDraft(c,id,req);return draftView(r,await first(c,draftSql.get,[id]));});},
    async saveDraft(id,value,req){
      const input=registration.command(value),fields=registration.assertValid(registration.validate(input.fields));
      const digest=hash(JSON.stringify({...input,fields}));
      return write(async c=>{
        const {actor,r}=await ownDraft(c,id,req),prior=await first(c,draftSql.receipt,[id,input.requestId]);
        if(prior){if(prior.actor_id!==actor||prior.intent_digest!==digest)fail('ONBOARDING_CONFLICT');return prior.result;}
        const old=await first(c,draftSql.get,[id]);
        if(Number(old?.revision||0)!==input.expectedRevision)fail('ONBOARDING_STALE');
        const saved=await first(c,draftSql.save,[id,JSON.stringify(fields),actor]),result=draftView(r,saved);
        await event(c,r,actor,'DRAFT_SAVED',`draft:${input.requestId}`);
        await c.query(draftSql.remember,[id,input.requestId,actor,digest,JSON.stringify(result)]);return result;
      });
    },
    async validateDraft(id,value,req){
      if(!value||Object.keys(value).sort().join(',')!=='fields,step'||(value.step!==null&&![0,1,2].includes(value.step)))fail('ONBOARDING_INPUT_INVALID');
      return coordinator.withAuthority(async()=>{await ownDraft(coordinator.pool,id,req);return registration.validate(value.fields,{step:value.step,complete:value.step===null});});
    },
    async create(value,req) {
      const data=input(value),digest=hash(JSON.stringify(data));
      return write(async c=>{
        const actor=await session(c,req,true),prior=await first(c,q.replay,[actor,data.requestId]);
        if(prior){if(prior.intent_digest!==digest)fail('ONBOARDING_CONFLICT');return view(prior);}
        const matches=(await c.query(q.existing,[data.adminEmail])).rows;
        if(matches.length && (!matches.every(m=>m.status==='ACTIVE') || matches.filter(m=>m.issuer===issuer).length!==1))fail('IDENTITY_RECONCILIATION_REQUIRED');
        const existing=matches.find(m=>m.issuer===issuer);
        if(existing&&await first(c,q.nonRemovedMembership,[existing.id]))fail('MEMBERSHIP_ALREADY_EXISTS');
        const r=await first(c,q.create,[randomUUID(),actor,data.requestId,digest,JSON.stringify({...data,expectedSubject:existing?.subject||null}),existing?.id||randomUUID()]);
        await event(c,r,actor,'CREATED','create');return view(r);
      });
    },
    async get(id,req) {return coordinator.withAuthority(async()=>{const c=coordinator.pool;await session(c,req,true);return view(await operation(c,id));});},
    async resume(id,req) {
      const r=await write(async c=>{await session(c,req,true);const row=await operation(c,id);if(['READY','FILLING'].includes(row.phase))return row;const claimed=await first(c,q.claim,[id]);if(!claimed)fail('ONBOARDING_NOT_READY');return claimed;});
      if(r.phase!=='IDENTITY')return view(r);
      try {
        const result=await identity.ensure({purpose:'ADMISSION',operationId:r.id,globalUserId:r.global_user_id,input:structuredClone(r.input),fence:Number(r.fence)});
        if(result?.purpose!=='ADMISSION'||result.operationId!==r.id||result.globalUserId!==r.global_user_id||result.issuer!==issuer||typeof result.subject!=='string'||!result.subject||result.subject.length>255||result.subject!==(r.input.expectedSubject||result.subject)||result.mode!==(r.input.expectedSubject?'EXISTING':'CREATED'))fail('IDENTITY_RECONCILIATION_REQUIRED');
        return await write(async c=>{
          const actor=await session(c,req,true),current=await operation(c,id);
          if(current.phase!=='IDENTITY'||Number(current.fence)!==Number(r.fence))fail('ONBOARDING_STALE');
          if(r.input.expectedSubject){if((await first(c,q.identity,[r.global_user_id,issuer,result.subject]))?.status!=='ACTIVE')fail('IDENTITY_RECONCILIATION_REQUIRED');}
          else {await c.query(q.user,[r.global_user_id,r.input.adminName,r.input.adminEmail]);await c.query(q.reference,[randomUUID(),r.global_user_id,issuer,result.subject]);}
          const advanced=await first(c,q.advance,[id,r.fence,'READY',JSON.stringify({issuer,subject:result.subject,mode:result.mode})]);if(!advanced)fail('ONBOARDING_STALE');
          await event(c,current,actor,'IDENTITY_READY',`ready:${r.fence}`);return view(advanced);
        });
      } catch(e) {
        await write(async c=>{await session(c,req,true);const current=await operation(c,id);if(current.phase==='IDENTITY')await c.query(q.failed,[id,r.fence]);}).catch(()=>{});
        if(['NOT_AUTHORIZED','ONBOARDING_STALE','IDENTITY_RECONCILIATION_REQUIRED'].includes(e.code))throw e;
        fail('ONBOARDING_STEP_UNCONFIRMED');
      }
    },
    async issue(id,value,req) {
      if(!value||Object.keys(value).some(k=>!['requestId','replace'].includes(k))||typeof (value.replace??false)!=='boolean')fail('ONBOARDING_INPUT_INVALID');
      uuid(value.requestId);const replace=value.replace??false;
      return write(async c=>{
        const actor=await session(c,req,true),r=await operation(c,id),prior=await first(c,q.issueReplay,[id,value.requestId]);
        if(r.phase!=='READY')fail('ONBOARDING_NOT_READY');
        if(prior){if(prior.issued_by!==actor||prior.replace_requested!==replace)fail('ONBOARDING_CONFLICT');return {...invitationView(prior),secretUnavailable:true};}
        if((await c.query(q.invite,[id])).rows.some(i=>i.status==='OPEN')&&!replace)fail('INVITATION_ALREADY_OPEN');
        await c.query(q.revoke,[id]);const secret=randomBytes(32).toString('hex');
        const i=await first(c,q.issue,[randomUUID(),id,value.requestId,actor,hash(secret),replace]);await event(c,r,actor,'INVITATION_ISSUED',`issue:${i.id}`);
        return {...invitationView(i),secret};
      });
    },
    async cancel(id,req) {return write(async c=>{const actor=await session(c,req,true),r=await operation(c,id);if(r.phase==='COMPLETE')fail('ONBOARDING_NOT_READY');if(r.phase==='CANCELLED')return view(r);if(completion)await completion.cancel(c,id);await c.query(q.revoke,[id]);const cancelled=await first(c,q.cancel,[id]);await event(c,r,actor,'CANCELLED','cancel');return view(cancelled);});},
    async beginActivation(secret,browserBinding) {
      const digest=token(secret),binding=token(browserBinding);
      return write(async c=>{const r=await first(c,q.lookup,[digest]);if(!r||r.phase!=='READY')fail('ACTIVATION_INVALID');await eligible(c,r);const exchange=randomBytes(32).toString('hex');if(!await first(c,q.exchange,[r.id,hash(exchange),binding]))fail('ACTIVATION_INVALID');return {exchange,issuer,subject:r.receipt.subject,mode:r.receipt.mode};});
    },
    async checkActivation(exchange,browserBinding,subject=null) {
      const args=[token(exchange),token(browserBinding)];
      return coordinator.withAuthority(async()=>{const c=coordinator.pool,r=await first(c,q.activation,args);if(!r||r.phase!=='READY'||(subject&&subject!==r.receipt.subject)||!await first(c,q.valid,[r.id]))fail('ACTIVATION_INVALID');await eligible(c,r);return {issuer,subject:r.receipt.subject,mode:r.receipt.mode};});
    },
    async activate(exchange,browserBinding,callback) {
      const args=[token(exchange),token(browserBinding)];
      const r=await write(async c=>{const row=await first(c,q.activation,args);if(!row)fail('ACTIVATION_INVALID');await eligible(c,row);if(row.status!=='USED'&&!await first(c,q.valid,[row.id]))fail('ACTIVATION_INVALID');return row;});
      if(r.status==='USED')return {admissionId:r.operation_id,accepted:true};
      const proof=await verification.verify({callback,exchangeDigest:args[0],bindingDigest:args[1],expectedIssuer:issuer,expectedSubject:r.receipt.subject,requirePasswordSetup:r.receipt.mode==='CREATED'});
      if(proof?.issuer!==issuer||proof.subject!==r.receipt.subject||proof.exchangeDigest!==args[0]||proof.bindingDigest!==args[1]||(r.receipt.mode==='CREATED'&&proof.passwordSetupComplete!==true))fail('ACTIVATION_INVALID');
      return write(async c=>{
        const current=await first(c,q.activation,args);if(!current||current.id!==r.id)fail('ACTIVATION_INVALID');await eligible(c,current);
        if(current.status==='USED')return {admissionId:current.operation_id,accepted:true};
        if(current.phase!=='READY'||!await first(c,q.valid,[current.id]))fail('ACTIVATION_INVALID');
        if(!await first(c,q.accept,[current.operation_id])||!await first(c,q.consume,[current.id]))fail('ACTIVATION_INVALID');
        await event(c,{id:current.operation_id},current.global_user_id,'ACCEPTED',`accepted:${current.id}`);
        return {admissionId:current.operation_id,accepted:true};
      });
    },
    together:work=>coordinator.withAuthority(work),
    async context(req) {return coordinator.withAuthority(async()=>{
      const c=coordinator.pool,id=await session(c,req),authority=await first(c,q.admissionOnly,[id]);
      const items=(await c.query(q.mine,[id])).rows.filter(r=>['FILLING','PREPARING','COMPLETE'].includes(r.phase)).map(view);
      return {limited:authority.admission_origin&&!authority.operational,items};
    });}
  });
}
module.exports={createAdmissionService,input};
