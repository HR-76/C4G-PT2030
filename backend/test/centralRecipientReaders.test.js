'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createAlertRecipientReader,createNoticeRecipientReader}=require('../src/applications/centralRecipientReaders');
test('alerts bind organization, skip empty lists and preserve result',async()=>{
 const org=randomUUID(),id=randomUUID(),exclude=randomUUID(),calls=[];const read=createAlertRecipientReader({organizationId:org,pool:{async query(sql,args){calls.push({sql,args});return {rows:[{id}]}}}});
 assert.deepEqual(await read([],exclude),[]);assert.equal(calls.length,0);assert.deepEqual(await read([id],exclude),[id]);assert.deepEqual(calls[0].args,[org,[id],exclude]);
});
test('notices bind organization and reject excess before presenting recipients',async()=>{
 const org=randomUUID(),id=randomUUID(),calls=[];let rows=[{id,display_name:'Pessoa'}];const read=createNoticeRecipientReader({organizationId:org,pool:{async query(sql,args){calls.push({sql,args});return {rows}}}});
 assert.deepEqual(await read(null),[{membershipId:id,name:'Pessoa'}]);assert.deepEqual(calls[0].args,[org,null]);rows=Array.from({length:1001},()=>({id,display_name:'x'}));await assert.rejects(read(null),{code:'LIMIT_EXCEEDED'});
});
