'use strict';
const {randomUUID}=require('node:crypto');
const {intentDigest}=require('../security/tenantRepositorySupport');
const {OrganizationalProfileContractError}=require('./errors');
const {mapError}=require('./taxonomyRepository');
const operations=Object.freeze({createDraft:'PROFILE_DRAFT_CREATE',editDraft:'PROFILE_DRAFT_EDIT',submitDraft:'PROFILE_SUBMIT'});
function fail(code){throw new OrganizationalProfileContractError(code);}
function createAuthoringRepository({organizationId,auditWriter,materialExtension=null}){
 if(typeof organizationId!=='string'||!auditWriter?.append)throw new TypeError('Prepared authoring repository required.');
 function intention(method,command){const keys=method==='createDraft'?['draftId','scopeId','items','idempotencyKey']:
  method==='editDraft'?['draftId','expectedRevision','items','idempotencyKey']:['draftId','expectedRevision','idempotencyKey'];
  const content=Object.fromEntries(keys.map(k=>[k,command[k]]));
  return Object.freeze({operation:operations[method],digest:intentDigest({organizationId,operation:operations[method],content})});}
 async function lockIntention(client,method,input){
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-AUTHORING:' || $1::text || ':' || $2 || ':' || $3::text,43001307))",
   [organizationId,operations[method],input.idempotencyKey]);
  return Boolean((await client.query(`SELECT 1 FROM organization_profile.idempotency_record
   WHERE organization_id=$1 AND operation=$2 AND idempotency_key=$3`,[organizationId,operations[method],input.idempotencyKey])).rowCount);
 }
 async function replay(client,method,input){const row=(await client.query(`SELECT intention_digest,result_projection
  FROM organization_profile.idempotency_record WHERE organization_id=$1 AND operation=$2 AND idempotency_key=$3`,
  [organizationId,operations[method],input.idempotencyKey])).rows[0];
  if(!row)return null;if(row.intention_digest!==intention(method,input).digest)fail('F13_IDEMPOTENCY_CONFLICT');return Object.freeze(row.result_projection);
 }
 async function scope(client,resource){let row=(await client.query(`SELECT profile_scope_id FROM organization_profile.profile_scope
  WHERE organization_id=$1 AND scope_id IS NOT DISTINCT FROM $2`,[organizationId,resource.scopeId])).rows[0];
  if(!row)row=(await client.query(`INSERT INTO organization_profile.profile_scope(profile_scope_id,organization_id,scope_type,scope_id)
   VALUES($1,$2,$3,$4) RETURNING profile_scope_id`,[randomUUID(),organizationId,resource.scopeType,resource.scopeId])).rows[0];
  return row.profile_scope_id;
 }
 async function appendItems(client,profileScopeId,items,input){
  const ordered=[...items].sort((a,b)=>a.itemId.localeCompare(b.itemId));
  for(const item of ordered){const stored=(await client.query(`SELECT item_id::text AS "itemId",item_version_id::text AS "itemVersionId",
   domain,knowledge_status AS "knowledgeStatus",concept_id::text AS "conceptId" FROM organization_profile.profile_item_version
   WHERE organization_id=$1 AND profile_scope_id=$2 AND item_version_id=$3`,[organizationId,profileScopeId,item.itemVersionId])).rows[0];
   if(stored){if(intentDigest(stored)!==intentDigest(item))fail('F13_STATE_CONFLICT');continue;}
   await client.query(`INSERT INTO organization_profile.profile_item_version
    (item_version_id,item_id,organization_id,profile_scope_id,domain,knowledge_status,concept_id,actor_subject_id,membership_id,correlation_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[item.itemVersionId,item.itemId,organizationId,profileScopeId,item.domain,item.knowledgeStatus,item.conceptId,input.actor.id,input.actor.membershipId,input.correlationId]);
  }return ordered;
 }
 async function mutate(client,method,input){const old=await replay(client,method,input);if(old)return old;
  let draft,previous=0;
  if(method==='createDraft'){
   const profileScopeId=await scope(client,input.resource);
   draft=(await client.query(`INSERT INTO organization_profile.profile_draft(draft_id,organization_id,profile_scope_id,head_revision,lifecycle)
    VALUES($1,$2,$3,1,'DRAFT') RETURNING profile_scope_id`,[input.draftId,organizationId,profileScopeId])).rows[0];
  }else{
   draft=(await client.query(`SELECT profile_scope_id,head_revision,lifecycle FROM organization_profile.profile_draft
    WHERE organization_id=$1 AND draft_id=$2 FOR UPDATE`,[organizationId,input.draftId])).rows[0];
   if(!draft)fail('F13_RESOURCE_NOT_AVAILABLE');if(draft.lifecycle!=='DRAFT')fail('F13_STATE_CONFLICT');
   if(Number(draft.head_revision)!==input.expectedRevision)fail('F13_STALE_REVISION');previous=Number(draft.head_revision);
  }
  let items=input.items;
  if(method==='submitDraft')items=(await client.query(`SELECT v.item_id::text AS "itemId",v.item_version_id::text AS "itemVersionId",
   v.domain,v.knowledge_status AS "knowledgeStatus",v.concept_id::text AS "conceptId"
   FROM organization_profile.profile_revision_item i JOIN organization_profile.profile_item_version v
   ON v.item_version_id=i.item_version_id AND v.organization_id=i.organization_id AND v.profile_scope_id=i.profile_scope_id
   WHERE i.organization_id=$1 AND i.draft_id=$2 AND i.revision=$3 ORDER BY v.item_id`,[organizationId,input.draftId,previous])).rows;
  const ordered=await appendItems(client,draft.profile_scope_id,items,input);
  const revision=previous+1,lifecycle=method==='submitDraft'?'SUBMITTED':'DRAFT';
  const extended=materialExtension?await materialExtension.members(client,organizationId,input.draftId,previous):null;
  const digest=intentDigest({scopeType:input.resource.scopeType,scopeId:input.resource.scopeId,items:ordered,...(extended?{competencyMaterial:extended}:{})});
  await client.query(`INSERT INTO organization_profile.profile_draft_revision
   (organization_id,draft_id,profile_scope_id,revision,lifecycle,semantic_digest,actor_subject_id,membership_id,correlation_id,authorization_evidence)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[organizationId,input.draftId,draft.profile_scope_id,revision,lifecycle,digest,
   input.actor.id,input.actor.membershipId,input.correlationId,JSON.stringify(input.authorizationEvidence)]);
  for(const item of ordered)await client.query(`INSERT INTO organization_profile.profile_revision_item
   (organization_id,draft_id,profile_scope_id,revision,item_id,item_version_id) VALUES($1,$2,$3,$4,$5,$6)`,
   [organizationId,input.draftId,draft.profile_scope_id,revision,item.itemId,item.itemVersionId]);
  if(extended)await materialExtension.append(client,organizationId,input.draftId,draft.profile_scope_id,revision,extended);
  if(previous){const updated=await client.query(`UPDATE organization_profile.profile_draft SET head_revision=$3,lifecycle=$4
   WHERE organization_id=$1 AND draft_id=$2 AND head_revision=$5 AND lifecycle='DRAFT'`,[organizationId,input.draftId,revision,lifecycle,previous]);
   if(updated.rowCount!==1)fail('F13_STALE_REVISION');}
  const eventCode=method==='createDraft'?'PROFILE_DRAFT_CREATED':method==='editDraft'?'PROFILE_DRAFT_REVISION_CREATED':'PROFILE_DRAFT_SUBMITTED';
  const audit=await auditWriter.append(client,{eventCode,operationCode:require('./authoringService').OPS[method],resourceType:'PROFILE_DRAFT',
   resourceId:input.draftId,actor:input.actor,authorizationEvidence:input.authorizationEvidence,idempotencyKey:input.idempotencyKey,
   correlationId:input.correlationId,scopeType:input.resource.scopeType,scopeDigest:intentDigest({scopeType:input.resource.scopeType,scopeId:input.resource.scopeId}),
   detailCode:method==='submitDraft'?'SUBMITTED':'REVISION_CREATED',previousVersion:String(previous),newVersion:String(revision),semanticDigest:digest});
  if(!audit||!['APPENDED','DUPLICATE','ACCEPTED'].includes(audit.status))throw new Error('F13_CRITICAL_AUDIT_UNAVAILABLE');
  const result=Object.freeze({draftId:input.draftId,revision,lifecycle,semanticDigest:digest});
  await client.query(`INSERT INTO organization_profile.idempotency_record
   (organization_id,operation,idempotency_key,intention_digest,draft_id,revision,result_projection) VALUES($1,$2,$3,$4,$5,$6,$7)`,
   [organizationId,operations[method],input.idempotencyKey,intention(method,input).digest,input.draftId,revision,JSON.stringify(result)]);
  return result;
 }
 return Object.freeze({intention,lockIntention,reconcile:replay,...Object.fromEntries(Object.keys(operations).map(method=>[method,(client,input)=>mutate(client,method,input)]))});
}
module.exports={createAuthoringRepository,mapError};
