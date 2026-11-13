'use strict';
// Fixed internal profiles. These rules do not confer any platform/C4G role.
const profiles=Object.freeze([
 Object.freeze({code:'ORG_ADMIN',label:'Administrador'}),
 Object.freeze({code:'FUNDING_MANAGER',label:'Gestor de candidaturas'}),
 Object.freeze({code:'CONTRIBUTOR',label:'Técnico'})
]);
const common=['opportunity_interest.read','notification.read','personal_profile.read','personal_profile.edit'];
const management=['opportunity_interest.manage','opportunity.read','opportunity.private.create','opportunity.private.update','opportunity.archive',
 'application.read','application.create','application.edit','application.transition','prequalification.read',
 'organization_directory.read','organization_directory.edit','organizational_scope.read','organization_membership.read','organization_membership.manage'];
// Técnico (12/11/2026): manages interests and starts applications; no directory, membership or archive powers.
const technician=['opportunity_interest.manage','application.create'];
const administration=['organization_notice.manage','organizational_scope.create','organizational_scope.rename','organizational_scope.reparent'];
const work=new Set(['application.read','application.edit','application.transition','application.review.decide',
 'document.read','document.version.list','document.version.create','document.download.request','document.upload.initiate','document.upload.confirm']);
// Which areas a profile may open. Decided here only; the client follows the list and has no per-profile rules.
function navigationFor(profileCode){
 if(!['ORG_ADMIN','FUNDING_MANAGER','CONTRIBUTOR','VIEWER'].includes(profileCode))return null;
 return {partners:profileCode!=='CONTRIBUTOR',calendar:profileCode==='ORG_ADMIN',people:canManage(profileCode),dashboard:profileCode==='CONTRIBUTOR'?'TECHNICIAN':'ORGANIZATION'};
}
function canManage(profile){return ['ORG_ADMIN','FUNDING_MANAGER'].includes(profile)}
function capabilities(profile,actorId,target){
 const own=actorId===target.membershipId;
 const allowed=!own&&(profile==='ORG_ADMIN'||profile==='FUNDING_MANAGER'&&['CONTRIBUTOR','VIEWER'].includes(target.profileCode));
 return {canChangeStatus:allowed&&(profile==='ORG_ADMIN'||target.profileCode==='CONTRIBUTOR'),profileOptions:allowed?(profile==='ORG_ADMIN'?profiles:profiles.filter(p=>p.code==='CONTRIBUTOR')):[]};
}
function grantsForProfile({organizationId,profileCode,previousProfile,previousGrants=[]}){
 if(!['ORG_ADMIN','FUNDING_MANAGER','CONTRIBUTOR','VIEWER'].includes(profileCode))throw Object.assign(new Error('INVALID_INPUT'),{code:'INVALID_INPUT'});
 const codes=[...common,...(profileCode!=='VIEWER'?['opportunity_interest.register']:[]),...(canManage(profileCode)?management:[]),...(profileCode==='CONTRIBUTOR'?technician:[]),...(profileCode==='ORG_ADMIN'?administration:[])];
 const grants=codes.map(permission=>({permission,scope:{type:'ORGANIZATION',id:organizationId,organizationId}}));
 // Explicit work grants survive; an old administrator/manager's broad powers do not.
 for(const grant of previousGrants){
  if(grant.permission==='billing.read'&&grant.scope?.type==='ORGANIZATION'&&grant.scope.id===organizationId&&grant.scope.organizationId===organizationId&&!grant.resourceId&&!grant.resourceType){grants.push(structuredClone(grant));continue;}
  if(grant.scope?.organizationId!==organizationId||!work.has(grant.permission))continue;
  if(grant.scope.type==='ORGANIZATION'&&!grant.resourceId&&previousProfile!=='CONTRIBUTOR')continue;
  if(!grants.some(g=>JSON.stringify(g)===JSON.stringify(grant)))grants.push(structuredClone(grant));
 }
 return grants;
}
// Effective only inside the central access service; no global grant expansion.
function accessSnapshot({snapshot,resource,operationCode}){
 if(!snapshot||!canManage(snapshot.profileCode)||snapshot.organizationId!==resource.organizationId)return snapshot;
 return {...snapshot,grants:[...snapshot.grants,{permission:operationCode==='ORGANIZATION_MEMBERSHIP_READ'?'organization_membership.read':'organization_membership.manage',scope:{type:'ORGANIZATION',id:snapshot.organizationId,organizationId:snapshot.organizationId}}]};
}
module.exports={profiles,canManage,capabilities,grantsForProfile,accessSnapshot,navigationFor};
