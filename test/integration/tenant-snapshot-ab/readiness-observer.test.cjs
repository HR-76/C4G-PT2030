'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {observeReadiness,snapshotReadiness}=require('./readiness-observer.cjs');
const hash='a'.repeat(64);
function metrics(){return {tag:'private-tag',phase:'functional',start:100,responseAt:110,queryCount:1,transactionCount:1,pendingQueries:0,
 queryEvents:[{hash,role:'tenant',category:'metadata',startMs:0,endMs:8,afterResponse:false}],
 checkouts:[{startMs:0,waitMs:1,holdMs:8,max:4,role:'tenant'}],admissions:[{ms:1,before:{active:0,queued:0,pools:1,tenants:1,circuitsOpen:0,credentialDisposalsPending:0,credentialCleanupTimeouts:0,credentialCleanupFailures:0,cleanupFailures:0},after:{active:1,queued:0}}],
 spans:[{name:'observeTenantRuntimeMetadata',startMs:1,endMs:8}],sqlErrors:[],failures:[],lockEvents:[{kind:'authority-held',startMs:2,endMs:3}]};}
function harness(result){
 const calls=[],clients=[{secret:'cookie-client'}],http={origin:'https://localhost:12345',clients,
  request(...args){assert.equal(this,http);calls.push(['request',args]);return Promise.resolve(result);},
  anonymousRequest(...args){assert.equal(this,http);calls.push(['anonymousRequest',args]);return Promise.resolve(result);},
  drain(...args){assert.equal(this,http);calls.push(['drain',args]);return Promise.resolve(7);},
  close(...args){assert.equal(this,http);calls.push(['close',args]);return clients;}};
 return {http,calls,clients};
}
test('forward exact arguments, original this, promise identity and returned objects without retries',async()=>{
 const result={status:200,ms:10,data:{total:1000},metrics:metrics()},x=harness(result),report={},progress=[];
 const source=x.http.request,opts={headers:{Authorization:'secret-header'}};let originalPromise;
 x.http.request=function(...args){originalPromise=source.apply(this,args);return originalPromise;};
 const observed=observeReadiness(Object.freeze(x.http),{report,onProgress:e=>progress.push(e)}),promise=observed.request(1,'report',opts,'extra');
 assert.equal(promise,originalPromise);assert.equal(await promise,result);assert.equal(observed.clients,x.clients);assert.equal(observed.origin,x.http.origin);
 assert.equal(await observed.anonymousRequest('private',opts),result);assert.equal(await observed.drain(30000,'extra'),7);assert.equal(observed.close('exact'),x.clients);
 assert.deepEqual(x.calls.map(x=>x[0]),['request','anonymousRequest','drain','close']);assert.deepEqual(x.calls[0][1],[1,'report',opts,'extra']);assert.equal(x.calls[0][1][2],opts);
 const r=snapshotReadiness(report);assert.equal(r.attempts.length,2);assert.equal(r.drains.length,1);assert.deepEqual(progress,[{event:'attempt',index:0},{event:'attempt',index:1},{event:'drain',index:0}]);
 assert.equal(r.attempts[0].tenant,1);assert.equal(r.attempts[1].tenant,null);assert.equal(r.attempts[1].anonymous,true);
});
for(const failure of ['http503','functional200','metrics'])test('capture precedes downstream readiness assertion: '+failure,async()=>{
 const result={status:failure==='http503'?503:200,ms:20,data:failure==='http503'?{error:{code:'SERVICE_UNAVAILABLE'}}:{total:failure==='functional200'?999:1000},metrics:metrics()};
 if(failure==='metrics')result.metrics.pendingQueries=1;
 const x=harness(result),report={},observed=observeReadiness(x.http,{report,onProgress(){assert.equal(report.httpReadinessObserved.attempts.length,1);}});
 const action=async()=>{const r=await observed.request(1,'dashboard');assert.equal(r.status,200);assert.equal(r.data.total,1000);await observed.drain(30000);assert.equal(r.metrics.pendingQueries,0);};
 await assert.rejects(action,{code:'ERR_ASSERTION'});
 const record=snapshotReadiness(report);assert.equal(record.attempts.length,1);assert.equal(record.attempts[0].resolved,true);assert.equal(record.attempts[0].status,result.status);assert.equal(record.attempts[0].metrics.queryCount,1);assert.equal(x.calls.filter(c=>c[0]==='request').length,1);
 if(failure==='http503')assert.equal(record.attempts[0].code,'SERVICE_UNAVAILABLE');
});
test('synchronous and asynchronous errors are rethrown unchanged and record no message or stack',async()=>{
 for(const asynchronous of [false,true]){
  const error=Object.assign(Error('secret-message-token'),{code:'HTTP_TRANSPORT_FAILURE',stack:'secret-stack'}),x=harness(null),report={};
  x.http.request=function(...args){assert.equal(this,x.http);x.calls.push(['request',args]);if(asynchronous)return Promise.reject(error);throw error;};
  const observed=observeReadiness(x.http,{report});
  if(asynchronous)await assert.rejects(observed.request(0,'report'),e=>e===error);else assert.throws(()=>observed.request(0,'report'),e=>e===error);
  const r=snapshotReadiness(report);assert.equal(r.attempts[0].resolved,false);assert.equal(r.attempts[0].code,'HTTP_TRANSPORT_FAILURE');assert.equal(r.attempts[0].status,null);
  assert(!JSON.stringify(report).includes('secret'));assert.equal(x.calls.length,1);
 }
});
test('raw metric references remain live until serialization after drain, without exposing the reference',async()=>{
 const m=metrics(),result={status:200,ms:10,data:{},metrics:m},x=harness(result),report={};m.pendingQueries=1;m.queryEvents[0].endMs=null;m.checkouts[0].holdMs=null;
 x.http.drain=function(...args){assert.equal(this,x.http);x.calls.push(['drain',args]);m.pendingQueries=0;m.queryEvents[0].endMs=12;m.queryEvents[0].afterResponse=true;m.checkouts[0].holdMs=12;m.spans[0].endMs=12;m.failures.push({code:'LEASE_TIMEOUT'});return Promise.resolve(3);};
 const observed=observeReadiness(x.http,{report});assert.equal(await observed.request(0,'report'),result);
 const before=snapshotReadiness(report);assert.equal(before.attempts[0].metrics.pendingQueries,1);assert.notEqual(before.attempts[0].metrics,m);
 await observed.drain(30000);const after=JSON.parse(JSON.stringify(report)).httpReadinessObserved;
 assert.equal(after.attempts[0].metrics.pendingQueries,0);assert.equal(after.attempts[0].metrics.queryEvents[0].endMs,12);assert.equal(after.attempts[0].metrics.queryEvents[0].afterResponse,true);assert.equal(after.attempts[0].metrics.checkouts[0].holdMs,12);assert.deepEqual(after.attempts[0].metrics.failures,[{code:'LEASE_TIMEOUT'}]);assert.equal(before.attempts[0].metrics.pendingQueries,1);
});
test('closed projections exclude payloads, tokens, URLs, cursors, organization IDs and arbitrary metric fields',async()=>{
 const secret='sensitive-unique-value',m=metrics();Object.assign(m,{sql:'SELECT '+secret,url:'https://'+secret,organizationId:secret});
 Object.assign(m.queryEvents[0],{text:secret,params:[secret],role:secret,category:secret});Object.assign(m.checkouts[0],{connectionString:secret,error:secret});
 Object.assign(m.admissions[0].before,{credentials:secret});m.spans.push({name:secret,startMs:0,endMs:1});m.sqlErrors.push({code:secret,hash:secret,message:secret});m.failures.push({code:secret,stack:secret});m.lockEvents.push({kind:secret,startMs:0,endMs:1});
 const response={status:503,ms:5,tag:secret,data:{error:{code:secret,message:secret},access_token:secret,organizationId:secret,cursor:secret},metrics:m},x=harness(response),report={},observed=observeReadiness(x.http,{report});
 for(const route of ['/api/applications/report?cursor='+secret,'/api/opportunities/'+secret,'/api/organizations/'+secret+'/dashboard/summary','https://'+secret,'/unknown/'+secret])await observed.request(0,route,{expectedOrganization:secret,headers:{Cookie:secret},body:{token:secret}});
 await observed.anonymousRequest('report',{headers:{Authorization:secret}});
 const serialized=JSON.stringify(report);assert(!serialized.includes(secret));assert(!serialized.includes('SELECT '));assert(!serialized.includes('https://'));assert(!serialized.includes('private-tag'));
 assert.deepEqual(snapshotReadiness(report).attempts.slice(0,5).map(x=>x.kind),['report-cursor','private-item','dashboard','unknown','unknown']);assert.equal(snapshotReadiness(report).attempts[0].code,null);
});
test('17 readiness calls and nine drains are retained, and later attempts are never silently capped',async()=>{
 const x=harness({status:200,ms:1,data:{},metrics:metrics()}),report={},observed=observeReadiness(x.http,{report});
 for(let index=0;index<14;index++)await observed.request(index%2,index%3?'report':'dashboard');for(let index=0;index<3;index++)await observed.anonymousRequest('private');for(let index=0;index<9;index++)await observed.drain(30000);
 let r=snapshotReadiness(report);assert.equal(r.attempts.length,17);assert.equal(r.drains.length,9);assert(r.attempts.every(x=>x.resolved));assert.equal(r.attempts.filter(x=>x.anonymous).length,3);
 await observed.request(0,'report');await observed.request(1,'report');r=snapshotReadiness(report);assert.equal(r.attempts.length,19);assert.deepEqual(r.attempts.map(x=>x.index),Array.from({length:19},(_,i)=>i));
});
test('diagnostic callback failure is visible but cannot replace the original result or rejection',async()=>{
 const response={status:200,ms:1,data:{}},x=harness(response),report={},error=Object.assign(Error('private-save-error'),{code:'EIO'});
 const observed=observeReadiness(x.http,{report,onProgress(){throw error;}});assert.equal(await observed.request(0,'report'),response);assert.deepEqual(snapshotReadiness(report).observerErrors,[{code:'EIO'}]);
 x.http.request=function(){throw error;};assert.throws(()=>observed.request(0,'report'),e=>e===error);assert(!JSON.stringify(report).includes('private-save-error'));
});
test('drain errors preserve identity and partial evidence without adding retries',async()=>{
 const x=harness({status:503,ms:2,data:{error:{code:'SERVICE_UNAVAILABLE'}}}),report={},error=Object.assign(Error('sensitive'),{code:'DRAIN_TIMEOUT'});x.http.drain=function(...args){assert.equal(this,x.http);x.calls.push(['drain',args]);return Promise.reject(error);};
 const observed=observeReadiness(x.http,{report});await observed.request(1,'dashboard');await assert.rejects(observed.drain(30000),e=>e===error);const r=snapshotReadiness(report);assert.equal(r.attempts.length,1);assert.equal(r.drains.length,1);assert.equal(r.drains[0].resolved,false);assert.equal(r.drains[0].code,'DRAIN_TIMEOUT');assert.deepEqual(x.calls.map(x=>x[0]),['request','drain']);
});
test('unknown uppercase values are not a covert payload channel through any error-code field',async()=>{
 const secret='SECRET_TOKEN',m=metrics();m.failures.push({code:secret});m.sqlErrors.push({code:secret,hash});m.checkouts[0].error=secret;m.admissions[0].error=secret;
 const response={status:503,ms:1,code:secret,data:{error:{code:secret}},metrics:m},x=harness(response),report={};
 const observed=observeReadiness(x.http,{report,onProgress(){throw Object.assign(Error('private'),{code:secret});}});
 assert.equal(await observed.request(0,'report'),response);const error=Object.assign(Error('private'),{internalCode:secret,code:secret});x.http.request=()=>Promise.reject(error);await assert.rejects(observed.request(1,'dashboard'),e=>e===error);
 const r=snapshotReadiness(report);assert(!JSON.stringify(r).includes(secret));assert.equal(r.attempts[0].code,null);assert.equal(r.attempts[1].code,'OBSERVED_ERROR');assert.equal(r.attempts[0].metrics.failures[0].code,'OBSERVED_ERROR');assert(r.observerErrors.every(e=>e.code==='OBSERVED_ERROR'));
});
test('known operation and SQL timeout codes remain diagnosable without free-form text',async()=>{
 const m=metrics();m.failures=[{code:'LEASE_TIMEOUT'},{code:'OPERATION_ABORTED'}];m.sqlErrors=[{code:'57014',hash},{code:'P0001',hash}];
 const x=harness({status:503,ms:1,data:{error:{code:'SERVICE_UNAVAILABLE'}},metrics:m}),report={},observed=observeReadiness(x.http,{report});await observed.request(0,'dashboard');
 const r=snapshotReadiness(report).attempts[0];assert.equal(r.code,'SERVICE_UNAVAILABLE');assert.deepEqual(r.metrics.failures,m.failures);assert.deepEqual(r.metrics.sqlErrors,m.sqlErrors);
});
