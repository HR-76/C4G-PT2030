'use strict';
const {randomUUID,randomBytes}=require('node:crypto');
const {isAuthorityCoordinator}=require('../security/authorityCoordinator');
const {grantsForProfile}=require('../organizationDirectory/accessProfiles');
const {createOnboardingAudit}=require('./audit');
const {fail,uuid,hash,token,input,view}=require('./contracts');
const q=require('./sql');

// Composition-only ports. No provider credentials, arbitrary SQL or HTTP claims enter this service.
function createOnboardingService({coordinator,identity,tenant,projection,verification,issuer,policyVersion,assuranceRequirements,mfaPolicyCode,dataResidencyCode,audit=createOnboardingAudit()}){
 if(!isAuthorityCoordinator(coordinator)||![identity,tenant,projection].every(p=>typeof p?.ensure==='function')||typeof verification?.verify!=='function'||typeof issuer!=='string'||!issuer.startsWith('https://')||!policyVersion||!assuranceRequirements||!mfaPolicyCode||!dataResidencyCode)fail('ONBOARDING_COMPOSITION_INVALID');
 const first=async(c,s,p)=>(await c.query(s,p)).rows[0];
 async function admin(c,request){
  const sid=request?.authContext?.sessionId,actorId=request?.user?.id;
  if(!sid||sid!==request.sessionID||!actorId||!await first(c,q.admin,[sid,uuid(actorId)]))fail('C4G_ADMIN_REQUIRED');
  return actorId;
 }
 const write=(fn,row)=>coordinator.write(['POLICY',...(row?[`ORG:${row.organization_id}`,`MEMBER:${row.membership_id}`,`SUBJECT:${row.global_user_id}`]:[])],fn);
 const event=(c,actorId,eventCode,op,key)=>audit(c,{actorId,eventCode,operationId:op.id,key:`onboarding:${op.id}:${key}`});
 async function operation(c,id){const row=await first(c,q.operation,[uuid(id)]);if(!row)fail('ONBOARDING_NOT_FOUND');return row;}
 async function prepared(c,row){
  if(!await first(c,q.orgActive,[row.organization_id])||!await first(c,q.ready,[row.organization_id]))fail('ONBOARDING_NOT_READY');
  const bound=await first(c,q.identity,[row.global_user_id,issuer,row.receipt.subject]);
  if(!bound||bound.status!=='ACTIVE')fail('ACTIVATION_INVALID');
 }
 async function eligible(c,row){
  await prepared(c,row);
  if(!await first(c,q.issuer,[row.issued_by]))fail('ACTIVATION_INVALID');
 }
 function invitationView(row){return {id:row.id,status:row.status,revision:Number(row.revision),expiresAt:row.expires_at};}
 const service={
  async create(value,request){
   const canonical=input(value),digest=hash(JSON.stringify(canonical));
   return write(async c=>{
    const actorId=await admin(c,request),prior=await first(c,q.replay,[actorId,canonical.requestId]);
    if(prior){if(prior.intent_digest!==digest)fail('ONBOARDING_CONFLICT');return view(prior);}
    const matches=(await c.query(q.existing,[canonical.adminEmail])).rows;
    if(matches.length&&(!matches.every(m=>m.status==='ACTIVE')||matches.filter(m=>m.issuer===issuer).length!==1))fail('IDENTITY_RECONCILIATION_REQUIRED');
    const existing=matches.find(m=>m.issuer===issuer),id=randomUUID(),org=randomUUID(),user=existing?.id||randomUUID();
    if(existing&&await first(c,q.nonRemovedMembership,[user]))fail('MEMBERSHIP_ALREADY_EXISTS');
    await c.query(q.org,[org,canonical.legalName,canonical.name,canonical.slug,canonical.type,canonical.currency,mfaPolicyCode,dataResidencyCode]);
    const row=await first(c,q.create,[id,org,actorId,canonical.requestId,digest,JSON.stringify({...canonical,expectedSubject:existing?.subject||null}),user,randomUUID()]);
    await event(c,actorId,'PLATFORM_ORGANIZATION_CREATED',row,'create');return view(row);
   });
  },
  async get(id,request){return coordinator.withAuthority(async()=>{const c=coordinator.pool;await admin(c,request);return view(await operation(c,id));});},
  async list(request){return coordinator.withAuthority(async()=>{await admin(coordinator.pool,request);return (await coordinator.pool.query(q.list)).rows.map(view);});},
  async resume(id,request){
   const row=await write(async c=>{await admin(c,request);const current=await operation(c,id);if(['READY','COMPLETE'].includes(current.phase))return current;const claimed=await first(c,q.claim,[id]);if(!claimed)fail('ONBOARDING_BUSY');return claimed;});
   if(['READY','COMPLETE'].includes(row.phase))return view(row);
   const binding=Object.freeze({operationId:row.id,organizationId:row.organization_id,globalUserId:row.global_user_id,membershipId:row.membership_id});
   try{
    const port={IDENTITY:identity,TENANT:tenant,PROJECTION:projection}[row.phase];
    const result=await port.ensure({...binding,input:structuredClone(row.input),receipt:structuredClone(row.receipt),fence:Number(row.fence)});
    if(!result||Object.entries(binding).some(([k,v])=>result[k]!==v))fail('ONBOARDING_ADAPTER_BINDING_INVALID');
    return await write(async c=>{
     const actorId=await admin(c,request),current=await operation(c,id);
     if(current.phase!==row.phase||Number(current.fence)!==Number(row.fence))fail('ONBOARDING_STALE');
     let receipt={...current.receipt},next;
     if(row.phase==='IDENTITY'){
      if(result.issuer!==issuer||typeof result.subject!=='string'||!result.subject||result.subject.length>255||result.subject!== (row.input.expectedSubject||result.subject)||result.mode!==(row.input.expectedSubject?'EXISTING':'CREATED'))fail('IDENTITY_RECONCILIATION_REQUIRED');
      if(row.input.expectedSubject){if((await first(c,q.identity,[row.global_user_id,issuer,result.subject]))?.status!=='ACTIVE')fail('IDENTITY_RECONCILIATION_REQUIRED');}
      else{await c.query(q.user,[row.global_user_id,row.input.adminName,row.input.adminEmail]);await c.query(q.reference,[randomUUID(),row.global_user_id,issuer,result.subject]);}
      await c.query(q.pending,[row.membership_id,row.global_user_id,row.organization_id]);receipt={issuer,subject:result.subject,mode:result.mode};next='TENANT';
     }else if(row.phase==='TENANT'){
      if(!await first(c,q.ready,[row.organization_id]))fail('ONBOARDING_NOT_READY');next='PROJECTION';
     }else{
      if(!await first(c,q.ready,[row.organization_id])||result.projected!==true)fail('ONBOARDING_NOT_READY');
      await c.query(q.activeOrg,[row.organization_id]);next='READY';
     }
     const advanced=await first(c,q.advance,[id,row.fence,next,JSON.stringify(receipt)]);if(!advanced)fail('ONBOARDING_STALE');
     await event(c,actorId,'PLATFORM_ONBOARDING_ADVANCED',row,`advance:${row.fence}`);return view(advanced);
    },row);
   }catch(error){
    // Provider outcomes are uncertain. Retain stable IDs; never compensate by deleting data.
    await write(async c=>{const actorId=await admin(c,request),failed=await first(c,q.failed,[id,row.fence]);if(failed)await event(c,actorId,'PLATFORM_ONBOARDING_FAILED',row,`failed:${row.fence}`);}).catch(()=>{});
    // Do not expose provider messages, credentials or URLs.
    if(error.code==='23505'&&error.constraint==='organization_membership_single_entity_uidx')fail('MEMBERSHIP_ALREADY_EXISTS');
    if(['C4G_ADMIN_REQUIRED','ONBOARDING_STALE','ONBOARDING_NOT_READY','IDENTITY_RECONCILIATION_REQUIRED','MEMBERSHIP_ALREADY_EXISTS'].includes(error.code))throw error;
    fail('ONBOARDING_STEP_UNCONFIRMED');
   }
  },
  async issue(id,intention,request){
   if(!intention||typeof intention!=='object'||Object.keys(intention).some(k=>!['requestId','replace'].includes(k)))fail('ONBOARDING_INPUT_INVALID');
   const {requestId,replace=false}=intention;
   uuid(requestId);if(typeof replace!=='boolean')fail('ONBOARDING_INPUT_INVALID');
   return write(async c=>{
    const actorId=await admin(c,request),row=await operation(c,id),previous=await first(c,q.issueReplay,[id,requestId]);
    if(previous){if(previous.issued_by!==actorId||previous.replace_requested!==replace)fail('ONBOARDING_CONFLICT');return {...invitationView(previous),secretUnavailable:true};}
    if(row.phase!=='READY')fail('ONBOARDING_NOT_READY');await prepared(c,row);
    const invitations=(await c.query(q.invite,[id])).rows;
    if(invitations.some(i=>i.status==='OPEN')&&!replace)fail('INVITATION_ALREADY_OPEN');
    const revoked=(await c.query(q.revoke,[id])).rows;
    for(const prior of revoked)await event(c,actorId,'PLATFORM_INVITATION_REVOKED',row,`revoke:${prior.id}`);
    const secret=randomBytes(32).toString('hex');
    const invitation=await first(c,q.issue,[randomUUID(),id,requestId,actorId,hash(secret),replace]);
    await event(c,actorId,'PLATFORM_INVITATION_ISSUED',row,`issue:${invitation.id}`);
    return {...invitationView(invitation),secret};
   });
  },
  async revoke(id,invitationId,request){
   uuid(invitationId);
   return write(async c=>{
    const actorId=await admin(c,request),row=await operation(c,id),invitations=(await c.query(q.invite,[id])).rows;
    const target=invitations.find(i=>i.id===invitationId);if(!target)fail('ONBOARDING_NOT_FOUND');
    if(target.status!=='OPEN')return invitationView(target);
    const revoked=await first(c,q.revoke,[id]);await event(c,actorId,'PLATFORM_INVITATION_REVOKED',row,`revoke:${target.id}`);return invitationView(revoked);
   });
  },
  // Browser binding is a server-issued transient secret. HTTP integration must bind it
  // to an HttpOnly cookie and CSRF protection; it is never an administrator session.
  async checkActivation(exchange,browserBinding,subject=null){
   const args=[token(exchange),token(browserBinding)];
   return coordinator.withAuthority(async()=>{
    const c=coordinator.pool,row=await first(c,q.activation,args);
    if(!row||row.status!=='OPEN'||row.phase!=='READY'||(subject&&row.receipt.subject!==subject)||!await first(c,q.valid,[row.id]))fail('ACTIVATION_INVALID');
    await eligible(c,row);return {issuer,subject:row.receipt.subject,mode:row.receipt.mode};
   });
  },
  async beginActivation(secret,browserBinding){
   const digest=token(secret),binding=token(browserBinding);
   return write(async c=>{
    const row=await first(c,q.lookup,[digest]);if(!row||row.phase!=='READY')fail('ACTIVATION_INVALID');await eligible(c,row);
    const exchange=randomBytes(32).toString('hex');
    if(!await first(c,q.exchange,[row.id,hash(exchange),binding]))fail('ACTIVATION_INVALID');
    return {exchange,issuer,subject:row.receipt.subject,mode:row.receipt.mode};
   });
  },
  async activate(exchange,browserBinding,callback){
   const args=[token(exchange),token(browserBinding)];
   const row=await write(async c=>{
    const found=await first(c,q.activation,args);if(!found)fail('ACTIVATION_INVALID');await eligible(c,found);
    if(found.status==='USED')return found;
    if(found.phase!=='READY'||!await first(c,q.valid,[found.id]))fail('ACTIVATION_INVALID');return found;
   });
   if(row.status==='USED')return {organizationId:row.organization_id,activated:true};
   if(!row.verified_identity){
    // This port validates signature, issuer, audience, PKCE, state, nonce and browser
    // binding. It must also prove completion of password setup for a new identity.
    const proof=await verification.verify({callback,exchangeDigest:args[0],bindingDigest:args[1],expectedIssuer:issuer,expectedSubject:row.receipt.subject,requirePasswordSetup:row.receipt.mode==='CREATED'});
    if(proof?.issuer!==issuer||proof?.subject!==row.receipt.subject||proof?.exchangeDigest!==args[0]||proof?.bindingDigest!==args[1]||(row.receipt.mode==='CREATED'&&proof?.passwordSetupComplete!==true))fail('ACTIVATION_INVALID');
    await write(async c=>{
     const current=await first(c,q.activation,args);if(!current||current.id!==row.id)fail('ACTIVATION_INVALID');await eligible(c,current);
     if(current.status==='USED')return;
     if(!await first(c,q.proof,[row.id,JSON.stringify({issuer,subject:proof.subject})]))fail('ACTIVATION_INVALID');
    });
   }
   return write(async c=>{
    const current=await first(c,q.activation,args);if(!current)fail('ACTIVATION_INVALID');await eligible(c,current);
    if(current.status==='USED')return {organizationId:current.organization_id,activated:true};
    if(current.phase!=='READY'||!await first(c,q.valid,[row.id])||current.verified_identity?.subject!==current.receipt.subject||current.verified_identity?.issuer!==issuer)fail('ACTIVATION_INVALID');
    const member=await first(c,q.member,[current.membership_id,current.organization_id,current.global_user_id]);
    if(member?.status!=='PENDING_PROJECTION'||member.base_role_code!=='ORG_ADMIN')fail('ACTIVATION_INVALID');
    await c.query(q.activateMember,[member.id,current.organization_id]);
    await c.query(q.grants,[current.organization_id,member.id,policyVersion,JSON.stringify(grantsForProfile({organizationId:current.organization_id,profileCode:'ORG_ADMIN'})),JSON.stringify(assuranceRequirements)]);
    if(!await first(c,q.consume,[current.id])||!await first(c,q.complete,[current.operation_id]))fail('ACTIVATION_INVALID');
    await event(c,current.global_user_id,'PLATFORM_ADMINISTRATOR_ACTIVATED',{id:current.operation_id},'activate');
    return {organizationId:current.organization_id,activated:true};
   },row);
  }
 };
 return Object.freeze(service);
}
module.exports={createOnboardingService};
