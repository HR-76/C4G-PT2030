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

function purgeNoticeHarness({ present = true, purgedAt = null } = {}) {
 const organizationId = randomUUID(), id = randomUUID(), membershipId = randomUUID(), seen = [];
 const repo = createChatRepository({ organizationId, actor: { id: membershipId, membershipId }, protectApplication: async () => {},
  responsibleNames: async () => new Map(), cursor: { cursor: position => String(position), openCursor: position => position } });
 const client = { async query(sql, values) {
  seen.push([String(sql), values]);
  if (sql.includes('application_participant')) return { rows: [{}] };
  if (sql.includes('to_regclass')) return { rows: [{ present }] };
  if (sql.includes('application_chat_purge')) return { rows: purgedAt ? [{ purged_at: purgedAt }] : [] };
  return { rows: [] };
 } };
 return { repo, client, id, organizationId, seen };
}

test('an empty first chat page reports when the history was purged', async () => {
 const { repo, client, id, organizationId, seen } = purgeNoticeHarness({ purgedAt: new Date('2026-11-12T03:00:00Z') });
 assert.deepEqual(await repo.chatGet(client, id, {}), { items: [], nextCursor: null, purgedAt: '2026-11-12T03:00:00.000Z' });
 const lookup = seen.find(([sql]) => /FROM opportunity_catalog\.application_chat_purge/.test(sql));
 assert.deepEqual(lookup[1], [organizationId, id]);
});

test('an empty first chat page without a purge record reports no purge', async () => {
 const { repo, client, id } = purgeNoticeHarness({ purgedAt: null });
 assert.deepEqual(await repo.chatGet(client, id, {}), { items: [], nextCursor: null, purgedAt: null });
});

test('a database without the retention table never queries it', async () => {
 const { repo, client, id, seen } = purgeNoticeHarness({ present: false });
 assert.deepEqual(await repo.chatGet(client, id, {}), { items: [], nextCursor: null, purgedAt: null });
 assert.equal(seen.some(([sql]) => /FROM opportunity_catalog\.application_chat_purge/.test(sql)), false);
});

test('pages with messages or a cursor never look up the purge record', async () => {
 const withMessages = purgeNoticeHarness({ purgedAt: new Date() });
 const membershipId = randomUUID();
 const row = { message_id: randomUUID(), author_membership_id: membershipId, body: 'Olá', created_at: new Date(), sequence_no: '1' };
 const client = { async query(sql) {
  withMessages.seen.push([String(sql)]);
  if (sql.includes('application_participant')) return { rows: [{}] };
  return { rows: [row] };
 } };
 const page = await withMessages.repo.chatGet(client, withMessages.id, {});
 assert.equal(Object.hasOwn(page, 'purgedAt'), false);
 assert.equal(withMessages.seen.some(([sql]) => /to_regclass|application_chat_purge/.test(sql)), false);
 const older = purgeNoticeHarness({ purgedAt: new Date() });
 const result = await older.repo.chatGet(older.client, older.id, { cursor: '5' });
 assert.equal(Object.hasOwn(result, 'purgedAt'), false);
 assert.equal(older.seen.some(([sql]) => /to_regclass|application_chat_purge/.test(sql)), false);
});
