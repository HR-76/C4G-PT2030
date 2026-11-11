'use strict';
const {randomUUID}=require('node:crypto');
const {fail,findings,digest,kinds,projectReceipt}=require('./contracts');
function createCriteriaRepository({organizationId:org,actor,tokens,audit}){
 async function load(client,opportunityId,lock=false){
 const opportunity=(await client.query('SELECT o.current_revision_id,o.lifecycle_state,r.content_digest FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.organization_id=o.organization_id AND r.revision_id=o.current_revision_id WHERE o.organization_id=$1 AND o.opportunity_id=$2'+(lock?' FOR UPDATE OF o':''),[org,opportunityId])).rows[0];if(!opportunity)fail('RESOURCE_NOT_AVAILABLE');
 const set=(await client.query('SELECT * FROM opportunity_catalog.criteria_set WHERE organization_id=$1 AND opportunity_id=$2'+(lock?' FOR UPDATE':''),[org,opportunityId])).rows[0];return {opportunity,set};}
 async function revision(client,id){const row=(await client.query('SELECT r.*,c.confirmed_by,c.confirmed_at FROM opportunity_catalog.criteria_revision r LEFT JOIN opportunity_catalog.criteria_confirmation c USING(organization_id,revision_id) WHERE r.organization_id=$1 AND r.revision_id=$2',[org,id])).rows[0];if(!row)fail('RESOURCE_NOT_AVAILABLE');if(digest(row.content)!==row.content_digest)fail('SERVICE_UNAVAILABLE');return row;}
 // One catalogue read per page, deduplicated by the complete typed reference.
 // Missing references remain draft findings; incompatible references take
 // precedence over a changed opportunity, matching the existing detail contract.
 async function referenceProblems(client,contents){
  const requested=[],indexes=new Map();
  const key=c=>JSON.stringify([c.conceptRef.conceptId.toLowerCase(),c.conceptRef.schemeId.toLowerCase(),c.conceptRef.releaseId.toLowerCase(),kinds[c.kind]]);
  for(const content of contents)for(const c of content.criteria){if(!c.conceptRef)continue;const k=key(c);if(!indexes.has(k)){indexes.set(k,requested.length);requested.push({reference_index:requested.length,concept_id:c.conceptRef.conceptId,scheme_id:c.conceptRef.schemeId,release_id:c.conceptRef.releaseId,scheme_code:kinds[c.kind]});}}
  const admissible=new Set();
  if(requested.length){await client.query('SET LOCAL ROLE c4g_organization_profile_runtime');try{
   const rows=(await client.query(`SELECT wanted.reference_index
    FROM jsonb_to_recordset($1::jsonb) AS wanted(reference_index integer,concept_id uuid,scheme_id uuid,release_id uuid,scheme_code text)
    JOIN organization_profile.concept c ON c.concept_id=wanted.concept_id AND c.scheme_id=wanted.scheme_id AND c.release_id=wanted.release_id
    JOIN organization_profile.scheme s ON s.scheme_id=c.scheme_id AND s.release_id=c.release_id AND s.scheme_code=wanted.scheme_code
    JOIN organization_profile.catalog_release r ON r.release_id=c.release_id
    WHERE r.lifecycle='PUBLISHED' AND c.deprecated_at IS NULL AND (c.organization_id IS NULL OR c.organization_id=$2)
    GROUP BY wanted.reference_index HAVING count(*)=1`,[JSON.stringify(requested),org])).rows;
   for(const row of rows)admissible.add(row.reference_index);
  }finally{await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');}}
  return contents.map(content=>content.criteria.filter(c=>c.conceptRef&&!admissible.has(indexes.get(key(c)))).map(c=>({criterionId:c.criterionId,code:'REFERENCE_INCOMPATIBLE'})));
 }
 async function references(client,content){return (await referenceProblems(client,[content]))[0];}
 function summary(row,opportunity,problems){return {revisionId:row.revision_id,revisionNumber:Number(row.revision_number),opportunityRevisionId:row.opportunity_revision_id,state:row.confirmed_at?'CONFIRMED':'DRAFT',author:{subjectId:row.author_subject_id,displayLabel:row.author_subject_id},createdAt:new Date(row.created_at).toISOString(),confirmation:row.confirmed_at?{subjectId:row.confirmed_by,displayLabel:row.confirmed_by,confirmedAt:new Date(row.confirmed_at).toISOString()}:null,freshness:problems.some(p=>p.code==='REFERENCE_INCOMPATIBLE')?'UNAVAILABLE':row.opportunity_revision_id===opportunity.current_revision_id?'CURRENT':'REVIEW_REQUIRED'};}
 async function detail(client,row,opportunity,actions){const problems=[...findings(row.content),...await references(client,row.content)];return {...summary(row,opportunity,problems),...row.content,criteria:row.content.criteria.map(c=>({...c,required:c.kind==='COMPETENCY_REQUIREMENT',verificationRequired:c.kind==='COMPETENCY_REQUIREMENT'})),findings:problems,actions:{...actions,canConfirm:actions.canConfirm&&!row.confirmed_at&&!problems.length&&row.opportunity_revision_id===opportunity.current_revision_id}};}
 async function receipt(client,operation,input,resourceId,intention){const row=(await client.query('SELECT * FROM opportunity_catalog.criteria_receipt WHERE organization_id=$1 AND operation=$2 AND request_id=$3',[org,operation,input.requestId])).rows[0];if(!row)return null;if(row.subject_id!==actor.id||row.resource_id!==resourceId||row.intention_digest!==intention)fail('IDEMPOTENCY_CONFLICT');return projectReceipt(row.result_projection);}
 async function run(client,{method,id,revisionId,input,loaded,actions,intention}){const {opportunity,set}=loaded;
 if(method==='catalog') {const context={subjectId:actor.id,organizationId:org,opportunityId:id,kind:input.kind};const position=input.cursor?tokens.openCursor(input.cursor,context):null;await client.query('SET LOCAL ROLE c4g_organization_profile_runtime');try{const rows=(await client.query("SELECT c.concept_id,c.scheme_id,c.release_id,r.release_version,l.label FROM organization_profile.concept c JOIN organization_profile.scheme s ON s.scheme_id=c.scheme_id AND s.release_id=c.release_id JOIN organization_profile.catalog_release r ON r.release_id=c.release_id JOIN organization_profile.concept_label l ON l.concept_id=c.concept_id AND l.label_kind='PREFERRED' AND l.locale=r.provenance#>>'{governance,defaultLocale}' WHERE s.scheme_code=$1 AND r.lifecycle='PUBLISHED' AND c.deprecated_at IS NULL AND (c.organization_id IS NULL OR c.organization_id=$2) AND ($3::uuid IS NULL OR c.concept_id>$3) ORDER BY c.concept_id LIMIT $4",[kinds[input.kind],org,position,input.limit+1])).rows;return {items:rows.slice(0,input.limit).map(r=>({conceptRef:{conceptId:r.concept_id,schemeId:r.scheme_id,releaseId:r.release_id},label:r.label,releaseVersion:r.release_version})),nextCursor:rows.length>input.limit?tokens.cursor(rows[input.limit-1].concept_id,context):null};}finally{await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');}}
 if(method==='head'){const row=set?await revision(client,set.head_revision_id):null;return {setId:set?.set_id||null,head:row?summary(row,opportunity,await references(client,row.content)):null,opportunityRevisionId:opportunity.current_revision_id,actions};}
 if(method==='get'){const row=await revision(client,revisionId);if(row.set_id!==set?.set_id)fail('RESOURCE_NOT_AVAILABLE');return detail(client,row,opportunity,actions);}
 if(method==='list'){const context={subjectId:actor.id,organizationId:org,opportunityId:id};const position=input.cursor?tokens.openCursor(input.cursor,context):0;const rows=(await client.query('SELECT r.*,c.confirmed_by,c.confirmed_at FROM opportunity_catalog.criteria_revision r LEFT JOIN opportunity_catalog.criteria_confirmation c USING(organization_id,revision_id) WHERE r.organization_id=$1 AND r.set_id=$2 AND r.revision_number>$3 ORDER BY r.revision_number LIMIT $4',[org,set?.set_id||null,position,input.limit+1])).rows;const page=rows.slice(0,input.limit),problems=await referenceProblems(client,page.map(r=>r.content));return {items:page.map((r,i)=>summary(r,opportunity,problems[i])),nextCursor:rows.length>input.limit?tokens.cursor(Number(rows[input.limit-1].revision_number),context):null};}
 const operation=method==='save'?'CRITERIA_SAVE':'CRITERIA_CONFIRM',resourceId=method==='save'?id:revisionId;
 const old=await receipt(client,operation,input,resourceId,intention);if(old)return old;
 if(opportunity.lifecycle_state==='ARCHIVED')fail('STATE_CONFLICT');if(opportunity.current_revision_id!==input.opportunityRevisionId)fail('OPPORTUNITY_CHANGED');if(Number(set?.head_revision||0)!==input.expectedHeadRevision)fail('STALE_REVISION');
 let result,row;
 if(method==='save'){
 const content={criteria:input.criteria,sources:input.sources};if(set){const history=(await client.query("SELECT DISTINCT item->>'criterionId' AS id,item->>'kind' AS kind FROM opportunity_catalog.criteria_revision r CROSS JOIN LATERAL jsonb_array_elements(r.content->'criteria') item WHERE r.organization_id=$1 AND r.set_id=$2 AND item->>'criterionId'=ANY($3::text[])",[org,set.set_id,content.criteria.map(c=>c.criterionId)])).rows;for(const c of content.criteria)if(history.some(old=>old.id===c.criterionId&&old.kind!==c.kind))fail('INVALID_INPUT');}
 const setId=set?.set_id||id,rid=randomUUID(),n=input.expectedHeadRevision+1;
 if(!set)await client.query('INSERT INTO opportunity_catalog.criteria_set(organization_id,set_id,opportunity_id,head_revision,head_revision_id) VALUES($1,$2,$3,$4,$5)',[org,setId,id,n,rid]);
 await client.query('INSERT INTO opportunity_catalog.criteria_revision(organization_id,set_id,revision_id,revision_number,parent_revision_id,opportunity_revision_id,opportunity_digest,content,content_digest,author_subject_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[org,setId,rid,n,set?.head_revision_id||null,input.opportunityRevisionId,opportunity.content_digest,content,digest(content),actor.id]);
 if(set)await client.query('UPDATE opportunity_catalog.criteria_set SET head_revision=$3,head_revision_id=$4 WHERE organization_id=$1 AND set_id=$2',[org,setId,n,rid]);
 result={setId,revisionId:rid,revisionNumber:n,state:'DRAFT'};row={content_digest:digest(content)};
 }else {if(!set||set.head_revision_id!==revisionId)fail('STALE_REVISION');row=await revision(client,revisionId);if(row.confirmed_at)fail('STATE_CONFLICT');if(row.opportunity_revision_id!==input.opportunityRevisionId)fail('OPPORTUNITY_CHANGED');if(findings(row.content).length)fail('EVIDENCE_INCOMPLETE');if((await references(client,row.content)).length)fail('REFERENCE_INCOMPATIBLE');
 const confirmation=(await client.query("INSERT INTO opportunity_catalog.criteria_confirmation(organization_id,revision_id,confirmed_by,contract_version) VALUES($1,$2,$3,'criteria-v1') RETURNING confirmed_at",[org,revisionId,actor.id])).rows[0];result={setId:set.set_id,revisionId,revisionNumber:Number(row.revision_number),state:'CONFIRMED',confirmedAt:new Date(confirmation.confirmed_at).toISOString()};}
 await audit(client,method,result,input,row.content_digest);
 await client.query('INSERT INTO opportunity_catalog.criteria_receipt(organization_id,subject_id,operation,request_id,resource_id,intention_digest,result_projection) VALUES($1,$2,$3,$4,$5,$6,$7)',[org,actor.id,operation,input.requestId,resourceId,intention,result]);return result;
 }
 return {load,revision,run};
}
module.exports={createCriteriaRepository};
