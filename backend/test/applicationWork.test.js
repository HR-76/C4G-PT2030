'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {parse,createWorkRepository}=require('../src/applications/work');
test('denied work reads never resolve member names',async()=>{
 let namesRead=false;
 const repo=createWorkRepository({organizationId:randomUUID(),actor:{id:randomUUID()},protect:async()=>{throw Error('denied')},responsibleNames:async()=>{namesRead=true;return new Map()}});
 await assert.rejects(repo.workGet({query:async()=>({rows:[{}]})},randomUUID(),{}),/denied/);
 assert.equal(namesRead,false);
});
test('read-only work resolves names only for the authorized page and responsible',async()=>{
 const org=randomUUID(),app=randomUUID(),member=randomUUID(),owner=randomUUID();let guarded=false;
 const repo=createWorkRepository({organizationId:org,actor:{id:randomUUID()},protect:async()=>{guarded=true},verifyResponsible:async()=>true,cursor:{},
  responsibleNames:async ids=>{assert.equal(guarded,true);assert.deepEqual(new Set(ids),new Set([member,owner]));return new Map([[member,'Técnico'],[owner,'Gestor']])}});
 const client={query:async sql=>({rows:sql.startsWith('SELECT * FROM opportunity_catalog.application WHERE')?[{responsible_membership_id:owner}]:sql.includes('FROM opportunity_catalog.application_participant')?[{membership_id:member,active:true,added_at:new Date(),updated_at:new Date()}]:[]})};
 const result=await repo.workGet(client,app,{});
 assert.equal(result.canEdit,false);assert.deepEqual(result.members,[{membershipId:owner,name:'Gestor'},{membershipId:member,name:'Técnico'}]);
});
test('work commands accept only the approved task and participant fields',()=>{
 const base={expectedRevision:1,idempotencyKey:randomUUID()};
 const membershipId=randomUUID(),taskId=randomUUID();
 assert.equal(parse('participantAdd',{...base,membershipId}).membershipId,membershipId);
 assert.equal(parse('participantRemove',{...base,membershipId}).membershipId,membershipId);
 assert.equal(parse('taskCreate',{...base,title:'Preparar',responsibleMembershipId:membershipId,deadline:'2026-12-31'}).title,'Preparar');
 assert.equal(parse('taskEdit',{...base,taskId,title:'Preparar',responsibleMembershipId:membershipId,deadline:'2026-12-31'}).taskId,taskId);
 assert.equal(parse('taskComplete',{...base,taskId}).taskId,taskId);
 assert.equal(parse('taskCancel',{...base,taskId}).taskId,taskId);
 for(const invalid of [{...base,title:'X',responsibleMembershipId:membershipId,deadline:'2026-02-30'},{...base,title:'X',responsibleMembershipId:membershipId,deadline:'2026-12-31',organizationId:randomUUID()}])assert.throws(()=>parse('taskCreate',invalid),{code:'INVALID_INPUT'});
 assert.throws(()=>parse('taskComplete',{...base,taskId,status:'REOPENED'}),{code:'INVALID_INPUT'});
});
test('task keyset pages retain all old and terminal tasks without duplicates',async()=>{
 const org=randomUUID(),app=randomUUID(),actor={id:randomUUID()};
 const rows=Array.from({length:53},(_,i)=>({task_id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,title:`Tarefa ${i+1}`,responsible_membership_id:randomUUID(),deadline:'2027-01-30',status:i%2?'COMPLETED':'CANCELLED',created_at:new Date(),updated_at:new Date()}));
 const repository=createWorkRepository({organizationId:org,actor,protect:async()=>{},verifyResponsible:async()=>true,audit:async()=>{},cursor:{cursor:value=>value,openCursor:value=>value}});
 const client={query:async(sql,params)=>({rows:sql.includes('FROM opportunity_catalog.application_task')?rows.filter(row=>!params[2]||row.task_id>params[2]).slice(0,26)
  :sql.includes('FROM opportunity_catalog.application_participant')?[]:sql.includes('FROM opportunity_catalog.application_work')?[{revision:1}]:[{opportunity_id:randomUUID(),evaluation_id:null}]})};
 const seen=[];let taskCursor=null;
 do{const page=await repository.workGet(client,app,{taskCursor,participantCursor:null});seen.push(...page.tasks.map(item=>item.taskId));taskCursor=page.taskNextCursor}while(taskCursor);
 assert.deepEqual(seen,rows.map(row=>row.task_id));
});

