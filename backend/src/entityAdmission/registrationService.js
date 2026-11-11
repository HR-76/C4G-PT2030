'use strict';
const {uuid,hash,fail}=require('../platformOnboarding/contracts'),q=require('./registrationSql');
const contract=require('./registrationContract');
const first=async(c,s,p)=>(await c.query(s,p)).rows[0];
function storedFields(fields={}){const administrator=fields.administrator||{};return {...fields,
 responsibleName:fields.responsibleName||administrator.name||'',responsibleEmail:fields.responsibleEmail||administrator.email||'',
 responsiblePhone:fields.responsiblePhone||fields.administratorProfessionalPhone||'',responsibleJobTitle:fields.responsibleJobTitle||fields.administratorJobTitle||''};}
const view=r=>r?{fields:storedFields(r.fields),revision:Number(r.revision),updatedAt:r.updated_at,source:'CENTRAL',sourceRevision:Number(r.source_revision),complete:Boolean(r.fields?.nif)}:null;
function createRegistrationService({coordinator,organizationReader=null,audit=require('../platformOnboarding/audit').createOnboardingAudit()}){
 if(!require('../security/authorityCoordinator').isAuthorityCoordinator(coordinator))throw new TypeError('Registration requires the composition authority coordinator.');
 const event=(c,org,actor,key,previousVersion,newVersion)=>audit(c,{actorId:actor,eventCode:'PLATFORM_REGISTRATION_CHANGED',operationId:org,resourceType:'ORGANIZATION',key:`registration:${org}:${key}`,previousVersion,newVersion});
 const identity=async org=>{if(!organizationReader)fail('ONBOARDING_COMPOSITION_INVALID');const value=await organizationReader(org);if(!value||value.status!=='ACTIVE')fail('RESOURCE_NOT_AVAILABLE');return value;};
 async function save(org,value,actor,authorize){
  uuid(org);const input=contract.profileCommand(value);
  try{return await coordinator.write(['POLICY',`ORG:${org}`],async c=>{
   await authorize(c);const organization=await identity(org),parsed=contract.assertValid(contract.validateProfile(input.fields,{legalName:organization.legalName,displayName:organization.name,typeCode:organization.typeCode}));
   // Persist every canonical profile key so clearing an optional value does not
   // leave a stale value behind through the JSONB merge used by the shared row.
   const fields={...Object.fromEntries(contract.profileKeys.map(key=>[key,parsed[key]??''])),legalName:organization.legalName,displayName:organization.name,typeCode:organization.typeCode,country:'PT',addressCountry:'PT',currency:organization.currency||'EUR'};
   const digest=hash(JSON.stringify({...input,fields})),prior=await first(c,q.receipt,[org,input.requestId]);
   if(prior){if(prior.actor_id!==actor||prior.intent_digest!==digest)fail('ONBOARDING_CONFLICT');return prior.result;}
   const old=await first(c,q.get,[org]),revision=Number(old?.revision||0);
   if(revision!==input.expectedRevision)fail('ONBOARDING_STALE');
   if(old?.fields?.nif&&old.fields.nif!==fields.nif)fail('FISCAL_IDENTITY_LOCKED');
   const occupied=await first(c,require('./completionSql').occupied,[fields.nif]);if(occupied&&occupied.organization_id!==org)fail('FISCAL_IDENTITY_REVIEW_REQUIRED');
   const row=old?await first(c,q.save,[org,JSON.stringify(fields),input.expectedRevision]):await first(c,q.seed,[org,JSON.stringify(fields),0,digest]);
   if(!row)fail('ONBOARDING_STALE');const result=view(row);await event(c,org,actor,input.requestId,revision,Number(row.revision));await c.query(q.remember,[org,input.requestId,actor,digest,JSON.stringify(result)]);return result;
  });}catch(error){if(error.code==='23505')fail(error.constraint==='organization_registration_pkey'?'ONBOARDING_STALE':'FISCAL_IDENTITY_REVIEW_REQUIRED');throw error;}
 }
 return Object.freeze({
  // Internal composition port, never mounted as an unauthenticated HTTP handler.
  read:org=>coordinator.withAuthority(async()=>view(await first(coordinator.pool,q.get,[uuid(org)]))),
  async contacts(org,value,req,trusted,authorize){
   uuid(org);const input=contract.command(value);
   if(!input.fields||Object.keys(input.fields).sort().join(',')!=='institutionalEmail,institutionalPhone,website')fail('ONBOARDING_INPUT_INVALID');
   const parsed=contract.assertValid(contract.validate(input.fields));
   const fields=Object.fromEntries(['institutionalEmail','institutionalPhone','website'].map(k=>[k,parsed[k]||''])),digest=hash(JSON.stringify({...input,fields}));
   return coordinator.write(['POLICY'],async c=>{
    const actor=req.user?.id;if(req.authContext?.sessionId!==req.sessionID||!actor)fail('NOT_AUTHORIZED');
    const current=await first(c,q.session,[req.sessionID,uuid(actor)]);
    if(!current||current.selected_organization_id!==org||current.selected_membership_id!==trusted.actor.membershipId||Number(current.selected_membership_version)!==trusted.actor.membershipVersion||trusted.actor.id!==actor||trusted.actor.organizationId!==org)fail('NOT_AUTHORIZED');
    if(!await authorize(c,trusted,org))fail('NOT_AUTHORIZED');
    const prior=await first(c,q.receipt,[org,input.requestId]);
    if(prior){if(prior.actor_id!==actor||prior.intent_digest!==digest)fail('ONBOARDING_CONFLICT');return prior.result;}
    const old=await first(c,q.get,[org]);if(!old)fail('ONBOARDING_NOT_READY');
    if(old.fields.nif&&(!fields.institutionalEmail||!fields.institutionalPhone))fail('ONBOARDING_INPUT_INVALID');
    const updated=await first(c,q.save,[org,JSON.stringify(fields),input.expectedRevision]);if(!updated)fail('ONBOARDING_STALE');
    const result=view(updated);await event(c,org,actor,input.requestId);await c.query(q.remember,[org,input.requestId,actor,digest,JSON.stringify(result)]);return result;
   });
  },
   async profile(org){const organization=await identity(uuid(org)),row=await coordinator.withAuthority(async()=>first(coordinator.pool,q.get,[org]));return {organization,registration:view(row)||{fields:{},revision:0,updatedAt:null,source:'CENTRAL',sourceRevision:0,complete:false}};},
   async saveForEntity(org,value,req,trusted,authorize){
    const actor=req.user?.id;
    return save(org,value,actor,async c=>{if(req.authContext?.sessionId!==req.sessionID||!actor)fail('NOT_AUTHORIZED');const current=await first(c,q.session,[req.sessionID,uuid(actor)]);if(!current||current.selected_organization_id!==org||current.selected_membership_id!==trusted.actor.membershipId||Number(current.selected_membership_version)!==trusted.actor.membershipVersion||trusted.actor.id!==actor||trusted.actor.organizationId!==org||!await authorize(c,trusted,org))fail('NOT_AUTHORIZED');});
   },
   async saveForPlatform(org,value,req){
    const actor=req.user?.id;
    return save(org,value,actor,async c=>{if(req.authContext?.sessionId!==req.sessionID||!actor||!await first(c,require('../platformOnboarding/sql').admin,[req.sessionID,uuid(actor)])||!await first(c,require('../platformOnboarding/sql').orgActive,[org]))fail('C4G_ADMIN_REQUIRED');});
   },
  // Administrative migration caller must hold the tenant profile lock through this call.
  async adoptContacts(org,snapshot,req){
   uuid(org);if(!snapshot||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<0||typeof snapshot.email!=='string'||typeof snapshot.website!=='string')fail('ONBOARDING_INPUT_INVALID');
   const fields={institutionalEmail:snapshot.email,website:snapshot.website},digest=hash(JSON.stringify({revision:snapshot.revision,...fields}));
   return coordinator.write(['POLICY'],async c=>{
    if(req.authContext?.sessionId!==req.sessionID||!req.user?.id||!await first(c,require('../platformOnboarding/sql').admin,[req.sessionID,uuid(req.user.id)]))fail('NOT_AUTHORIZED');
    const prior=await first(c,q.get,[org]);
    if(prior){
     // A later description-only save changes the tenant revision, not its legacy contacts.
     const originalDigest=hash(JSON.stringify({revision:Number(prior.source_revision),...fields}));
     if(prior.source_digest!==originalDigest)fail('ONBOARDING_CONFLICT');return view(prior);
    }
    const row=await first(c,q.seed,[org,JSON.stringify(fields),snapshot.revision,digest]);await event(c,org,req.user.id,`adopt:${digest}`);return view(row);
   });
  }
 });
}
module.exports={createRegistrationService};
