'use strict';
const {LIMITS}=require('./constants');
const failure=code=>Object.assign(new Error(code),{code});
function createDocumentConcurrency({global=LIMITS.globalConcurrency,perOrganization=LIMITS.organizationConcurrency,queueLimit=64,perOrganizationQueueLimit=16}={}){
 if(!Number.isInteger(global)||!Number.isInteger(perOrganization)||global<1||global>4||perOrganization<1||perOrganization>2||perOrganization>global
   ||!Number.isInteger(queueLimit)||queueLimit<1||queueLimit>64||!Number.isInteger(perOrganizationQueueLimit)||perOrganizationQueueLimit<1||perOrganizationQueueLimit>16||perOrganizationQueueLimit>queueLimit)throw new TypeError('Document concurrency limits are invalid.');
 let active=0;const organizations=new Map(),queue=[];
 function start(item){
  item.signal?.removeEventListener('abort',item.abort);active++;organizations.set(item.organizationId,(organizations.get(item.organizationId)||0)+1);
  Promise.resolve().then(item.operation).finally(()=>{active--;const next=organizations.get(item.organizationId)-1;if(next)organizations.set(item.organizationId,next);else organizations.delete(item.organizationId);drain();}).then(item.resolve,item.reject);
 }
 function drain(){for(let i=0;i<queue.length&&active<global;i++){const item=queue[i];if((organizations.get(item.organizationId)||0)>=perOrganization)continue;queue.splice(i--,1);start(item);}}
 function run(organizationId,operation,{signal}={}){
  if(typeof organizationId!=='string'||typeof operation!=='function'||(signal!==undefined&&(!signal||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'||typeof signal.aborted!=='boolean')))throw new TypeError('Document concurrency request is invalid.');
  if(signal?.aborted)return Promise.reject(failure('DOCUMENT_QUEUE_CANCELLED'));
  const canStart=active<global&&(organizations.get(organizationId)||0)<perOrganization;
  if(!canStart&&(queue.length>=queueLimit||queue.filter(item=>item.organizationId===organizationId).length>=perOrganizationQueueLimit))return Promise.reject(failure('DOCUMENT_QUEUE_FULL'));
  return new Promise((resolve,reject)=>{
   const item={organizationId,operation,signal,resolve,reject,abort:null};
   item.abort=()=>{const index=queue.indexOf(item);if(index<0)return;queue.splice(index,1);signal.removeEventListener('abort',item.abort);reject(failure('DOCUMENT_QUEUE_CANCELLED'));drain();};
   if(canStart)start(item);else{queue.push(item);signal?.addEventListener('abort',item.abort,{once:true});if(signal?.aborted)item.abort();}
  });
 }
 return Object.freeze({run,snapshot:()=>Object.freeze({active,queued:queue.length,organizations:organizations.size})});
}
module.exports={createDocumentConcurrency};
