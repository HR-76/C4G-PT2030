'use strict';
const {createBudgetClient}=require('./shared-r2-budget');
const {budgetFetch}=require('./shared-budget-transport');
const missing=e=>e?.$metadata?.httpStatusCode===404||['NoSuchKey','NotFound'].includes(e?.name);

// Reuses the previous proof's closed scope, conditional create, provenance HEAD
// and bounded cleanup protocol. All counters now belong to the coordinator.
function createSharedSafeguards({coordinator,tokens,proofTag,buckets,origin,parentBudget}){
 const functional=createBudgetClient({port:coordinator.port,token:tokens.functional});
 const cleanup=createBudgetClient({port:coordinator.port,token:tokens.cleanup});
 const prefix=`${proofTag}/`;
 function scope(input){if(input.Bucket&&!buckets.includes(input.Bucket)||input.Key&&!input.Key.startsWith(prefix)||input.Prefix&&!input.Prefix.startsWith(prefix))throw new Error('R2_PROOF_SCOPE_INVALID');}
 function intention(input){return coordinator.intentions().find(row=>row.provenance?.bucket===input.Bucket&&row.provenance?.key===input.Key);}
 const api={snapshot(){const value=coordinator.snapshot().budget;return Object.fromEntries(Object.entries(value).map(([key,n])=>[key,key==='unresolvedMultipart'?n:n-parentBudget[key]]));},
  recordTransport(){/* STARTED/CONFIRMED/UNCERTAIN are durably recorded by the coordinator. */},close(){},
  async registerObjectIntent({Bucket,Key,sha256,size}){scope({Bucket,Key});const existing=intention({Bucket,Key});
   if(existing){if(existing.provenance.sha256!==sha256||existing.provenance.size!==size)throw new Error('R2_PROOF_INTENT_CONFLICT');return;}
   const objectId=Key.slice(prefix.length);await functional.perform('OBJECT_INTENT',0,async()=>{}, {objectId,provenance:{bucket:Bucket,key:Key,sha256,size,proofTag}});
  },
  instrumentClient(client){const send=client.send.bind(client);client.send=async(command,options={})=>{
   const attempts=typeof client.config?.maxAttempts==='function'?await client.config.maxAttempts():client.config?.maxAttempts;
   if(attempts!==1||client.config?.followRegionRedirects===true)throw new Error('BUDGET_RETRIES_FORBIDDEN');
   const input=command.input||{},operation=command.constructor.name.replace(/Command$/,'');scope(input);
   let bytes=0,objectId;
   if(operation==='PutObject'){
    const record=intention(input);if(!record||input.IfNoneMatch!=='*'||input.ContentLength!==record.provenance.size)throw new Error('R2_PROOF_PROVENANCE_REQUIRED');
    input.Metadata={...input.Metadata,c4gproof:proofTag,c4gintent:record.id};bytes=input.ContentLength;objectId=record.objectId;
   }
   if(operation==='GetObject'){const range=/^bytes=(\d+)-(\d+)$/.exec(input.Range||'');if(!range)throw new Error('BUDGET_GET_BOUND_REQUIRED');bytes=Number(range[2])-Number(range[1])+1;}
   return (options.proofPhase==='cleanup'?cleanup:functional).perform(operation,bytes,()=>send(command,{...options,proofPhase:undefined}),{objectId});
  };return client;},
  controlledFetch:(fetcher,url,init,{expectedBytes})=>budgetFetch(functional,fetcher,url,{origin,expectedBytes,headers:init?.headers}),
  async cleanupKnownResources(client,sdk){let uncertain=false,partial=false;
   for(const row of coordinator.intentions()){
    const p=row.provenance;if(!p)continue;const input={Bucket:p.bucket,Key:p.key};let head;
    try{head=await client.send(new sdk.HeadObjectCommand(input),{proofPhase:'cleanup'});}catch(error){if(missing(error))continue;uncertain=true;continue;}
    if(head.Metadata?.c4gproof!==proofTag||head.Metadata?.c4gintent!==row.id||head.Metadata?.sha256!==p.sha256||Number(head.ContentLength)!==p.size){partial=true;continue;}
    try{await client.send(new sdk.DeleteObjectCommand(input),{proofPhase:'cleanup'});
     try{await client.send(new sdk.HeadObjectCommand(input),{proofPhase:'cleanup'});partial=true;}catch(error){if(!missing(error))uncertain=true;}
    }catch{uncertain=true;}
   }return{status:uncertain?'UNCERTAIN':partial?'PARTIAL':'COMPLETE'};
  }
 };
 return Object.freeze(api);
}
module.exports={createSharedSafeguards};
