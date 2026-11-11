'use strict';

const crypto=require('node:crypto');
const {InboxRepository}=require('../async/inboxRepository');
const {WorkerLifecycle}=require('../async/workerLifecycle');
const {createWorkerProcessor}=require('../async/workerProcessor');
const {JOB_TYPE}=require('./jobs');

function method(value,name){if(!value||typeof value[name]!=='function')throw new TypeError(`F12 import worker ${name} dependency is required.`);}

function createOpportunityImportWorkerRuntime({composition,queue,transactionResolver,relay,
  inbox=new InboxRepository(),consumer='f12-import-worker',workerId=`f12-import-${crypto.randomUUID()}`,
  pollIntervalMs=1000,batchSize=10,continuous=true,scheduler={setInterval,clearInterval},telemetry=null,errorObserver=null}){
  if(!composition?.registry||!composition.registry.types?.includes(JOB_TYPE))throw new TypeError('F12 import worker registry is required.');
  method(queue,'claim');method(queue,'shutdown');method(transactionResolver,'resolve');method(relay,'poll');
  if(!Number.isSafeInteger(pollIntervalMs)||pollIntervalMs<10||pollIntervalMs>60000||!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>10||typeof continuous!=='boolean')throw new TypeError('F12 import worker polling configuration is invalid.');
  if(!scheduler||typeof scheduler.setInterval!=='function'||typeof scheduler.clearInterval!=='function')throw new TypeError('F12 import worker scheduler is invalid.');
  const lifecycle=new WorkerLifecycle({queue,run:async()=>{},telemetryPort:telemetry});
  const processor=createWorkerProcessor({queue,registry:composition.registry,inbox,transactionResolver,lifecycle,
    consumer,workerId,errorObserver});
  let timer=null,active=null,closed=false;
  async function tick(){
    if(closed)throw new Error('F12_IMPORT_WORKER_CLOSED');
    if(active)return active;
    active=(async()=>{const relayed=await relay.poll();const processed=await processor.processOnce({type:JOB_TYPE,batchSize});return Object.freeze({relayed,processed});})()
      .finally(()=>{active=null;});
    return active;
  }
  async function start(){
    if(continuous){if(!timer)timer=scheduler.setInterval(()=>{tick().catch(error=>{try{errorObserver?.(error);}catch{}});},pollIntervalMs);tick().catch(error=>{try{errorObserver?.(error);}catch{}});return Object.freeze({relayed:Object.freeze([]),processed:Object.freeze([])});}
    return tick();
  }
  async function shutdown(){
    if(closed)return;
    closed=true;
    if(timer){scheduler.clearInterval(timer);timer=null;}
    return lifecycle.shutdown();
  }
  return Object.freeze({registry:composition.registry,queue,start,runOnce:tick,shutdown});
}

module.exports={createOpportunityImportWorkerRuntime};
