'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {summarize,percentile}=require('../../test/integration/catalog-acceptance/durable-load.cjs');
test('load acceptance excludes missing timing and malformed successful bodies instead of turning them into successes',()=>{
 const samples=[{status:200,serverMs:10,httpMs:12,contractValid:true},{status:200,serverMs:null,httpMs:12,contractValid:true},{status:200,serverMs:10,httpMs:12,contractValid:false},{status:503,serverMs:1,httpMs:2,contractValid:false}];
 assert.deepEqual(summarize(samples),{attempts:4,successes:1,errors:3,serverP95Ms:10,httpP95Ms:12});
 assert.equal(percentile([1,2,3,4,5,6,7,8,9,510],.95),510);
});
test('successful measured series cannot hide a warmup failure',async()=>{
 const {runLoad}=require('../../test/integration/catalog-acceptance/durable-load.cjs');let calls=0;const report={};
 const http=async(_admin,route)=>{calls++;const detail=route.includes('/opportunities/');return {status:calls===3?503:200,serverMs:10,httpMs:12,data:{meta:{contractVersion:'gcni-catalog-read/1.0',snapshot:'test-only'},data:detail?{summary:{id:'test-id'}}:Array.from({length:25},()=>({id:'test-id'}))}};};
 const result=await runLoad({catalog:{seed:async count=>({count,storedPayloadBytes:1,seedMs:1})},http,admin:{},renew:async()=>{},report,save(){}});
 assert.equal(calls,242);assert.equal(result.status,'NOT_ACCEPTED');assert.equal(result.scenarios[0].accepted,false);
 assert(result.scenarios.every(s=>s.runs.every(r=>r.errors===0)));assert(result.scenarios.slice(1).every(s=>s.accepted));
});
