'use strict';
const {fork}=require('node:child_process'),path=require('node:path'),assert=require('node:assert/strict');
async function runProbe({config,job,instant,resolve,revoke,restore,acceptance=false,inspect}){
 const children=new Set(),providerRequests=[];
 const provider=require('../src/applications/statusEmails/transport').createTransport({mode:'simulated',isolated:true});
 async function launch(pause,time){
  const child=fork(path.join(__dirname,'statusEmailWorkerChild.js'),[],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});children.add(child);
  const exited=new Promise(r=>child.once('exit',()=>{children.delete(child);r();}));
  const value=await new Promise((accept,reject)=>{
   const timer=setTimeout(()=>reject(Error('WORKER_PROCESS_TIMEOUT')),20000);
   const finish=(fn,v)=>{clearTimeout(timer);fn(v)};
   child.once('error',e=>finish(reject,e));child.once('exit',()=>finish(reject,Error('WORKER_EXITED_EARLY')));
   child.on('message',async m=>{
    if(m.kind==='simulationSend'){providerRequests.push({key:m.key,message:m.message});const value=await provider.send(m.message,m.key);if(child.connected)child.send({kind:'simulationResult',id:m.id,value});return;}
    if(m.kind==='resolve'){try{const value=await resolve(m.input);if(child.connected)child.send({kind:'resolved',id:m.id,value});}catch{if(child.connected)child.send({kind:'resolved',id:m.id,error:true});}return;}
    if(m.kind==='failed')finish(reject,Error('WORKER_PROCESS_FAILED'));
    if(m.kind==='reserved'||m.kind==='acceptedBeforeCommit'||m.kind==='done')finish(accept,m);
   });
   child.send({kind:'start',config,job,instant:time,pause,acceptance});
  });
  return {value,stop:async()=>{child.kill('SIGKILL');await exited;children.delete(child);}};
 }
 try{
  if(acceptance){
   const interrupted=await launch(true,instant);assert.equal(interrupted.value.kind,'acceptedBeforeCommit');assert.equal(provider.stats().accepted,1);await inspect('RESERVED');await interrupted.stop();
   await inspect('RESERVED');
   const recovery=await launch(false,instant+30001);assert.equal(recovery.value.code,'SUCCESS');await recovery.stop();await inspect('ACCEPTED');
   assert.deepEqual(provider.stats(),{calls:2,accepted:1});assert.deepEqual(providerRequests[0],providerRequests[1]);
   const duplicate=await launch(false,instant+31000);assert.equal(duplicate.value.code,'SUCCESS');await duplicate.stop();assert.deepEqual(provider.stats(),{calls:2,accepted:1});
   console.log('PASS acceptance/commit crash window: provider survives worker SIGKILL; same request recovers, 2 provider calls, 1 acceptance, durable result.');return;
  }
  const first=await launch(true,instant);assert.equal(first.value.kind,'reserved');await first.stop();
  const busy=await launch(false,instant+29999);assert.equal(busy.value.detailCode,'DELIVERY_BUSY');assert.equal(busy.value.stats.calls,0);await busy.stop();
  await revoke();const denied=await launch(false,instant+30000);assert.equal(denied.value.detailCode,'RECONCILIATION_REQUIRED');assert.equal(denied.value.stats.calls,0);await denied.stop();await restore();
  const resumed=await launch(false,instant+30001);assert.equal(resumed.value.code,'SUCCESS');assert.equal(resumed.value.stats.accepted,1);await resumed.stop();
  const duplicate=await launch(false,instant+31000);assert.equal(duplicate.value.code,'SUCCESS');assert.equal(duplicate.value.stats.calls,0);await duplicate.stop();
  console.log('PASS OS process termination/restart: reserved crash, busy lease, revoked access, recovery and durable accepted duplicate suppression.');
 }finally{await Promise.all([...children].map(child=>new Promise(r=>{child.once('exit',r);child.kill('SIGKILL');})));}
}
module.exports={runProbe};
