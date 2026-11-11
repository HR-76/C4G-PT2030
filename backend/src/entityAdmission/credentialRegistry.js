'use strict';
const {uuid,fail}=require('../platformOnboarding/contracts');
// Private encrypted journal; only the API binding may cross the IPC boundary.
function createCredentialRegistry({journal,directory,probe}){
 const tuple=(e,r)=>e&&e.tenantId===r.tenantId&&e.credentialRef===r.credentialRef&&e.connectionVersion===r.connectionVersion;
 return Object.freeze({
  async publish(binding,api,worker){
   for(const key of ['operationId','organizationId','globalUserId','membershipId'])uuid(binding[key]);
   if(api.tenantId!==binding.organizationId||worker.tenantId!==api.tenantId||api.database!==worker.database||api.login===worker.login)fail('CREDENTIAL_BINDING_INVALID');
   for(const [workload,material] of [['API',api],['WORKER',worker]]){
    const snapshot=await directory.resolveSnapshotByOrganization(binding.organizationId,workload);
    if(!tuple(material,snapshot)||material.database!==snapshot.databaseRef)fail('CREDENTIAL_BINDING_INVALID');
    await probe(material,snapshot,workload);
   }
   await journal.reserve(binding.organizationId,{...binding,api,worker},()=>({binding,api,worker}));
   return {...binding,published:true};
  },
  async resolve(request){
   if(request.workload!=='API')fail('CREDENTIAL_UNAVAILABLE');uuid(request.tenantId);
   const {api,binding}=await journal.get(request.tenantId);
   const snapshot=await directory.resolveSnapshotByOrganization(binding.organizationId,'API');
   if(!tuple(api,request)||!tuple(api,snapshot)||api.database!==snapshot.databaseRef)fail('CREDENTIAL_UNAVAILABLE');
   return {...api};
  }
 });
}
module.exports={createCredentialRegistry};
