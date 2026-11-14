'use strict';
const {uuid,fail}=require('../platformOnboarding/contracts');
const {evaluateAssurance}=require('../security/assurance');
const q=require('./deletionSql');
const adminSql=require('../platformOnboarding/sql').admin;
const view=row=>({userId:row.global_user_id,requestId:row.request_key,phase:row.phase,accessRevoked:true});
function createUserDeletion({coordinator,identity,projection,issuer,policyVersion,recentMfaRequirement,audit,clock=()=>Date.now()}){
 const first=async(c,sql,values)=>(await c.query(sql,values)).rows[0];
 async function authorize(c,req){
  const id=req.user?.id,sid=req.authContext?.sessionId;
  if(!sid||sid!==req.sessionID||!id||!await first(c,adminSql,[sid,uuid(id)]))fail('C4G_ADMIN_REQUIRED');
  if(recentMfaRequirement?.mfa!==true||!evaluateAssurance({evidence:req.authContext?.evidence,requirement:recentMfaRequirement,nowSeconds:clock()/1000,expectedPolicyVersion:policyVersion}).allowed)fail('MFA_REQUIRED');
  return uuid(id);
 }
 const transaction=async(id,work)=>{
  const memberships=await coordinator.withAuthority(async()=>(await coordinator.pool.query(q.memberships,[id])).rows);
  return coordinator.write(['POLICY',`SUBJECT:${id}`,...memberships.flatMap(m=>[`ORG:${m.organizationId}`,`MEMBER:${m.membershipId}`])],work);
 };
 async function advance(id,key,phase,req){return transaction(id,async c=>{
  await authorize(c,req);const row=await first(c,q.operation,[id]);
  if(!row||row.request_key!==key)fail('DELETION_CONFLICT');
  if(row.phase==='COMPLETE')return row;
  const order=['BLOCKED','IDENTITY_REMOVED','TENANTS_ANONYMIZED'];
  if(order.indexOf(row.phase)>=order.indexOf(phase))return row;
  if(order.indexOf(phase)!==order.indexOf(row.phase)+1)fail('DELETION_CONFLICT');
  return first(c,q.phase,[id,key,phase]);
 });}
 return Object.freeze({
 async status(id,req){
  id=uuid(id);return coordinator.withAuthority(async()=>{
   const c=coordinator.pool;await authorize(c,req);
   const target=await first(c,q.target,[id]);if(!target)fail('RESOURCE_NOT_AVAILABLE');
   if(uuid(req.user.id)===id)fail('SELF_ACCESS_PROTECTED');
   const row=await first(c,q.operation,[id]);
   return {...(row?view(row):{userId:id,phase:'NOT_STARTED',accessRevoked:false}),expectedRevision:Number(target.session_revocation_version)};
  });
 },
 async remove(id,input,req){
  id=uuid(id);
  if(!input||Object.keys(input).sort().join(',')!=='confirmation,expectedRevision,requestId'||input.confirmation!=='ELIMINAR'||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)fail('INVALID_INPUT');
  const key=uuid(input.requestId);
  let row=await transaction(id,async c=>{
   const actor=await authorize(c,req);if(actor===id)fail('SELF_ACCESS_PROTECTED');
   const prior=await first(c,q.operation,[id]);
   if(prior){if(prior.request_key!==key)fail('DELETION_CONFLICT');return prior;}
   const target=await first(c,q.target,[id]);
   if(!target)fail('RESOURCE_NOT_AVAILABLE');
   if(Number(target.session_revocation_version)!==input.expectedRevision)fail('STALE_REVISION');
   if((await first(c,q.protected,[id])).protected)fail('LAST_ADMIN_PROTECTED');
   if((await first(c,q.pending,[id])).pending)fail('ONBOARDING_IN_PROGRESS');
   const identities=(await c.query(q.identities,[id])).rows,memberships=(await c.query(q.memberships,[id])).rows;
   if(!identities.length||identities.some(i=>i.issuer!==issuer))fail('IDENTITY_RECONCILIATION_REQUIRED');
   if(typeof projection?.anonymize!=='function'||typeof identity?.remove!=='function')fail('DELETION_NOT_CONFIGURED');
   const started=await first(c,q.start,[id,key,actor,JSON.stringify(identities),JSON.stringify(memberships)]);
   for(const command of ['archive','sessions','sessionPayloads','roles','removeMemberships','revokeMemberInvites','revokeFirstInvites'])await c.query(q[command],[id]);
   await audit(c,{actorId:actor,eventCode:'PLATFORM_ACCESS_CHANGED',operationId:id,resourceType:'GLOBAL_USER',detailCode:'ACCOUNT_DELETION_STARTED',key:`user-deletion:${id}:start`});
   return started;
  });
  if(row.phase==='COMPLETE')return view(row);
  if(row.phase==='BLOCKED'){
   for(const reference of row.identities){const result=await identity.remove(reference);if(result?.deleted!==true||result.issuer!==reference.issuer||result.subject!==reference.subject)fail('IDENTITY_DELETION_UNCONFIRMED');}
   row=await advance(id,key,'IDENTITY_REMOVED',req);
  }
  if(row.phase==='IDENTITY_REMOVED'){
   for(const membership of row.memberships){const result=await projection.anonymize({...membership,globalUserId:id,requestId:key});if(result?.anonymized!==true||result.organizationId!==membership.organizationId||result.membershipId!==membership.membershipId)fail('PROJECTION_DELETION_UNCONFIRMED');}
   row=await advance(id,key,'TENANTS_ANONYMIZED',req);
  }
  return transaction(id,async c=>{
   const actor=await authorize(c,req);const current=await first(c,q.operation,[id]);
   if(!current||current.request_key!==key)fail('DELETION_CONFLICT');
   if(current.phase==='COMPLETE')return view(current);
   if(current.phase!=='TENANTS_ANONYMIZED')fail('DELETION_CONFLICT');
   const email=`deleted-${id}@deleted.invalid`;
   for(const command of ['anonymize','memberInputs','firstInputs','admissionInputs'])await c.query(q[command],[id,email]);
   for(const command of ['references','memberProofs','firstProofs','admissionProofs'])await c.query(q[command],[id]);
   await audit(c,{actorId:actor,eventCode:'PLATFORM_ACCESS_CHANGED',operationId:id,resourceType:'GLOBAL_USER',detailCode:'ACCOUNT_DELETION_COMPLETED',key:`user-deletion:${id}:complete`});
   return view(await first(c,q.finish,[id,key]));
  });
 }});
}
module.exports={createUserDeletion};
