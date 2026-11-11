'use strict';
const path=require('node:path');
const {createOpportunityImportWorkerEntrypoint}=require('../opportunityImports/workerEntrypoint');
const {createOpportunityImportWorkerInfrastructure}=require('./opportunityImportWorkerInfrastructure');
function loadF11Provider(env){
 const configured=env.OPPORTUNITY_IMPORT_F11_PROVIDER;
 if(typeof configured!=='string'||!configured||!path.isAbsolute(configured))throw new TypeError('F12 XLSX F11 provider must be an explicit absolute module path.');
 const loaded=require(configured);
 if(!loaded||Reflect.ownKeys(loaded).some(key=>key!=='createOpportunityImportF11Boundary')||typeof loaded.createOpportunityImportF11Boundary!=='function')throw new TypeError('F12 XLSX F11 provider contract is invalid.');
 return loaded.createOpportunityImportF11Boundary;
}
async function createOpportunityImportWorkerRuntime({env=process.env,telemetry=null,f11Provider=null}={}){
 const f11=await(f11Provider||loadF11Provider(env))({env,telemetry});
 if(!f11||Reflect.ownKeys(f11).some(key=>!['documentPortFactory','close'].includes(key))||typeof f11.documentPortFactory!=='function'||typeof f11.close!=='function')throw new TypeError('F12 XLSX F11 boundary is incomplete or open.');
 const infrastructure=await createOpportunityImportWorkerInfrastructure({env,telemetry,documentPortFactory:f11.documentPortFactory});
 const base=createOpportunityImportWorkerEntrypoint({...infrastructure,telemetry});let stopping=null;
 return Object.freeze({registry:base.registry,queue:base.queue,start:()=>base.start(),runOnce:()=>base.runOnce(),shutdown:()=>stopping||(stopping=(async()=>{const failures=[];try{await base.shutdown();}catch(error){failures.push(error);}try{await infrastructure.close();}catch(error){failures.push(error);}try{await f11.close();}catch(error){failures.push(error);}if(failures.length===1)throw failures[0];if(failures.length>1)throw new AggregateError(failures,'F12 import worker shutdown failed.');})())});
}
module.exports={createOpportunityImportWorkerRuntime};
