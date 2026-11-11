'use strict';
const {randomUUID}=require('node:crypto');
const {fail,uuid}=require('./contracts');
const {resource}=require('./repository');
const {frozenSnapshotExpressions}=require('./opportunitySnapshot');
const LABELS={IDENTIFIED:'Identificada',INTENTION:'Intenção',PREPARATION:'Em preparação',SUBMITTED:'Submetida',APPROVED:'Aprovada',REJECTED:'Rejeitada',CANCELLED:'Cancelada',ARCHIVED:'Arquivada'};
function parse(method,value={}){
 if(!value||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)fail();
 const allowed=['alertsList','alertsRefreshList'].includes(method)?['unread','limit']:[];
 if(Object.keys(value).some(k=>!allowed.includes(k)))fail();
 if(value.unread!==undefined&&![true,false,'true','false'].includes(value.unread))fail();
 const limit=value.limit===undefined?100:Number(value.limit);
 if(!Number.isInteger(limit)||limit<1||limit>100)fail();
 return {unread:value.unread===true||value.unread==='true',limit};
}
function milestone(days){return Number.isInteger(days)&&days>=0?[30,7,1].find(n=>days<=n&&days>=n-2)||null:null}
function createAlertsRepository({organizationId:org,actor,protect,authorize,activeRecipients,audit}){
 const membership=actor.membershipId;
 async function available(client){return Boolean((await client.query("SELECT to_regclass('opportunity_catalog.application_alert') IS NOT NULL AS ready")).rows[0].ready)}
 async function insert(client,app,recipient,type,key,title,message,deadline=null){
  const result=await client.query(`INSERT INTO opportunity_catalog.application_alert(organization_id,alert_id,recipient_membership_id,application_id,event_key,type,title,message,deadline)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ${type.startsWith('DEADLINE_')?'ON CONFLICT(organization_id,recipient_membership_id,event_key) DO NOTHING':''}`,[org,randomUUID(),recipient,app.application_id,key,type,title,message,deadline]);
  return result.rowCount>0;
 }
 async function notify(client,event){
  // Older supported tenants remain usable until the additive migration is applied.
  if(!await available(client))return;
  const app=event.application;
  const candidates=event.kind==='PARTICIPANT_ADDED'?[event.membershipId]:[
   app.responsible_membership_id,...(await client.query('SELECT membership_id FROM opportunity_catalog.application_participant WHERE organization_id=$1 AND application_id=$2 AND active',[org,app.application_id])).rows.map(r=>r.membership_id)];
  const recipients=await activeRecipients([...new Set(candidates)],actor.id);
  for(const recipient of recipients){
   if(event.kind==='PARTICIPANT_ADDED')await insert(client,app,recipient,'APPLICATION_TEAM_ADDED',`TEAM:${app.application_id}:${event.revision}`,'Adicionado à equipa',`Foi adicionado à equipa da candidatura «${app.title}».`);
   else await insert(client,app,recipient,'APPLICATION_STATUS_CHANGED',`STATUS:${app.application_id}:${event.revision}`,`Candidatura ${LABELS[app.status]||app.status}`,`A candidatura «${app.title}» passou de ${LABELS[event.fromStatus]} para ${LABELS[app.status]}.`);
  }
 }
 async function guard(client,operation,extra={}){
  await protect({operationCode:operation,resource:resource(org,org,'NOTIFICATION_INBOX'),...extra});
  if(!await available(client))fail('SCHEMA_UPGRADE_REQUIRED');
 }
 async function canRead(row){
  return await authorize('APPLICATION_READ',resource(row.application_id,org))&&
   await authorize('OPPORTUNITY_READ',resource(row.opportunity_id||org,org,'OPPORTUNITY'))&&
   (!row.evaluation_id||await authorize('F14_PREQUALIFICATION_READ',resource(row.evaluation_id,org,'PREQUALIFICATION_EVALUATION')));
 }
 async function visible(client){
  const frozen=frozenSnapshotExpressions('a.central_snapshot');
  const rows=(await client.query(`SELECT n.alert_id,n.application_id,n.type,n.deadline,n.created_at,n.read_at,
   a.title AS application_title,a.opportunity_id,a.evaluation_id,a.status,
   COALESCE(o.closing_date::text,${frozen.deadlineDay}) AS current_deadline
   FROM opportunity_catalog.application_alert n JOIN opportunity_catalog.application a USING(organization_id,application_id)
   LEFT JOIN opportunity_catalog.opportunity o ON o.organization_id=a.organization_id AND o.opportunity_id=a.opportunity_id
   ${frozen.join}
   WHERE n.organization_id=$1 AND n.recipient_membership_id=$2 ORDER BY n.created_at DESC,n.alert_id DESC LIMIT 10001`,[org,membership])).rows;
  if(rows.length>10000)fail('LIMIT_EXCEEDED');
  const result=[];
  for(const row of rows){
   if(row.type.startsWith('DEADLINE_')&&(row.status!=='PREPARATION'||String(row.current_deadline)!==String(row.deadline instanceof Date?`${row.deadline.getFullYear()}-${String(row.deadline.getMonth()+1).padStart(2,'0')}-${String(row.deadline.getDate()).padStart(2,'0')}`:row.deadline)))continue;
   if(await canRead(row))result.push(row);
  }
  if((await client.query("SELECT to_regclass('opportunity_catalog.organization_notice') IS NOT NULL AS ready")).rows[0].ready){
   const general=(await client.query(`SELECT r.notification_id AS alert_id,r.read_at,n.notice_id,n.created_at,'BROADCAST' AS type
    FROM opportunity_catalog.organization_notice_recipient r JOIN opportunity_catalog.organization_notice n USING(organization_id,notice_id)
    WHERE r.organization_id=$1 AND r.recipient_membership_id=$2 ORDER BY n.created_at DESC,r.notification_id DESC LIMIT 10001`,[org,membership])).rows;
   result.push(...general);
  }
  if(result.length>10000)fail('LIMIT_EXCEEDED');
  return result.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)||b.alert_id.localeCompare(a.alert_id));
 }
 async function hydrateContent(client,rows){
  const contents=new Map();
  for(const broadcast of [false,true]){
   const selected=rows.filter(row=>(row.type==='BROADCAST')===broadcast);
   if(!selected.length)continue;
   const expected=new Map(selected.map(row=>[row.alert_id,row]));
   const values=[org,membership,[...expected.keys()]];
   const result=await client.query(broadcast?`SELECT r.notification_id AS alert_id,n.notice_id,n.title,n.message
    FROM opportunity_catalog.organization_notice_recipient r JOIN opportunity_catalog.organization_notice n USING(organization_id,notice_id)
    WHERE r.organization_id=$1 AND r.recipient_membership_id=$2 AND r.notification_id=ANY($3::uuid[])`:
    `SELECT n.alert_id,n.title,n.message FROM opportunity_catalog.application_alert n
    WHERE n.organization_id=$1 AND n.recipient_membership_id=$2 AND n.alert_id=ANY($3::uuid[])`,values);
   if(!Array.isArray(result.rows))fail('SERVICE_UNAVAILABLE');
   const byId=new Map();
   for(const content of result.rows){
    if(!content||typeof content.alert_id!=='string'||!expected.has(content.alert_id)||byId.has(content.alert_id)||
     typeof content.title!=='string'||!content.title.length||typeof content.message!=='string'||!content.message.length||
     (broadcast&&content.notice_id!==expected.get(content.alert_id).notice_id))fail('SERVICE_UNAVAILABLE');
    byId.set(content.alert_id,content);
   }
   if(byId.size!==expected.size)fail('SERVICE_UNAVAILABLE');
   contents.set(broadcast,byId);
  }
  // Contents are immutable to the runtime. Retain metadata from the authorized
  // selection: read_at and the application's title can change between statements.
  return rows.map(row=>{
   const content=contents.get(row.type==='BROADCAST').get(row.alert_id);
   return {...row,title:content.title,message:content.message};
  });
 }
 async function alertsList(client,id,input){
  await guard(client,'NOTIFICATION_READ');return listProtected(client,input);
 }
 async function listProtected(client,input){
  const rows=await visible(client);
  const unread=rows.filter(r=>!r.read_at).length, selected=input.unread?rows.filter(r=>!r.read_at):rows;
  const page=await hydrateContent(client,selected.slice(0,input.limit));
  return {notifications:page.map(r=>({id:r.alert_id,type:r.type,title:r.title,message:r.message,related_application_id:r.application_id,application_title:r.application_title,created_at:new Date(r.created_at).toISOString(),is_read:Boolean(r.read_at)})),unread_count:unread,total:selected.length,truncated:selected.length>input.limit};
 }
 async function acknowledge(client,id){
  await guard(client,'NOTIFICATION_ACK');const rows=await visible(client),selected=id?rows.filter(r=>r.alert_id===id):rows;
  if(id&&!selected.length)fail('RESOURCE_NOT_AVAILABLE');
  for(const row of selected.filter(r=>!r.read_at)){
   if(row.type==='BROADCAST'){
    await client.query('UPDATE opportunity_catalog.organization_notice_recipient SET read_at=clock_timestamp() WHERE organization_id=$1 AND recipient_membership_id=$2 AND notification_id=$3 AND read_at IS NULL',[org,membership,row.alert_id]);
    await audit(client,{eventCode:'ORGANIZATION_NOTICE_READ',operationCode:'NOTIFICATION_ACK',resourceType:'ORGANIZATION_NOTICE',resourceId:row.notice_id,idempotencyKey:row.alert_id,auditPrefix:'NOTICE_READ'});continue;
   }
   await client.query('UPDATE opportunity_catalog.application_alert SET read_at=clock_timestamp() WHERE organization_id=$1 AND recipient_membership_id=$2 AND alert_id=$3 AND read_at IS NULL',[org,membership,row.alert_id]);
   await audit(client,{eventCode:'APPLICATION_ALERT_READ',operationCode:'NOTIFICATION_ACK',resourceId:row.application_id,idempotencyKey:row.alert_id,auditPrefix:'ALERT_READ'});
  }
  return {success:true};
 }
 async function alertsRefresh(client){
  await guard(client,'NOTIFICATION_SYNC');return refreshProtected(client);
 }
 async function refreshProtected(client){
  const frozen=frozenSnapshotExpressions('a.central_snapshot');
  // Self-delivery on refresh, including the header: no privileged cross-tenant scheduler.
  // Use the opportunity deadline and the Lisbon civil day.
  const rows=(await client.query(`SELECT a.*,COALESCE(o.closing_date::text,${frozen.deadlineDay}) AS closing_day,
   COALESCE(o.closing_date,${frozen.deadlineDate})-(clock_timestamp() AT TIME ZONE 'Europe/Lisbon')::date AS days_left
   FROM opportunity_catalog.application a LEFT JOIN opportunity_catalog.opportunity o ON o.organization_id=a.organization_id AND o.opportunity_id=a.opportunity_id
   ${frozen.join}
   WHERE a.organization_id=$1 AND a.status='PREPARATION'
   AND (a.responsible_membership_id=$2 OR EXISTS(SELECT 1 FROM opportunity_catalog.application_participant p WHERE p.organization_id=a.organization_id AND p.application_id=a.application_id AND p.membership_id=$2 AND p.active))
   AND (o.opportunity_id IS NULL OR o.lifecycle_state='ACTIVE') ORDER BY a.application_id LIMIT 10001`,[org,membership])).rows;
  if(rows.length>10000)fail('LIMIT_EXCEEDED');
  for(const row of rows){const days=Number(row.days_left),due=row.days_left===null?null:milestone(days);if(!due||!await canRead(row))continue;
   const key=`DEADLINE:${row.application_id}:${row.closing_day}:${due}`;
   const created=await insert(client,row,membership,`DEADLINE_${due}_DAYS`,key,`Prazo de candidatura: ${days===0?'hoje':`${days} dia${days===1?'':'s'}`}`,`O prazo da oportunidade da candidatura «${row.title}» termina em ${row.closing_day}.`,row.closing_day);
   if(created)await audit(client,{eventCode:'APPLICATION_ALERT_CREATED',operationCode:'NOTIFICATION_SYNC',resourceId:row.application_id,idempotencyKey:`${membership}:${key}`,auditPrefix:'ALERT_CREATED'});
  }
  return {success:true};
 }
 async function alertsRefreshList(client,id,input){
  await guard(client,'NOTIFICATION_SYNC',{intention:{operation:'NOTIFICATION_REFRESH_LIST'},additionalAuthorizations:[{operationCode:'NOTIFICATION_READ',resource:resource(org,org,'NOTIFICATION_INBOX')}]});
  await refreshProtected(client);
  return listProtected(client,input);
 }
 return {notify,alertsList,alertsRefreshList,alertsRead:(c,id)=>acknowledge(c,uuid(id)),alertsReadAll:c=>acknowledge(c,null),alertsRefresh};
}
module.exports={parse,milestone,createAlertsRepository};
