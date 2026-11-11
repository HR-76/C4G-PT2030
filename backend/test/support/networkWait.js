'use strict';
const nodeTest=require('node:test');
const {AsyncLocalStorage}=require('node:async_hooks');
const scope=new AsyncLocalStorage();
function failure(phase,code,cause){return Object.assign(new Error(phase+': '+code,{cause}),{code});}
function bounded(promise,phase,timeoutMs=5000,signal){
 return new Promise((resolve,reject)=>{
  let timer;
  const finish=(fn,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(value);};
  const abort=()=>finish(reject,failure(phase,'TEST_WAIT_ABORTED',signal.reason));
  timer=setTimeout(()=>finish(reject,failure(phase,'TEST_WAIT_TIMEOUT')),timeoutMs);
  Promise.resolve(promise).then(v=>finish(resolve,v),e=>finish(reject,e));
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 });
}
function waitForSignal(event,operation,phase,{timeoutMs=5000,signal=scope.getStore()?.signal}={}){
 const ended=Promise.resolve(operation).then(value=>{
  // Legacy lifecycle fixtures expose expected socket errors as codes.
  const code=typeof value==='string'&&/^E[A-Z]+$/.test(value)?value:'TEST_OPERATION_ENDED';
  throw failure(phase,code);
 },cause=>{throw failure(phase,cause.code||cause.cause?.code||'TEST_OPERATION_FAILED',cause)});
 return bounded(Promise.race([event,ended]),phase,timeoutMs,signal);
}
function deferCleanup(cleanup,timeoutMs=2000){
 const current=scope.getStore();if(!current)throw Error('TEST_SCOPE_REQUIRED');
 current.cleanups.push({cleanup,timeoutMs});
}
async function runScope(work,signal){
 const state={cleanups:[],signal};
 return scope.run(state,async()=>{
  let result,primary;
  try{result=await work()}catch(error){primary=error}
  const errors=[];
  for(const {cleanup,timeoutMs} of state.cleanups.reverse()){
   try{await bounded(Promise.resolve().then(cleanup),'resource cleanup',timeoutMs)}catch(error){errors.push(error)}
  }
  if(primary&&errors.length)throw new AggregateError([primary,...errors],'Test failed; cleanup also failed',{cause:primary});
  if(primary)throw primary;
  if(errors.length===1)throw errors[0];
  if(errors.length)throw new AggregateError(errors,'Cleanup failed');
  return result;
 });
}
function test(name,options,fn){
 if(typeof options==='function'){fn=options;options={}}
 return nodeTest(name,{timeout:15000,...options},t=>runScope(()=>bounded(Promise.resolve().then(()=>fn(t)),'test body',10000,t.signal),t.signal));
}
function trackServer(server){
 const sockets=new Set();
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket))});
 deferCleanup(async()=>{
  for(const socket of sockets)socket.destroy();
  server.closeAllConnections?.();
  if(server.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 });
 return server;
}
async function listening(server){
 if(server.listening)return;
 let ready,failed;
 try{await bounded(new Promise((resolve,reject)=>{
  ready=resolve;failed=reject;server.once('listening',ready);server.once('error',failed);
 }),'server listening',5000,scope.getStore()?.signal)}
 finally{server.removeListener('listening',ready);server.removeListener('error',failed)}
}
module.exports={test,runScope,deferCleanup,trackServer,listening,waitForSignal,bounded};
