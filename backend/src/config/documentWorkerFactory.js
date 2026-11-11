'use strict';
const {createDocumentWorkerInfrastructure}=require('./documentWorkerInfrastructure');
const {createDocumentWorkerRuntime}=require('../documentWorker');
async function createDocumentWorkerProductionRuntime({env=process.env,telemetry=null,infrastructureFactory=createDocumentWorkerInfrastructure,runtimeFactory=createDocumentWorkerRuntime}={}){
 const infrastructure=await infrastructureFactory({env,telemetry});let base,stopping=null,health=null;
 try{base=runtimeFactory({...infrastructure,telemetry});}catch(error){
  // Until the runtime exists, no lifecycle owns the already-started queue.
  const failures=[error];
  try{await infrastructure.queue?.shutdown();}catch(closeError){failures.push(closeError);}
  try{await infrastructure.close();}catch(closeError){failures.push(closeError);}
  if(failures.length>1)throw new AggregateError(failures,'DOCUMENT_WORKER_CONSTRUCTION_CLEANUP_FAILED');
  throw error;
 }
 const shutdown=()=>stopping||(stopping=(async()=>{const failures=[];let result;try{await health?.close();}catch(error){failures.push(error);}try{result=await base.shutdown();}catch(error){failures.push(error);}try{await infrastructure.close();}catch(error){failures.push(error);}if(failures.length===1)throw failures[0];if(failures.length>1)throw new AggregateError(failures,'Document worker shutdown failed.');return result;})());
 return Object.freeze({registry:base.registry,queue:base.queue,readiness:infrastructure.readiness,async start(){try{const result=await base.start();if(env.DOCUMENT_WORKER_HEALTH_PORT)health=await require('./documentWorkerHealth').startWorkerHealth({port:Number(env.DOCUMENT_WORKER_HEALTH_PORT),check:()=>base.health()});return result;}catch(error){await shutdown();throw error;}},runOnce:()=>base.runOnce(),state:()=>base.state(),shutdown});
}
module.exports={createDocumentWorkerProductionRuntime};
