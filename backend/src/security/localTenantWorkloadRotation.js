'use strict';
const {requireTenantWorkload}=require('./tenantWorkload');
function createLocalTenantWorkloadRotation({directory,credentialProvider,validator,poolManager,revokeCredential}){
 if(!directory||!credentialProvider||typeof validator!=='function'||!poolManager||typeof revokeCredential!=='function')throw new TypeError('Local workload rotation dependencies are incomplete.');
 return Object.freeze({async rotate(input){
  requireTenantWorkload(input?.workload);const published=await directory.resolvePublished(input);
  if(published&&published.connectionVersion===input.connectionVersion){if(published.credentialRef!==input.credentialRef||published.bindingDigest!==input.bindingDigest)throw new Error('F44_ROTATION_CONFLICT');const versions=await directory.listVersions(input),pending=versions.filter(version=>version.lifecycleStatus==='DRAINING');poolManager.synchronizeFence({tenantId:input.tenantId,workload:input.workload,fence:published.fence,connectionVersion:published.connectionVersion});for(const previous of pending){await poolManager.drainVersion({tenantId:input.tenantId,workload:input.workload,connectionVersion:previous.connectionVersion});if(typeof poolManager.awaitDrained==='function')await poolManager.awaitDrained({tenantId:input.tenantId,workload:input.workload,connectionVersion:previous.connectionVersion});await revokeCredential({tenantId:input.tenantId,workload:input.workload,connectionVersion:previous.connectionVersion});await directory.markDrained({tenantId:input.tenantId,workload:input.workload,connectionVersion:previous.connectionVersion});}return Object.freeze({published,converged:true,reconciled:pending.length});}
  const expectedFence=published?published.fence:0,expectedCurrentVersion=published?published.connectionVersion:null;
  await directory.createCandidate(input);let credential;
  try{credential=await credentialProvider.resolve({credentialRef:input.credentialRef,tenantId:input.tenantId,workload:input.workload,connectionVersion:input.connectionVersion,correlationId:input.correlationId});const evidence=await validator({input,credential});if(!evidence||evidence.bindingDigest!==input.bindingDigest||evidence.workload!==input.workload)throw new Error('F44_CANDIDATE_INCOMPATIBLE');await directory.validateCandidate({...input,compatibilityStatus:'COMPATIBLE',provisioningStatus:'READY'});}
  catch{await directory.validateCandidate({...input,compatibilityStatus:'INCOMPATIBLE',provisioningStatus:'FAILED',failureCode:'CANDIDATE_INCOMPATIBLE'}).catch(()=>{});throw new Error('F44_CANDIDATE_INCOMPATIBLE');}
  finally{if(credential)await credential.dispose().catch(()=>{});}
  const cutover=await directory.publishCandidate({...input,expectedFence,expectedCurrentVersion});
  poolManager.synchronizeFence({tenantId:input.tenantId,workload:input.workload,fence:expectedFence,connectionVersion:expectedCurrentVersion});
  if(expectedCurrentVersion!==null){await poolManager.drainVersion({tenantId:input.tenantId,workload:input.workload,connectionVersion:expectedCurrentVersion});if(typeof poolManager.awaitDrained==='function')await poolManager.awaitDrained({tenantId:input.tenantId,workload:input.workload,connectionVersion:expectedCurrentVersion});await revokeCredential({tenantId:input.tenantId,workload:input.workload,connectionVersion:expectedCurrentVersion});await directory.markDrained({tenantId:input.tenantId,workload:input.workload,connectionVersion:expectedCurrentVersion});}
  poolManager.synchronizeFence({tenantId:input.tenantId,workload:input.workload,fence:cutover.current.fence,connectionVersion:input.connectionVersion});
  return Object.freeze({published:cutover.current,previousConnectionVersion:expectedCurrentVersion,converged:false});
 }});
}
module.exports={createLocalTenantWorkloadRotation};
