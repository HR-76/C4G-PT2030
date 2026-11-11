'use strict';

const crypto=require('node:crypto');
const {createDocumentWorker}=require('./documents/worker');
const {JOBS}=require('./documents/jobs');
const {InboxRepository}=require('./async/inboxRepository');
const {WorkerLifecycle}=require('./async/workerLifecycle');
const {createWorkerProcessor}=require('./async/workerProcessor');

function method(value,name){if(!value||typeof value[name]!=='function')throw new TypeError(`Document worker ${name} dependency is required.`);}

function createDocumentWorkerRuntime({queue,portsForOrganization,transactionResolver,retryPort=null,retryPortFactory=null,relay=null,
  inbox=new InboxRepository(),actor,clock=()=>new Date(),consumer='document-worker-v1',workerId=`document-${crypto.randomUUID()}`,
  pollIntervalMs=1000,batchSize=5,continuous=true,graceMs=30000,forcedCancelMs=5000,leaseMs=30000,
  scheduler={setTimeout,clearTimeout},telemetry=null,errorObserver=null}){
  method(queue,'claim');method(queue,'shutdown');method(transactionResolver,'resolve');
  if(relay)method(relay,'poll');
  if(!Number.isSafeInteger(pollIntervalMs)||pollIntervalMs<10||pollIntervalMs>60000||!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>10
    ||typeof continuous!=='boolean'||!scheduler||typeof scheduler.setTimeout!=='function'||typeof scheduler.clearTimeout!=='function')throw new TypeError('Document worker polling configuration is invalid.');
  const composition=createDocumentWorker({portsForOrganization,actor,clock});
  const effectiveRetryPort=retryPort||(typeof retryPortFactory==='function'?retryPortFactory(composition.registry):null);method(effectiveRetryPort,'schedule');
  let timer=null,active=null,closed=false,processor,lifecycle,lastSuccess=null,lastFailure=false;
  async function cycle(){
    if(closed||!lifecycle.accepting())return Object.freeze([]);
    if(active)return active;
    active=(async()=>{if(relay)await relay.poll();const processed=[];for(const type of JOBS){if(!lifecycle.accepting())break;processed.push(...await processor.processOnce({type,batchSize}));}return Object.freeze(processed);})()
      .then(result=>{lastSuccess=Date.now();lastFailure=false;return result;},error=>{lastFailure=true;throw error;}).finally(()=>{active=null;});
    return active;
  }
  function schedule(){if(closed||!lifecycle.accepting()||timer)return;timer=scheduler.setTimeout(async()=>{timer=null;try{await cycle();}catch(error){try{errorObserver?.(error);}catch{}}finally{schedule();}},pollIntervalMs);}
  lifecycle=new WorkerLifecycle({queue,graceMs,forcedCancelMs,telemetryPort:telemetry,run:async()=>{if(!continuous)return cycle();schedule();return Object.freeze([]);}});
  processor=createWorkerProcessor({queue,registry:composition.registry,inbox,transactionResolver,lifecycle,retryPort:effectiveRetryPort,consumer,workerId,clock,errorObserver,leaseMs});
  async function shutdown(){
    if(closed)return lifecycle.shutdown();
    closed=true;if(timer){scheduler.clearTimeout(timer);timer=null;}
    return lifecycle.shutdown();
  }
  return Object.freeze({registry:composition.registry,queue,start:()=>lifecycle.start(),runOnce:cycle,shutdown,state:()=>lifecycle.state,
    health:()=>Object.freeze({ready:!closed&&lifecycle.accepting()&&!lastFailure&&lastSuccess!==null&&Date.now()-lastSuccess<=Math.max(30000,pollIntervalMs*3)})});
}

async function startDocumentWorker(options){const runtime=createDocumentWorkerRuntime(options);await runtime.start();return runtime;}

async function main({env=process.env,telemetry=null,onReady=null}={}){const {loadDocumentWorkerRuntime}=require('./config/documentWorker');const {installProcessHandlers}=require('./observability/workerProcessLifecycle');const runtime=await loadDocumentWorkerRuntime({env,telemetry});const readiness=runtime.readiness();if(readiness.ready!==true)throw new Error('DOCUMENT_WORKER_NOT_READY');await runtime.start();installProcessHandlers(runtime);if(typeof onReady==='function')onReady(readiness);return runtime;}
module.exports={createDocumentWorkerRuntime,startDocumentWorker,main};
if(require.main===module){main({onReady:readiness=>process.stdout.write(`${JSON.stringify({type:'DOCUMENT_WORKER_READY',schemaVersion:readiness.schemaVersion,organizations:readiness.organizations,queueTypes:readiness.queueTypes})}\n`)}).catch(error=>{process.stderr.write(`${error?.code||error?.message||'DOCUMENT_WORKER_START_FAILED'}\n`);process.exitCode=1;});}
