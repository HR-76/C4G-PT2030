'use strict';

const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const test=require('node:test');
const {createJobRegistry}=require('../src/async/jobRegistry');
const {createOpportunityImportWorkerRuntime}=require('../src/opportunityImports/workerRuntime');
const {main}=require('../src/worker');
const {stopWorkerCommand}=require('../../test/integration/f12-import/process-control');

const registry=createJobRegistry([Object.freeze({type:'opportunity.import.portugal2030',version:1,payloadVersion:1,handler:async()=>({code:'SUCCESS'})})]);

test('F12 worker entrypoint fails closed when selected without productive configuration',async()=>{
 await assert.rejects(()=>main({env:{OPPORTUNITY_IMPORTS_RUNTIME:'f12-xlsx'}}),/F11 provider/);
});

test('F12 worker command composes the selected runtime through its configured loader',async()=>{
 let loaded=0,started=0,stopped=0;
 const runtime={registry,queue:null,async start(){started++;return{relayed:[],processed:[]};},async shutdown(){stopped++;}};
 const running=await main({env:{OPPORTUNITY_IMPORTS_RUNTIME:'f12-xlsx'},runtimeLoader:async({env,telemetry})=>{loaded++;assert.equal(env.OPPORTUNITY_IMPORTS_RUNTIME,'f12-xlsx');assert.equal(typeof telemetry.run,'function');return runtime;}});
 assert.equal(loaded,1);assert.equal(started,1);await running.shutdown();assert.equal(stopped,1);
});

test('F12 productive factory exposes only the F11 provider as an external module boundary',()=>{
 const source=require('node:fs').readFileSync(require.resolve('../src/config/opportunityImportWorkerFactory'),'utf8');
 assert.match(source,/OPPORTUNITY_IMPORT_F11_PROVIDER/);assert.doesNotMatch(source,/INFRASTRUCTURE_PROVIDER/);
 assert.match(source,/createOpportunityImportWorkerInfrastructure/);assert.match(source,/documentPortFactory/);
 const infrastructure=require('node:fs').readFileSync(require.resolve('../src/config/opportunityImportWorkerInfrastructure'),'utf8');
  for(const expected of ['createTenantDirectoryRepository','createTenantCredentialProvider','createTenantPoolManager','createTenantBindingVerifier','createTenantRuntime','createAuthorityDataRepository','createTaxonomyAuthorization','createRepository','createPgBossQueueAdapter','OutboxRelay','InboxRepository'])assert.match(infrastructure,new RegExp(expected));
  assert.match(infrastructure,/set_config\('app\.organization_id',\$1,true\)/);
  assert.match(infrastructure,/createRepository\([\s\S]*runtimeRole:ROLE/);
 for(const forbidden of ['F12_IMPORT_FUNCTIONAL_PROOF','c4g_gate','SYNTHETIC_COMMIT_ACK_LOST','OPPORTUNITY_IMPORT_WORKER_CONFIG_B64'])assert.doesNotMatch(infrastructure,new RegExp(forbidden));
});

test('F12 command configuration cannot select an alternative runtime factory',()=>{
 const source=require('node:fs').readFileSync(require.resolve('../src/config/opportunityImportWorker'),'utf8');
 assert.doesNotMatch(source,/OPPORTUNITY_IMPORT_WORKER_FACTORY/);
 assert.match(source,/opportunityImportWorkerFactory/);
});

test('F12 process gate force-cleans a stuck worker but keeps shutdown timeout blocking',async()=>{
 const child=new EventEmitter();child.exitCode=null;const signals=[];child.kill=signal=>{signals.push(signal);if(signal==='SIGKILL'){child.exitCode=null;queueMicrotask(()=>child.emit('exit',null,signal));}return true;};
 await assert.rejects(()=>stopWorkerCommand({child},1),/WORKER_STOP_TIMEOUT/);
 assert.deepEqual(signals,['SIGTERM','SIGKILL']);
});

test('F12 worker entrypoint starts and owns an explicitly composed import runtime',async()=>{
 let started=0,stopped=0;
 const runtime={registry,queue:null,async start(){started++;return{relayed:[],processed:[]};},async shutdown(){stopped++;}};
 const running=await main({runtime,env:{OPPORTUNITY_IMPORTS_RUNTIME:'f12-xlsx'}});
 assert.equal(started,1);
 await running.shutdown();
 assert.equal(stopped,1);
});

test('F12 worker runtime crosses relay and processor through the registered import job',async()=>{
 const calls=[];
 const queue={async publish(){},async claim(){calls.push('claim');return[];},async heartbeat(){},async complete(){},async fail(){},async cancel(){},async deadLetter(){},async getState(){},async shutdown(){calls.push('shutdown');}};
 const runtime=createOpportunityImportWorkerRuntime({composition:{registry},queue,relay:{async poll(){calls.push('relay');return['PUBLISHED'];}},
   transactionResolver:{async resolve(){return async work=>work({query:async()=>({rows:[]})});}},continuous:false});
 const result=await runtime.start();
 assert.deepEqual(result,{relayed:['PUBLISHED'],processed:[]});
 assert.deepEqual(calls,['relay','claim']);
 await runtime.shutdown();
 assert.deepEqual(calls,['relay','claim','shutdown']);
});

test('API production composition no longer offers in-process worker registration',()=>{
 const source=require('node:fs').readFileSync(require.resolve('../src/productionComposition'),'utf8');
 assert.doesNotMatch(source,/registerOpportunityImportWorker/);
});
