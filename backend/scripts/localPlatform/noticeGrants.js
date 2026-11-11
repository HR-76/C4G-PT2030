'use strict';
// Explicit installation step, never called by API startup or user requests.
const {createAuthorityDataRepository}=require('../../src/authorization/authorityDataRepository');
const {createAuditEvent}=require('../../src/audit/event');
const {createAppendService}=require('../../src/audit/appendService');
const {PostgresAppendRepository}=require('../../src/audit/postgresAppendRepository');
const {createUuidV7}=require('../../src/audit/uuidV7');
const {uuid}=require('../../src/applications/contracts');
async function grantNoticeAccess({coordinator,catalogs,organizationId,membershipId,policyVersion,requirement,installationId}){
 uuid(organizationId);uuid(membershipId);uuid(installationId);
 const data=createAuthorityDataRepository({coordinator,catalogs,policyVersion,recentMfaRequirement:requirement});
 return coordinator.write([`ORG:${organizationId}`,`MEMBER:${membershipId}`],async client=>{
  const actor={organizationId,membershipId},member=await data.membershipPort.revalidate(actor),before=await data.authorizationDataPort.load(actor);
  if(member?.status!=='ACTIVE'||!before)throw Error('NOTICE_ACTIVE_AUTHORITY_REQUIRED');
  const grants=structuredClone(before.grants);
  const permissions=['notification.read',...(before.profileCode==='ORG_ADMIN'?['organization_notice.manage']:[])];
  for(const permission of permissions){
   if(!catalogs.permissionCatalog.resolve(permission))throw Error('NOTICE_CATALOG_REQUIRED');
   if(!grants.some(g=>g.permission===permission&&g.scope?.type==='ORGANIZATION'&&g.scope.id===organizationId&&!g.resourceId&&!g.resourceType))grants.push({permission,scope:{type:'ORGANIZATION',id:organizationId,organizationId}});
  }
  if(grants.length===before.grants.length)return{added:0,authorizationVersion:before.authorizationVersion};
  const event=createAuditEvent({trustedContext:{organizationId,tenantId:null,operationAuthority:'CENTRAL',operationCode:'ORGANIZATION_MEMBERSHIP_MANAGE',source:'LOCAL_INSTALLER',channel:'OPERATIONS',synchronous:true},input:{
   eventCode:'GRANT_CHANGED',actor:{type:'SERVICE',id:installationId,membershipId:null,serviceActorCode:'C4G_LOCAL_INSTALLER',supportGrantId:null},subject:null,resource:{type:'ORGANIZATION_MEMBERSHIP',id:membershipId},decision:'ACCEPT',outcome:'SUCCESS',observedAt:new Date().toISOString(),correlationId:createUuidV7(),causationId:null,
   idempotencyKey:`NOTICE_ACCESS:${membershipId}:${before.authorizationVersion}`,streamType:'SECURITY',payload:{detailCode:'NOTICE_ACCESS_GRANTED',previousVersion:String(before.authorizationVersion),newVersion:String(before.authorizationVersion+1)}}});
  await createAppendService({appendPort:new PostgresAppendRepository()}).append(event,client);
  const result=await client.query(`UPDATE public.authority_f5_state SET authorization_version=authorization_version+1,
   policy_version=$4,grants=$5,assurance_requirements=$6,updated_at=clock_timestamp()
   WHERE organization_id=$1 AND membership_id=$2 AND authorization_version=$3 RETURNING authorization_version`,[organizationId,membershipId,before.authorizationVersion,policyVersion,JSON.stringify(grants),JSON.stringify(requirement)]);
  if(result.rowCount!==1)throw Error('NOTICE_AUTHORITY_VERSION_CHANGED');
  return{added:grants.length-before.grants.length,authorizationVersion:Number(result.rows[0].authorization_version)};
 });
}
module.exports={grantNoticeAccess};
