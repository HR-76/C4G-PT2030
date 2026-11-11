'use strict';
const {randomUUID}=require('node:crypto');
const {snapshotEligible}=require('../security/tenantResolver');
const {sameSnapshot}=require('../security/tenantLeaseExecutor');
const REQUIRED=Object.freeze(['F11_PRIVATE_DOCUMENT_STORAGE','APPLICATION_DOCUMENT_TRANSPORT','DOCUMENT_WORKER_RUNTIME','F4_RUNTIME_METADATA_ACCESS','F7_AUDIT_LEDGER','F9_EXECUTION_LINEAGE']);
const OPERATION=Object.freeze({workload:'API',compatibleSchemaVersions:Object.freeze(['032_document_worker_runtime','033_organizational_opportunity_interests',require('../security/opportunityV2MigrationPackage').tenantAddition.version]),allowedCompatibilityStates:['COMPATIBLE'],accessMode:'WRITE',requiredCapabilities:REQUIRED});
function createDocumentApiPool({organizationId,runtime}){
 async function connect(){
  const correlationId=randomUUID(),snapshot=await runtime.directoryRepository.resolveSnapshotByOrganization(organizationId,'API');
  if(!snapshotEligible(snapshot,organizationId,OPERATION,runtime.regionPolicy))throw Error('DOCUMENT_API_BINDING_UNAVAILABLE');
  runtime.poolManager.synchronizeFence({tenantId:snapshot.tenantId,workload:'API',fence:snapshot.fence,connectionVersion:snapshot.connectionVersion});
  const credentialLease=await runtime.credentialProvider.resolve({...snapshot,correlationId});
  const allocation=await runtime.poolManager.acquire({...snapshot,credentialLease,correlationId,workloadClass:'FUNCTIONAL'});
  let released=false,failed=false;
  try{
   await runtime.bindingVerifier.verify({client:allocation.client,snapshot,requiredCapabilities:REQUIRED,correlationId,phase:'PREPARATION'});
   if(!sameSnapshot(snapshot,await runtime.directoryRepository.resolveSnapshotByOrganization(organizationId,'API')))throw Error('DOCUMENT_API_BINDING_CHANGED');
   const query=async(...args)=>{
    if(released)throw Error('DOCUMENT_API_CLIENT_RELEASED');
    // Cleanup remains possible after authority expires; it cannot commit effects.
    if(/^\s*ROLLBACK\s*;?\s*$/i.test(args[0]))return allocation.client.query(...args);
    if(runtime.poolManager.getFence(snapshot.tenantId,'API')!==allocation.fence||Date.now()>allocation.deadline){failed=true;throw Error('DOCUMENT_API_LEASE_EXPIRED');}
    // Commit is never allowed using a stale binding, even after the effect was prepared.
    if(/^\s*COMMIT\s*;?\s*$/i.test(args[0])){
     if(!sameSnapshot(snapshot,await runtime.directoryRepository.resolveSnapshotByOrganization(organizationId,'API'))){failed=true;throw Error('DOCUMENT_API_BINDING_CHANGED');}
     if(runtime.poolManager.getFence(snapshot.tenantId,'API')!==allocation.fence||Date.now()>allocation.deadline){failed=true;throw Error('DOCUMENT_API_LEASE_EXPIRED');}
    }
    return allocation.client.query(...args);
   };
   return Object.freeze({tenantId:snapshot.tenantId,query,async release(){if(released)return;released=true;await allocation.release({discard:failed});}});
  }catch(error){await allocation.release({discard:true,cause:error});throw error;}
 }
 return Object.freeze({connect});
}
module.exports={createDocumentApiPool,REQUIRED};
