'use strict';

const fs=require('node:fs');
const {createEnvelopeV2,createTrustedObservability}=require('../../src/async/envelope');
const {createDocumentWorkerRuntime}=require('../../src/documentWorker');
const {installProcessHandlers}=require('../../src/observability/workerProcessLifecycle');

const ORG='11111111-1111-4111-8111-111111111111',VERSION='22222222-2222-4222-8222-222222222222',EXECUTION='33333333-3333-4333-8333-333333333333';
const mode=process.env.C4G_DOCUMENT_LIFECYCLE_MODE,statePath=process.env.C4G_DOCUMENT_LIFECYCLE_STATE;
if(!['empty','graceful','forced','abrupt','recovery'].includes(mode)||!statePath)throw new Error('DOCUMENT_LIFECYCLE_FIXTURE_INVALID');
const load=()=>fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{inbox:'NEW',fence:0,effects:0,retries:0};
const save=value=>fs.writeFileSync(statePath,JSON.stringify(value));
let runtime,claimed=false;const keeper=setInterval(()=>{},1000);
const queue={
 async claim({type}){const state=load();if(mode==='empty'||claimed||type!=='document.scan'||state.inbox==='COMPLETED')return[];claimed=true;const made=createEnvelopeV2({trustedContext:{organizationId:ORG,actor:{kind:'SERVICE',serviceActorCode:'F11_DOCUMENT_WORKER'},operation:'document.scan',correlationId:VERSION,causationId:VERSION},job:{type:'document.scan',version:1,payloadVersion:1,idempotencyKey:'process-lifecycle-scan',deadlineMs:300000},payload:{organizationId:ORG,versionId:VERSION},registry:runtime.registry,observability:createTrustedObservability({traceparent:null,tracestate:null}),clock:()=>new Date('2026-10-24T10:00:00Z'),id:()=>EXECUTION});return[{id:'process-job',envelope:made.envelope,attempt:state.retries+1,redelivery:state.retries>0,replay:false,...(state.retries?{rootExecutionId:EXECUTION}:{})}];},
 async heartbeat(){},async complete(){},async fail(){},async cancel(){},async deadLetter(){},
 async shutdown(){clearInterval(keeper);process.send?.({type:'SHUTDOWN',mode,state:load()});setImmediate(()=>process.disconnect?.());}
};
const inbox={
 async begin(){const state=load();state.fence+=1;state.inbox='PROCESSING';save(state);return{status:'CLAIMED',row:{fence:state.fence}};},
 async heartbeat(){return true;},
 async complete(){const state=load();state.inbox='COMPLETED';save(state);return true;},
 async transition(_client,input){const state=load();state.inbox=input.state;save(state);return true;}
};
const scan=async({signal,assertFence})=>{process.send?.({type:'JOB_STARTED',mode});if(mode==='graceful')await new Promise(resolve=>setTimeout(resolve,30));else if(mode==='forced')await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));else if(mode==='abrupt')await new Promise(()=>{});await assertFence();if(signal.aborted)throw Object.assign(new Error('WORKER_DRAINING'),{code:'WORKER_DRAINING'});const state=load();state.effects+=1;save(state);return{state:'AVAILABLE'};};
const repository={async findVersion(){return{organization_id:ORG,version_id:VERSION,state:'SCANNING',lock_version:0,expected_file_class:'PDF'};},async claimExpiredMultipart(){return[]},async claimTransportRecovery(){return[]}};
runtime=createDocumentWorkerRuntime({queue,inbox,transactionResolver:{resolve:async()=>async work=>work({})},retryPort:{async schedule(){const state=load();state.retries+=1;save(state);}},portsForOrganization:()=>({repository,storage:{kind:'CONTROLLED_DOUBLE'},scanService:{scan},audit:{}}),pollIntervalMs:10,batchSize:1,graceMs:mode==='forced'?10:200,forcedCancelMs:200,continuous:true,clock:()=>new Date('2026-10-24T10:00:01Z')});
installProcessHandlers(runtime);
process.on('message',message=>{if(message?.type==='STOP')process.emit('SIGTERM');});
runtime.start().then(()=>process.send?.({type:'READY',mode,state:load()})).catch(error=>{process.send?.({type:'ERROR',code:error.code||'UNEXPECTED'});process.exitCode=1;});
