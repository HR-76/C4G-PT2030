'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {parseChat,createChatRepository}=require('../src/applications/chat');

test('chat accepts only a message identifier and non-empty plain text',()=>{
 const messageId=randomUUID();
 const text='<b>Olá</b>\n😀';
 assert.deepEqual(parseChat('chatSend',{messageId,body:` ${text} `}),{messageId,body:text});
 for(const body of ['', ' \r\n ', 'x'.repeat(2001), '\u0000', '\uD800', null]){
  assert.throws(()=>parseChat('chatSend',{messageId,body}),{code:'INVALID_INPUT'});
 }
 assert.throws(()=>parseChat('chatSend',{messageId,body:'Olá',attachment:{}}),{code:'INVALID_INPUT'});
 assert.throws(()=>parseChat('chatGet',{cursor:['one','two']}),{code:'INVALID_CURSOR'});
});

test('application access alone never lets a non-participant query or send messages',async()=>{
 const [organizationId,applicationId,membershipId]=Array.from({length:3},()=>randomUUID());
 const operations=[];
 const repo=createChatRepository({organizationId,actor:{id:membershipId,membershipId},
  protectApplication:async(_client,id,operation)=>{assert.equal(id,applicationId);operations.push(operation);},
  responsibleNames:async()=>assert.fail('Names must not be queried'),audit:async()=>assert.fail('Send must not be audited')});
 const client={async query(sql,values){
  assert.match(sql,/application_participant/);
  assert.deepEqual(values,[organizationId,applicationId,membershipId]);
  return {rows:[]};
 }};
 await assert.rejects(repo.chatGet(client,applicationId,{}),{code:'RESOURCE_NOT_AVAILABLE'});
 await assert.rejects(repo.chatSend(client,applicationId,{messageId:randomUUID(),body:'Olá'}),{code:'RESOURCE_NOT_AVAILABLE'});
 assert.deepEqual(operations,['APPLICATION_CHAT_READ','APPLICATION_CHAT_SEND']);
});

test('chat history pages are chronological, scoped to the actor and limited to 25 messages',async()=>{
 const organizationId=randomUUID(),id=randomUUID(),membershipId=randomUUID(),subjectId=randomUUID();
 const messages=Array.from({length:30},(_,index)=>({message_id:randomUUID(),body:`Mensagem ${index+1}`,
  author_membership_id:membershipId,created_at:new Date(),sequence_no:String(index+1)}));
 const binding={organizationId,applicationId:id,subjectId,membershipId,route:'application-chat'};
 const repo=createChatRepository({organizationId,actor:{id:subjectId,membershipId},protectApplication:async()=>{},
  responsibleNames:async ids=>{assert.deepEqual(ids,[membershipId]);return new Map([[membershipId,'Técnico']]);},
  cursor:{cursor(position,bound){assert.deepEqual(bound,binding);return position;},
   openCursor(position,bound){assert.deepEqual(bound,binding);return position;}}});
 const client={async query(sql,values){
  if(sql.includes('application_participant'))return {rows:[{}]};
  assert.deepEqual(values.slice(0,2),[organizationId,id]);
  const [, , before, limit]=values;
  return {rows:messages.filter(row=>!before||Number(row.sequence_no)<Number(before)).reverse().slice(0,limit)};
 }};
 const latest=await repo.chatGet(client,id,{});
 assert.equal(latest.items.length,25);
 assert.equal(latest.items[0].body,'Mensagem 6');
 assert.equal(latest.items.at(-1).body,'Mensagem 30');
 assert.equal(latest.items[0].authorName,'Técnico');
 assert.equal(latest.items[0].own,true);
 const older=await repo.chatGet(client,id,{cursor:latest.nextCursor});
 assert.equal(older.nextCursor,null);
 assert.deepEqual(older.items.map(item=>item.body),messages.slice(0,5).map(item=>item.body));
});