test('task descriptions are optional, can be cleared, and reject invalid values',()=>{
 const base={expectedRevision:1,idempotencyKey:randomUUID(),title:'Tarefa',responsibleMembershipId:randomUUID(),deadline:'2026-12-31'};
 assert.equal(Object.hasOwn(parse('taskCreate',base),'description'),false);
 assert.equal(parse('taskCreate',{...base,description:'  Primeira linha\nSegunda linha  '}).description,'Primeira linha\nSegunda linha');
 for(const empty of [null,'','  '])assert.equal(parse('taskEdit',{...base,taskId:randomUUID(),description:empty}).description,null);
 for(const invalid of [true,{},'a'.repeat(2001),'a\0b'])assert.throws(()=>parse('taskCreate',{...base,description:invalid}),{code:'INVALID_INPUT'});
});

test('only the current organization admin can delete a task, and retries reuse the receipt',async()=>{
 const org=randomUUID(),app=randomUUID(),actor={id:randomUUID()},taskId=randomUUID();
 const body={expectedRevision:1,idempotencyKey:randomUUID(),taskId};
 const input=parse('taskDelete',body);
 let admin=false, receipt, writes=0, auditEvents=0, workRevision=1;
 const row={task_id:taskId,title:'Tarefa',description:'Texto',status:'COMPLETED',responsible_membership_id:randomUUID(),deadline:'2026-12-31',created_at:new Date(),updated_at:new Date()};
 const repo=createWorkRepository({organizationId:org,actor,protect:async({operationCode})=>assert.equal(operationCode,'APPLICATION_WORK_EDIT'),
  taskDetailsAvailable:true,isOrganizationAdmin:async()=>admin,audit:async()=>{auditEvents++}});
 const client={async query(sql,params){
  assert.equal(params[0],org);
  if(sql.startsWith('SELECT * FROM opportunity_catalog.application WHERE'))return {rows:[{opportunity_id:randomUUID()}]};
  assert.equal(admin,true);
  if(sql.includes('FROM opportunity_catalog.application_work_receipt'))return {rows:receipt?.key===params[1]?[receipt]:[]};
  if(sql.startsWith('INSERT INTO opportunity_catalog.application_work_receipt')){
   receipt={key:params[1],subject_id:params[2],resource_id:params[3],intention_digest:params[4],result_projection:params[5]};return {rows:[]};
  }
  assert.equal(params[1],app);
  if(sql.startsWith('SELECT revision'))return {rows:[{revision:workRevision}]};
  if(sql.startsWith('SELECT * FROM opportunity_catalog.application_task'))return {rows:[row]};
  if(sql.includes('SET deleted_at=')){row.deleted_at=new Date();writes++;return {rows:[row]};}
  if(sql.startsWith('UPDATE opportunity_catalog.application_work '))workRevision=params[2];
  if(sql.startsWith('INSERT INTO opportunity_catalog.application_work_change')){
   assert.equal(params[3],'TASK_DELETED');assert.equal(params[11],'Texto');
  }
  return {rows:[]};
 }};
 await assert.rejects(repo.taskDelete(client,app,input),{code:'NOT_AUTHORIZED'});
 admin=true;
 const deleted=await repo.taskDelete(client,app,input);
 assert.equal(deleted.deleted,true);
 assert.deepEqual(await repo.taskDelete(client,app,input),deleted);
 assert.equal(writes,1);assert.equal(auditEvents,1);
 await assert.rejects(repo.taskDelete(client,app,{...input,expectedRevision:2,idempotencyKey:randomUUID()}),{code:'STATE_CONFLICT'});
 admin=false;
 await assert.rejects(repo.taskDelete(client,app,input),{code:'NOT_AUTHORIZED'});
});
test('work history pages preserve all participant and task revisions',async()=>{
 const org=randomUUID(),app=randomUUID(),actor={id:randomUUID()};
 const rows=Array.from({length:53},(_,i)=>({revision:i+2,kind:'TASK_COMPLETED',task_id:randomUUID(),title:`Tarefa ${i+1}`,responsible_membership_id:randomUUID(),deadline:'2027-01-30',status:'COMPLETED',actor_subject_id:actor.id,recorded_at:new Date()}));
 const repository=createWorkRepository({organizationId:org,actor,protect:async()=>{},verifyResponsible:async()=>true,audit:async()=>{},cursor:{cursor:value=>String(value),openCursor:value=>Number(value)}});
 const client={query:async(sql,params)=>({rows:sql.includes('FROM opportunity_catalog.application_work_change')?rows.filter(row=>params[2]===null||row.revision<params[2]).reverse().slice(0,26):[{opportunity_id:randomUUID(),evaluation_id:null}]})};
 const revisions=[];let pointer=null;
 do{const page=await repository.workHistory(client,app,{cursor:pointer});revisions.push(...page.items.map(item=>item.revision));pointer=page.nextCursor}while(pointer);
 assert.deepEqual(revisions,Array.from({length:53},(_,i)=>54-i));
});

