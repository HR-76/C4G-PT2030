'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {command,query,NEXT}=require('../src/applications/contracts');
const {createApplicationRepository,project}=require('../src/applications/repository');
test('a civil deadline keeps the PostgreSQL day during summer time',()=>{
 const row={deadline:new Date(2026,6,1),created_at:new Date(),updated_at:new Date(),revision:1};
 assert.equal(project(row).deadline,'2026-07-01');
});
test('application command accepts an exact optional evaluation and rejects caller authority',()=>{
 const base={opportunityId:randomUUID(),evaluationId:null,title:'Candidatura',responsibleMembershipId:randomUUID(),deadline:'2026-12-31',idempotencyKey:randomUUID()};
 assert.equal(command('create',base).evaluationId,null);
 assert.equal(command('create',{...base,evaluationId:randomUUID()}).title,'Candidatura');
 for(const input of [{...base,organizationId:randomUUID()},{...base,title:' Candidatura'},{...base,deadline:'2026-02-30'},{...base,deadline:null}])assert.throws(()=>command('create',input),{code:'INVALID_INPUT'});
 assert.deepEqual(query('list',{opportunityId:base.opportunityId}),{cursor:null,opportunityId:base.opportunityId});
 assert.throws(()=>query('list',{organizationId:randomUUID()}),{code:'INVALID_INPUT'});
});
test('approved pilot transitions allow open-stage corrections and preserve terminal boundaries',()=>{
 assert.equal(NEXT.INTENTION,undefined);
 assert.deepEqual(NEXT.IDENTIFIED,['PREPARATION','SUBMITTED','CANCELLED','ARCHIVED']);
 assert.deepEqual(NEXT.PREPARATION,['IDENTIFIED','SUBMITTED','CANCELLED','ARCHIVED']);
 assert.deepEqual(NEXT.APPROVED,['ARCHIVED']);assert.deepEqual(NEXT.REJECTED,['ARCHIVED']);
 assert.deepEqual(NEXT.CANCELLED,[]);assert.deepEqual(NEXT.ARCHIVED,[]);
 assert.equal(command('transition',{status:'SUBMITTED',reason:'Teste',expectedRevision:1,idempotencyKey:randomUUID()}).status,'SUBMITTED');
});
test('application edit and transition reject non-positive expected revisions',()=>{
 const base={expectedRevision:1,idempotencyKey:randomUUID()};
 const edit={...base,title:'Candidatura',responsibleMembershipId:randomUUID(),deadline:'2026-12-31'};
 const transition={...base,status:'SUBMITTED',reason:'Teste'};
 for(const value of [0,-1]){
  assert.throws(()=>command('edit',{...edit,expectedRevision:value}),{code:'INVALID_INPUT'});
  assert.throws(()=>command('transition',{...transition,expectedRevision:value}),{code:'INVALID_INPUT'});
 }
});
test('new fields preserve absent keys for old receipt digests and validate exact decimal EUR',()=>{
 const base={title:'Candidatura',responsibleMembershipId:randomUUID(),deadline:'2026-12-31',expectedRevision:1,idempotencyKey:randomUUID()};
 assert.deepEqual(command('edit',base),base);
 for(const totalBudget of [null,'0','0.00','123.45','99999999999999.99'])assert.equal(command('edit',{...base,totalBudget}).totalBudget,totalBudget);
 for(const totalBudget of [0,1.1,'-1','01','1.001','1e3','1,50','100000000000000','NaN','Infinity',''])assert.throws(()=>command('edit',{...base,totalBudget}),{code:'INVALID_INPUT'});
 assert.throws(()=>command('edit',{...base,notes:'a'.repeat(10001)}),{code:'INVALID_INPUT'});
 assert.equal(command('edit',{...base,notes:'a'.repeat(10000)}).notes.length,10000);
 assert.throws(()=>command('edit',null),{code:'INVALID_INPUT'});
});
test('application list keyset preserves the last included row across hidden resources',async()=>{
 const org=randomUUID(),actor={id:randomUUID()},rows=Array.from({length:55},(_,i)=>({organization_id:org,application_id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,opportunity_id:randomUUID(),evaluation_id:null,title:`C ${i}`,responsible_membership_id:randomUUID(),deadline:null,status:'INTENTION',revision:1,created_at:new Date(),updated_at:new Date()}));
 const cursor={cursor:(position)=>position,openCursor:value=>value};
 const repository=createApplicationRepository({organizationId:org,actor,cursor,audit:()=>{},verifyResponsible:()=>true,protect:()=>{},authorize:async(op,target)=>target.id!==rows[5].application_id&&target.id!==rows[28].application_id});
 const client={query:async(sql,params)=>({rows:rows.filter(row=>!params[1]||row.application_id>params[1]).slice(0,100)})};
 const first=await repository.list(client,{cursor:null,opportunityId:null});
 const second=await repository.list(client,{cursor:first.nextCursor,opportunityId:null});
 const third=await repository.list(client,{cursor:second.nextCursor,opportunityId:null});
 assert.equal(first.items.length,25);assert.equal(first.nextCursor,first.items.at(-1).applicationId);
 assert.equal(second.items.length,25);assert.equal(third.items.length,3);assert.equal(third.nextCursor,null);
 assert.equal(new Set([...first.items,...second.items,...third.items].map(item=>item.applicationId)).size,53);
});
test('application history keeps every old revision across keyset pages',async()=>{
 const org=randomUUID(),id=randomUUID(),opp=randomUUID(),actor={id:randomUUID()};
 const changes=Array.from({length:53},(_,i)=>({revision:i+1,kind:i?'EDIT':'CREATE',from_status:'INTENTION',to_status:'INTENTION',
  title:`Revisão ${i+1}`,responsible_membership_id:randomUUID(),deadline:'2026-12-31',reason:null,actor_subject_id:actor.id,recorded_at:new Date()}));
 const repository=createApplicationRepository({organizationId:org,actor,protect:()=>{},authorize:()=>true,verifyResponsible:()=>true,audit:()=>{},
  cursor:{cursor:value=>String(value),openCursor:value=>Number(value)}});
 const client={query:async(sql,params)=>({rows:sql.includes('FROM opportunity_catalog.application_change WHERE')?changes.filter(row=>params[2]===null||row.revision<params[2]).reverse().slice(0,26)
  :[{application_id:id,opportunity_id:opp,evaluation_id:null}]})};
 const found=[];let pointer=null;
 do{const page=await repository.history(client,id,{cursor:pointer});found.push(...page.items.map(item=>item.revision));pointer=page.nextCursor}while(pointer);
 assert.deepEqual(found,Array.from({length:53},(_,i)=>53-i));
});
