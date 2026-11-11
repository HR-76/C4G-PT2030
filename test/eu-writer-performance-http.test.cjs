'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runHttpMatrix,percentile,normalizeResponse,unionMs}=require('./integration/eu-writer-performance/http.cjs');
const metrics=()=>({queryCount:1,pendingQueries:0,transactionCount:1,responseAt:1,lockEvents:[],queryEvents:[{startMs:0,endMs:1,role:'tenant',category:'metadata'}],checkouts:[{waitMs:0,holdMs:1}],admissions:[{ms:0,before:{active:0,queued:0},after:{active:1,queued:0}}],spans:[{name:'assertCentralSchema',startMs:0,endMs:1},{name:'observeTenantRuntimeMetadata',startMs:0,endMs:1}],sqlErrors:[],failures:[]});
test('H retains all 108 attempts, 21 warmups and three independent fixtures',async()=>{
 let fixtures=0,closed=0,calls=0;
 const result=await runHttpMatrix({createHarness:async()=>{fixtures++;return {async request(index,kind){calls++;return {status:200,data:{total:1000,tenant:index},ms:1,metrics:metrics()};},async drain(){return 0;},async close(){closed++;}};},validate:()=>true});
 assert.equal(fixtures,3);assert.equal(closed,3);assert.equal(calls,129);
 assert.equal(result.attempts.length,108);assert.equal(result.warmups.length,21);assert.equal(result.status,'PASS');
 assert.deepEqual(result.scenarios.map(s=>s.attempts),[4,4,8,4,8,8,4,4,8,4,8,8,4,4,8,4,8,8]);
});
test('H retains failures and refuses functional approval while closing each fixture',async()=>{
 let count=0,closed=0;
 const result=await runHttpMatrix({createHarness:async()=>({async request(){count++;return {status:count===2?503:200,data:{total:1000},ms:2};},async drain(){return 0;},async close(){closed++;}}),validate:()=>true});
 assert.equal(result.status,'FAIL');assert.equal(result.attempts.length,108);assert.equal(result.attempts.filter(x=>x.status===503).length,1);assert.equal(closed,3);
});
test('nearest-rank quantiles preserve precision, empty samples and overlapping durations',()=>{
 assert.equal(percentile([],0.95),null);assert.equal(percentile([1.0001,2.0002,3.0003],0.5),2.0002);
 assert.equal(unionMs([[0,4],[2,6],[8,9]]),7);assert.throws(()=>unionMs([[2,1]]));
});
test('successful HTTP without complete measurements cannot approve H',async()=>{
 const result=await runHttpMatrix({createHarness:async()=>({async request(){return {status:200,data:{total:1000},ms:1};},async drain(){return 0;},async close(){}}),validate:()=>true});
 assert.equal(result.status,'FAIL');assert(result.attempts.every(x=>x.instrumentationPass===false));
});
test('normalization excludes only declared volatile time fields and preserves business data',()=>{
 assert.deepEqual(normalizeResponse({total:10,asOf:'2026-01-01',items:[{name:'A',updatedAt:'v'}]}),{items:[{name:'A',updatedAt:'v'}],total:10});
});

test('a drain failure retains every completed HTTP attempt in the failure evidence',async()=>{
 let closed=0;
 await assert.rejects(runHttpMatrix({createHarness:async()=>({
  async request(){return {status:200,data:{total:1000},ms:1,metrics:metrics()};},
  async drain(){throw Object.assign(Error('DRAIN_TIMEOUT'),{code:'DRAIN_TIMEOUT'});},
  async close(){closed++;}
 }),validate:()=>true}),error=>{
  assert.equal(error.code,'DRAIN_TIMEOUT');
  assert.equal(error.httpReport.status,'FAIL');
  assert.equal(error.httpReport.attempts.length,4);
  assert.equal(error.httpReport.warmups.length,1);
  return true;
 });
 assert.equal(closed,1);
});

