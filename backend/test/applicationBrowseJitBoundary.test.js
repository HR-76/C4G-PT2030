'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createSqlBrowse}=require('../src/applications/browseSql');
const {parse}=require('../src/applications/browse');
function setup(guarded){return createSqlBrowse({org:randomUUID(),actor:{id:randomUUID()},guarded,
 readAuthority:async()=>({teamOnly:false,membershipId:randomUUID(),application:{all:true,ids:[]},opportunity:{all:true,ids:[]},evaluation:{all:true,ids:[]}}),
 responsibleDirectory:async()=>new Map(),cursor:{},project:x=>x,transitionCapability:async()=>false});}
test('denied browse guard cannot change transaction settings or read SQL data',async()=>{
 let queries=0;const denied=Object.assign(new Error('denied'),{code:'NOT_AUTHORIZED'});
 const browse=setup(async()=>{throw denied;});
 await assert.rejects(browse({query:async()=>{queries++;assert.fail('SQL after denied guard');}},parse({})),{code:'NOT_AUTHORIZED'});
 assert.equal(queries,0);
});
test('failed transaction-local JIT setup does not read data or return a partial page',async()=>{
 const unavailable=Object.assign(new Error('fixture failure'),{code:'FIXTURE_UNAVAILABLE'}),queries=[];
 const browse=setup(async()=>{});
 await assert.rejects(browse({query:async(sql)=>{queries.push(sql);if(sql==='SET LOCAL jit = off')throw unavailable;return{rows:[{total:0,items:[],counts:{},fingerprint:'empty'}]};}},parse({})),{code:'FIXTURE_UNAVAILABLE'});
 assert.deepEqual(queries,['SET LOCAL jit = off']);
});
