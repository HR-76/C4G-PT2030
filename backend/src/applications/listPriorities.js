'use strict';
const {resource}=require('./repository');
async function hydratePriorities(client,{org,items,authorize,taskDetailsAvailable=false}){
 const taskIds=[],documentIds=[],summaries=new Map();
 for(const item of items){
  const target=resource(item.applicationId,org);
  const work=await authorize('APPLICATION_WORK_READ',target);
  const documents=await authorize('APPLICATION_DOCUMENT_READ',target);
  summaries.set(item.applicationId,{tasks:work?{open:0,next:null}:null,documents:documents?{pending:0,changes:0,restricted:false}:null});
  if(work)taskIds.push(item.applicationId);
  if(documents)documentIds.push(item.applicationId);
 }
 if(taskIds.length){
  const rows=(await client.query(`SELECT application_id,count(*)::int AS open,
   (array_agg(deadline::text ORDER BY deadline,task_id))[1] AS deadline
   FROM opportunity_catalog.application_task WHERE organization_id=$1 AND application_id=ANY($2::uuid[]) AND status='OPEN'${taskDetailsAvailable?' AND deleted_at IS NULL':''}
   GROUP BY application_id`,[org,taskIds])).rows;
  for(const row of rows)summaries.get(row.application_id).tasks={open:row.open,next:row.deadline};
 }
 if(documentIds.length){
  const rows=(await client.query(`SELECT l.application_id,l.document_id,r.request_id,r.decision
   FROM opportunity_catalog.application_document_link l
   LEFT JOIN LATERAL (
    SELECT q.request_id,d.decision FROM opportunity_catalog.application_review_item i
    JOIN opportunity_catalog.application_review_request q ON q.organization_id=i.organization_id AND q.application_id=i.application_id AND q.request_id=i.request_id
    LEFT JOIN opportunity_catalog.application_review_decision d ON d.organization_id=q.organization_id AND d.application_id=q.application_id AND d.request_id=q.request_id
    WHERE i.organization_id=l.organization_id AND i.application_id=l.application_id AND i.document_id=l.document_id AND i.version_id=l.version_id
    ORDER BY q.requested_at DESC,q.request_id DESC LIMIT 1
   ) r ON true WHERE l.organization_id=$1 AND l.application_id=ANY($2::uuid[]) AND l.active`,[org,documentIds])).rows;
  for(const row of rows){
   const summary=summaries.get(row.application_id).documents;
   if(!await authorize('DOCUMENT_READ',resource(row.document_id,org,'DOCUMENT'))){summary.restricted=true;continue;}
   if(row.request_id&&!row.decision)summary.pending++;
   if(row.decision==='CHANGES_REQUESTED')summary.changes++;
  }
 }
 return items.map(item=>({...item,priorities:summaries.get(item.applicationId)}));
}
module.exports={hydratePriorities};
