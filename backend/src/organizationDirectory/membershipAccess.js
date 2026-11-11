'use strict';
const {createHash}=require('node:crypto');
const {createAuthorityDataRepository}=require('../authorization/authorityDataRepository');
const {createTaxonomySessionAuthority}=require('../security/authenticatedAuthority');
const {createTaxonomyAuthorization}=require('../authorization/resourceAuthorization');
const {createAuditEvent}=require('../audit/event');
const {createAppendService}=require('../audit/appendService');
const {PostgresAppendRepository}=require('../audit/postgresAppendRepository');
const {createUuidV7}=require('../audit/uuidV7');
const {resource}=require('./repository');
const {uuid,fail}=require('./contracts');
const {profiles,canManage,capabilities,grantsForProfile,accessSnapshot}=require('./accessProfiles');
const sql=require('./accessSql');
function createMembershipAccess({sessionStore,sessionRegistry,authorityCoordinator:coordinator,authorizationCatalogs:catalogs,assurancePolicyVersion:policyVersion,recentMfaRequirement,clock={now:()=>new Date()}}){
 const data=createAuthorityDataRepository({coordinator,catalogs,policyVersion,recentMfaRequirement});
 const authority=createTaxonomySessionAuthority({sessionStore,sessionRegistry,authorityCoordinator:coordinator,...data,policyVersion,clock});
 // Inside coordinator.write the writer owns the actor/session/organization keys.
 // Revalidate all session and membership data in that transaction, without treating its own pending epoch as a competing writer.
 const writerAuthority=createTaxonomySessionAuthority({sessionStore,sessionRegistry,...data,policyVersion,clock});
 const append=createAppendService({appendPort:new PostgresAppendRepository()});
 async function audit(client,actor,eventCode,key,target,detailCode,previousVersion,newVersion,operationCode='ORGANIZATION_MEMBERSHIP_MANAGE'){
  const event=createAuditEvent({trustedContext:{organizationId:actor.organizationId,tenantId:null,operationAuthority:'CENTRAL',operationCode,source:'API',channel:'APPLICATION',synchronous:true},input:{
   eventCode,actor:{type:'HUMAN',id:actor.id,membershipId:actor.membershipId,serviceActorCode:null,supportGrantId:null},subject:null,
   resource:{type:'ORGANIZATION_MEMBERSHIP',id:target},decision:eventCode==='AUTHORIZATION_DENIED'?'DENY':'ACCEPT',outcome:eventCode==='AUTHORIZATION_DENIED'?'DENIED':'SUCCESS',observedAt:clock.now().toISOString(),correlationId:createUuidV7(),causationId:null,
   idempotencyKey:key,streamType:'DATA',payload:{detailCode,...(previousVersion?{previousVersion:String(previousVersion),newVersion:String(newVersion)}:{})}}});
  await append.append(event,client);
 }
 async function authorize(client,trusted,id,operationCode='ORGANIZATION_MEMBERSHIP_MANAGE'){
  const snapshot=await data.authorizationDataPort.load(trusted.actor);
  if(!canManage(snapshot?.profileCode))fail('NOT_AUTHORIZED');
  const authorization=createTaxonomyAuthorization({exactResourceScope:false,catalogs,...data,assurancePolicyVersion:policyVersion,recentMfaRequirement,clock,snapshotForResource:accessSnapshot,
   authorizationAuditPort:{async accept(event){await audit(client,trusted.actor,event.eventType,`MEMBERSHIP-DECISION:${createUuidV7()}`,id,event.reasonCode,undefined,undefined,operationCode);return 'ACCEPTED'}}});
  const decision=await authorization.authorize(operationCode,trusted,resource(trusted.actor.organizationId));
  if(!decision.allowed)fail('NOT_AUTHORIZED');
  return snapshot.profileCode;
 }
 async function change(id,input,request,kind='status'){
  const field=kind==='billing'?'billingRead':kind==='profile'?'profileCode':'status';
  uuid(id);if(!input||Object.keys(input).sort().join(',')!==['expectedRevision','idempotencyKey',field].sort().join(',')||
   !(kind==='billing'?[true,false]:kind==='profile'?profiles.map(p=>p.code):['ACTIVE','SUSPENDED']).includes(input[field])||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)fail('INVALID_INPUT');uuid(input.idempotencyKey);
  const initial=await authority.resolve(await authority.captureAuthenticatedRequest(request)),org=uuid(request.headers?.['x-c4g-organization']);
  if(org!==initial.actor.organizationId)fail('CONTEXT_CHANGED');
  return coordinator.write(['POLICY',`ORG:${org}`,`MEMBER:${id}`,`MEMBER:${initial.actor.membershipId}`,`SUBJECT:${initial.actor.id}`,coordinator.sessionKey(request.sessionID)],async client=>{
   const trusted=await writerAuthority.resolve(await writerAuthority.captureAuthenticatedRequest(request));
   if(trusted.actor.organizationId!==org)fail('CONTEXT_CHANGED');
   const actorProfile=await authorize(client,trusted,id);
   const row=(await client.query(`SELECT m.* FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id
    WHERE m.id=$1 AND m.organization_id=$2 AND u.status='ACTIVE' AND m.status IN ('ACTIVE','SUSPENDED') FOR UPDATE OF m`,[id,org])).rows[0];
   if(!row)fail('RESOURCE_NOT_AVAILABLE');
   if(id===trusted.actor.membershipId)fail('SELF_ACCESS_PROTECTED');
   const allowed=capabilities(actorProfile,trusted.actor.membershipId,{membershipId:id,profileCode:row.base_role_code});
   if(kind==='billing' ? actorProfile!=='ORG_ADMIN'||row.base_role_code==='ORG_ADMIN' : kind==='profile'?!allowed.profileOptions.some(p=>p.code===input.profileCode):!allowed.canChangeStatus)fail('NOT_AUTHORIZED');
   const financial=kind==='billing'?await data.authorizationDataPort.load({organizationId:org,membershipId:id}):null;
   if(kind==='billing'&&!financial)fail('MEMBERSHIP_UNAVAILABLE');
   const digest=createHash('sha256').update(JSON.stringify({org,id,actor:trusted.actor.id,kind,value:input[field],revision:input.expectedRevision,key:input.idempotencyKey})).digest('hex');
   const marker=`C4G_ACCESS:${input.idempotencyKey}:${digest}`;
   const value=kind==='billing'?require('../customerBilling/service').canRead(financial,org):kind==='profile'?row.base_role_code:row.status;
   const result=()=>({membershipId:id,status:row.status,profileCode:row.base_role_code,revision:Number(row.membership_version),...(kind==='billing'?{billingRead:input.billingRead}:{})});
   if(row.status_reason===marker&&Number(row.membership_version)===input.expectedRevision+1&&value===input[field])return result();
   if(Number(row.membership_version)!==input.expectedRevision||value===input[field])fail('STALE_REVISION');
   if(input.status==='ACTIVE'&&(new Date(row.valid_from)>clock.now()||row.valid_until&&new Date(row.valid_until)<=clock.now()))fail('MEMBERSHIP_UNAVAILABLE');
   await audit(client,trusted.actor,'GRANT_CHANGED',`MEMBERSHIP:${org}:${input.idempotencyKey}`,id,kind==='billing'?`BILLING_READ_${input.billingRead?'GRANTED':'REVOKED'}`:kind==='profile'?`PROFILE_${row.base_role_code}_TO_${input.profileCode}`:`MEMBERSHIP_${input.status}`,row.membership_version,Number(row.membership_version)+1);
   if(kind==='profile'||kind==='billing'){
    const prior=await data.authorizationDataPort.load({organizationId:org,membershipId:id});
    if(!prior)fail('MEMBERSHIP_UNAVAILABLE');
    const grants=kind==='billing'?require('../customerBilling/access').financialGrants(prior.grants,org,input.billingRead):grantsForProfile({organizationId:org,profileCode:input.profileCode,previousProfile:row.base_role_code,previousGrants:prior.grants});
    const updated=await client.query(`UPDATE public.authority_f5_state SET authorization_version=authorization_version+1,
     policy_version=$4,grants=$5,assurance_requirements=$6,updated_at=clock_timestamp()
     WHERE organization_id=$1 AND membership_id=$2 AND authorization_version=$3 RETURNING authorization_version`,
     [org,id,prior.authorizationVersion,policyVersion,JSON.stringify(grants),JSON.stringify(recentMfaRequirement)]);
    if(updated.rowCount!==1)fail('STALE_REVISION');
    const nextProfile=kind==='billing'?row.base_role_code:input.profileCode;
    await client.query(sql.profile,[id,org,nextProfile,marker]);row.base_role_code=nextProfile;
   }else{await client.query(`UPDATE public.organization_membership SET status=$3,membership_version=membership_version+1,status_reason=$4,
    suspended_at=CASE WHEN $3='SUSPENDED' THEN clock_timestamp() ELSE suspended_at END,updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2`,[id,org,input.status,marker]);
    row.status=input.status;
   }
   row.membership_version=Number(row.membership_version)+1;return result();
  });
 }
 return {change,changeBilling:(id,input,request)=>change(id,input,request,'billing'),changeProfile:(id,input,request)=>change(id,input,request,'profile'),
  async list(request){return coordinator.withAuthority(async()=>{
   const handle=await authority.captureAuthenticatedRequest(request),trusted=await authority.resolve(handle),org=uuid(request.headers?.['x-c4g-organization']);
   if(org!==trusted.actor.organizationId)fail('CONTEXT_CHANGED');
   const actorProfile=await authorize(coordinator.pool,trusted,org,'ORGANIZATION_MEMBERSHIP_READ');
   const items=(await coordinator.pool.query(sql.list,[org])).rows;
   if(items.length>1000)fail('LIMIT_EXCEEDED');
   const projected=[];
   for(const m of items){
    const financial=await data.authorizationDataPort.load({organizationId:org,membershipId:m.membershipId});
    projected.push({...m,...capabilities(actorProfile,trusted.actor.membershipId,m),billingRead:require('../customerBilling/service').canRead(financial,org),canChangeBilling:actorProfile==='ORG_ADMIN'&&m.profileCode!=='ORG_ADMIN'&&m.membershipId!==trusted.actor.membershipId});
   }
   await authority.resolve(handle);
   return {items:projected,actorMembershipId:trusted.actor.membershipId,actorProfile,canManage:true};
  })}
 };
}
module.exports={createMembershipAccess};
