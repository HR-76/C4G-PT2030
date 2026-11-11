'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {bootstrapTelemetry,resetForTests,isBootstrapped}=require('../src/observability/bootstrap');
test('failed metric exporter flush reaches lifecycle without leaking provider details',async()=>{
 const t=bootstrapTelemetry({service:'c4g-api',env:{},metricIntervalMs:600000});const original=t.metricExporter.forceFlush;
 try{
  t.metricExporter.forceFlush=async()=>{throw Error('synthetic secret provider detail')};
  await assert.rejects(t.forceFlush(),error=>error.message==='TELEMETRY_FLUSH_FAILED'&&!JSON.stringify(error).includes('synthetic secret'));
 }finally{t.metricExporter.forceFlush=original;await t.shutdown();resetForTests();}
 assert.equal(isBootstrapped(),false);
});
test('failed exporter shutdown is reported and bootstrap state is released',async()=>{
 const t=bootstrapTelemetry({service:'c4g-api',env:{},metricIntervalMs:600000});
 t.metricExporter.shutdown=async()=>{throw Error('synthetic secret provider detail')};
 try{await assert.rejects(t.shutdown(),error=>error.message==='TELEMETRY_SHUTDOWN_FAILED'&&!JSON.stringify(error).includes('synthetic secret'));assert.equal(isBootstrapped(),false);}
 finally{resetForTests();}
});
test('worker lifecycle reports shutdown failure when telemetry flush fails',async()=>{
 const {createRuntimeLifecycle}=require('../src/observability/runtimeLifecycle');
 const t=bootstrapTelemetry({service:'c4g-api',env:{},metricIntervalMs:600000});
 t.metricExporter.forceFlush=async()=>{throw Error('synthetic secret provider detail')};
 const lifecycle=createRuntimeLifecycle({flush:t.forceFlush,providerShutdown:t.shutdown});lifecycle.ready();
 try{assert.deepEqual(await lifecycle.shutdown(),{errorCode:'SHUTDOWN_FAILURE'});assert.equal(isBootstrapped(),false);}
 finally{if(isBootstrapped())await t.shutdown();resetForTests();}
});
