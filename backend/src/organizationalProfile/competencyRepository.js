'use strict';
const {intentDigest}=require('../security/tenantRepositorySupport');
const {OrganizationalProfileContractError}=require('./errors');
const {mapError}=require('./taxonomyRepository');
const {OPS}=require('./competencyService');
const material=require('./competencyMaterial');
const operations=Object.freeze({setCompetencies:'COMPETENCY_SET',setExperiences:'EXPERIENCE_SET',attachEvidence:'EVIDENCE_ATTACH',verifyCompetency:'COMPETENCY_VERIFY',readEvidenceLink:'EVIDENCE_LINK_READ'});
const fields={setCompetencies:['draftId','expectedRevision','assertions','idempotencyKey'],setExperiences:['draftId','expectedRevision','experiences','idempotencyKey'],
 attachEvidence:['draftId','expectedRevision','linkId','assertionVersionId','experienceVersionId','documentVersionId','idempotencyKey'],verifyCompetency:['draftId','expectedRevision','verificationId','assertionVersionId','methodId','validUntil','idempotencyKey'],readEvidenceLink:['draftId','linkId','idempotencyKey']};
function fail(code='F13_STATE_CONFLICT'){throw new OrganizationalProfileContractError(code);}
function createCompetencyRepository({organizationId,auditWriter,clock=()=>new Date()}){
 function intention(method,input){return {operation:operations[method],digest:intentDigest({organizationId,operation:operations[method],content:Object.fromEntries(fields[method].map(key=>[key,input[key]]))})};}
 async function lockIntention(client,method,input){await client.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-COMPETENCY:' || $1::text || ':' || $2 || ':' || $3::text,43001308))",[organizationId,operations[method],input.idempotencyKey]);
  return Boolean((await client.query('SELECT 1 FROM organization_profile.competency_idempotency_record WHERE organization_id=$1 AND operation=$2 AND idempotency_key=$3',[organizationId,operations[method],input.idempotencyKey])).rowCount);}
 async function replay(client,method,input){const row=(await client.query('SELECT intention_digest,result_projection FROM organization_profile.competency_idempotency_record WHERE organization_id=$1 AND operation=$2 AND idempotency_key=$3',[organizationId,operations[method],input.idempotencyKey])).rows[0];
  if(!row)return null;if(row.intention_digest!==intention(method,input).digest)fail('F13_IDEMPOTENCY_CONFLICT');return Object.freeze(row.result_projection);}
 async function entry(client,id,kind){const row=(await client.query(`SELECT e.*,r.lifecycle FROM organization_profile.competency_catalog_entry e
  JOIN organization_profile.competency_catalog_release r ON r.release_id=e.release_id AND r.organization_id IS NOT DISTINCT FROM e.organization_id
  WHERE e.entry_id=$1 AND e.kind=$2 AND (e.organization_id IS NULL OR e.organization_id=$3) AND r.lifecycle='PUBLISHED'`,[id,kind,organizationId])).rows[0];
  if(!row)fail('F13_RESOURCE_NOT_AVAILABLE');return row;}
 async function insert(client,table,idColumn,id,data){const columns=Object.keys(data),values=Object.values(data);const old=(await client.query(`SELECT ${columns.join(',')} FROM organization_profile.${table} WHERE ${idColumn}=$1 AND organization_id=$2 AND profile_scope_id=$3`,[id,organizationId,data.profile_scope_id])).rows[0];
  if(old){const contentColumns=columns.filter(key=>!['actor_subject_id','membership_id','correlation_id'].includes(key));
   const expected=Object.fromEntries(contentColumns.map(key=>[key,old[key] instanceof Date?new Date(data[key]).toISOString():data[key]]));
   const actual=Object.fromEntries(contentColumns.map(key=>[key,old[key] instanceof Date?old[key].toISOString():old[key]]));if(intentDigest(expected)!==intentDigest(actual))fail();return;}
  await client.query(`INSERT INTO organization_profile.${table}(${idColumn},${columns.join(',')}) VALUES($1,${values.map((_,i)=>'$'+(i+2)).join(',')})`,[id,...values]);}
 async function mutate(client,method,input){const old=await replay(client,method,input);if(old)return old;
  const draft=input.state.draft,previous=Number(draft.head_revision),scope=draft.profile_scope_id;
  if(method!=='readEvidenceLink'&&(draft.lifecycle!=='DRAFT'||input.expectedRevision!==previous))fail(input.expectedRevision!==previous?'F13_STALE_REVISION':'F13_STATE_CONFLICT');
  let members=[...input.state.members],result,revision=previous,digest;
  const authors={organization_id:organizationId,profile_scope_id:scope,actor_subject_id:input.actor.id,membership_id:input.actor.membershipId,correlation_id:input.correlationId};
  if(method==='setCompetencies'){
   members=members.filter(row=>row.kind!=='ASSERTION');
   for(const assertion of input.assertions){if(assertion.conceptId){const concept=await entry(client,assertion.conceptId,'COMPETENCY_CONCEPT');
    if(assertion.levelId){const level=await entry(client,assertion.levelId,'FRAMEWORK_LEVEL');if(!concept.framework_id||level.framework_id!==concept.framework_id||level.framework_version!==concept.framework_version||level.release_id!==concept.release_id)fail();}}
    await insert(client,'competency_assertion_version','version_id',assertion.versionId,{...authors,assertion_id:assertion.assertionId,knowledge_status:assertion.knowledgeStatus,concept_id:assertion.conceptId,level_id:assertion.levelId});
    members.push({kind:'ASSERTION',version_id:assertion.versionId});}
  }else if(method==='setExperiences'){
   members=members.filter(row=>row.kind!=='EXPERIENCE');
   for(const experience of input.experiences){await entry(client,experience.typeId,'EXPERIENCE_TYPE');
    await insert(client,'experience_evidence_version','version_id',experience.versionId,{...authors,experience_id:experience.experienceId,type_id:experience.typeId,observed_from:experience.observedFrom,observed_until:experience.observedUntil,provenance_ref:experience.provenanceRef});
    members.push({kind:'EXPERIENCE',version_id:experience.versionId});}
  }else if(method==='attachEvidence'){
   const doc=input.state.documents[0];
   await insert(client,'competency_evidence_link','version_id',input.linkId,{...authors,link_id:input.linkId,assertion_version_id:input.assertionVersionId,experience_version_id:input.experienceVersionId,document_id:doc?.document_id||null,document_version_id:doc?.version_id||null});
   members=members.filter(row=>row.kind!=='VERIFICATION');members.push({kind:'LINK',version_id:input.linkId});
  }else if(method==='verifyCompetency'){
   if(input.state.assertion.knowledge_status!=='KNOWN'||!input.state.links.length)fail();
   const methodEntry=await entry(client,input.methodId,'VERIFICATION_METHOD');
   const verifiedAt=clock();if(!Number.isFinite(verifiedAt.getTime()))fail();
   if(input.validUntil===null?methodEntry.max_validity_seconds!==null:(!methodEntry.max_validity_seconds||Date.parse(input.validUntil)<=verifiedAt.getTime()||Date.parse(input.validUntil)>verifiedAt.getTime()+Number(methodEntry.max_validity_seconds)*1000))fail();
   const evidenceDigest=intentDigest({assertion:input.assertionVersionId,links:input.state.links.map(row=>row.version_id).sort(),method:input.methodId});
   await client.query(`INSERT INTO organization_profile.competency_verification_result
    (verification_id,organization_id,profile_scope_id,assertion_version_id,method_id,verified_at,valid_until,status,material_digest,actor_subject_id,membership_id,correlation_id,authorization_evidence)
    VALUES($1,$2,$3,$4,$5,$6,$7,'VERIFIED',$8,$9,$10,$11,$12)`,[input.verificationId,organizationId,scope,input.assertionVersionId,input.methodId,verifiedAt,input.validUntil,evidenceDigest,input.actor.id,input.actor.membershipId,input.correlationId,JSON.stringify(input.authorizationEvidence)]);
   const replaced=(await client.query(`SELECT verification_id FROM organization_profile.competency_verification_result
    WHERE organization_id=$1 AND profile_scope_id=$2 AND assertion_version_id=$3 AND verification_id=ANY($4::uuid[])`,
    [organizationId,scope,input.assertionVersionId,members.filter(row=>row.kind==='VERIFICATION').map(row=>row.version_id)])).rows;
   const replacedIds=new Set(replaced.map(row=>row.verification_id));
   members=members.filter(row=>row.kind!=='VERIFICATION'||!replacedIds.has(row.version_id));members.push({kind:'VERIFICATION',version_id:input.verificationId});
  }
  if(['setCompetencies','setExperiences'].includes(method)){
   const links=(await client.query('SELECT version_id,assertion_version_id,experience_version_id FROM organization_profile.competency_evidence_link WHERE organization_id=$1 AND profile_scope_id=$2 AND version_id=ANY($3::uuid[])',[organizationId,scope,members.filter(row=>row.kind==='LINK').map(row=>row.version_id)])).rows;
   const validLinks=links.filter(link=>members.some(row=>row.kind==='ASSERTION'&&row.version_id===link.assertion_version_id)&&members.some(row=>row.kind==='EXPERIENCE'&&row.version_id===link.experience_version_id)).map(row=>row.version_id);
   members=members.filter(row=>row.kind!=='LINK'||validLinks.includes(row.version_id));
   const content=rows=>rows.filter(row=>row.kind!=='VERIFICATION').map(row=>row.kind+row.version_id).sort();
   if(intentDigest(content(members))!==intentDigest(content(input.state.members)))members=members.filter(row=>row.kind!=='VERIFICATION');
  }
  members.sort((a,b)=>a.kind.localeCompare(b.kind)||a.version_id.localeCompare(b.version_id));
  if(method==='readEvidenceLink'){
   const link=input.state.link;result={linkId:link.link_id,assertionVersionId:link.assertion_version_id,experienceVersionId:link.experience_version_id,documentVersionId:link.document_version_id};digest=intentDigest(result);
  }else{
   const items=(await client.query(`SELECT v.item_id::text AS "itemId",v.item_version_id::text AS "itemVersionId",v.domain,v.knowledge_status AS "knowledgeStatus",v.concept_id::text AS "conceptId"
    FROM organization_profile.profile_revision_item i JOIN organization_profile.profile_item_version v ON v.item_version_id=i.item_version_id AND v.organization_id=i.organization_id
    WHERE i.organization_id=$1 AND i.draft_id=$2 AND i.revision=$3 ORDER BY v.item_id`,[organizationId,input.draftId,previous])).rows;
   revision=previous+1;digest=intentDigest({scopeType:input.resource.scopeType,scopeId:input.resource.scopeId,items,competencyMaterial:members});
   await client.query(`INSERT INTO organization_profile.profile_draft_revision(organization_id,draft_id,profile_scope_id,revision,lifecycle,semantic_digest,actor_subject_id,membership_id,correlation_id,authorization_evidence)
    VALUES($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9)`,[organizationId,input.draftId,scope,revision,digest,input.actor.id,input.actor.membershipId,input.correlationId,JSON.stringify(input.authorizationEvidence)]);
   await client.query(`INSERT INTO organization_profile.profile_revision_item SELECT organization_id,draft_id,profile_scope_id,$4,item_id,item_version_id
    FROM organization_profile.profile_revision_item WHERE organization_id=$1 AND draft_id=$2 AND revision=$3`,[organizationId,input.draftId,previous,revision]);
   await material.append(client,organizationId,input.draftId,scope,revision,members);
   const updated=await client.query("UPDATE organization_profile.profile_draft SET head_revision=$3 WHERE organization_id=$1 AND draft_id=$2 AND head_revision=$4 AND lifecycle='DRAFT'",[organizationId,input.draftId,revision,previous]);if(updated.rowCount!==1)fail('F13_STALE_REVISION');
   result={draftId:input.draftId,revision,lifecycle:'DRAFT',semanticDigest:digest};
  }
  const eventCode={setCompetencies:'PROFILE_DRAFT_REVISION_CREATED',setExperiences:'PROFILE_DRAFT_REVISION_CREATED',attachEvidence:'EVIDENCE_ATTACHED',verifyCompetency:'COMPETENCY_ASSERTION_VERIFIED',readEvidenceLink:'EVIDENCE_LINK_ACCESSED'}[method];
  const audit=await auditWriter.append(client,{eventCode,operationCode:OPS[method],resourceType:input.resource.resourceType,resourceId:input.resource.id,
   actor:input.actor,authorizationEvidence:input.authorizationEvidence,idempotencyKey:input.idempotencyKey,correlationId:input.correlationId,
   scopeType:input.resource.scopeType,scopeDigest:intentDigest({scopeType:input.resource.scopeType,scopeId:input.resource.scopeId}),detailCode:method==='verifyCompetency'?'VERIFIED':'EVIDENCE_GOVERNED',previousVersion:String(previous),newVersion:String(revision),semanticDigest:digest});
  if(!audit||!['APPENDED','DUPLICATE','ACCEPTED'].includes(audit.status))throw new Error('F13_CRITICAL_AUDIT_UNAVAILABLE');
  await client.query(`INSERT INTO organization_profile.competency_idempotency_record(organization_id,operation,idempotency_key,intention_digest,draft_id,revision,result_projection)
   VALUES($1,$2,$3,$4,$5,$6,$7)`,[organizationId,operations[method],input.idempotencyKey,intention(method,input).digest,input.draftId,revision,JSON.stringify(result)]);
  return Object.freeze(result);
 }
 return Object.freeze({intention,lockIntention,reconcile:replay,...Object.fromEntries(Object.keys(operations).map(method=>[method,(client,input)=>mutate(client,method,input)]))});
}
module.exports={createCompetencyRepository,mapError};
