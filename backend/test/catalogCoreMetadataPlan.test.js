'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {catalogReaderSnapshot}=require('../src/security/catalogReaderSecurity');
test('reader metadata uses one fresh parameterized statement and preserves its exact snapshot',async()=>{
 const expected={roles:[],parents:[],tables:[],columns:[],database:[{public_temp:false}]};let calls=0;
 const client={query:async(sql,args)=>{calls++;assert.deepEqual(args,['c4g_catalog_reader']);return {rows:[{snapshot:expected}]};}};
 assert.equal(await catalogReaderSnapshot(client),expected);assert.equal(calls,1);
 assert.equal(await catalogReaderSnapshot(client),expected);assert.equal(calls,2);
});
test('database-local reader absence remains null without collecting role data',async()=>{
 let calls=0;assert.equal(await catalogReaderSnapshot({query:async()=>{calls++;return {rows:[{snapshot:null}]};}}),null);assert.equal(calls,1);
});
