'use strict';
const {createAuthoringResourceLoader}=require('./authoringResources');
const {OrganizationalProfileContractError}=require('./errors');
function missing(){throw new OrganizationalProfileContractError('F13_RESOURCE_NOT_AVAILABLE');}
function createCompetencyResourceLoader({organizationId}){
 const base=createAuthoringResourceLoader({organizationId});
 return Object.freeze({async load(client,method,command,replay){
  const draftResource=await base.load(client,'editDraft',command,replay||method==='readEvidenceLink');
  const draft=(await client.query('SELECT profile_scope_id,head_revision,lifecycle FROM organization_profile.profile_draft WHERE organization_id=$1 AND draft_id=$2 FOR UPDATE',[organizationId,command.draftId])).rows[0];
  const members=(await client.query('SELECT kind,version_id FROM organization_profile.competency_revision_member WHERE organization_id=$1 AND draft_id=$2 AND revision=$3 ORDER BY kind,version_id',[organizationId,command.draftId,draft.head_revision])).rows;
  const state={draft,members,documents:[],link:null,assertion:null,method:null},additionalAuthorizations=[],authors=[];
  const member=(kind,id)=>members.some(row=>row.kind===kind&&row.version_id===id);
  if(['attachEvidence','verifyCompetency'].includes(method)){
   if(!member('ASSERTION',command.assertionVersionId)&&!replay)missing();
   state.assertion=(await client.query('SELECT * FROM organization_profile.competency_assertion_version WHERE organization_id=$1 AND profile_scope_id=$2 AND version_id=$3',[organizationId,draft.profile_scope_id,command.assertionVersionId])).rows[0];
   if(!state.assertion)missing();
  }
  if(method==='attachEvidence'){
   if(!member('EXPERIENCE',command.experienceVersionId)&&!replay)missing();
   state.experience=(await client.query('SELECT * FROM organization_profile.experience_evidence_version WHERE organization_id=$1 AND profile_scope_id=$2 AND version_id=$3',[organizationId,draft.profile_scope_id,command.experienceVersionId])).rows[0];
   if(!state.experience)missing();
  }
  if(method==='readEvidenceLink'){
   state.link=(await client.query('SELECT * FROM organization_profile.competency_evidence_link WHERE organization_id=$1 AND profile_scope_id=$2 AND link_id=$3 ORDER BY version_id LIMIT 1',[organizationId,draft.profile_scope_id,command.linkId])).rows[0];
   if(!state.link)missing();
   state.link.experience_id=(await client.query('SELECT experience_id FROM organization_profile.experience_evidence_version WHERE organization_id=$1 AND profile_scope_id=$2 AND version_id=$3',[organizationId,draft.profile_scope_id,state.link.experience_version_id])).rows[0]?.experience_id;
   if(!state.link.experience_id)missing();
  }
  let links=[];
  if(method==='verifyCompetency'){
   links=(await client.query(`SELECT l.*,e.actor_subject_id AS experience_author,e.experience_id FROM organization_profile.competency_evidence_link l
    JOIN organization_profile.experience_evidence_version e ON e.version_id=l.experience_version_id AND e.organization_id=l.organization_id AND e.profile_scope_id=l.profile_scope_id
    JOIN organization_profile.competency_revision_member m ON m.version_id=l.version_id AND m.organization_id=l.organization_id AND m.kind='LINK'
    WHERE m.draft_id=$1 AND m.revision=$2 AND m.organization_id=$3 AND l.assertion_version_id=$4 ORDER BY l.version_id`,[command.draftId,draft.head_revision,organizationId,command.assertionVersionId])).rows;
   authors.push(state.assertion.actor_subject_id,...links.flatMap(l=>[l.actor_subject_id,l.experience_author]));
   const revisionAuthors=(await client.query(`SELECT r.actor_subject_id FROM organization_profile.profile_draft_revision r
    WHERE r.organization_id=$1 AND r.draft_id=$2 AND (
     EXISTS(SELECT 1 FROM organization_profile.idempotency_record i WHERE i.organization_id=r.organization_id AND i.draft_id=r.draft_id AND i.revision=r.revision)
     OR EXISTS(SELECT 1 FROM organization_profile.competency_idempotency_record i WHERE i.organization_id=r.organization_id AND i.draft_id=r.draft_id AND i.revision=r.revision AND i.operation IN('COMPETENCY_SET','EXPERIENCE_SET','EVIDENCE_ATTACH')))
    ORDER BY r.revision`,[organizationId,command.draftId])).rows;
   authors.push(...revisionAuthors.map(row=>row.actor_subject_id));state.links=links;
  }
  const refs=method==='attachEvidence'&&command.documentVersionId?[{version:command.documentVersionId,experienceId:state.experience.experience_id}]:
   method==='readEvidenceLink'&&state.link.document_version_id?[{version:state.link.document_version_id,experienceId:state.link.experience_id}]:links.filter(l=>l.document_version_id).map(l=>({version:l.document_version_id,experienceId:l.experience_id}));
  for(const ref of refs){const doc=(await client.query('SELECT * FROM document_storage.load_competency_reference($1,$2)',[organizationId,ref.version])).rows[0];
   if(!doc||doc.state!=='AVAILABLE'||doc.scan_state!=='CLEAN'||doc.resource_type!=='EXPERIENCE_EVIDENCE'||(ref.experienceId&&doc.resource_id!==ref.experienceId))missing();
   state.documents.push(doc);if(!additionalAuthorizations.some(item=>item.resource.id===doc.document_id))additionalAuthorizations.push({operationCode:'DOCUMENT_READ',resource:Object.freeze({id:doc.document_id,resourceType:'DOCUMENT',organizationId,scopeType:'ORGANIZATION',scopeId:null,status:'ACTIVE',distinctFromActorIds:[],unitId:null,teamIds:[],ancestorUnitIds:[]})});
  }
  const resourceType=method==='attachEvidence'?'ASSERTION':method==='verifyCompetency'?'COMPETENCY_ASSERTION':method==='readEvidenceLink'?'EVIDENCE_LINK':'PROFILE_DRAFT';
  return {resource:Object.freeze({...draftResource,id:method==='readEvidenceLink'?command.linkId:command.assertionVersionId||command.draftId,
   resourceType,distinctFromActorIds:Object.freeze([...new Set(authors)])}),state,additionalAuthorizations};
 }});
}
module.exports={createCompetencyResourceLoader};
