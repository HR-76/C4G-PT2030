'use strict';
const {uuid,hash,fail}=require('../platformOnboarding/contracts');
const q=require('../platformOnboarding/memberSql');
const {profiles,grantsForProfile}=require('../organizationDirectory/accessProfiles');
const {createOnboardingAudit}=require('../platformOnboarding/audit');
const {evaluateAssurance}=require('../security/assurance');
function createPlatformAccess({coordinator,policyVersion,assuranceRequirements,recentMfaRequirement,audit=createOnboardingAudit(),clock=()=>Date.now()}){
 const first=async(c,s,p)=>(await c.query(s,p)).rows[0];
 async function admin(c,request,org){
  const sid=request.authContext?.sessionId,id=request.user?.id;
  if(!sid||sid!==request.sessionID||!id||!await first(c,q.admin,[sid,uuid(id)]))fail('C4G_ADMIN_REQUIRED');
  if(!await first(c,q.orgActive,[uuid(org)]))fail('RESOURCE_NOT_AVAILABLE');return id;
 }
 return {
  async list(org,req){return coordinator.withAuthority(async()=>{const c=coordinator.pool;await admin(c,req,org);const rows=(await c.query(q.accessList,[org])).rows;if(rows.length>1000)fail('LIMIT_EXCEEDED');return {items:rows.map(r=>({...r,canChangeStatus:true,profileOptions:profiles})),actorMembershipId:null,actorProfile:'C4G_ADMIN',canManage:true};});},
  async change(org,id,input,req,kind){
   uuid(org);uuid(id);const field=kind==='profile'?'profileCode':'status';
   if(!input||Object.keys(input).sort().join(',')!==['expectedRevision','idempotencyKey',field].sort().join(',')||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||!(kind==='profile'?profiles.map(p=>p.code):['ACTIVE','SUSPENDED']).includes(input[field]))fail('INVALID_INPUT');uuid(input.idempotencyKey);
   return coordinator.write(['POLICY',`ORG:${org}`,`MEMBER:${id}`],async c=>{
    const actorId=await admin(c,req,org);
    if(recentMfaRequirement?.mfa!==true||!evaluateAssurance({evidence:req.authContext?.evidence,requirement:recentMfaRequirement,nowSeconds:clock()/1000,expectedPolicyVersion:policyVersion}).allowed)fail('MFA_REQUIRED');
    const row=await first(c,q.detail,[id,org]);
    if(!row||!['ACTIVE','SUSPENDED'].includes(row.status))fail('RESOURCE_NOT_AVAILABLE');
    if(row.global_user_id===actorId)fail('SELF_ACCESS_PROTECTED');
    const marker='C4G_ACCESS:'+input.idempotencyKey+':'+hash(JSON.stringify({org,id,actorId,kind,value:input[field],revision:input.expectedRevision}));
    const current=kind==='profile'?row.base_role_code:row.status;
    if(row.status_reason===marker&&Number(row.membership_version)===input.expectedRevision+1&&current===input[field])return {membershipId:id,revision:Number(row.membership_version)};
    if(Number(row.membership_version)!==input.expectedRevision||current===input[field])fail('STALE_REVISION');
    if(input.status==='ACTIVE'&&(new Date(row.valid_from)>new Date()||(row.valid_until&&new Date(row.valid_until)<=new Date())))fail('MEMBERSHIP_UNAVAILABLE');
    if(kind==='profile'){
     const previous=await first(c,q.state,[org,id]);if(!previous)fail('MEMBERSHIP_UNAVAILABLE');
     await c.query(q.grantsUpdate,[org,id,policyVersion,JSON.stringify(grantsForProfile({organizationId:org,profileCode:input.profileCode,previousProfile:row.base_role_code,previousGrants:previous.grants})),JSON.stringify(assuranceRequirements)]);
     await c.query(q.profileUpdate,[id,org,input.profileCode,marker]);
    }else await c.query(q.statusUpdate,[id,org,input.status,marker]);
    await audit(c,{actorId,eventCode:'PLATFORM_ACCESS_CHANGED',operationId:id,resourceType:'ORGANIZATION_MEMBERSHIP',detailCode:kind==='profile'?`PROFILE_${row.base_role_code}_TO_${input.profileCode}`:`MEMBERSHIP_${input.status}`,previousVersion:row.membership_version,newVersion:Number(row.membership_version)+1,key:`platform-access:${org}:${input.idempotencyKey}`});
    return {membershipId:id,revision:Number(row.membership_version)+1};
   });
  }
 };
}
module.exports={createPlatformAccess};
