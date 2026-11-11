'use strict';
const {fork}=require('node:child_process'),{randomUUID}=require('node:crypto'),path=require('node:path');
function createMemberWorkerClient(configFile,entrypoint=path.join(__dirname,'memberWorker.js')){
 let worker,starting,closed=false;const pending=new Map();
 async function start(){if(closed)throw Error('WORKER_CLOSED');if(worker?.connected)return;if(starting)return starting;
  starting=new Promise((resolve,reject)=>{const child=fork(entrypoint,[configFile],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});worker=child;
   const timer=setTimeout(()=>{child.kill();reject(Error('WORKER_UNAVAILABLE'));},10000);
   child.on('message',m=>{if(m.ready){clearTimeout(timer);resolve();return;}const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Object.assign(Error(m.error),{code:m.error})):p.resolve(m.result);});
   const stopped=()=>{clearTimeout(timer);if(worker===child)worker=null;reject(Error('WORKER_UNAVAILABLE'));for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('WORKER_UNAVAILABLE'));}pending.clear();};child.once('error',stopped);child.once('exit',stopped);
  }).finally(()=>{starting=null});return starting;
 }
 return {async call(method,value){if(starting)await starting;await start();const child=worker,id=randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('WORKER_TIMEOUT'));},50000);pending.set(id,{resolve,reject,timer});child.send({id,method,value},e=>{if(e){clearTimeout(timer);pending.delete(id);reject(Error('WORKER_UNAVAILABLE'));}});});},async close(){closed=true;const child=worker;if(child?.connected){const done=new Promise(r=>child.once('exit',r));child.disconnect();await done;}}};
}
module.exports={createMemberWorkerClient};
