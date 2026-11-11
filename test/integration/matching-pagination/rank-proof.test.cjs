'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createProof,compare}=require('./rank-proof.cjs');
const context={organizationId:randomUUID(),subjectId:randomUUID(),sessionId:randomUUID(),query:'synthetic'};
const records=Array.from({length:1501},(_,i)=>({id:String(i%900).padStart(4,'0'),origin:i<900?'CENTRAL':'PRIVATE',score:i%4,deadline:i%5?'2027-01-01':'9999',match:i%7!==0}));
const source=data=>async function*(){for(const item of data)yield item;};
test('bounded selection over more than 1000 records equals globally sorted complete reference',async()=>{
 const query=createProof({key:'synthetic-key-'.repeat(4)}),expected=records.filter(x=>x.match).sort(compare),actual=[];let cursor=null;
 do{const page=await query({source:source(records),context,cursor,pageSize:100});assert.equal(page.total,expected.length);actual.push(...page.items);cursor=page.nextCursor;}while(cursor);
 assert.deepEqual(actual,expected);assert(expected.length>1000);
});
test('continuation refuses mutations, changed organization and altered token',async()=>{
 const query=createProof({key:'synthetic-key-'.repeat(4)}),first=await query({source:source(records),context,pageSize:25});assert(first.nextCursor);
 const changed=structuredClone(records);changed[1400].score=99;
 await assert.rejects(query({source:source(changed),context,cursor:first.nextCursor}),{code:'INVALID_CURSOR'});
 await assert.rejects(query({source:source(records),context:{...context,organizationId:randomUUID()},cursor:first.nextCursor}),{code:'INVALID_CURSOR'});
 await assert.rejects(query({source:source(records),context,cursor:first.nextCursor+'x'}),{code:'INVALID_CURSOR'});
});
test('a rescan without a stable snapshot cannot detect a mutation behind the current iterator',async()=>{
 const data=[{id:'a',origin:'CENTRAL',score:10,deadline:'2027',match:true},{id:'b',origin:'CENTRAL',score:1,deadline:'2027',match:true}];
 const unstable=async function*(){yield structuredClone(data[0]);data[0].score=0;yield structuredClone(data[1]);};
 const query=createProof({key:'synthetic-key-'.repeat(4)}),page=await query({source:unstable,context,pageSize:2});
 assert.equal(page.items[0].id,'a');assert.equal(data[0].score,0);
 // The returned ordering reflects a value that was already changed before completion.
 assert.equal([...data].sort(compare)[0].id,'b');
});
test('an immutable synthetic snapshot gives a consistent ordering despite source mutation',async()=>{
 const data=[{id:'a',origin:'CENTRAL',score:10,deadline:'2027',match:true},{id:'b',origin:'PRIVATE',score:1,deadline:'2027',match:true}];
 const snapshot=structuredClone(data),stable=async function*(){yield structuredClone(snapshot[0]);data[0].score=0;yield structuredClone(snapshot[1]);};
 const query=createProof({key:'synthetic-key-'.repeat(4)}),page=await query({source:stable,context,pageSize:2});
 assert.deepEqual(page.items,snapshot.sort(compare));assert.equal(data[0].score,0);
});
