'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCapture}=require('../src/applications/statusEmails/capture');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const change={application:{organization_id:id(1),application_id:id(2),responsible_membership_id:id(4),title:'Test',status:'PREPARATION'},revision:2,fromStatus:'INTENTION'};
const client={query:async sql=>({rows:sql.includes('application_change')?[{actor_subject_id:id(3),recorded_at:new Date('2026-11-02T12:00:00Z')}]:[{membership_id:id(4)}]})};
const row={organization_id:id(1),actor_id:id(3),organization_name:'Org',actor_email:' AUTHOR@EXAMPLE.ORG ',candidates:[id(4)]};
test('capture binds guarded context and history, obtains only central identity fields',async()=>{
 let guards=0;const capture=createCapture({organizationId:id(1),actorUserId:id(3),assertAuthorized:async()=>guards++,centralPool:{query:async(sql,values)=>{assert.deepEqual(values,[id(1),id(3),[id(4)]]);return {rows:[row]}}}});
 const value=await capture(client,change);assert.equal(guards,2);assert.equal(value.actorEmail,'author@example.org');assert.equal(value.occurredAt,'2026-11-02T12:00:00.000Z');
 await assert.rejects(capture(client,{...change,application:{...change.application,organization_id:id(9)}}),/CONTEXT_CONFLICT/);
});
test('missing central authority or injected candidate fails closed',async()=>{
 for(const rows of [[],[{...row,candidates:[id(9)]}],[{...row,actor_id:id(9)}]]){
 const capture=createCapture({organizationId:id(1),actorUserId:id(3),assertAuthorized:async()=>{},centralPool:{query:async()=>({rows})}});await assert.rejects(capture(client,change));
 }
});
test('revoked transaction guard prevents central read',async()=>{
 let reads=0;const capture=createCapture({organizationId:id(1),actorUserId:id(3),assertAuthorized:async()=>{throw Error('revoked')},centralPool:{query:async()=>{reads++;return {rows:[row]}}}});
 await assert.rejects(capture(client,change),/revoked/);assert.equal(reads,0);
});
