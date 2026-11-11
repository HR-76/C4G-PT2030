'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {canonicalize}=require('../organizationalProfile/canonicalization');
const {uuid,fail}=require('./contracts');
const {resource}=require('./repository');
const {createChatRepository}=require('./chat');
const KINDS=Object.freeze(['PARTICIPANT_ADDED','PARTICIPANT_REMOVED','TASK_CREATED','TASK_EDITED','TASK_COMPLETED','TASK_CANCELLED','TASK_DELETED']);
const digest=value=>createHash('sha256').update(canonicalize(value)).digest('hex');
const exact=(value,keys)=>{if(!value||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))fail();return value};
const revision=value=>{if(!Number.isSafeInteger(value)||value<1)fail();return value};
const title=value=>{if(typeof value!=='string'||value!==value.trim()||value.length<1||value.length>200)fail();return value};
function description(value){
 if(value===null)return null;
 if(typeof value!=='string'||value.length>2000||value.includes('\0'))fail();
 return value.trim()||null;
}
const deadline=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(`${value}T00:00:00Z`))||new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value)fail();return value};
function parse(method,value){
 if(method==='workMine')return require('./myWork').parse(value);
 if(method==='workGet'){
  if(Object.keys(value).some(k=>!['taskCursor','participantCursor','taskFilter'].includes(k)))fail();
  const taskFilter=value.taskFilter===undefined?'all':value.taskFilter;
  if(!['all','mine','open','unassigned'].includes(taskFilter))fail();
  return {taskCursor:value.taskCursor?String(value.taskCursor):null,participantCursor:value.participantCursor?String(value.participantCursor):null,taskFilter};
 }
 if(method==='workHistory'){if(Object.keys(value).some(k=>k!=='cursor'))fail();return {cursor:value.cursor?String(value.cursor):null}}
 const base=['expectedRevision','idempotencyKey'];let keys;
 if(method==='participantAdd'||method==='participantRemove')keys=[...base,'membershipId'];
 else if(method==='taskCreate')keys=[...base,'title','responsibleMembershipId','deadline'];
 else if(method==='taskEdit')keys=[...base,'taskId','title','responsibleMembershipId','deadline'];
 else if(['taskComplete','taskCancel','taskDelete'].includes(method))keys=[...base,'taskId'];
 else fail();
 const hasDescription=keys.includes('title')&&value!=null&&Object.hasOwn(value,'description');
 exact(value,hasDescription?[...keys,'description']:keys);
 const parsed={expectedRevision:revision(value.expectedRevision),idempotencyKey:uuid(value.idempotencyKey)};
 if(keys.includes('membershipId'))parsed.membershipId=uuid(value.membershipId);
 if(keys.includes('taskId'))parsed.taskId=uuid(value.taskId);
 if(keys.includes('title'))Object.assign(parsed,{title:title(value.title),responsibleMembershipId:uuid(value.responsibleMembershipId),deadline:deadline(value.deadline)});
 if(hasDescription)parsed.description=description(value.description);
 return parsed;
}
const day=value=>value instanceof Date?value.toISOString().slice(0,10):value;
const task=row=>({taskId:row.task_id,title:row.title,description:row.description??null,responsibleMembershipId:row.responsible_membership_id,deadline:day(row.deadline),status:row.status,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()});
function createWorkRepository({organizationId:org,actor,protect,authorize=async()=>false,isOrganizationAdmin=async()=>false,
 taskDetailsAvailable=false,verifyResponsible,responsibleNames=async()=>new Map(),audit,cursor,notify=async()=>{}}){
 async function application(client,id,operation,intention=null){
  const row=(await client.query('SELECT * FROM opportunity_catalog.application WHERE organization_id=$1 AND application_id=$2',[org,id])).rows[0];
  if(!row)fail('RESOURCE_NOT_AVAILABLE');
  await protect({operationCode:operation,resource:resource(id,org),additionalAuthorizations:[{operationCode:'OPPORTUNITY_READ',resource:resource(row.opportunity_id||org,org,'OPPORTUNITY')},...(row.evaluation_id?[{operationCode:'F14_PREQUALIFICATION_READ',resource:resource(row.evaluation_id,org,'PREQUALIFICATION_EVALUATION')}]:[])],intention});
  return row;
 }
 async function ensureWork(client,id){await client.query('INSERT INTO opportunity_catalog.application_work(organization_id,application_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[org,id]);return (await client.query('SELECT revision FROM opportunity_catalog.application_work WHERE organization_id=$1 AND application_id=$2 FOR UPDATE',[org,id])).rows[0]}
 async function workGet(client,id,input){const current=await application(client,id,'APPLICATION_WORK_READ');
  const head=(await client.query(`SELECT
   (SELECT revision FROM opportunity_catalog.application_work WHERE organization_id=$1 AND application_id=$2) AS revision,
   EXISTS (SELECT 1 FROM opportunity_catalog.application_participant
    WHERE organization_id=$1 AND application_id=$2 AND membership_id=$3 AND active) AS can_chat`,[org,id,actor.membershipId||null])).rows[0];
  const taskFilter=input.taskFilter||'all';
  if(!['all','mine','open','unassigned'].includes(taskFilter))fail();
  const taskBind={organizationId:org,subjectId:actor.id,route:'application-work-tasks',applicationId:id,...(taskFilter==='all'?{}:{taskFilter}),...(taskFilter==='mine'?{membershipId:actor.membershipId||null}:{})};
  const participantBind={organizationId:org,subjectId:actor.id,route:'application-work-participants',applicationId:id};
  const taskAfter=input.taskCursor?uuid(cursor.openCursor(input.taskCursor,taskBind)):null;
  const participantAfter=input.participantCursor?uuid(cursor.openCursor(input.participantCursor,participantBind)):null;
  const participantRows=(await client.query('SELECT membership_id,active,added_at,updated_at FROM opportunity_catalog.application_participant WHERE organization_id=$1 AND application_id=$2 AND ($3::uuid IS NULL OR membership_id>$3) ORDER BY membership_id LIMIT 26',[org,id,participantAfter])).rows;
  const taskPredicate={all:'',mine:' AND responsible_membership_id=$4::uuid',open:" AND status='OPEN'",unassigned:' AND responsible_membership_id IS NULL'}[taskFilter];
  const activeTasks=taskDetailsAvailable?' AND deleted_at IS NULL':'';
  const taskRows=(await client.query(`SELECT * FROM opportunity_catalog.application_task WHERE organization_id=$1 AND application_id=$2 AND ($3::uuid IS NULL OR task_id>$3)${activeTasks}${taskPredicate} ORDER BY task_id LIMIT 26`,[org,id,taskAfter,...(taskFilter==='mine'?[actor.membershipId||null]:[])])).rows;
  const participants=await Promise.all(participantRows.slice(0,25).map(async r=>({membershipId:r.membership_id,active:r.active,eligible:r.active?await verifyResponsible(r.membership_id):false,addedAt:new Date(r.added_at).toISOString(),updatedAt:new Date(r.updated_at).toISOString()})));
  const tasks=taskRows.slice(0,25).map(task);
  const memberIds=[...new Set([current.responsible_membership_id,...participants.map(p=>p.membershipId),...tasks.map(t=>t.responsibleMembershipId)].filter(Boolean))];
  const names=await responsibleNames(memberIds);
  const members=memberIds.filter(id=>names.has(id)).map(membershipId=>({membershipId,name:names.get(membershipId)}));
  const canEdit=Boolean(await authorize('APPLICATION_WORK_EDIT',resource(id,org)));
  const canDeleteTasks=canEdit&&taskDetailsAvailable&&await isOrganizationAdmin();
  return {currentMembershipId:actor.membershipId||null,canChat:head?.can_chat===true,canEdit,canDescribeTasks:taskDetailsAvailable,canDeleteTasks,revision:Number(head?.revision||1),members,participants,participantNextCursor:participantRows.length>25?cursor.cursor(participants.at(-1).membershipId,participantBind):null,
   tasks,taskNextCursor:taskRows.length>25?cursor.cursor(tasks.at(-1).taskId,taskBind):null};
 }
 async function workHistory(client,id,input){await application(client,id,'APPLICATION_WORK_READ');
  const bind={organizationId:org,subjectId:actor.id,route:'application-work-history',applicationId:id};const position=input.cursor?cursor.openCursor(input.cursor,bind):null;
  if(position!==null&&(!Number.isSafeInteger(position)||position<2))fail('INVALID_CURSOR');
  const rows=(await client.query('SELECT * FROM opportunity_catalog.application_work_change WHERE organization_id=$1 AND application_id=$2 AND ($3::bigint IS NULL OR revision<$3) ORDER BY revision DESC LIMIT 26',[org,id,position])).rows;
  const page=rows.slice(0,25);return {items:page.map(r=>({revision:Number(r.revision),kind:r.kind,membershipId:r.membership_id,taskId:r.task_id,title:r.title,description:r.description??null,responsibleMembershipId:r.responsible_membership_id,deadline:day(r.deadline),status:r.status,actorSubjectId:r.actor_subject_id,recordedAt:new Date(r.recorded_at).toISOString()})),nextCursor:rows.length>25?cursor.cursor(Number(page.at(-1).revision),bind):null};
 }
 async function mutate(client,method,id,input){
  const intentionDigest=digest({operation:'WORK',method,resourceId:id,input,organizationId:org,subjectId:actor.id});
  const currentApplication=await application(client,id,'APPLICATION_WORK_EDIT',{operation:'APPLICATION_WORK_EDIT',key:input.idempotencyKey,digest:intentionDigest});
  if(method==='taskDelete'&&!await isOrganizationAdmin())fail('NOT_AUTHORIZED');
  const hasDescription=Object.hasOwn(input,'description');
  if(!taskDetailsAvailable&&(method==='taskDelete'||hasDescription))fail('SCHEMA_UPGRADE_REQUIRED');
  const previous=(await client.query('SELECT * FROM opportunity_catalog.application_work_receipt WHERE organization_id=$1 AND idempotency_key=$2',[org,input.idempotencyKey])).rows[0];
  if(previous){if(previous.subject_id!==actor.id||previous.resource_id!==id||previous.intention_digest!==intentionDigest)fail('IDEMPOTENCY_CONFLICT');return previous.result_projection}
  const head=await ensureWork(client,id);if(Number(head.revision)!==input.expectedRevision)fail('STALE_REVISION');
  let kind,membershipId=null,taskId=null,result;
  if(method==='participantAdd'||method==='participantRemove'){
   membershipId=input.membershipId;const prior=(await client.query('SELECT active FROM opportunity_catalog.application_participant WHERE organization_id=$1 AND application_id=$2 AND membership_id=$3',[org,id,membershipId])).rows[0];
   if(method==='participantAdd'){
    if(!await verifyResponsible(membershipId))fail('RESPONSIBLE_UNAVAILABLE');if(prior?.active)fail('STATE_CONFLICT');
    await client.query('INSERT INTO opportunity_catalog.application_participant(organization_id,application_id,membership_id) VALUES($1,$2,$3) ON CONFLICT(organization_id,application_id,membership_id) DO UPDATE SET active=true,updated_at=transaction_timestamp()',[org,id,membershipId]);kind='PARTICIPANT_ADDED';result={membershipId,active:true};
   }else{
    if(!prior?.active)fail('STATE_CONFLICT');await client.query('UPDATE opportunity_catalog.application_participant SET active=false,updated_at=transaction_timestamp() WHERE organization_id=$1 AND application_id=$2 AND membership_id=$3',[org,id,membershipId]);kind='PARTICIPANT_REMOVED';result={membershipId,active:false};
   }
  }else{
   let row;
   if(method==='taskCreate'){
    if(!await verifyResponsible(input.responsibleMembershipId))fail('RESPONSIBLE_UNAVAILABLE');taskId=randomUUID();
    row=(await client.query(`INSERT INTO opportunity_catalog.application_task(organization_id,application_id,task_id,title,responsible_membership_id,deadline${hasDescription?',description':''}) VALUES($1,$2,$3,$4,$5,$6${hasDescription?',$7':''}) RETURNING *`,
     [org,id,taskId,input.title,input.responsibleMembershipId,input.deadline,...(hasDescription?[input.description]:[])])).rows[0];kind='TASK_CREATED';
   }else{
    taskId=input.taskId;const prior=(await client.query('SELECT * FROM opportunity_catalog.application_task WHERE organization_id=$1 AND application_id=$2 AND task_id=$3',[org,id,taskId])).rows[0];
    if(!prior)fail('RESOURCE_NOT_AVAILABLE');
    if(prior.deleted_at||(method!=='taskDelete'&&prior.status!=='OPEN'))fail('STATE_CONFLICT');
    if(method==='taskDelete'){
     row=(await client.query('UPDATE opportunity_catalog.application_task SET deleted_at=transaction_timestamp(),updated_at=transaction_timestamp() WHERE organization_id=$1 AND application_id=$2 AND task_id=$3 RETURNING *',[org,id,taskId])).rows[0];kind='TASK_DELETED';
    }else if(method==='taskEdit'){
     if(!await verifyResponsible(input.responsibleMembershipId))fail('RESPONSIBLE_UNAVAILABLE');
     row=(await client.query(`UPDATE opportunity_catalog.application_task SET title=$4,responsible_membership_id=$5,deadline=$6,updated_at=transaction_timestamp()${hasDescription?',description=$7':''} WHERE organization_id=$1 AND application_id=$2 AND task_id=$3 RETURNING *`,
      [org,id,taskId,input.title,input.responsibleMembershipId,input.deadline,...(hasDescription?[input.description]:[])])).rows[0];kind='TASK_EDITED';
    }else{
     const status=method==='taskComplete'?'COMPLETED':'CANCELLED';row=(await client.query('UPDATE opportunity_catalog.application_task SET status=$4,updated_at=transaction_timestamp() WHERE organization_id=$1 AND application_id=$2 AND task_id=$3 RETURNING *',[org,id,taskId,status])).rows[0];kind=method==='taskComplete'?'TASK_COMPLETED':'TASK_CANCELLED';
    }
   }result=method==='taskDelete'?{...task(row),deleted:true}:task(row);
  }
  const revision=input.expectedRevision+1;
  await client.query('UPDATE opportunity_catalog.application_work SET revision=$3 WHERE organization_id=$1 AND application_id=$2',[org,id,revision]);
  await client.query(`INSERT INTO opportunity_catalog.application_work_change(organization_id,application_id,revision,kind,membership_id,task_id,title,responsible_membership_id,deadline,status,actor_subject_id${taskDetailsAvailable?',description':''}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11${taskDetailsAvailable?',$12':''})`,
   [org,id,revision,kind,membershipId,taskId,result.title||null,result.responsibleMembershipId||null,result.deadline||null,result.status||null,actor.id,...(taskDetailsAvailable?[result.description??null]:[])]);
  await audit(client,{eventCode:'APPLICATION_CHANGED',operationCode:'APPLICATION_WORK_EDIT',resourceId:id,idempotencyKey:input.idempotencyKey});
  if(kind==='PARTICIPANT_ADDED')await notify(client,{kind,application:currentApplication,membershipId,revision});
  const projection={revision,...result};await client.query("INSERT INTO opportunity_catalog.application_work_receipt(organization_id,idempotency_key,operation,subject_id,resource_id,intention_digest,result_projection) VALUES($1,$2,'WORK',$3,$4,$5,$6)",[org,input.idempotencyKey,actor.id,id,intentionDigest,projection]);
  return projection;
 }
 const chat=createChatRepository({organizationId:org,actor,protectApplication:application,responsibleNames,audit,cursor});
 return {...chat,workGet,workHistory,participantAdd:(c,id,i)=>mutate(c,'participantAdd',id,i),participantRemove:(c,id,i)=>mutate(c,'participantRemove',id,i),taskCreate:(c,id,i)=>mutate(c,'taskCreate',id,i),taskEdit:(c,id,i)=>mutate(c,'taskEdit',id,i),taskComplete:(c,id,i)=>mutate(c,'taskComplete',id,i),taskCancel:(c,id,i)=>mutate(c,'taskCancel',id,i),taskDelete:(c,id,i)=>mutate(c,'taskDelete',id,i)};
}
module.exports={parse,createWorkRepository,KINDS};
