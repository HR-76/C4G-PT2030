'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {createEnvelopeV2,createTrustedObservability}=require('../src/async/envelope');
const {createDocumentWorkerRuntime}=require('../src/documentWorker');

const ORG='11111111-1111-4111-8111-111111111111';
const VERSION='22222222-2222-4222-8222-222222222222';
const EXECUTION='33333333-3333-4333-8333-333333333333';

function fixture({scan,graceMs=100,forcedCancelMs=50,heartbeat=true,delivery=true}={}){
  const calls=[];let runtime,claimed=false,fence=1;
  const queue={
    async claim({type}){calls.push(`claim:${type}`);if(!delivery||claimed||type!=='document.scan')return[];claimed=true;const made=createEnvelopeV2({trustedContext:{organizationId:ORG,actor:{kind:'SERVICE',serviceActorCode:'F11_DOCUMENT_WORKER'},operation:'document.scan',correlationId:VERSION,causationId:VERSION},job:{type:'document.scan',version:1,payloadVersion:1,idempotencyKey:'document-scan-lifecycle',deadlineMs:300000},payload:{organizationId:ORG,versionId:VERSION},registry:runtime.registry,observability:createTrustedObservability({traceparent:null,tracestate:null}),clock:()=>new Date('2026-10-24T10:00:00Z'),id:()=>EXECUTION});return[Object.freeze({id:'queue-1',envelope:made.envelope,attempt:1,redelivery:false,replay:false})];},
    async heartbeat(){calls.push('queue.heartbeat');},async complete(){calls.push('queue.complete');},async fail(){calls.push('queue.fail');},async cancel(){calls.push('queue.cancel');},async deadLetter(){calls.push('queue.deadLetter');},async shutdown(){calls.push('queue.shutdown');}
  };
  const inbox={
    async begin(){calls.push('inbox.begin');return{status:'CLAIMED',row:{fence:fence++}};},
    async heartbeat(){calls.push('inbox.heartbeat');return heartbeat;},
    async complete(){calls.push('inbox.complete');return true;},
    async transition(_client,input){calls.push(`inbox.${input.state}`);return true;}
  };
  const repository={async findVersion(){calls.push('document.lookup');return{organization_id:ORG,version_id:VERSION,state:'SCANNING',lock_version:0,expected_file_class:'PDF'};},async claimExpiredMultipart(){return[]},async claimTransportRecovery(){return[]}};
  runtime=createDocumentWorkerRuntime({queue,inbox,transactionResolver:{resolve:async()=>async work=>work({})},retryPort:{async schedule(){calls.push('retry.schedule');}},portsForOrganization:()=>({repository,storage:{},scanService:{scan:scan||(async()=>({state:'AVAILABLE'}))},audit:{}}),continuous:false,graceMs,forcedCancelMs,clock:()=>new Date('2026-10-24T10:00:01Z')});
  return{runtime,calls};
}

test('document worker stops with no jobs and never admits work after shutdown begins',async()=>{const value=fixture({delivery:false});assert.deepEqual(await value.runtime.start(),[]);const stopped=await value.runtime.shutdown();assert.equal(stopped.mode,'GRACEFUL');assert.equal(value.runtime.state(),'STOPPED');assert.equal(value.calls.at(-1),'queue.shutdown');assert.deepEqual(await value.runtime.runOnce(),[]);});

test('worker health requires a completed cycle and becomes unavailable after queue failure or shutdown',async()=>{
 const value=fixture({delivery:false});assert.equal(value.runtime.health().ready,false);
 await value.runtime.start();assert.equal(value.runtime.health().ready,true);
 value.runtime.queue.claim=async()=>{throw Error('SYNTHETIC_QUEUE_UNAVAILABLE');};
 await assert.rejects(()=>value.runtime.runOnce(),/SYNTHETIC_QUEUE_UNAVAILABLE/);assert.equal(value.runtime.health().ready,false);
 value.runtime.queue.claim=async()=>[];await value.runtime.runOnce();assert.equal(value.runtime.health().ready,true);
 await value.runtime.shutdown();assert.equal(value.runtime.health().ready,false);
});

test('document worker lets an active scan finish inside the graceful deadline',async()=>{let started,release;const began=new Promise(resolve=>{started=resolve});const wait=new Promise(resolve=>{release=resolve});const value=fixture({scan:async({assertFence,signal})=>{started();assert.equal(signal.aborted,false);await wait;await assertFence();return{state:'AVAILABLE'};}});const running=value.runtime.start();await began;const stopping=value.runtime.shutdown();release();assert.deepEqual(await running,['SUCCESS']);assert.equal((await stopping).mode,'GRACEFUL');assert.equal(value.calls.includes('queue.complete'),true);assert.equal(value.calls.includes('retry.schedule'),false);});

test('document worker aborts an over-deadline scan and persists retry intent without false success',async()=>{let started;const began=new Promise(resolve=>{started=resolve});const value=fixture({graceMs:5,forcedCancelMs:100,scan:async({signal})=>{started();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));throw Object.assign(new Error('WORKER_DRAINING'),{code:'WORKER_DRAINING'});}});const running=value.runtime.start();await began;const stopped=await value.runtime.shutdown();assert.deepEqual(await running,['RETRYABLE']);assert.equal(stopped.mode,'FORCED');assert.equal(value.calls.includes('inbox.UNCERTAIN'),true);assert.equal(value.calls.includes('retry.schedule'),true);assert.equal(value.calls.includes('queue.fail'),true);assert.equal(value.calls.includes('queue.complete'),false);});

test('document worker rejects a stale fence before the document state effect',async()=>{let effects=0;const value=fixture({heartbeat:false,scan:async({assertFence})=>{await assertFence();effects+=1;return{state:'AVAILABLE'};}});assert.deepEqual(await value.runtime.start(),['CANCELLED']);assert.equal(effects,0);assert.equal(value.calls.includes('queue.complete'),false);await value.runtime.shutdown();});
