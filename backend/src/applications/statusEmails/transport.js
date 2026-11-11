"use strict";
const {message}=require('./contracts');
const simulated=new WeakSet();
// Deliberately no provider SDK, network or runtime wiring in this stage.
function createTransport({mode='disabled',isolated=false,now=()=>Date.now(),outcome=()=> 'ACCEPTED'}={}){
 if(mode==='disabled')return Object.freeze({mode,send:async()=>Object.freeze({status:'DISABLED'})});
 if(mode!=='simulated'||isolated!==true)throw new TypeError('STATUS_EMAIL_TRANSPORT_NOT_ENABLED');
 const requests=new Map();let calls=0,accepted=0;
 async function send(input,key,signal){
  const m=message(input);if(typeof key!=='string'||!key.length||key.length>256||!/^[a-zA-Z0-9:/_-]+$/.test(key))throw new TypeError('INVALID_IDEMPOTENCY_KEY');
  if(signal?.aborted)return Object.freeze({status:'RETRYABLE_NOT_ACCEPTED',simulated:true});
  const at=now();if(!Number.isFinite(at))throw new TypeError('INVALID_CLOCK');
  calls++;const serialized=JSON.stringify([m.to,m.subject,m.html,m.text]);const prior=requests.get(key);
  if(prior){
   if(prior.serialized!==serialized)return Object.freeze({status:'PERMANENT_REJECTED',reason:'IDEMPOTENCY_CONFLICT',simulated:true});
   // Safer than a provider: do not silently accept a second time after expiry.
   if(at-prior.at>=86400000)return Object.freeze({status:'UNKNOWN',reason:'RECONCILIATION_REQUIRED',simulated:true});
   return Object.freeze({status:'ACCEPTED',providerId:prior.providerId,simulated:true});
  }
  let result;try{result=outcome({call:calls,key});}catch{return Object.freeze({status:'UNKNOWN',simulated:true});}
  if(['ACCEPTED','TIMEOUT_AFTER_ACCEPTANCE'].includes(result)){
   const providerId=`simulated-${++accepted}`;requests.set(key,{serialized,at,providerId});
   return Object.freeze(result==='ACCEPTED'?{status:'ACCEPTED',providerId,simulated:true}:{status:'UNKNOWN',simulated:true});
  }
  if(!['RETRYABLE_NOT_ACCEPTED','PERMANENT_REJECTED','UNKNOWN'].includes(result))throw new TypeError('INVALID_SIMULATED_OUTCOME');
  return Object.freeze({status:result,simulated:true});
 }
 const transport=Object.freeze({mode,send,stats:()=>Object.freeze({calls,accepted})});simulated.add(transport);return transport;
}
// Test-only IPC bridge to the isolated parent simulator. No HTTP/provider SDK.
function createIpcSimulationTransport({isolated=false}={}){
 if(isolated!==true||typeof process.send!=='function')throw TypeError('ISOLATED_IPC_REQUIRED');
 let sequence=0,calls=0;const pending=new Map();
 const listener=m=>{if(m?.kind!=='simulationResult')return;const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);const v=m.value;if(!v||v.simulated!==true||!['ACCEPTED','UNKNOWN','RETRYABLE_NOT_ACCEPTED','PERMANENT_REJECTED'].includes(v.status)){p.reject(Error('INVALID_SIMULATION_RESULT'));return;}p.resolve(v);};
 process.on('message',listener);
 const transport=Object.freeze({mode:'simulated',send:async(input,key,signal)=>{
  const value=message(input);if(signal?.aborted)return {status:'RETRYABLE_NOT_ACCEPTED',simulated:true};calls++;
  return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('SIMULATION_TIMEOUT'));},10000);pending.set(id,{resolve,reject,timer});process.send({kind:'simulationSend',id,message:value,key});});
 },stats:()=>({calls}),close(){process.removeListener('message',listener);for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('SIMULATION_CLOSED'));}pending.clear();}});
 simulated.add(transport);return transport;
}
module.exports={createTransport,createIpcSimulationTransport,isSimulatedTransport:value=>simulated.has(value)};
