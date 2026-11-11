'use strict';
const {randomUUID}=require('node:crypto');
const {uuid,hash,fail}=require('../platformOnboarding/contracts');
const q=require('./completionSql'),admission=require('./sql'),onboarding=require('../platformOnboarding/sql'),draft=require('./draftSql'),contract=require('./registrationContract');
const first=async(c,sql,args)=>(await c.query(sql,args)).rows[0];
const projection=r=>({admissionId:r.admission_id,organizationId:r.organization_id,phase:r.phase,submittedAt:r.created_at,completedAt:r.completed_at,errorCode:r.error_code,canEnter:r.phase==='COMPLETE'});
function command(value){if(!value||Object.keys(value).sort().join(',')!=='expectedRevision,requestId'||!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<1)fail('ONBOARDING_INPUT_INVALID');return {expectedRevision:value.expectedRevision,requestId:uuid(value.requestId)};}
function createCompletionService({coordinator,issuer,tenant,projection:person,publishCredentials,policyVersion,assuranceRequirements,mfaPolicyCode,dataResidencyCode,audit=require('../platformOnboarding/audit').createOnboardingAudit(),onFailure=()=>{}}){
 if(!require('../security/authorityCoordinator').isAuthorityCoordinator(coordinator)||!issuer||!policyVersion||!assuranceRequirements||!mfaPolicyCode||!dataResidencyCode||![tenant,person].every(p=>typeof p?.ensure==='function')||typeof publishCredentials!=='function')fail('ONBOARDING_COMPOSITION_INVALID');
 const write=(fn,r)=>coordinator.write(['POLICY',...(r?[`ORG:${r.organization_id}`,`MEMBER:${r.membership_id}`,`SUBJECT:${r.actor_id}`]:[])],fn);
 const event=(c,r,code,key)=>audit(c,{actorId:r.actor_id,eventCode:code,operationId:r.admission_id,resourceType:'ENTITY_ADMISSION',key:`completion:${r.admission_id}:${key}`});
 async function own(c,id,req){
  uuid(id);const actor=req?.user?.id;
  if(!actor||req.authContext?.sessionId!==req.sessionID||!await first(c,admission.session,[req.sessionID,uuid(actor)]))fail('NOT_AUTHORIZED');
  const r=await first(c,admission.operation,[id]);if(!r||r.global_user_id!==actor||!r.accepted_at||r.phase==='CANCELLED')fail('ONBOARDING_NOT_FOUND');return r;
 }
 async function eligible(c,id){const r=await first(c,admission.operation,[id]);if(!r||r.phase!=='PREPARING'||!await first(c,admission.issuer,[r.requested_by])||(await first(c,admission.identity,[r.global_user_id,issuer,r.receipt.subject]))?.status!=='ACTIVE')fail('ONBOARDING_NOT_READY');return r;}
 async function ready(c,r){if(!await first(c,onboarding.ready,[r.organization_id])||(await c.query(q.readiness,[r.organization_id])).rows.length!==2)fail('ONBOARDING_NOT_READY');}
 async function currentProjection(c,r){const result=projection(r);if(result.canEnter){const m=await first(c,onboarding.member,[r.membership_id,r.organization_id,r.actor_id]);result.canEnter=m?.status==='ACTIVE'&&Boolean(await first(c,onboarding.orgActive,[r.organization_id]));}return result;}
 return Object.freeze({
  async submit(id,value,req){const input=command(value);return write(async c=>{
   const a=await own(c,id,req),previous=await first(c,q.get,[id]);
   if(previous){if(previous.actor_id!==a.global_user_id||previous.request_key!==input.requestId||Number(previous.draft_revision)!==input.expectedRevision)fail('ONBOARDING_CONFLICT');return currentProjection(c,previous);}
   if(a.phase!=='FILLING'||!await first(c,admission.issuer,[a.requested_by])||(await first(c,admission.identity,[a.global_user_id,issuer,a.receipt.subject]))?.status!=='ACTIVE')fail('ONBOARDING_NOT_READY');
   const d=await first(c,draft.get,[id]);if(!d||Number(d.revision)!==input.expectedRevision)fail('ONBOARDING_STALE');
   const fields=contract.assertValid(contract.validate(d.fields,{complete:true}));
   const snapshot={...fields,country:'PT',addressCountry:'PT',currency:'EUR',administrator:{name:a.input.adminName,email:a.input.adminEmail}},digest=hash(JSON.stringify(snapshot)),org=randomUUID(),member=randomUUID();
   if(await first(c,q.occupied,[fields.nif]))fail('FISCAL_IDENTITY_REVIEW_REQUIRED');
   // All writes roll back together, including organization creation on a duplicate NIF.
   await c.query(onboarding.org,[org,fields.legalName,fields.displayName,'c4g-'+org,fields.typeCode,'EUR',mfaPolicyCode,dataResidencyCode]);
   if(!await first(c,q.reserve,[fields.nif,id,org]))fail('FISCAL_IDENTITY_REVIEW_REQUIRED');
   await c.query(onboarding.pending,[member,a.global_user_id,org]);
   const row=await first(c,q.create,[id,org,member,a.global_user_id,input.requestId,d.revision,JSON.stringify(snapshot),digest]);
   await c.query(q.registration,[org,JSON.stringify(snapshot),d.revision,digest]);
   if(!await first(c,q.submitted,[id]))fail('ONBOARDING_STALE');
   await event(c,row,'PLATFORM_ADMISSION_SUBMITTED','submit');return projection(row);
  });},
  async status(id,req){return coordinator.withAuthority(async()=>{const c=coordinator.pool,a=await own(c,id,req),r=await first(c,q.get,[id]);return r?currentProjection(c,r):{admissionId:id,phase:a.phase,canEnter:false};});},
  async cancel(c,id){const r=await first(c,q.get,[id]);if(r?.phase==='COMPLETE')fail('ONBOARDING_NOT_READY');if(r)await c.query(q.cancel,[id]);},
  // Private worker port. The row is the durable queue; no HTTP request owns its lifetime.
  async pending(){return coordinator.withAuthority(async()=>(await coordinator.pool.query(q.jobs)).rows.map(r=>r.admission_id));},
  async prepare(id){
   const row=await write(async c=>{await eligible(c,uuid(id));const r=await first(c,q.claim,[id]);if(!r)fail('ONBOARDING_NOT_READY');return r;});
   const binding={operationId:id,organizationId:row.organization_id,globalUserId:row.actor_id,membershipId:row.membership_id};
   const f=row.snapshot,input={...f,name:f.displayName,type:f.typeCode,adminName:f.administrator.name,adminEmail:f.administrator.email};
   const args={...binding,input,fence:Number(row.fence)};
   try{
    if(row.phase!=='ACTIVATION'){
     const result=await (row.phase==='TENANT'?tenant:person).ensure(args);
     if(!result||Object.entries(binding).some(([k,v])=>result[k]!==v)||(row.phase==='PROJECTION'&&result.projected!==true))fail('ONBOARDING_ADAPTER_BINDING_INVALID');
    }
    // Re-publish idempotently after restart and before activation; this private port
    // must verify both runtime credentials and physical binding, never return secrets.
    if(['TENANT','ACTIVATION'].includes(row.phase)){const published=await publishCredentials(args);if(!published||Object.entries(binding).some(([k,v])=>published[k]!==v)||published.published!==true)fail('ONBOARDING_NOT_READY');}
    return await write(async c=>{
     await eligible(c,id);const current=await first(c,q.get,[id]);if(current?.phase!==row.phase||Number(current.fence)!==Number(row.fence))fail('ONBOARDING_STALE');await ready(c,row);
     const next={TENANT:'PROJECTION',PROJECTION:'ACTIVATION',ACTIVATION:'COMPLETE'}[row.phase];
     if(next==='COMPLETE'){
      const member=await first(c,onboarding.member,[row.membership_id,row.organization_id,row.actor_id]);if(member?.status!=='PENDING_PROJECTION'||member.base_role_code!=='ORG_ADMIN')fail('ONBOARDING_NOT_READY');
      await c.query(onboarding.activeOrg,[row.organization_id]);
      if(!await first(c,onboarding.activateMember,[row.membership_id,row.organization_id]))fail('ONBOARDING_STALE');
      await c.query(onboarding.grants,[row.organization_id,row.membership_id,policyVersion,JSON.stringify(require('../organizationDirectory/accessProfiles').grantsForProfile({organizationId:row.organization_id,profileCode:'ORG_ADMIN'})),JSON.stringify(assuranceRequirements)]);
      if(!await first(c,q.complete,[id]))fail('ONBOARDING_STALE');
     }
     const saved=await first(c,q.advance,[id,row.fence,next]);if(!saved)fail('ONBOARDING_STALE');
     await event(c,row,next==='COMPLETE'?'PLATFORM_ADMISSION_COMPLETED':'PLATFORM_ADMISSION_PREPARED',`advance:${row.fence}`);return projection(saved);
    },row);
   }catch(e){onFailure({code:e.code||e.name,constraint:e.constraint,phase:row.phase});await write(c=>c.query(q.failed,[id,row.fence])).catch(()=>{});if(['ONBOARDING_STALE','ONBOARDING_NOT_READY'].includes(e.code))throw e;fail('ONBOARDING_STEP_UNCONFIRMED');}
  }
 });
}
module.exports={createCompletionService,command};
