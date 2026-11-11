'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parse}=require('../src/organizationDirectory/contracts');
const {areas}=require('../src/organizationDirectory/thematicAreas');
const {createDirectoryRepository}=require('../src/organizationDirectory/repository');
test('people filter accepts only existing thematic areas',()=>{
 assert.equal(parse('people',{areaId:areas[0].id}).areaId,areas[0].id);
 for(const areaId of ['unknown','00000000-0000-4000-8000-000000000099',['x']])assert.throws(()=>parse('people',{areaId}),{code:'INVALID_INPUT'});
});
test('area filter is tenant-bound and applied before pagination; cursor cannot change area',async()=>{
 const org='00000000-0000-4000-8000-000000000001',calls=[],bindings=[];
 const repository=createDirectoryRepository({organizationId:org,actor:{id:org},protect:async()=>{},tokens:{cursor:(id,bind)=>{bindings.push(bind);return 'cursor'},openCursor:(_cursor,bind)=>{assert.deepEqual(bind,bindings[0]);return org}}});
 const client={query:async(sql,values)=>{calls.push({sql,values});return {rows:Array.from({length:26},(_,i)=>({person_id:org,name:'Person',revision:1}))}}};
 const input=parse('people',{areaId:areas[0].id,search:'Ana',status:'ACTIVE'});
 const result=await repository.people(client,input);
 assert.equal(result.items.length,25);assert.deepEqual(result.areas,areas);
 assert.equal(calls[0].values[5],areas[0].id);
 assert.match(calls[0].sql,/pp.organization_id=p.organization_id AND pp.person_id=p.person_id/);
 assert(calls[0].sql.indexOf('$6::uuid')<calls[0].sql.indexOf('LIMIT 26'));
 assert.equal(bindings[0].areaId,areas[0].id);
 await repository.people(client,{...input,cursor:'cursor'});
 await assert.rejects(repository.people(client,{...input,areaId:areas[1].id,cursor:'cursor'}));
});
test('interest and competence are filtered independently and both bind the cursor',async()=>{
 const org='00000000-0000-4000-8000-000000000001',queries=[];
 const {createPq1UiTokens}=require('../src/organizationalProfile/pq1UiTokens');
 const tokens=createPq1UiTokens({keys:{test:'x'.repeat(32)},currentKeyId:'test'});
 const repository=createDirectoryRepository({organizationId:org,actor:{id:org},protect:async()=>{},tokens,supportsStrategy:true});
 const competence=areas[0].id,interest=areas[1].id;
 const input=parse('people',{areaId:competence,interestAreaId:interest});
 const client={async query(sql,values){
  queries.push({sql,values});return {rows:Array.from({length:26},()=>({person_id:org,area_ids:[competence],interest_area_ids:[interest],revision:1}))};
 }};
 const result=await repository.people(client,input);
 assert.deepEqual(result.items[0].areaIds,[competence]);
 assert.deepEqual(result.items[0].interestAreaIds,[interest]);
 assert.deepEqual(queries[0].values.slice(5),[competence,interest]);
 assert.match(queries[0].sql,/ANY\(pp\.interest_area_ids\)[\s\S]+LIMIT 26/);
 await assert.rejects(repository.people(client,{...input,interestAreaId:areas[2].id,cursor:result.nextCursor}),{code:'INVALID_CURSOR'});
 assert.equal(queries.length,1);
 assert.throws(()=>parse('people',{interestAreaId:'unknown'}),{code:'INVALID_INPUT'});
});
test('signed cursors reject changed area, organization and actor before SQL',async()=>{
 const {createPq1UiTokens}=require('../src/organizationalProfile/pq1UiTokens');
 const tokens=createPq1UiTokens({keys:{test:'x'.repeat(32)},currentKeyId:'test'});
 const org='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
 let queries=0;
 const client={query:async()=>{queries++;return {rows:Array.from({length:26},()=>({person_id:org,revision:1}))}}};
 const make=(organizationId=org,subjectId=org)=>createDirectoryRepository({organizationId,actor:{id:subjectId},protect:async()=>{},tokens});
 const input=parse('people',{areaId:areas[0].id}),first=await make().people(client,input);
 await make().people(client,{...input,cursor:first.nextCursor});
 for(const [repository,query] of [[make(),{...input,areaId:areas[1].id}],[make(other),input],[make(org,other),input]]){
  const before=queries;
  await assert.rejects(repository.people(client,{...query,cursor:first.nextCursor}),{code:'INVALID_CURSOR'});
  assert.equal(queries,before);
 }
 const denied=createDirectoryRepository({organizationId:org,actor:{id:org},tokens,protect:async()=>{throw Object.assign(Error(),{code:'FORBIDDEN'})}});
 const before=queries;await assert.rejects(denied.people(client,input),{code:'FORBIDDEN'});assert.equal(queries,before);
});
