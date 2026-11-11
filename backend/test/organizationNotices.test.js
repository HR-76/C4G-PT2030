'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {parse,createNoticesRepository}=require('../src/applications/notices');
const {createPq1UiTokens}=require('../src/organizationalProfile/pq1UiTokens');
const valid=()=>({title:'Aviso',message:'Texto simples\nSegunda linha',recipientMembershipIds:[randomUUID()],idempotencyKey:randomUUID()});
test('notice commands reject implicit broadcast, foreign authority and invalid content',()=>{
 const base=valid();
 for(const input of [null,[],{}, {...base,organizationId:randomUUID()},{...base,author:randomUUID()},
  {...base,recipientMembershipIds:[]},{...base,recipientMembershipIds:['all']},
  {...base,recipientMembershipIds:[base.recipientMembershipIds[0],base.recipientMembershipIds[0].toUpperCase()]},
  {...base,recipientMembershipIds:Array.from({length:1001},randomUUID)},
  {...base,title:' '},{...base,title:'x'.repeat(201)},{...base,message:'x'.repeat(5001)},
  {...base,message:'x\u0000y'},{...base,idempotencyKey:'auto'}])assert.throws(()=>parse('noticesSend',input),{code:'INVALID_INPUT'});
 assert.throws(()=>parse('unknown',{}),{code:'INVALID_INPUT'});
});
test('explicit recipient selection has stable order, valid multiline text is preserved',()=>{
 const value=valid();value.recipientMembershipIds.push(randomUUID());
 const other={...value,recipientMembershipIds:[...value.recipientMembershipIds].reverse().map(x=>x.toUpperCase())};
 assert.deepEqual(parse('noticesSend',value),parse('noticesSend',other));
 assert.equal(parse('noticesSend',value).message,value.message);
});
test('notice read inputs never accept impersonation or arbitrary filters',()=>{
 for(const method of ['noticesContext','noticesGet','noticesHistory']){
  assert.throws(()=>parse(method,{membershipId:randomUUID()}),{code:'INVALID_INPUT'});
  assert.throws(()=>parse(method,{read:true}),{code:'INVALID_INPUT'});
 }
 assert.throws(()=>parse('noticesHistory',{cursor:'x'.repeat(4097)}),{code:'INVALID_INPUT'});
 assert.throws(()=>parse('noticesContext',{cursor:'x'}),{code:'INVALID_INPUT'});
});
function fixture(overrides={}){
 const org=randomUUID(),actor={id:randomUUID(),membershipId:randomUUID()};
 const ports={organizationId:org,actor,protect:async()=>{},canManage:async()=>false,
  recipients:async()=>{throw Error('Unexpected recipient lookup')},audit:async()=>{},
  cursor:createPq1UiTokens({keys:{test:'x'.repeat(32)},currentKeyId:'test'}),...overrides};
 return {org,actor,ports,repository:createNoticesRepository(ports)};
}
test('administrative authority is checked before querying notice content',async()=>{
 const {repository}=fixture(),client={query:async()=>{throw Error('Unexpected SQL')}};
 for(const [method,input] of [['noticesSend',valid()],['noticesHistory',{}],['noticesGet',{}]]){
  await assert.rejects(repository[method](client,randomUUID(),input),{code:'NOT_AUTHORIZED'});
 }
});
test('personal context does not disclose organization recipients to a common member',async()=>{
 const calls=[],{repository}=fixture({protect:async value=>calls.push(value)});
 const result=await repository.noticesContext({query:async()=>({rows:[{ready:true}]})});
 assert.deepEqual(result,{canManage:false,recipients:[]});
 assert.equal(calls[0].operationCode,'NOTIFICATION_READ');
 assert.equal(calls[0].resource.resourceType,'NOTIFICATION_INBOX');
});
test('unavailable recipient aborts before any insertion or audit',async()=>{
 const writes=[],{repository}=fixture({canManage:async()=>true,recipients:async()=>[],audit:async()=>writes.push('audit')});
 const client={query:async sql=>{
  assert.ok(!sql.startsWith('INSERT'));
  return {rows:sql.includes('to_regclass')?[{ready:true}]:[]};
 }};
 await assert.rejects(repository.noticesSend(client,null,parse('noticesSend',valid())),{code:'RECIPIENT_UNAVAILABLE'});
 assert.deepEqual(writes,[]);
});
test('history cursors retain microseconds and reject another organization or actor',async()=>{
 const {repository,ports,org,actor}=fixture({canManage:async()=>true});
 const rows=Array.from({length:26},()=>({notice_id:randomUUID(),title:'Aviso',message:'Texto',author_name:'Pessoa',recipient_count:1,
  created_at:new Date('2026-10-18T10:00:00.123Z'),cursor_time:'2026-10-18 10:00:00.123456+00'}));
 const client={query:async sql=>({rows:sql.includes('to_regclass')?[{ready:true}]:sql.startsWith('SELECT *,')?rows:[]})};
 const result=await repository.noticesHistory(client,null,{cursor:null});
 assert.equal(result.items.length,25);
 const binding={organizationId:org,subjectId:actor.id,route:'notice-history'};
 assert.deepEqual(ports.cursor.openCursor(result.nextCursor,binding),[rows[24].cursor_time,rows[24].notice_id]);
 assert.throws(()=>ports.cursor.openCursor(result.nextCursor,{...binding,organizationId:randomUUID()}),{code:'INVALID_CURSOR'});
 assert.throws(()=>ports.cursor.openCursor(result.nextCursor,{...binding,subjectId:randomUUID()}),{code:'INVALID_CURSOR'});
 assert.equal(JSON.stringify(result.items).includes('cursor_time'),false);
});
