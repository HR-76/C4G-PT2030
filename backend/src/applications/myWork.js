'use strict';
const {fail,uuid}=require('./contracts');
const {createHash}=require('node:crypto');
const {canonicalize}=require('../organizationalProfile/canonicalization');
const {selection}=require('./browseSql');
function parse(value){
 if(!value||Object.keys(value).some(k=>!['q','applicationQ','status','period','cursor'].includes(k)))fail();
 const result={};
 for(const key of ['q','applicationQ']){const text=value[key]??'';if(typeof text!=='string'||text.length>200)fail();result[key]=text.trim();}
 result.status=value.status??'OPEN';result.period=value.period??'all';
 if(!['OPEN','COMPLETED','CANCELLED','all'].includes(result.status)||!['all','overdue','today','upcoming'].includes(result.period))fail();
 if(value.cursor!==undefined&&(typeof value.cursor!=='string'||!value.cursor||value.cursor.length>8192))fail();
 return {...result,cursor:value.cursor||null};
}
const day=value=>value instanceof Date?value.toISOString().slice(0,10):value;
async function read(client,{organizationId:org,actor,authority,cursor,clock,taskDetailsAvailable=false},input){
 if(!actor.membershipId||authority.membershipId!==actor.membershipId||!authority.work)fail('RESOURCE_NOT_AVAILABLE');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'}).format(clock.now());
 const {cursor:token,...filters}=input;
 const bind={organizationId:org,subjectId:actor.id,membershipId:actor.membershipId,route:'my-work-v1',authority:createHash('sha256').update(canonicalize(authority)).digest('hex'),today,...filters};
 const after=token?cursor.openCursor(token,bind):null;
 if(after){if(typeof after.digest!=='string'||typeof after.deadline!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(after.deadline))fail('INVALID_CURSOR');uuid(after.taskId);}
 const {sql,params}=selection(org,authority,new Map(),{});
 params.push(authority.work.all,authority.work.ids,actor.membershipId,input.q,input.applicationQ,input.status,input.period,today,after?.deadline||null,after?.taskId||null);
 const row=(await client.query(`${sql}, mine AS (
  SELECT t.*,a.title AS application_title,CASE WHEN t.status='COMPLETED' THEN 'completed' WHEN t.status='CANCELLED' THEN 'cancelled'
   WHEN t.deadline<$20::date THEN 'overdue' WHEN t.deadline=$20::date THEN 'today' ELSE 'upcoming' END AS bucket
  FROM searched a JOIN opportunity_catalog.application_task t ON t.organization_id=a.organization_id AND t.application_id=a.application_id
  WHERE t.organization_id=$1 AND ($13::boolean OR a.application_id=ANY($14::uuid[])) AND t.responsible_membership_id=$15::uuid
  ${taskDetailsAvailable?'AND t.deleted_at IS NULL':''}
  AND ($16='' OR strpos(lower(t.title),lower($16))>0) AND ($17='' OR strpos(lower(a.title),lower($17))>0)
  AND ($18='all' OR t.status=$18)
 ), filtered AS (SELECT * FROM mine WHERE $19='all' OR bucket=$19), page AS (
  SELECT * FROM filtered WHERE $21::date IS NULL OR (deadline,task_id)>($21::date,$22::uuid) ORDER BY deadline,task_id LIMIT 26
 ) SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY deadline,task_id) FROM page),'[]') AS items,
  (SELECT count(*)::int FROM filtered) AS total,
  (SELECT encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(f)::text,'' ORDER BY task_id),''),'UTF8')),'hex') FROM filtered f) AS digest,
  (SELECT jsonb_object_agg(bucket,n) FROM (SELECT bucket,count(*)::int AS n FROM filtered GROUP BY bucket) counts) AS counts`,params)).rows[0];
 if(!row||!Array.isArray(row.items))fail('SERVICE_UNAVAILABLE');
 if(after&&after.digest!==row.digest)fail('INVALID_CURSOR');
 const items=row.items.slice(0,25).map(t=>({taskId:t.task_id,applicationId:t.application_id,applicationTitle:t.application_title,title:t.title,description:t.description??null,deadline:day(t.deadline),status:t.status,group:t.bucket}));
 const last=items.at(-1);
 return {today,items,total:row.total,counts:row.counts||{},nextCursor:row.items.length>25?cursor.cursor({deadline:last.deadline,taskId:last.taskId,digest:row.digest},bind):null};
}
module.exports={parse,read};
