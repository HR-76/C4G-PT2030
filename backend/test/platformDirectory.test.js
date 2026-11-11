'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {query,createPlatformDirectory}=require('../src/platformDirectory/service');
test('dashboard reports observed operational state and fails closed on missing telemetry',async()=>{
 const user='11111111-1111-4111-8111-111111111111', calls=[];
 const client={async query(sql){calls.push(sql);if(sql.includes('SELECT u.id FROM'))return {rowCount:1};if(sql.includes('SELECT now()'))return {rows:[{observedAt:'2026-01-01',entities:{total:1}}]};return {rows:[]}},release(){}};
 const pool={connect:async()=>client,totalCount:4,idleCount:1,waitingCount:2,options:{max:10}};
 const request={authContext:{sessionId:'session'},sessionID:'session',user:{id:user}};
 const service=createPlatformDirectory({pool,health:{check:async()=>({status:'DEGRADED',reasons:['DATABASE']})}});
 const result=await service.dashboard({},request);
 assert.deepEqual(result.operational,{dependencies:{status:'DEGRADED',reasons:['DATABASE']},capacity:{total:4,idle:1,waiting:2,max:10}});
 assert.equal(calls.filter(sql=>sql.includes('SELECT u.id FROM')).length,2);
 const unavailable=await createPlatformDirectory({pool:{connect:async()=>client},health:{check:async()=>{throw Error('private')}}}).dashboard({},request);
 assert.deepEqual(unavailable.operational,{dependencies:null,capacity:null});
});
const {createErrorHandler}=require('../src/app');
test('directory parser and unexpected errors never return bodies or development stacks',()=>{
 for(const [error,expected] of [[Object.assign(Error('private payload'),{type:'entity.parse.failed'}),400],[Object.assign(Error('private payload'),{type:'entity.too.large'}),413],[Error('private payload'),503]]){
  const response={setHeader(k,v){this[k]=v},status(value){this.statusCode=value;return this},json(value){this.body=value;return this}};
  createErrorHandler({nodeEnv:'development'})(error,{originalUrl:'/api/admin/directory/users'},response,()=>assert.fail('must handle'));
  assert.equal(response.statusCode,expected);assert.equal(response['Cache-Control'],'no-store');assert.deepEqual(response.body,{error:{code:expected===503?'SERVICE_UNAVAILABLE':'INVALID_INPUT'}});
 }
});
test('directory query admits only bounded filters and pagination',()=>{
 assert.deepEqual(query({q:' Ana ',page:'2'},'users'),{q:'Ana',status:'',page:2,organizationId:null});
 for(const input of [{page:'0'},{page:'1.2'},{page:'100000'},{page:2},{q:['a']},{q:'a'.repeat(151)},{q:'a\nb'},{status:'REMOVED'},{role:'C4G_ADMIN'},{organizationId:'bad'}])assert.throws(()=>query(input,'users'),e=>e.code==='INVALID_INPUT');
 assert.throws(()=>query({organizationId:'92b4d30a-d30d-48cd-9272-e3d54db63b0f'},'entities'),e=>e.code==='INVALID_INPUT');
});
test('untrusted request cannot acquire a Central connection',async()=>{
 const service=createPlatformDirectory({pool:{connect(){throw Error('MUST_NOT_CONNECT');}}});
 for(const request of [{},{sessionID:'x',authContext:{sessionId:'y'},user:{id:'92b4d30a-d30d-48cd-9272-e3d54db63b0f'}}])await assert.rejects(()=>service.entities({},request),e=>e.code==='C4G_ADMIN_REQUIRED');
});
