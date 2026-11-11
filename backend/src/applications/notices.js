'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {uuid,fail}=require('./contracts');
const {resource}=require('./repository');
const {canonicalize}=require('../organizationalProfile/canonicalization');
const digest=value=>createHash('sha256').update(canonicalize(value)).digest('hex');
function parse(method,input={}){
 if(!['noticesContext','noticesSend','noticesHistory','noticesGet'].includes(method))fail();
 if(!input||Array.isArray(input)||Object.getPrototypeOf(input)!==Object.prototype)fail();
 if(method==='noticesSend'){
  if(Object.keys(input).sort().join(',')!=='idempotencyKey,message,recipientMembershipIds,title')fail();
  for(const [key,max] of [['title',200],['message',5000]])if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>max||input[key]!==input[key].trim()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input[key]))fail();
  if(!Array.isArray(input.recipientMembershipIds)||!input.recipientMembershipIds.length||input.recipientMembershipIds.length>1000)fail();
  const ids=input.recipientMembershipIds.map(uuid).sort();if(new Set(ids).size!==ids.length)fail();
  return{title:input.title,message:input.message,recipientMembershipIds:ids,idempotencyKey:uuid(input.idempotencyKey)};
 }
 const keys=method==='noticesHistory'?['cursor']:[];if(Object.keys(input).some(k=>!keys.includes(k)))fail();
 if(input.cursor!==undefined&&(typeof input.cursor!=='string'||!input.cursor||input.cursor.length>4096))fail();
 return{cursor:input.cursor||null};
}
function createNoticesRepository({organizationId:org,actor,protect,canManage,recipients,cursor,audit}){
 const adminResource=resource(org,org,'ORGANIZATION_NOTICE');
 async function ready(client){if(!(await client.query("SELECT to_regclass('opportunity_catalog.organization_notice') IS NOT NULL AS ready")).rows[0].ready)fail('SCHEMA_UPGRADE_REQUIRED')}
 async function admin(client,operation,intention=null){
  await protect({operationCode:operation,resource:adminResource,intention});
  if(!await canManage())fail('NOT_AUTHORIZED');
  await ready(client);await client.query("SELECT set_config('app.notice_admin','true',true)");
 }
 async function noticesContext(client){
  await protect({operationCode:'NOTIFICATION_READ',resource:resource(org,org,'NOTIFICATION_INBOX')});await ready(client);
  const allowed=await canManage();return{canManage:allowed,recipients:allowed?await recipients(null):[]};
 }
 const project=r=>({noticeId:r.notice_id,title:r.title,message:r.message,authorName:r.author_name,recipientCount:r.recipient_count,createdAt:new Date(r.created_at).toISOString()});
 async function noticesSend(client,id,input){
  const intentionDigest=digest({org,actor:actor.id,membership:actor.membershipId,...input});
  await admin(client,'ORGANIZATION_NOTICE_SEND',{operation:'ORGANIZATION_NOTICE_SEND',key:input.idempotencyKey,digest:intentionDigest});
  const previous=(await client.query('SELECT * FROM opportunity_catalog.organization_notice WHERE organization_id=$1 AND idempotency_key=$2',[org,input.idempotencyKey])).rows[0];
  if(previous){if(previous.author_subject_id!==actor.id||previous.intention_digest!==intentionDigest)fail('IDEMPOTENCY_CONFLICT');return project(previous)}
  const selected=await recipients(input.recipientMembershipIds);
  if(selected.length!==input.recipientMembershipIds.length)fail('RECIPIENT_UNAVAILABLE');
  const author=(await recipients([actor.membershipId]))[0];if(!author)fail('NOT_AUTHORIZED');
  const noticeId=randomUUID(),row=(await client.query(`INSERT INTO opportunity_catalog.organization_notice(organization_id,notice_id,author_subject_id,author_membership_id,author_name,idempotency_key,intention_digest,title,message,recipient_count)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[org,noticeId,actor.id,actor.membershipId,author.name,input.idempotencyKey,intentionDigest,input.title,input.message,selected.length])).rows[0];
  const members=selected.map(r=>({membership_id:r.membershipId,name:r.name,notification_id:randomUUID()}));
  await client.query(`INSERT INTO opportunity_catalog.organization_notice_recipient(organization_id,notice_id,recipient_membership_id,recipient_name,notification_id)
   SELECT $1,$2,r.membership_id,r.name,r.notification_id FROM jsonb_to_recordset($3::jsonb) AS r(membership_id uuid,name text,notification_id uuid)`,[org,noticeId,JSON.stringify(members)]);
  await audit(client,{eventCode:'ORGANIZATION_NOTICE_SENT',operationCode:'ORGANIZATION_NOTICE_SEND',resourceType:'ORGANIZATION_NOTICE',resourceId:noticeId,idempotencyKey:input.idempotencyKey,auditPrefix:'NOTICE_SEND'});
  return project(row);
 }
 async function noticesHistory(client,id,input){
  await admin(client,'ORGANIZATION_NOTICE_READ');const bind={organizationId:org,subjectId:actor.id,route:'notice-history'};
  const after=input.cursor?cursor.openCursor(input.cursor,bind):null;
  if(after&&(!Array.isArray(after)||after.length!==2||typeof after[0]!=='string'||Number.isNaN(Date.parse(after[0]))))fail('INVALID_CURSOR');if(after)uuid(after[1]);
  // Keep PostgreSQL microseconds in the cursor; Date truncates them and can skip rows.
  const rows=(await client.query(`SELECT *,created_at::text AS cursor_time FROM opportunity_catalog.organization_notice WHERE organization_id=$1 AND ($2::timestamptz IS NULL OR (created_at,notice_id)<($2,$3::uuid)) ORDER BY created_at DESC,notice_id DESC LIMIT 26`,[org,after?.[0]||null,after?.[1]||null])).rows;
  const items=rows.slice(0,25);return{items:items.map(project),nextCursor:rows.length>25?cursor.cursor([items.at(-1).cursor_time,items.at(-1).notice_id],bind):null};
 }
 async function noticesGet(client,id){
  await admin(client,'ORGANIZATION_NOTICE_READ');const row=(await client.query('SELECT * FROM opportunity_catalog.organization_notice WHERE organization_id=$1 AND notice_id=$2',[org,id])).rows[0];if(!row)fail('RESOURCE_NOT_AVAILABLE');
  const selected=(await client.query('SELECT recipient_membership_id,recipient_name FROM opportunity_catalog.organization_notice_recipient WHERE organization_id=$1 AND notice_id=$2 ORDER BY recipient_name,recipient_membership_id',[org,id])).rows;
  return{...project(row),recipients:selected.map(r=>({membershipId:r.recipient_membership_id,name:r.recipient_name}))};
 }
 return{noticesContext,noticesSend,noticesHistory,noticesGet};
}
module.exports={parse,createNoticesRepository};