test('incomplete transaction, response, lock or lease evidence cannot be called complete',()=>{
 const {completeMetrics,metricSummary}=require('./integration/eu-writer-performance/http.cjs');
 const full={...metrics(),transactionCount:1,responseAt:10,lockEvents:[{kind:'authority-held',startMs:0,endMs:1}],
  admissions:[{ms:0,before:{active:0,queued:0},after:{active:1,queued:0}}]};
 for(const field of ['transactionCount','responseAt','lockEvents']){
  const partial={...full};delete partial[field];
  assert.equal(completeMetrics(partial),false,field);
  assert.equal(metricSummary(partial),null,field);
 }
 for(const field of ['before','after']){
  const partial=structuredClone(full);delete partial.admissions[0][field];
  assert.equal(completeMetrics(partial),false,'admission.'+field);
 }
});
test('H separates timeouts and503 and refuses normalized response drift',async()=>{
 let calls=0;const result=await runHttpMatrix({createHarness:async()=>({async request(){calls++;if(calls===2)throw Object.assign(Error('not persisted'),{name:'TimeoutError'});return {status:calls===3?503:200,data:{total:1000,changed:calls===4},ms:1,metrics:metrics()};},async drain(){return 0;},async close(){}}),validate:()=>true});
 assert.equal(result.status,'FAIL');assert.equal(result.scenarios[0].timeouts,1);assert.equal(result.scenarios[0].http503,1);
 assert.equal(result.attempts.find(x=>x.attempt===2).normalizedResponsePass,false);
});

function virtualScenario(durationMs){
 const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),vm=require('node:vm');
 const filename=require.resolve('./integration/eu-writer-performance/http.cjs'),localRequire=createRequire(filename),module={exports:{}};
 const protocol=structuredClone(require('../context/references/performance/eu-writer-v2-protocol.json'));
 protocol.http.scenarios=[protocol.http.scenarios[0]];
 const state={elapsed:0,phase:'',calls:0,drains:0};
 vm.runInThisContext('(function(require,module,exports,__filename,__dirname,performance){\n'+fs.readFileSync(filename,'utf8')+'\n})',{filename})(
  name=>name.endsWith('eu-writer-v2-protocol.json')?protocol:localRequire(name),module,module.exports,filename,path.dirname(filename),{now:()=>state.elapsed});
 const http={setPhase(value){state.phase=value;},async request(){state.calls++;if(!state.phase.endsWith('-warmup'))state.elapsed+=durationMs;return {status:200,data:{total:1000},ms:durationMs,metrics:metrics()};},async drain(){state.drains++;return 0;}};
 return {state,run:()=>module.exports.runHttpReplica({http,validate:()=>true})};
}

test('the last HTTP response cannot exceed the scenario budget and its attempt remains in evidence',async()=>{
 const f=virtualScenario(50000);
 await assert.rejects(f.run(),error=>{
  assert.equal(error.code,'CONTROL_DEADLINE_EXCEEDED');
  assert.equal(error.httpReport.status,'FAIL');
  assert.equal(error.httpReport.scenarios[0].status,'FAIL');
  assert.equal(error.httpReport.scenarios[0].controlElapsedMs,200000);
  assert.equal(error.httpReport.attempts.length,4);
  assert.equal(error.httpReport.attempts[3].attempt,3);
  assert.equal(error.httpReport.attempts[3].status,200);
  assert.equal(error.httpReport.attempts[3].ms,50000);
  assert.equal(error.httpReport.warmups.length,1);
  return true;
 });
 assert.equal(f.state.calls,5);assert.equal(f.state.drains,0);
});

test('a final response exactly at the scenario budget remains eligible',async()=>{
 const f=virtualScenario(45000),result=await f.run();
 assert.equal(result.status,'PASS');assert.equal(result.attempts.length,4);
 assert.equal(result.scenarios[0].controlElapsedMs,180000);assert.equal(f.state.drains,1);
});
