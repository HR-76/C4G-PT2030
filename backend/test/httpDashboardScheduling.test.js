'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createOrganizationDashboardRouter,emptyMetrics}=require('../src/routes/organizationDashboardRoutes');
const {id}=require('./support/httpSqlFixture');

function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
async function checkpoint(gate,pending){
 await Promise.race([gate.entered.promise,pending.then(()=>{throw Error('Dashboard responded before the expected checkpoint.');})]);
}
function reportData(){const metrics=emptyMetrics();metrics.total=57;return{organizationId:id(1),today:'2026-10-27',metrics,
 states:{IDENTIFIED:metrics},unitMetrics:[],unitsAvailable:false,units:[],items:[],deadlines:[],deadlineTotal:0};}
const privateSummary={total:5,open:2,closing_soon:1,sources:[],recent:[]};
const publicSummary={total:9,open:3,closing_soon:2,sources:[],recent:[]};

async function harness(overrides={}){
 const app=express(),calls=[],settled=[],published=[],closed=deferred(),pass=(req,res,next)=>next();
 const defaults={tenant:()=>({report:reportData(),privateSummary}),central:()=>publicSummary};
 async function call(step,...args){calls.push(step);try{return await(overrides[step]||defaults[step])(...args);}finally{settled.push(step);}}
 app.use((req,res,next)=>{
  res.once('close',()=>closed.resolve());
  const json=res.json;
  res.json=function(body){published.push(body);return json.call(this,body);};
  next();
 });
 app.use('/organizations',createOrganizationDashboardRouter({express,authenticate:pass,
  organizationMiddleware:{requireServerSession:pass,requireOrganizationContext:pass,
   resolveOrganizationContext(req,res,next){req.organizationContext={organization:{id:id(1)}};next();}},
  applications:{execute(method,input,resourceId,req){
   assert.equal(resourceId,null);
   assert.equal(method,'dashboard');assert.deepEqual(input,{today:'2026-10-27',asOf:'2026-10-27T12:00:00.000Z'});return call('tenant',req);
  }},
  opportunities:{dashboardSummary(today,req){assert.equal(today,'2026-10-27');return call('private',req);}},
  central:{dashboardSummary(today){assert.equal(today,'2026-10-27');return call('central');}},
  clock:()=>new Date('2026-10-27T12:00:00.000Z')}));
 const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 return {calls,settled,published,closed,url:`http://127.0.0.1:${server.address().port}/organizations/${id(1)}/dashboard/summary`,
  async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

test('dashboard finishes each source before starting the next and retains final authority',async()=>{
 const steps=['central','tenant'];
 const gates=Object.fromEntries(steps.map(step=>[step,{entered:deferred(),release:deferred()}]));
 const values={central:publicSummary,tenant:{report:reportData(),privateSummary}};
 const fixture=await harness(Object.fromEntries(steps.map(step=>[step,async()=>{
  gates[step].entered.resolve();await gates[step].release.promise;return values[step];
 }])));
 let pending;
 try{
  pending=fetch(fixture.url,{signal:AbortSignal.timeout(5000)});
  for(let i=0;i<steps.length;i++){
   const step=steps[i];await checkpoint(gates[step],pending);
   assert.deepEqual(fixture.calls,steps.slice(0,i+1));
   gates[step].release.resolve();
  }
  const response=await pending;assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const body=await response.json();assert.deepEqual(body.report,values.tenant.report);assert.equal(body.applications.total,57);
  assert.deepEqual(body.opportunities,{total:14,open:5,closing_soon:3,planned:0,upcoming:0,closed:0,cancelled:0,unknown:0});assert.equal(body.unit_totals,null);
 }finally{for(const step of steps)gates[step].release.resolve();await pending?.catch(()=>{});await fixture.close();}
});

for(const step of ['central','tenant'])test(`disconnected dashboard during ${step} finishes that stage without starting later work or publishing`,{timeout:5000},async()=>{
 const steps=['central','tenant'],index=steps.indexOf(step),gate={entered:deferred(),release:deferred()};
 const values={central:publicSummary,tenant:{report:reportData(),privateSummary}};
 const fixture=await harness({[step]:async()=>{gate.entered.resolve();await gate.release.promise;return values[step];}});
 const controller=new AbortController();let pending;
 try{
  pending=fetch(fixture.url,{signal:controller.signal});
  await checkpoint(gate,pending);
  const rejected=assert.rejects(pending,{name:'AbortError'});
  controller.abort();await rejected;await fixture.closed.promise;
  // Disconnect does not settle/cancel the protected operation mid-transaction.
  assert.deepEqual(fixture.calls,steps.slice(0,index+1));
  assert.deepEqual(fixture.settled,steps.slice(0,index));
  gate.release.resolve();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(fixture.settled,steps.slice(0,index+1));
  assert.deepEqual(fixture.calls,steps.slice(0,index+1));
  assert.deepEqual(fixture.published,[]);
 }finally{gate.release.resolve();controller.abort();await pending?.catch(()=>{});await fixture.close();}
});

test('a protected stage failure after disconnect settles without attempting an error response',{timeout:5000},async()=>{
 const gate={entered:deferred(),release:deferred()};
 const fixture=await harness({tenant:async()=>{gate.entered.resolve();await gate.release.promise;throw Error('synthetic protected failure');}});
 const controller=new AbortController();let pending;
 try{
  pending=fetch(fixture.url,{signal:controller.signal});await checkpoint(gate,pending);
  const rejected=assert.rejects(pending,{name:'AbortError'});controller.abort();await rejected;await fixture.closed.promise;
  assert.deepEqual(fixture.settled,['central']);
  gate.release.resolve();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(fixture.settled,['central','tenant']);assert.deepEqual(fixture.calls,['central','tenant']);
  assert.deepEqual(fixture.published,[]);
 }finally{gate.release.resolve();controller.abort();await pending?.catch(()=>{});await fixture.close();}
});

for(const step of ['central','tenant'])test(`dashboard ${step} failure starts no later source and returns no partial totals`,async()=>{
 const fixture=await harness({[step]:async()=>{throw Error('internal source detail');}});
 try{
  const response=await fetch(fixture.url);assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:{code:'SERVICE_UNAVAILABLE'}});
  assert.deepEqual(fixture.calls,['central','tenant'].slice(0,['central','tenant'].indexOf(step)+1));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(fixture.calls.length,['central','tenant'].indexOf(step)+1);
 }finally{await fixture.close();}
});

