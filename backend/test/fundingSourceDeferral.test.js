'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createWorkerProcessor}=require('../src/async/workerProcessor');
const {validateEnvelope,createTrustedObservability}=require('../src/async/envelope');
const {createJobRegistry}=require('../src/async/jobRegistry');
const {result}=require('../src/async/jobResult');
const ID='11111111-1111-4111-8111-111111111111',TYPE='funding_tenders.refresh';
function envelope(){return {envelopeVersion:3,authority:'CENTRAL',jobType:TYPE,jobVersion:1,payloadVersion:1,organizationId:null,actor:{kind:'SERVICE',serviceActorCode:'FUNDING_TENDERS_CENTRAL'},operation:'opportunity.central.manage',correlationId:ID,causationId:ID,idempotencyKey:ID,executionId:ID,createdAt:'2030-01-01T00:00:00.000Z',deadlineAt:'2030-01-01T00:05:00.000Z',payload:{runId:ID},observability:createTrustedObservability({traceparent:null,tracestate:null})};}
function processorFixture({paused=true,midflight=false,expired=false,proofFailure=false,beginFailure=false,handlerFailure=null}={}){
 const calls=[],e=envelope(),delivery={id:'delivery-1',envelope:e,attempt:1,redelivery:false,replay:false};let proofCalls=0;
 const queue={claim:async()=>[delivery],heartbeat:async()=>calls.push('heartbeat'),complete:async value=>calls.push(value.result.code),fail:async()=>calls.push('fail'),deadLetter:async()=>calls.push('deadLetter')};
 const registry=createJobRegistry([{type:TYPE,version:1,payloadVersion:1,handler:async()=>{calls.push('handler');if(handlerFailure)throw Object.assign(Error(handlerFailure),{code:handlerFailure});return result('RETRYABLE','FUNDING_SOURCE_SUSPENDED');}}]);
 const inbox={begin:async()=>{calls.push('begin');if(beginFailure)throw Error('barrier rejected');return {status:'CLAIMED',row:{fence:1}};},heartbeat:async()=>true,complete:async()=>{calls.push('inbox.complete');return true;},transition:async()=>{calls.push('transition');return true;}};
 const deferPort={defer:async({delivery:actual})=>{assert.equal(actual,delivery);proofCalls++;if(proofFailure)throw Error('durable proof unavailable');return paused&&(!midflight||proofCalls>1);}};
 const processor=createWorkerProcessor({queue,registry,inbox,deferPort,transactionResolver:{resolve:()=>async work=>work({})},lifecycle:{execute:(_e,work)=>work({signal:new AbortController().signal})},consumer:'funding',workerId:'worker',clock:()=>new Date(expired?'2030-01-01T01:00:00Z':'2030-01-01T00:00:01Z')});
 return {processor,calls};
}
test('source suspension defers even an expired transport without expiring the logical job',async()=>{const f=processorFixture({expired:true});assert.deepEqual(await f.processor.processOnce({type:TYPE}),['DEFERRED']);assert.deepEqual(f.calls,['SOURCE_SUSPENDED']);});
test('suspension during collection keeps inbox/run pending and does not schedule a new attempt',async()=>{const f=processorFixture({midflight:true});assert.deepEqual(await f.processor.processOnce({type:TYPE}),['DEFERRED']);assert.deepEqual(f.calls,['begin','heartbeat','handler','SOURCE_SUSPENDED']);});
test('suspension racing inbox admission is deferred only after durable proof',async()=>{const f=processorFixture({midflight:true,beginFailure:true});assert.deepEqual(await f.processor.processOnce({type:TYPE}),['DEFERRED']);assert.deepEqual(f.calls,['begin','SOURCE_SUSPENDED']);});
test('failed deferral proof never acknowledges or terminalizes the delivery',async()=>{const f=processorFixture({proofFailure:true});await assert.rejects(f.processor.processOnce({type:TYPE}),/durable proof/);assert.deepEqual(f.calls,[]);});

test('obsolete source epoch or run lease after resume leaves transport and logical intent for fenced redelivery',async()=>{
 for(const code of ['OPPORTUNITY_V2_SOURCE_FENCE_STALE','FUNDING_FENCE_STALE','OPPORTUNITY_V2_EU_SUSPENDED']){
  const f=processorFixture({paused:false,handlerFailure:code});
  await assert.rejects(f.processor.processOnce({type:TYPE}),{code});
  assert.deepEqual(f.calls,['begin','heartbeat','handler']);
 }
});

test('funding handler cannot finish or manufacture a retry for an obsolete source epoch or run lease',async()=>{
 const {createFundingWorker}=require('../src/fundingTenders/worker');const calls=[];
 for(const code of ['OPPORTUNITY_V2_SOURCE_FENCE_STALE','FUNDING_FENCE_STALE','OPPORTUNITY_V2_EU_SUSPENDED']){
 const worker=createFundingWorker({queue:{shutdown:async()=>{}},source:{collect:async()=>({})},repository:{euSourceControlEnabled:true,transaction:async work=>work({}),claim:async()=>({source_code:'EU_FUNDING_TENDERS'}),stage:async()=>{throw Object.assign(Error('stale epoch'),{code});},sourceExecutionAllowed:async()=>true,finish:async()=>calls.push('finish')}});
 await assert.rejects(worker.registry.resolve(TYPE).handler(envelope()),{code});
 }
 assert.deepEqual(calls,[]);
});
test('durable deferral proves exact original outbox and keeps unrelated sources active',async()=>{
 const {createFundingSourceDeferral}=require('../src/fundingTenders/sourceDeferral');
 const e=envelope(),validated=validateEnvelope(e,{supports:()=>true});
 let row={source_code:'EU_FUNDING_TENDERS',status:'QUEUED',allowed:false},outbox={envelope:e,envelope_digest:validated.envelopeDigest};const queries=[];
 const port=createFundingSourceDeferral({transaction:async work=>work({query:async sql=>{queries.push(sql);return {rows:sql.includes('FROM opportunity_catalog.funding_run')?[row]:outbox?[outbox]:[]};}})});
 const input={type:TYPE,delivery:{id:'delivery',envelope:e}};
 assert.equal(await port.defer(input),true);
 assert(queries.every(sql=>sql.startsWith('SELECT')));
 row={...row,source_code:'INTERREG_EUROPE',allowed:true};assert.equal(await port.defer(input),false);
 row={...row,source_code:'EU_FUNDING_TENDERS',allowed:false};outbox={...outbox,envelope_digest:'a'.repeat(64)};await assert.rejects(port.defer(input),{code:'FUNDING_DEFERRED_PROOF_REQUIRED'});
 outbox=null;await assert.rejects(port.defer(input),{code:'FUNDING_DEFERRED_PROOF_REQUIRED'});
});
