'use strict';

const { validateEnvelope } = require('./envelope');
const { classify, result } = require('./jobResult');
const { nextRetry } = require('./retryPolicy');

const TERMINAL = new Set(['PERMANENT','AUTHORIZATION_REVOKED','INCOMPATIBLE','POISON_MESSAGE','EXPIRED','CLEANUP_FAILURE']);
function checkedBatch(value){if(!Number.isInteger(value)||value<1||value>10)throw new TypeError('Worker batch size is invalid.');return value;}
function outcomeFrom(error){const code=error&&typeof error.code==='string'?error.code:null;if(['WORKER_DRAINING','WORKER_FENCE_STALE','MALWARE_SCAN_ABORTED','STORAGE_ABORTED','OOXML_INSPECTION_ABORTED'].includes(code))return result('RETRYABLE',code);return ['CANCELLED','EXPIRED','AUTHORIZATION_REVOKED','INCOMPATIBLE','POISON_MESSAGE'].includes(code)?result(code):result('RETRYABLE','INTERNAL_ERROR');}
function transactionPort(value){if(typeof value==='function')return value;if(value&&typeof value.transaction==='function')return value.transaction.bind(value);throw new TypeError('Effect transaction resolver is invalid.');}

function createWorkerProcessor({queue,registry,inbox,transactionResolver,lifecycle,consumer,workerId,clock=()=>new Date(),retryPort=null,deadLetterPort=null,deferPort=null,errorObserver=null,terminalReceiptPort=null,random=Math.random,leaseMs=30000}){
  if(terminalReceiptPort!==null&&typeof terminalReceiptPort.record!=='function')throw new TypeError('Terminal receipt port is invalid.');
  if(deferPort!==null&&typeof deferPort.defer!=='function')throw new TypeError('Durable source deferral port is invalid.');
  if(!queue||!registry||typeof registry.resolve!=='function'||typeof registry.supports!=='function'||!inbox||typeof inbox.begin!=='function'||typeof inbox.heartbeat!=='function'||typeof inbox.complete!=='function'||typeof inbox.transition!=='function'||!transactionResolver||typeof transactionResolver.resolve!=='function'||!lifecycle||typeof lifecycle.execute!=='function'||typeof consumer!=='string'||!consumer||typeof workerId!=='string'||!workerId)throw new TypeError('Worker processor dependencies are invalid.');
  async function inTransaction(organizationId,envelope,work){return transactionPort(await transactionResolver.resolve(organizationId,envelope))(work);}
  async function setState(envelope,row,state,code,delivery){
    return inTransaction(envelope.organizationId,envelope,async client=>{
      const fence=Number(row.fence);
      const changed=await inbox.transition(client,{consumer,jobType:envelope.jobType,jobVersion:envelope.jobVersion,
        organizationId:envelope.organizationId,idempotencyKey:envelope.idempotencyKey,owner:workerId,fence,state,resultCode:code});
      if(terminalReceiptPort){
        if(!changed)throw Object.assign(new Error('INBOX_FENCE_STALE'),{code:'CLEANUP_FAILURE'});
        await terminalReceiptPort.record({client,envelope,delivery,state,code,consumer,fence});
      }
      return changed;
    });
  }
  async function processDelivery(type,delivery){
    if(!delivery||Object.getPrototypeOf(delivery)!==Object.prototype||Reflect.ownKeys(delivery).some(k=>!['id','envelope','attempt','redelivery','replay','rootExecutionId'].includes(k))||typeof delivery.id!=='string'||!Number.isInteger(delivery.attempt)||delivery.attempt<1||typeof delivery.redelivery!=='boolean'||typeof delivery.replay!=='boolean'||(delivery.attempt>1&&typeof delivery.rootExecutionId!=='string'))throw new TypeError('Normalized queue delivery is invalid.');
    const validated=validateEnvelope(delivery.envelope,registry),envelope=validated.envelope,definition=registry.resolve(envelope.jobType);
    if(envelope.jobType!==type||!definition)throw Object.assign(new Error('INCOMPATIBLE'),{code:'INCOMPATIBLE'});
    let acknowledgedDeferral=false;
    async function defer(){
      if(!deferPort||await deferPort.defer({type,delivery})!==true)return false;
      // A transport acknowledgment is not inbox completion. The source port
      // proves a durable original outbox; resumption re-arms that same intent.
      acknowledgedDeferral=true;
      await queue.complete({type,id:delivery.id,result:{code:'SOURCE_SUSPENDED'}});
      return true;
    }
    if(await defer())return 'DEFERRED';
    try{
    const now=clock();if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new TypeError('Worker clock is invalid.');
    const expired=Date.parse(envelope.deadlineAt)<=now.getTime();
    if(expired&&!(await terminalReceiptPort?.covers?.({envelope,delivery}))){await queue.deadLetter({type,id:delivery.id,result:{code:'EXPIRED'}});return 'EXPIRED';}
    const begun=await inTransaction(envelope.organizationId,envelope,client=>inbox.begin(client,{consumer,jobType:envelope.jobType,jobVersion:envelope.jobVersion,organizationId:envelope.organizationId,idempotencyKey:envelope.idempotencyKey,envelope,contentDigest:validated.contentDigest,executionId:envelope.executionId,owner:workerId,leaseUntil:new Date(now.getTime()+leaseMs),replay:delivery.replay}));
    if(begun.status==='DUPLICATE'){await queue.complete({type,id:delivery.id,result:{code:'SUCCESS'}});return 'DUPLICATE';}
    if(begun.status!=='CLAIMED')return 'BUSY';
    const row=begun.row;let classified;
    if(expired){
      await setState(envelope,row,'FAILED','EXPIRED',delivery);
      await queue.deadLetter({type,id:delivery.id,result:{code:'EXPIRED'}});
      return 'EXPIRED';
    }
    try{
      await queue.heartbeat({type,id:delivery.id});
      const alive=await inTransaction(envelope.organizationId,envelope,client=>inbox.heartbeat(client,{consumer,jobType:envelope.jobType,jobVersion:envelope.jobVersion,organizationId:envelope.organizationId,idempotencyKey:envelope.idempotencyKey,owner:workerId,fence:Number(row.fence),leaseUntil:new Date(clock().getTime()+leaseMs)}));
      if(!alive)throw Object.assign(new Error('INBOX_FENCE_STALE'),{code:'CANCELLED'});
      const assertFence=async()=>{await queue.heartbeat({type,id:delivery.id});const current=clock();if(!(current instanceof Date)||!Number.isFinite(current.getTime()))throw new TypeError('Worker clock is invalid.');const alive=await inTransaction(envelope.organizationId,envelope,client=>inbox.heartbeat(client,{consumer,jobType:envelope.jobType,jobVersion:envelope.jobVersion,organizationId:envelope.organizationId,idempotencyKey:envelope.idempotencyKey,owner:workerId,fence:Number(row.fence),leaseUntil:new Date(current.getTime()+leaseMs)}));if(!alive)throw Object.assign(new Error('WORKER_FENCE_STALE'),{code:'WORKER_FENCE_STALE'});return true;};
      const value=await lifecycle.execute(envelope,({signal})=>definition.handler(Object.freeze({...envelope,attempt:delivery.attempt,redelivery:delivery.redelivery,replay:delivery.replay,fencingToken:Number(row.fence),signal,assertFence,...(delivery.rootExecutionId && {rootExecutionId:delivery.rootExecutionId})})),delivery);
      classified=classify(value&&value.jobResult?value.jobResult:value);
    }catch(error){
      try{errorObserver?.(error);}catch{}
      // A source epoch revoked by pause/resume cannot finish the logical job
      // or create a new attempt. The durable source port may park the transport
      // if still paused; otherwise its existing lease/redelivery remains intact.
      if(deferPort&&['OPPORTUNITY_V2_SOURCE_FENCE_STALE','FUNDING_FENCE_STALE','OPPORTUNITY_V2_EU_SUSPENDED'].includes(error?.code))throw error;
      classified=outcomeFrom(error);
    }
    if(classified.code==='SUCCESS'){
      const completed=await inTransaction(envelope.organizationId,envelope,client=>inbox.complete(client,{consumer,jobType:envelope.jobType,jobVersion:envelope.jobVersion,organizationId:envelope.organizationId,idempotencyKey:envelope.idempotencyKey,owner:workerId,fence:Number(row.fence),resultCode:'SUCCESS'}));
      if(!completed)throw Object.assign(new Error('INBOX_FENCE_STALE'),{code:'CLEANUP_FAILURE'});
      await queue.complete({type,id:delivery.id,result:{code:'SUCCESS'}});return 'SUCCESS';
    }
    if(classified.code==='RETRYABLE'){
      if(classified.detailCode==='FUNDING_SOURCE_SUSPENDED'&&await defer())return 'DEFERRED';
      const retry=nextRetry({outcome:'RETRYABLE',attempt:delivery.attempt,nowMs:now.getTime(),deadlineMs:Date.parse(envelope.deadlineAt),random});
      if(retry&&retryPort&&typeof retryPort.schedule==='function'){await inTransaction(envelope.organizationId,envelope,async client=>{const transitioned=await inbox.transition(client,{consumer,jobType:envelope.jobType,jobVersion:envelope.jobVersion,organizationId:envelope.organizationId,idempotencyKey:envelope.idempotencyKey,owner:workerId,fence:Number(row.fence),state:'UNCERTAIN',resultCode:'RETRYABLE'});if(!transitioned)throw Object.assign(new Error('INBOX_FENCE_STALE'),{code:'CLEANUP_FAILURE'});await retryPort.schedule({client,envelope,result:classified,runAt:new Date(retry.runAtMs),attempt:delivery.attempt+1,rootExecutionId:delivery.rootExecutionId||envelope.executionId});});await queue.fail({type,id:delivery.id,result:{code:'RETRYABLE'}});return 'RETRYABLE';}
      await setState(envelope,row,'FAILED','PERMANENT',delivery);
      await queue.deadLetter({type,id:delivery.id,result:{code:'PERMANENT'}});return 'PERMANENT';
    }
    const state=classified.code==='CANCELLED'?'CANCELLED':'FAILED';await setState(envelope,row,state,classified.code,delivery);
    if(classified.code==='CANCELLED')await queue.cancel({type,id:delivery.id});
    else if(TERMINAL.has(classified.code)){if(deadLetterPort&&typeof deadLetterPort.record==='function')await deadLetterPort.record({envelope,classification:classified.code,attempts:delivery.attempt,detailCode:classified.detailCode||classified.code});await queue.deadLetter({type,id:delivery.id,result:{code:classified.code}});}
    return classified.code;
    }catch(error){
      // SQL may suspend the source between the initial check and inbox/run
      // admission. Defer only after a fresh durable proof, never by error text.
      if(!acknowledgedDeferral&&await defer())return 'DEFERRED';
      throw error;
    }
  }
  return Object.freeze({async processOnce({type,batchSize=10}){if(typeof type!=='string'||!registry.resolve(type))throw new TypeError('Worker job type is not registered.');if(typeof lifecycle.accepting==='function'&&!lifecycle.accepting())return Object.freeze([]);const deliveries=await queue.claim({type,batchSize:checkedBatch(batchSize)});const results=[];for(const delivery of deliveries){const operation=processDelivery(type,delivery);results.push(await (typeof lifecycle.track==='function'?lifecycle.track(operation):operation));}return Object.freeze(results);}});
}

module.exports={createWorkerProcessor};