for(const allowed of [true,false])test('work projection uses specific current edit authority: '+allowed,async()=>{
 const org=randomUUID(),app=randomUUID(),checks=[];
 const repo=createWorkRepository({organizationId:org,actor:{id:randomUUID()},protect:async()=>{},authorize:async(op,r)=>{checks.push(op);assert.equal(r.id,app);assert.equal(r.organizationId,org);return allowed},cursor:{}});
 const client={query:async sql=>({rows:sql.startsWith('SELECT * FROM opportunity_catalog.application WHERE')?[{opportunity_id:randomUUID()}]:[]})};
 assert.equal((await repo.workGet(client,app,{})).canEdit,allowed);assert.deepEqual(checks,['APPLICATION_WORK_EDIT']);
});

test('work exposes only the authenticated actor membership for personal task filtering',async()=>{
 const membershipId=randomUUID(),userId=randomUUID(),app=randomUUID();
 const repo=createWorkRepository({organizationId:randomUUID(),actor:{id:userId,membershipId},protect:async()=>{},cursor:{}});
 const client={query:async sql=>({rows:sql.startsWith('SELECT * FROM opportunity_catalog.application WHERE')?[{}]:[]})};
 const result=await repo.workGet(client,app,{});
 assert.equal(result.currentMembershipId,membershipId);
 assert.notEqual(result.currentMembershipId,userId);
});

test('task filter input rejects unknown filters and client supplied personal identity',()=>{
 assert.equal(parse('workGet',{}).taskFilter,'all');
 for(const taskFilter of ['all','mine','open','unassigned'])assert.equal(parse('workGet',{taskFilter}).taskFilter,taskFilter);
 for(const value of [{taskFilter:'anything'},{taskFilter:['mine']},{taskFilter:'mine',membershipId:randomUUID()}])assert.throws(()=>parse('workGet',value));
});
test('personal filtering precedes pagination and binds the cursor to the filter and actor',async()=>{
 const org=randomUUID(),app=randomUUID(),actor={id:randomUUID(),membershipId:randomUUID()},other=randomUUID();
 const rows=Array.from({length:80},(_,i)=>({task_id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,title:'Task '+i,responsible_membership_id:i<30?other:actor.membershipId,deadline:'2026-11-30',status:'OPEN',created_at:new Date(),updated_at:new Date()}));
 const cursor={cursor:(value,bind)=>JSON.stringify({value,bind}),openCursor:(token,bind)=>{const parsed=JSON.parse(token);assert.deepEqual(parsed.bind,bind);return parsed.value}};
 const repo=createWorkRepository({organizationId:org,actor,protect:async()=>{},verifyResponsible:async()=>true,cursor});
 const client={query:async(sql,params)=>{
  if(sql.includes('FROM opportunity_catalog.application_task')){
   assert.equal(params[0],org);assert.equal(params[1],app);
   const personal=sql.includes('responsible_membership_id=$4::uuid');
   if(personal){assert.equal(params[3],actor.membershipId);assert(sql.indexOf('responsible_membership_id=$4')<sql.indexOf('LIMIT 26'))}
   return {rows:rows.filter(r=>(!params[2]||r.task_id>params[2])&&(!personal||r.responsible_membership_id===params[3])).slice(0,26)};
  }
  return {rows:sql.startsWith('SELECT * FROM opportunity_catalog.application WHERE')?[{}]:[]};
 }};
 const first=await repo.workGet(client,app,{taskFilter:'mine'});
 assert.equal(first.tasks[0].title,'Task 30');assert.equal(first.tasks.length,25);
 const next=await repo.workGet(client,app,{taskFilter:'mine',taskCursor:first.taskNextCursor});assert.equal(next.tasks[0].title,'Task 55');
 await assert.rejects(repo.workGet(client,app,{taskFilter:'open',taskCursor:first.taskNextCursor}));
 await assert.rejects(repo.workGet(client,app,{taskFilter:'all',taskCursor:first.taskNextCursor}));
});
