'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {install}=require('./integration/eu-writer-performance/instrumentation.cjs');
test('query observation preserves promise identity, callback receiver and sync errors; close restores prototypes',async()=>{
 const promise=Promise.resolve({rows:[]}),failure=new Error('controlled');let callbackThis;
 class Client{constructor(){this.connectionParameters={user:'fixture',database:'fixture'};}query(sql,callback){if(sql==='throw')throw failure;if(callback){callback.call(this,null,{rows:[]});return 17;}return promise;}}
 class Pool{connect(){throw Error('unused');}}
 const original=Client.prototype.query,client=new Client(),metrics=install({pg:{Client,Pool},load:()=>({})});
 const record=metrics.begin('r');
 metrics.withRecord(record,()=>{assert.equal(client.query('SELECT 1'),promise);assert.equal(client.query('SELECT 2',function(){callbackThis=this;}),17);assert.throws(()=>client.query('throw'),error=>error===failure);});
 await promise;await Promise.resolve();
 assert.equal(callbackThis,client);assert.equal(record.queryCount,3);assert.equal(record.queryEvents.length,3);assert.equal(record.sqlErrors.length,1);
 assert(record.queryEvents.every(event=>Number.isFinite(event.endMs)));assert.equal(JSON.stringify(record).includes('SELECT 1'),false);
 await metrics.close();assert.equal(Client.prototype.query,original);
});
test('overlapping requests retain independent records through deferred completion',async()=>{
 const callbacks=[];class Client{query(sql,cb){callbacks.push(cb);}}
 class Pool{connect(){throw Error('unused');}}
 const metrics=install({pg:{Client,Pool},load:()=>({})}),a=metrics.begin('a'),b=metrics.begin('b'),client=new Client();
 metrics.withRecord(a,()=>client.query('A',()=>{}));metrics.withRecord(b,()=>client.query('B',()=>{}));callbacks[1](null,{});callbacks[0](null,{});
 assert.equal(a.queryCount,1);assert.equal(b.queryCount,1);assert.notEqual(a.queryEvents[0].hash,b.queryEvents[0].hash);await metrics.close();
});

test('the current tenant metadata capability is included in metadata time',()=>{
 const {category}=require('./integration/eu-writer-performance/instrumentation.cjs');
 assert.equal(category('SELECT c4g_system.runtime_metadata_v1($1::uuid,$2::uuid) AS metadata'),'metadata');
});
test('drain waits for credential disposal and refuses cleanup failures',async()=>{
 class Client{query(){return Promise.resolve({rows:[]});}}class Pool{connect(){throw Error('unused');}}
 const metrics=install({pg:{Client,Pool},load:()=>({})});let polls=0;
 metrics.managers.push({snapshot:()=>({active:0,queued:0,credentialDisposalsPending:polls++<2?1:0,credentialCleanupFailures:0,credentialCleanupTimeouts:0,cleanupFailures:0})});
 try{await metrics.drain(1000);assert(polls>=3);metrics.managers.push({snapshot:()=>({active:0,queued:0,credentialCleanupFailures:1})});await assert.rejects(metrics.drain(100),error=>error.code==='DRAIN_CLEANUP_FAILED');}finally{await metrics.close();}
});
