'use strict';
const {OrganizationalProfileContractError}=require('./errors');
function missing(){throw new OrganizationalProfileContractError('F13_RESOURCE_NOT_AVAILABLE');}
function createAuthoringResourceLoader({organizationId}){return Object.freeze({async load(client,method,command,replay){
 let draft=null,scopeId=command.scopeId;
 if(method!=='createDraft'){
  draft=(await client.query(`SELECT d.draft_id,d.head_revision,d.lifecycle,s.scope_id,s.scope_type
   FROM organization_profile.profile_draft d JOIN organization_profile.profile_scope s
   ON s.profile_scope_id=d.profile_scope_id AND s.organization_id=d.organization_id
   WHERE d.draft_id=$1 AND d.organization_id=$2 FOR UPDATE OF d`,[command.draftId,organizationId])).rows[0];
  if(!draft)missing();scopeId=draft.scope_id;
  if(!replay&&draft.lifecycle!=='DRAFT')throw new OrganizationalProfileContractError('F13_STATE_CONFLICT');
 }
 let scopeType='ORGANIZATION';
 if(scopeId!==null){const scope=(await client.query(`SELECT scope_type,lifecycle FROM organizational_scope.scope
  WHERE organization_id=$1 AND scope_id=$2`,[organizationId,scopeId])).rows[0];
  if(!scope||scope.lifecycle!=='ACTIVE'||!['UNIT','TEAM'].includes(scope.scope_type))missing();scopeType=scope.scope_type;
 }
 if(draft&&draft.scope_type!==scopeType)missing();
 return Object.freeze({id:method==='createDraft'?(scopeId||organizationId):command.draftId,
  resourceType:method==='createDraft'?'PROFILE_SCOPE':'PROFILE_DRAFT',organizationId,scopeType,scopeId,
  status:'ACTIVE',distinctFromActorIds:Object.freeze([]),unitId:scopeType==='UNIT'?scopeId:null,
  teamIds:Object.freeze(scopeType==='TEAM'?[scopeId]:[]),ancestorUnitIds:Object.freeze([])});
}});}
module.exports={createAuthoringResourceLoader};