test('dashboard final authority denial cannot publish previously collected summaries',async()=>{
 const fixture=await harness({tenant:async()=>{throw Object.assign(Error('authority changed'),{code:'NOT_AUTHORIZED'});}});
 try{
  const response=await fetch(fixture.url);assert.equal(response.status,403);
  assert.deepEqual(await response.json(),{error:{code:'NOT_AUTHORIZED'}});
  assert.deepEqual(fixture.calls,['central','tenant']);
 }finally{await fixture.close();}
});

test('dashboard final organization mismatch cannot publish previously collected summaries',async()=>{
 const fixture=await harness({tenant:()=>({report:{...reportData(),organizationId:id(2)},privateSummary})});
 try{
  const response=await fetch(fixture.url);assert.equal(response.status,404);
  assert.deepEqual(await response.json(),{error:{code:'RESOURCE_NOT_AVAILABLE'}});
  assert.deepEqual(fixture.calls,['central','tenant']);
 }finally{await fixture.close();}
});

test('a held dashboard request does not queue another dashboard request',async()=>{
 const first={entered:deferred(),release:deferred()},second={entered:deferred(),release:deferred()};
 const fixture=await harness({tenant:async req=>{
  const gate=req.get('X-Proof-Request')==='first'?first:second;
  gate.entered.resolve();await gate.release.promise;return {report:reportData(),privateSummary};
 }});
 let firstRequest,secondRequest;
 try{
  firstRequest=fetch(fixture.url,{headers:{'X-Proof-Request':'first'},signal:AbortSignal.timeout(5000)});
  await checkpoint(first,firstRequest);
  secondRequest=fetch(fixture.url,{headers:{'X-Proof-Request':'second'},signal:AbortSignal.timeout(5000)});
  await checkpoint(second,secondRequest);assert.deepEqual(fixture.calls,['central','tenant','central','tenant']);
  second.release.resolve();assert.equal((await secondRequest).status,200);
  assert.deepEqual(fixture.calls,['central','tenant','central','tenant']);
  first.release.resolve();assert.equal((await firstRequest).status,200);
 }finally{
  first.release.resolve();second.release.resolve();
  await Promise.allSettled([firstRequest,secondRequest].filter(Boolean));await fixture.close();
 }
});
