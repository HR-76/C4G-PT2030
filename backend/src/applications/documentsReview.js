'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {canonicalize}=require('../organizationalProfile/canonicalization');
const {uuid,fail}=require('./contracts');
const {resource}=require('./repository');
const digest=value=>createHash('sha256').update(canonicalize(value)).digest('hex');
const exact=(value,keys)=>{if(!value||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))fail();return value};
function parse(method,value){
 if(method==='documentDeletionGuard'){exact(value,['documentId']);if(typeof value.documentId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.documentId))fail();return {documentId:value.documentId}}
 if(method==='documentTransportAccess'){exact(value,['operationCode']);if(!['DOCUMENT_UPLOAD_INITIATE','DOCUMENT_UPLOAD_CONFIRM','DOCUMENT_VERSION_CREATE'].includes(value.operationCode))fail();return {operationCode:value.operationCode}}
 if(method==='documentDownload'){exact(value,['versionId']);return {versionId:uuid(value.versionId)}}
 if(['documentCandidates','documentGet','documentHistory','reviewMine','reviewReviewers'].includes(method)){
  if(!value||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).some(key=>key!=='cursor'))fail();
  if(value.cursor!==undefined&&(typeof value.cursor!=='string'||!value.cursor||value.cursor.length>8192))fail();
  return {cursor:value.cursor?['documentHistory','reviewMine'].includes(method)?value.cursor:uuid(value.cursor):null};
 }
 const base=['expectedRevision','idempotencyKey'];let keys;
 if(method==='documentLink')keys=[...base,'documentId','versionId'];
 else if(method==='documentRemove')keys=[...base,'documentId'];
 else if(method==='reviewRequest')keys=value?.reviewerMembershipId===undefined?base:[...base,'reviewerMembershipId'];
 else if(method==='reviewDecide')keys=[...base,'requestId','decision','comment'];
 else fail();exact(value,keys);
 if(!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<1)fail();
 const input={expectedRevision:value.expectedRevision,idempotencyKey:uuid(value.idempotencyKey)};
 for(const key of ['documentId','versionId','requestId','reviewerMembershipId'])if(keys.includes(key))input[key]=uuid(value[key]);
 if(method==='reviewDecide'){
  if(!['APPROVED','CHANGES_REQUESTED'].includes(value.decision)||typeof value.comment!=='string'||value.comment!==value.comment.trim()||value.comment.length<1||value.comment.length>2000)fail();
  input.decision=value.decision;input.comment=value.comment;
 }
 return input;
}
const available=row=>row?.state==='AVAILABLE'&&row.scan_state==='CLEAN';
function createApplicationDocumentsRepository({organizationId:org,actor,protect,authorize,audit,cursor,reviewEvidence,reviewerDirectory}){
 async function authorizeApplication(operation,id){if(!await authorize(operation,resource(id,org)))fail('NOT_AUTHORIZED')}
 async function application(client,id,operation,docs=[],intention=null,reviewerMembershipId=null){
   await authorizeApplication(operation,id);
  const row=(await client.query('SELECT * FROM opportunity_catalog.application WHERE organization_id=$1 AND application_id=$2',[org,id])).rows[0];
  if(!row)fail('RESOURCE_NOT_AVAILABLE');
  const additional=[{operationCode:'OPPORTUNITY_READ',resource:resource(row.opportunity_id||org,org,'OPPORTUNITY')},
   ...(row.evaluation_id?[{operationCode:'F14_PREQUALIFICATION_READ',resource:resource(row.evaluation_id,org,'PREQUALIFICATION_EVALUATION')}]:[]),
   ...docs.map(documentId=>({operationCode:'DOCUMENT_READ',resource:resource(documentId,org,'DOCUMENT')}))];
  const approvalEvidence=reviewerMembershipId?await evidence(row,docs,reviewerMembershipId,intention.digest):null;
  await protect({operationCode:operation,resource:resource(id,org),additionalAuthorizations:additional,intention,...(approvalEvidence?{approvalEvidence}:{})});return row;
 }
 function evidence(row,docs,membershipId,intentionDigest){
  if(!reviewEvidence)fail('SERVICE_UNAVAILABLE');
  return reviewEvidence({requester:actor,membershipId,application:resource(row.application_id,org),
   opportunity:resource(row.opportunity_id||org,org,'OPPORTUNITY'),
   evaluation:row.evaluation_id?resource(row.evaluation_id,org,'PREQUALIFICATION_EVALUATION'):null,
   documents:docs.map(id=>resource(id,org,'DOCUMENT')),intentionDigest});
 }
 // The immutable receipt and the review are written in the same transaction.
 const assignmentJoin=`LEFT JOIN LATERAL (
  SELECT p.result_projection->>'reviewerMembershipId' AS reviewer_membership_id
  FROM opportunity_catalog.application_document_receipt p
  WHERE p.organization_id=r.organization_id AND p.resource_id=r.application_id
    AND p.result_projection->>'requestId'=r.request_id::text
    AND p.result_projection ? 'reviewerMembershipId'
 ) assignment ON true`;
 async function version(client,documentId,versionId){
  return (await client.query(`SELECT v.version_id,v.document_id,v.version_number,v.state,v.scan_state,v.display_filename,v.expected_file_class,v.created_at
   FROM document_storage.document_version v JOIN document_storage.document d ON d.organization_id=v.organization_id AND d.document_id=v.document_id
   WHERE v.organization_id=$1 AND v.document_id=$2 AND v.version_id=$3 AND d.organization_id=$1`,[org,documentId,versionId])).rows[0]||null;
 }
 const projectVersion=row=>({documentId:row.document_id,versionId:row.version_id,versionNumber:row.version_number,filename:row.display_filename,fileClass:row.expected_file_class,state:row.state,scanState:row.scan_state,usable:available(row),createdAt:new Date(row.created_at).toISOString()});
 async function head(client,id,lock=false){
  if(lock)await client.query('INSERT INTO opportunity_catalog.application_document_head(organization_id,application_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[org,id]);
  return (await client.query(`SELECT revision FROM opportunity_catalog.application_document_head WHERE organization_id=$1 AND application_id=$2${lock?' FOR UPDATE':''}`,[org,id])).rows[0];
 }
 async function links(client,id){return (await client.query('SELECT document_id,version_id FROM opportunity_catalog.application_document_link WHERE organization_id=$1 AND application_id=$2 AND active=true ORDER BY document_id',[org,id])).rows}
 async function linkRevision(client,id){return Number((await client.query("SELECT COALESCE(MAX(revision),1) AS revision FROM opportunity_catalog.application_document_change WHERE organization_id=$1 AND application_id=$2 AND kind IN ('DOCUMENT_LINKED','DOCUMENT_REMOVED')",[org,id])).rows[0].revision)}
 async function documentCandidates(client,id,input){await application(client,id,'APPLICATION_DOCUMENT_READ');
  const items=[];let position=input.cursor,hasMore=false,scanned=0;
  while(items.length<25&&scanned<10000){const rows=(await client.query(`SELECT v.version_id,v.document_id,v.version_number,v.state,v.scan_state,v.display_filename,v.expected_file_class,v.created_at
   FROM document_storage.document_version v JOIN document_storage.document d ON d.organization_id=v.organization_id AND d.document_id=v.document_id
   WHERE v.organization_id=$1 AND ($2::uuid IS NULL OR v.version_id>$2) ORDER BY v.version_id LIMIT 100`,[org,position])).rows;
   if(!rows.length)break;
   for(const row of rows){position=row.version_id;scanned++;
    if(await authorize('DOCUMENT_READ',resource(row.document_id,org,'DOCUMENT'))&&await authorize('DOCUMENT_VERSION_LIST',resource(row.document_id,org,'DOCUMENT')))items.push(projectVersion(row));
    if(items.length===25||scanned===10000)break;
   }
   if(items.length===25||scanned===10000){hasMore=Boolean((await client.query('SELECT 1 FROM document_storage.document_version WHERE organization_id=$1 AND version_id>$2 LIMIT 1',[org,position])).rows[0]);break}
   if(rows.length<100)break;
  }
  return {items,nextCursor:hasMore?position:null};
 }
 async function documentGet(client,id,input){await authorizeApplication('APPLICATION_DOCUMENT_READ',id);const current=await links(client,id);await application(client,id,'APPLICATION_DOCUMENT_READ',current.map(r=>r.document_id));
  const revision=Number((await head(client,id))?.revision||1),currentLinkRevision=await linkRevision(client,id);
  const linked=[];
  for(const item of current){
   const row=await version(client,item.document_id,item.version_id);
   const doc=row?projectVersion(row):{documentId:item.document_id,versionId:item.version_id,usable:false,state:'MISSING'};
   doc.canDownload=doc.usable && await authorize('DOCUMENT_DOWNLOAD_REQUEST',resource(item.version_id,org,'DOCUMENT_VERSION'));
   linked.push(doc);
  }
  const requests=(await client.query(`SELECT r.*,d.decision,d.comment,d.decided_by_subject_id,d.decided_at,assignment.reviewer_membership_id
   FROM opportunity_catalog.application_review_request r LEFT JOIN opportunity_catalog.application_review_decision d
   ON d.organization_id=r.organization_id AND d.application_id=r.application_id AND d.request_id=r.request_id
   ${assignmentJoin}
   WHERE r.organization_id=$1 AND r.application_id=$2 AND ($3::uuid IS NULL OR r.request_id<$3) ORDER BY r.request_id DESC LIMIT 26`,[org,id,input.cursor])).rows;
  const reviewItems=[];for(const request of requests.slice(0,25)){
   const fixed=(await client.query('SELECT document_id,version_id FROM opportunity_catalog.application_review_item WHERE organization_id=$1 AND application_id=$2 AND request_id=$3 ORDER BY document_id',[org,id,request.request_id])).rows;
   const visible=[];for(const item of fixed)if(await authorize('DOCUMENT_READ',resource(item.document_id,org,'DOCUMENT')))visible.push(item);
   reviewItems.push({requestId:request.request_id,documentRevision:Number(request.document_revision),requestedBy:request.requested_by_subject_id,requestedAt:new Date(request.requested_at).toISOString(),
    documents:visible.map(r=>({documentId:r.document_id,versionId:r.version_id})),documentsRestricted:visible.length!==fixed.length,decision:request.decision,comment:request.comment,decidedBy:request.decided_by_subject_id,decidedAt:request.decided_at?new Date(request.decided_at).toISOString():null,
    assigned:Boolean(request.reviewer_membership_id),assignedToMe:request.reviewer_membership_id===actor.membershipId,
    stale:Number(request.document_revision)!==currentLinkRevision||linked.some(item=>!item.usable)});
  }
  const canEdit=await authorize('APPLICATION_DOCUMENT_EDIT',resource(id,org));
  const canDecide=await authorize('APPLICATION_REVIEW_DECIDE',resource(id,org));
  const canUpload=canEdit&&await authorize('DOCUMENT_UPLOAD_INITIATE',resource(id,org,'DOCUMENT'))
   &&await authorize('DOCUMENT_VERSION_CREATE',resource(id,org,'DOCUMENT'))
   &&await authorize('DOCUMENT_UPLOAD_CONFIRM',resource(id,org,'DOCUMENT_VERSION'));
  return {capabilities:{canEdit:Boolean(canEdit),canDecide:Boolean(canDecide),canUpload:Boolean(canUpload)},revision,documents:linked,reviews:reviewItems,reviewsNextCursor:requests.length>25?requests[24].request_id:null};
 }
 async function documentHistory(client,id,input){await application(client,id,'APPLICATION_DOCUMENT_READ');
  const position=input.cursor?Number(cursor.openCursor(input.cursor,{organizationId:org,subjectId:actor.id,route:'application-document-history',applicationId:id})):null;
  if(position!==null&&(!Number.isSafeInteger(position)||position<2))fail('INVALID_CURSOR');
  const rows=(await client.query('SELECT * FROM opportunity_catalog.application_document_change WHERE organization_id=$1 AND application_id=$2 AND ($3::bigint IS NULL OR revision<$3) ORDER BY revision DESC LIMIT 26',[org,id,position])).rows;
  const page=rows.slice(0,25),items=[];for(const r of page){const visible=!r.document_id||await authorize('DOCUMENT_READ',resource(r.document_id,org,'DOCUMENT'));
   items.push({revision:Number(r.revision),kind:r.kind,documentId:visible?r.document_id:null,versionId:visible?r.version_id:null,restricted:!visible,requestId:r.request_id,decision:r.decision,comment:r.comment,actorSubjectId:r.actor_subject_id,recordedAt:new Date(r.recorded_at).toISOString()});}
  return {items,nextCursor:rows.length>25?cursor.cursor(Number(page.at(-1).revision),{organizationId:org,subjectId:actor.id,route:'application-document-history',applicationId:id}):null};
 }
 async function documentDownload(client,id,input){
   await authorizeApplication('APPLICATION_DOCUMENT_READ',id);
  const linked=(await client.query('SELECT document_id FROM opportunity_catalog.application_document_link WHERE organization_id=$1 AND application_id=$2 AND version_id=$3 AND active=true',[org,id,input.versionId])).rows[0];
  if(!linked)fail('RESOURCE_NOT_AVAILABLE');
  await application(client,id,'APPLICATION_DOCUMENT_READ',[linked.document_id]);
  if(!await authorize('DOCUMENT_DOWNLOAD_REQUEST',resource(input.versionId,org,'DOCUMENT_VERSION')))fail('DOCUMENT_NOT_AVAILABLE');
  const row=await version(client,linked.document_id,input.versionId);if(!available(row))fail('DOCUMENT_NOT_AVAILABLE');
  await audit(client,{eventCode:'DOCUMENT_ALLOWED',operationCode:'APPLICATION_DOCUMENT_READ',resourceId:id,idempotencyKey:randomUUID()});
  return {organizationId:org,versionId:input.versionId,filename:row.display_filename};
 }
 async function documentTransportAccess(client,id,input){
  const type=input.operationCode==='DOCUMENT_UPLOAD_CONFIRM'?'DOCUMENT_VERSION':'DOCUMENT';
   if(!await authorize('APPLICATION_DOCUMENT_EDIT',resource(id,org))
    ||!await authorize(input.operationCode,resource(id,org,type)))fail('NOT_AUTHORIZED');
  const row=(await client.query('SELECT opportunity_id,evaluation_id FROM opportunity_catalog.application WHERE organization_id=$1 AND application_id=$2',[org,id])).rows[0];
  if(!row)fail('RESOURCE_NOT_AVAILABLE');
  await protect({operationCode:'APPLICATION_DOCUMENT_EDIT',resource:resource(id,org),additionalAuthorizations:[
   {operationCode:'OPPORTUNITY_READ',resource:resource(row.opportunity_id||org,org,'OPPORTUNITY')},
   ...(row.evaluation_id?[{operationCode:'F14_PREQUALIFICATION_READ',resource:resource(row.evaluation_id,org,'PREQUALIFICATION_EVALUATION')}]:[]),
   {operationCode:input.operationCode,resource:resource(id,org,type)}
  ]});
  return {organizationId:org,actor:{id:actor.id,membershipId:actor.membershipId,organizationId:org}};
 }
 // Refuses deletion of evidence: any active link, any review item, or a link of an application already submitted or closed.
 async function documentDeletionGuard(client,id,input){
  await documentTransportAccess(client,id,{operationCode:'DOCUMENT_VERSION_CREATE'});
  const protectedRow=(await client.query(`SELECT 1 FROM opportunity_catalog.application_document_link l JOIN opportunity_catalog.application a ON a.organization_id=l.organization_id AND a.application_id=l.application_id
    WHERE l.organization_id=$1 AND l.document_id=$2 AND (l.active OR a.status IN ('SUBMITTED','APPROVED','REJECTED','ARCHIVED'))
   UNION ALL SELECT 1 FROM opportunity_catalog.application_review_item WHERE organization_id=$1 AND document_id=$2 LIMIT 1`,[org,input.documentId])).rows[0];
  if(protectedRow)fail('STATE_CONFLICT');
  return {organizationId:org,documentId:input.documentId};
 }
 async function reviewReviewers(client,id,input){
  await authorizeApplication('APPLICATION_DOCUMENT_EDIT',id);
  const current=await links(client,id);
  const row=await application(client,id,'APPLICATION_DOCUMENT_READ',current.map(item=>item.document_id));
  if(!current.length)return {items:[],nextCursor:null};
  const page=await reviewerDirectory(input.cursor);
  const items=[];
  for(const person of page.items){
   try{await evidence(row,current.map(item=>item.document_id),person.membershipId,'0'.repeat(64));items.push(person);}
   catch(error){if(error.code!=='REVIEWER_NOT_ELIGIBLE')throw error;}
  }
  return {items,nextCursor:page.nextCursor};
 }
 async function reviewMine(client,_id,input){
  await protect({operationCode:'APPLICATION_DOCUMENT_READ',resource:resource(org,org)});
  const binding={organizationId:org,subjectId:actor.id,membershipId:actor.membershipId,
   membershipVersion:actor.membershipVersion,authorizationVersion:actor.authorizationVersion,route:'assigned-reviews-v1'};
  const after=input.cursor?uuid(cursor.openCursor(input.cursor,binding)):null;
  const rows=(await client.query(`SELECT r.request_id,r.application_id,r.requested_at,a.title,a.opportunity_id,a.evaluation_id
   FROM opportunity_catalog.application_document_receipt p
   JOIN opportunity_catalog.application_review_request r ON r.organization_id=p.organization_id
     AND r.application_id=p.resource_id AND r.request_id::text=p.result_projection->>'requestId'
   JOIN opportunity_catalog.application a ON a.organization_id=r.organization_id AND a.application_id=r.application_id
   WHERE p.organization_id=$1 AND p.result_projection ? 'reviewerMembershipId'
     AND p.result_projection->>'reviewerMembershipId'=$2 AND ($3::text IS NULL OR p.result_projection->>'requestId'>$3)
     AND NOT EXISTS (SELECT 1 FROM opportunity_catalog.application_review_decision d
       WHERE d.organization_id=r.organization_id AND d.application_id=r.application_id AND d.request_id=r.request_id)
     AND r.document_revision=(SELECT COALESCE(MAX(c.revision),1) FROM opportunity_catalog.application_document_change c
       WHERE c.organization_id=r.organization_id AND c.application_id=r.application_id AND c.kind IN ('DOCUMENT_LINKED','DOCUMENT_REMOVED'))
   ORDER BY p.result_projection->>'requestId' LIMIT 26`,[org,actor.membershipId,after])).rows;
  const page=rows.slice(0,25),items=[];
  for(const row of page){
   const id=row.application_id, target=resource(id,org);
   if(!await authorize('APPLICATION_DOCUMENT_READ',target)||!await authorize('APPLICATION_REVIEW_DECIDE',target)
    ||!await authorize('OPPORTUNITY_READ',resource(row.opportunity_id||org,org,'OPPORTUNITY'))
    ||(row.evaluation_id&&!await authorize('F14_PREQUALIFICATION_READ',resource(row.evaluation_id,org,'PREQUALIFICATION_EVALUATION'))))continue;
   const fixed=(await client.query('SELECT document_id,version_id FROM opportunity_catalog.application_review_item WHERE organization_id=$1 AND application_id=$2 AND request_id=$3',[org,id,row.request_id])).rows;
   let visible=fixed.length>0;
   for(const item of fixed){
    if(!await authorize('DOCUMENT_READ',resource(item.document_id,org,'DOCUMENT'))
     ||!available(await version(client,item.document_id,item.version_id))){visible=false;break;}
   }
   if(visible)items.push({requestId:row.request_id,applicationId:id,title:row.title,requestedAt:new Date(row.requested_at).toISOString()});
  }
  return {items,nextCursor:rows.length>25?cursor.cursor(page.at(-1).request_id,binding):null};
 }
 async function mutate(client,method,id,input){
   await authorizeApplication(method==='reviewDecide'?'APPLICATION_REVIEW_DECIDE':'APPLICATION_DOCUMENT_EDIT',id);
  const intentionDigest=digest({operation:'DOCUMENT_REVIEW',method,resourceId:id,input,organizationId:org,subjectId:actor.id});
  const receiptHint=(await client.query('SELECT * FROM opportunity_catalog.application_document_receipt WHERE organization_id=$1 AND idempotency_key=$2',[org,input.idempotencyKey])).rows[0];
  if(method==='reviewRequest'&&!receiptHint&&!input.reviewerMembershipId)fail();
  let docs=[];if(method==='documentLink')docs=[input.documentId];
  else if(method==='documentRemove')docs=[input.documentId];
  else if(method==='reviewRequest')docs=receiptHint?.result_projection?.documents?.map(r=>r.documentId)||(await links(client,id)).map(r=>r.document_id);
  else if(method==='reviewDecide')docs=(await client.query('SELECT document_id FROM opportunity_catalog.application_review_item WHERE organization_id=$1 AND application_id=$2 AND request_id=$3',[org,id,input.requestId])).rows.map(r=>r.document_id);
  if(docs.length>48)fail('LIMIT_EXCEEDED');
  await application(client,id,method==='reviewDecide'?'APPLICATION_REVIEW_DECIDE':'APPLICATION_DOCUMENT_EDIT',docs,
   {operation:method==='reviewDecide'?'APPLICATION_REVIEW_DECIDE':method==='reviewRequest'?'APPLICATION_REVIEW_REQUEST':'APPLICATION_DOCUMENT_EDIT',key:input.idempotencyKey,digest:intentionDigest},
   method==='reviewRequest'&&!receiptHint?input.reviewerMembershipId:null);
  const previous=receiptHint;
  if(previous){if(previous.subject_id!==actor.id||previous.resource_id!==id||previous.intention_digest!==intentionDigest)fail('IDEMPOTENCY_CONFLICT');return previous.result_projection}
  const current=await head(client,id,true);if(Number(current.revision)!==input.expectedRevision)fail('STALE_REVISION');
  let kind,documentId=null,versionId=null,requestId=null,decision=null,comment=null,result={};
  if(method==='documentLink'){
   documentId=input.documentId;versionId=input.versionId;const row=await version(client,documentId,versionId);if(!row||!available(row))fail('DOCUMENT_NOT_AVAILABLE');
   const prior=(await client.query('SELECT version_id,active FROM opportunity_catalog.application_document_link WHERE organization_id=$1 AND application_id=$2 AND document_id=$3',[org,id,documentId])).rows[0];
   if(prior?.active&&prior.version_id===versionId)fail('STATE_CONFLICT');
   if(!prior?.active&&(await links(client,id)).length>=20)fail('LIMIT_EXCEEDED');
   await client.query(`INSERT INTO opportunity_catalog.application_document_link(organization_id,application_id,document_id,version_id) VALUES($1,$2,$3,$4)
    ON CONFLICT(organization_id,application_id,document_id) DO UPDATE SET version_id=$4,active=true,updated_at=transaction_timestamp()`,[org,id,documentId,versionId]);
   kind='DOCUMENT_LINKED';result={documentId,versionId};
  }else if(method==='documentRemove'){
   documentId=input.documentId;const prior=(await client.query('SELECT version_id FROM opportunity_catalog.application_document_link WHERE organization_id=$1 AND application_id=$2 AND document_id=$3 AND active=true',[org,id,documentId])).rows[0];
   if(!prior)fail('RESOURCE_NOT_AVAILABLE');versionId=prior.version_id;
   await client.query('UPDATE opportunity_catalog.application_document_link SET active=false,updated_at=transaction_timestamp() WHERE organization_id=$1 AND application_id=$2 AND document_id=$3',[org,id,documentId]);kind='DOCUMENT_REMOVED';result={documentId,versionId};
  }else if(method==='reviewRequest'){
   const currentLinks=await links(client,id);if(!currentLinks.length||currentLinks.length>20)fail('STATE_CONFLICT');
   for(const item of currentLinks){const row=await version(client,item.document_id,item.version_id);if(!available(row))fail('DOCUMENT_NOT_AVAILABLE')}
   requestId=randomUUID();const snapshotDigest=digest(currentLinks.map(r=>[r.document_id,r.version_id]));
   await client.query('INSERT INTO opportunity_catalog.application_review_request(organization_id,application_id,request_id,document_revision,snapshot_digest,requested_by_subject_id) VALUES($1,$2,$3,$4,$5,$6)',[org,id,requestId,await linkRevision(client,id),snapshotDigest,actor.id]);
   for(const item of currentLinks)await client.query('INSERT INTO opportunity_catalog.application_review_item(organization_id,application_id,request_id,document_id,version_id) VALUES($1,$2,$3,$4,$5)',[org,id,requestId,item.document_id,item.version_id]);
   kind='REVIEW_REQUESTED';result={requestId,reviewerMembershipId:input.reviewerMembershipId,documents:currentLinks.map(r=>({documentId:r.document_id,versionId:r.version_id}))};
  }else{
   requestId=input.requestId;const request=(await client.query('SELECT * FROM opportunity_catalog.application_review_request WHERE organization_id=$1 AND application_id=$2 AND request_id=$3',[org,id,requestId])).rows[0];
   if(!request)fail('RESOURCE_NOT_AVAILABLE');if(request.requested_by_subject_id===actor.id)fail('NOT_AUTHORIZED');
   const assignment=(await client.query(`SELECT result_projection->>'reviewerMembershipId' AS reviewer_membership_id
    FROM opportunity_catalog.application_document_receipt WHERE organization_id=$1 AND resource_id=$2
     AND result_projection->>'requestId'=$3 AND result_projection ? 'reviewerMembershipId'`,[org,id,requestId])).rows[0];
   if(assignment&&assignment.reviewer_membership_id!==actor.membershipId)fail('NOT_AUTHORIZED');
   if(Number(request.document_revision)!==await linkRevision(client,id))fail('STALE_REVISION');
   const prior=(await client.query('SELECT 1 FROM opportunity_catalog.application_review_decision WHERE organization_id=$1 AND application_id=$2 AND request_id=$3',[org,id,requestId])).rows[0];if(prior)fail('STATE_CONFLICT');
   const fixed=(await client.query('SELECT document_id,version_id FROM opportunity_catalog.application_review_item WHERE organization_id=$1 AND application_id=$2 AND request_id=$3 ORDER BY document_id',[org,id,requestId])).rows;
   if(digest(fixed.map(r=>[r.document_id,r.version_id]))!==request.snapshot_digest)fail('STATE_CONFLICT');
   const currentLinks=await links(client,id);if(digest(currentLinks.map(r=>[r.document_id,r.version_id]))!==request.snapshot_digest)fail('STALE_REVISION');
   for(const item of fixed){const row=await version(client,item.document_id,item.version_id);if(!available(row))fail('DOCUMENT_NOT_AVAILABLE')}
   decision=input.decision;comment=input.comment;await client.query('INSERT INTO opportunity_catalog.application_review_decision(organization_id,application_id,request_id,decision,comment,decided_by_subject_id) VALUES($1,$2,$3,$4,$5,$6)',[org,id,requestId,decision,comment,actor.id]);
   kind='REVIEW_DECIDED';result={requestId,decision,comment};
  }
  const next=input.expectedRevision+1;await client.query('UPDATE opportunity_catalog.application_document_head SET revision=$3 WHERE organization_id=$1 AND application_id=$2',[org,id,next]);
  await client.query('INSERT INTO opportunity_catalog.application_document_change(organization_id,application_id,revision,kind,document_id,version_id,request_id,decision,comment,actor_subject_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[org,id,next,kind,documentId,versionId,requestId,decision,comment,actor.id]);
  await audit(client,{eventCode:'APPLICATION_CHANGED',operationCode:method==='reviewDecide'?'APPLICATION_REVIEW_DECIDE':'APPLICATION_DOCUMENT_EDIT',resourceId:id,idempotencyKey:input.idempotencyKey});
  const projection={revision:next,...result};await client.query("INSERT INTO opportunity_catalog.application_document_receipt(organization_id,idempotency_key,operation,subject_id,resource_id,intention_digest,result_projection) VALUES($1,$2,'DOCUMENT_REVIEW',$3,$4,$5,$6)",[org,input.idempotencyKey,actor.id,id,intentionDigest,projection]);return projection;
 }
 return {documentCandidates,documentGet,documentHistory,documentDownload,documentTransportAccess,documentDeletionGuard,reviewMine,reviewReviewers,documentLink:(c,id,i)=>mutate(c,'documentLink',id,i),documentRemove:(c,id,i)=>mutate(c,'documentRemove',id,i),reviewRequest:(c,id,i)=>mutate(c,'reviewRequest',id,i),reviewDecide:(c,id,i)=>mutate(c,'reviewDecide',id,i)};
}
module.exports={parse,createApplicationDocumentsRepository};
