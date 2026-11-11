'use strict';
// Isolated test worker process. Configuration arrives via IPC, never argv/logs.
const {Client}=require('pg');
const {createSimulationStore}=require('../src/applications/statusEmails/simulationStore');
const {createSimulatedConsumer}=require('../src/applications/statusEmails/consumer');
const {createTransport}=require('../src/applications/statusEmails/transport');
const pending=new Map();let sequence=0,client;
process.on('message',async message=>{
 if(message.kind==='resolved'){const p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(Error('AUTHORITY_UNAVAILABLE')):p.resolve(message.value);}return;}
 if(message.kind!=='start')return;
 try{
  const {config,job,instant,pause,acceptance}=message;
  client=new Client(config);await client.connect();await client.query('SET ROLE c4g_status_simulation_worker');
  const store=createSimulationStore({isolated:true,transaction:async(org,work)=>{await client.query('BEGIN');try{await client.query("SELECT set_config('app.organization_id',$1,true)",[org]);const v=await work(client);await client.query('COMMIT');return v}catch(e){await client.query('ROLLBACK');throw e;}}});
  const wrapped={...store,finish:async(...args)=>{if(acceptance&&pause&&args[3]==='ACCEPTED'){process.send({kind:'acceptedBeforeCommit',pid:process.pid});await new Promise(()=>{});}return store.finish(...args);},reserve:async(...args)=>{const value=await store.reserve(...args);if(pause&&!acceptance&&value.status==='RESERVED'){process.send({kind:'reserved',pid:process.pid});await new Promise(()=>{});}return value;}};
  const transport=acceptance?require('../src/applications/statusEmails/transport').createIpcSimulationTransport({isolated:true}):createTransport({mode:'simulated',isolated:true});
  const consumer=createSimulatedConsumer({isolated:true,organizationId:job.organizationId,store:wrapped,transport,publicOrigin:'https://fixture.example.invalid',now:()=>new Date(instant),resolve:input=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});process.send({kind:'resolve',id,input});})});
  const result=await consumer.handler(job);process.send({kind:'done',pid:process.pid,code:result.code,detailCode:result.detailCode,stats:transport.stats()});
 }catch{process.send({kind:'failed',pid:process.pid});}
});
