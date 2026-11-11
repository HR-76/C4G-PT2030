'use strict';
const {waitForSignal,bounded,deferCleanup,trackServer,listening}=require('./support/networkWait');
const test=require('./support/networkWait').test,assert=require('node:assert/strict'),http=require('node:http');
const express=require('express');
const {start}=require('../src/server');
const {createResourceOwner}=require('../src/resourceOwner');
async function trackedStart(options){const api=await start(options);trackServer(api.server);return api;}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
 const events=[],app=express();app.get('/health/live',(req,res)=>res.json({alive:true}));
 return {events,production:{app,port:0,logger:{info(){},error(){}},observability:{lifecycle:{start(){events.push('start');},async stop(){events.push('stop');}}},
 async assertDatabaseReadiness(){events.push('preflight');},
 async closeOpportunityRuntime(){events.push('close');},logFrontendUrlHealth(){},legacyBootstrapEnabled:false,notificationSchedulerEnabled:false,euFundingSchedulerEnabled:false}};
}
const options={host:'127.0.0.1',installSignals:false,telemetry:{},env:{API_SHUTDOWN_GRACE_MS:'30',API_SHUTDOWN_SETTLE_MS:'500'}};
function get(server,route='/health/live'){return new Promise(resolve=>{const req=http.get({host:'127.0.0.1',port:server.address().port,path:route},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});deferCleanup(()=>req.destroy());req.once('error',error=>resolve(error.code));});}
test('HTTP listener starts after readiness and repeated shutdown shares the result',async()=>{
 const f=fixture(),api=await trackedStart({...options,production:f.production});
 assert.equal(await get(api.server),200);const first=api.shutdown();assert.equal(first,api.shutdown());
 assert.equal((await first).status,'CLOSED');assert.deepEqual(f.events,['preflight','start','stop','close']);assert.equal(api.server.listening,false);
});
test('readiness failure never listens and closes composition resources',async()=>{
 const f=fixture();f.production.assertDatabaseReadiness=async()=>{throw new Error('SCHEMA_INCOMPATIBLE');};
 await assert.rejects(start({...options,production:f.production}),/SCHEMA_INCOMPATIBLE/);assert.deepEqual(f.events,['close']);
});
test('partial dependency construction cleans only registered resources',async()=>{
 let ended=0;const foreign={end(){throw Error('FOREIGN_RESOURCE_CLOSED');}};
 await assert.rejects(start({...options,env:{JWT_SECRET:'synthetic'},dependencyLoader({ownResource}){ownResource({},async()=>{ended++;});void foreign;throw Error('CONFIG_INCOMPLETE');}}),/CONFIG_INCOMPLETE/);
 assert.equal(ended,1);
});
test('owned pools close once after composition consumers; borrowed pools are not ended',async()=>{
 const f=fixture(),events=f.events;let ended=0;
 const pool={async query(){},async connect(){return{release(){}};},async end(){ended++;events.push('pool-end');}};
 const api=await trackedStart({...options,env:{AUTH_MODE:'oidc'},dependencyLoader({ownResource}){ownResource(pool,()=>pool.end());return{centralPool:pool};},composer(){return f.production;}});
 await api.shutdown();assert.equal(ended,1);assert(events.indexOf('close')<events.indexOf('pool-end'));
 const g=fixture();const borrowed=await trackedStart({...options,dependencies:{centralPool:pool},composer:()=>g.production,env:{AUTH_MODE:'oidc'}});await borrowed.shutdown();assert.equal(ended,1);
});
test('request completes during grace before dependencies close',async()=>{
 const f=fixture(),entered=deferred(),release=deferred();deferCleanup(()=>release.resolve());
 f.production.app.get('/work',async(req,res)=>{entered.resolve();await release.promise;f.events.push('query');res.end('ok');});
 const api=await trackedStart({...options,env:{API_SHUTDOWN_GRACE_MS:'500'},production:f.production});const response=get(api.server,'/work');await waitForSignal(entered.promise,response,'HTTP handler entry');
 const done=api.shutdown();await new Promise(r=>setImmediate(r));assert(!f.events.includes('close'));release.resolve();assert.equal(await response,200);await done;assert(f.events.indexOf('query')<f.events.indexOf('close'));
});
test('deadline closes socket, waits for asynchronous handler after disconnect, then closes dependencies',async()=>{
 const f=fixture(),entered=deferred();
 f.production.app.get('/slow',async(req,res)=>{entered.resolve();await new Promise(resolve=>res.once('close',resolve));await new Promise(r=>setImmediate(r));f.events.push('cancel-complete');});
 const api=await trackedStart({...options,production:f.production});const response=get(api.server,'/slow');await waitForSignal(entered.promise,response,'HTTP handler entry');await api.shutdown();assert.equal(await response,'ECONNRESET');assert(f.events.indexOf('cancel-complete')<f.events.indexOf('close'));
});
test('uncooperative handler produces bounded failure, not success or pool closure',async()=>{
 const f=fixture(),entered=deferred(),release=deferred();deferCleanup(()=>release.resolve());
 f.production.app.get('/stuck',async(req,res)=>{entered.resolve();await release.promise;});
 const api=await trackedStart({...options,env:{API_SHUTDOWN_GRACE_MS:'20',API_SHUTDOWN_SETTLE_MS:'30'},production:f.production});const response=get(api.server,'/stuck');await waitForSignal(entered.promise,response,'HTTP handler entry');
 await assert.rejects(api.shutdown(),/REQUEST_WORK_DRAIN_TIMEOUT/);assert(!f.events.includes('close'));release.resolve();await response;await f.production.observability.lifecycle.stop();await f.production.closeOpportunityRuntime();
});
test('resource owner closes in reverse order, once, even when one close fails',async()=>{
 const owner=createResourceOwner(),events=[],a={},b={};const closeA=owner.own(a,async()=>events.push('a'));
 assert.equal(closeA,owner.own(a,()=>{throw Error('duplicate');}));owner.own(b,async()=>{events.push('b');throw Error('busy');});
 const first=owner.close();assert.equal(first,owner.close());await assert.rejects(first,/OWNED_RESOURCE_CLOSE_FAILED/);assert.deepEqual(events,['b','a']);
});
test('invalid shutdown durations are rejected before dependency construction',async()=>{
 for(const value of ['0','NaN','300001'])await assert.rejects(start({...options,env:{API_SHUTDOWN_GRACE_MS:value},dependencyLoader(){throw Error('must not load');}}),/API_SHUTDOWN_GRACE_MS/);
});
test('normal shutdown succeeds with the actual allowlisted production logger',async()=>{
 const {Writable}=require('node:stream'),lines=[];
 const destination=new Writable({write(chunk,encoding,done){lines.push(chunk.toString());done();}});
 const f=fixture();f.production.logger=require('../src/observability/logger').createLogger({service:'c4g-api',destination});
 const api=await trackedStart({...options,production:f.production});
 try{
  assert.equal((await api.shutdown()).status,'CLOSED');
  const events=lines.join('').trim().split('\n').map(line=>JSON.parse(line));
  assert(events.some(event=>event.signalCode==='c4g.api.lifecycle'&&event.phase==='DRAINED'));
  assert(events.filter(event=>event.signalCode==='c4g.api.lifecycle').every(event=>Number.isFinite(event.elapsedMs)));
 }finally{if(api.server.listening)await new Promise(resolve=>api.server.close(resolve));}
});
