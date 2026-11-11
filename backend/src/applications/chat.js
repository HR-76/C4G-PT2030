'use strict';

const {createHash}=require('node:crypto');
const {uuid,fail}=require('./contracts');

const PAGE_SIZE=25;
const MAX_TEXT_LENGTH=2000;

function parseChat(method,value){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype)fail();
 if(method==='chatGet'){
  if(Object.keys(value).some(key=>key!=='cursor'))fail();
  if(value.cursor!==undefined&&(typeof value.cursor!=='string'||!value.cursor||value.cursor.length>4096))fail('INVALID_CURSOR');
  return {cursor:value.cursor??null};
 }
 if(method!=='chatSend'||Object.keys(value).sort().join(',')!=='body,messageId'||typeof value.body!=='string')fail();
 const body=value.body.trim();
 if(!body||body.length>MAX_TEXT_LENGTH||/[\u0000\uD800-\uDFFF]/u.test(body))fail();
 return {messageId:uuid(value.messageId),body};
}

async function isChatParticipant(client,organizationId,applicationId,membershipId){
 const {rows}=await client.query(`SELECT 1 FROM opportunity_catalog.application_participant
  WHERE organization_id=$1 AND application_id=$2 AND membership_id=$3 AND active`,[organizationId,applicationId,membershipId]);
 return rows.length===1;
}

function createChatRepository({organizationId,actor,protectApplication,responsibleNames,audit,cursor}){
 async function authorize(client,id,operation,intention){
  await protectApplication(client,id,operation,intention);
  if(!await isChatParticipant(client,organizationId,id,actor.membershipId))fail('RESOURCE_NOT_AVAILABLE');
 }

 async function project(rows){
  const names=await responsibleNames([...new Set(rows.map(row=>row.author_membership_id))]);
  return rows.map(row=>({
   messageId:row.message_id,authorMembershipId:row.author_membership_id,
   authorName:names.get(row.author_membership_id)??null,own:row.author_membership_id===actor.membershipId,
   body:row.body,createdAt:new Date(row.created_at).toISOString()
  }));
 }

 // The table only exists from migration 040; older tenant schemas are still supported.
 async function purgedAt(client,id){
  const {rows:[table]}=await client.query(`SELECT to_regclass('opportunity_catalog.application_chat_purge') IS NOT NULL AS present`);
  if(table?.present!==true)return null;
  const {rows:[purge]}=await client.query(`SELECT purged_at FROM opportunity_catalog.application_chat_purge
   WHERE organization_id=$1 AND application_id=$2`,[organizationId,id]);
  return purge?new Date(purge.purged_at).toISOString():null;
 }

 return {
  async chatGet(client,id,input){
   await authorize(client,id,'APPLICATION_CHAT_READ');
   const binding={organizationId,applicationId:id,subjectId:actor.id,membershipId:actor.membershipId,route:'application-chat'};
   const before=input.cursor?cursor.openCursor(input.cursor,binding):null;
   if(before!==null&&(typeof before!=='string'||!/^\d{1,19}$/.test(before)||BigInt(before)>9223372036854775807n))fail('INVALID_CURSOR');
   const {rows}=await client.query(`SELECT message_id,author_membership_id,body,created_at,sequence_no
    FROM opportunity_catalog.application_chat_message
    WHERE organization_id=$1 AND application_id=$2 AND ($3::bigint IS NULL OR sequence_no<$3)
    ORDER BY sequence_no DESC LIMIT $4`,[organizationId,id,before,PAGE_SIZE+1]);
   const page=rows.slice(0,PAGE_SIZE);
   const nextCursor=rows.length>PAGE_SIZE?cursor.cursor(page.at(-1).sequence_no,binding):null;
   // An empty first page is ambiguous: no messages yet, or the retention purge deleted them.
   if(before===null&&page.length===0)return {items:[],nextCursor:null,purgedAt:await purgedAt(client,id)};
   return {items:await project(page.reverse()),nextCursor};
  },

  async chatSend(client,id,{messageId,body}){
   const operation='APPLICATION_CHAT_SEND';
   const digest=createHash('sha256').update(JSON.stringify([organizationId,id,actor.membershipId,messageId,body])).digest('hex');
   await authorize(client,id,operation,{operation,key:messageId,digest});
   const key=[organizationId,id,actor.membershipId,messageId];
   const receipt=(await client.query(`SELECT intention_digest FROM opportunity_catalog.application_chat_receipt
    WHERE organization_id=$1 AND message_id=$2`,[organizationId,messageId])).rows[0];
   let row;
   if(receipt){
    if(receipt.intention_digest!==digest)fail('IDEMPOTENCY_CONFLICT');
    ({rows:[row]}=await client.query(`SELECT message_id,author_membership_id,body,created_at
     FROM opportunity_catalog.application_chat_message
     WHERE organization_id=$1 AND application_id=$2 AND author_membership_id=$3 AND message_id=$4`,key));
    if(!row)fail('RESOURCE_NOT_AVAILABLE');
   }else{
    ({rows:[row]}=await client.query(`INSERT INTO opportunity_catalog.application_chat_message
     (organization_id,application_id,author_membership_id,message_id,body) VALUES ($1,$2,$3,$4,$5)
     RETURNING message_id,author_membership_id,body,created_at`,[...key,body]));
    await client.query(`INSERT INTO opportunity_catalog.application_chat_receipt
     (organization_id,message_id,intention_digest) VALUES ($1,$2,$3)`,[organizationId,messageId,digest]);
    await audit(client,{eventCode:'APPLICATION_CHANGED',operationCode:operation,resourceId:id,
     auditPrefix:'APP_CHAT',idempotencyKey:messageId});
   }
   const [message]=await project([row]);
   return message;
  }
 };
}

module.exports={parseChat,isChatParticipant,createChatRepository};
