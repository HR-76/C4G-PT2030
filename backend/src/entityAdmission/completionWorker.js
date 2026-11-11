'use strict';
// Scheduler invokes runOnce in its own process. No credential material or API request.
function createCompletionWorker(service){
 let running=false;
 return Object.freeze({async runOnce(){if(running)return [];running=true;const results=[];try{for(const id of await service.pending()){try{await service.prepare(id);results.push({id,confirmed:true});}catch{results.push({id,confirmed:false});}}return results;}finally{running=false;}}});
}
module.exports={createCompletionWorker};
