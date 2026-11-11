'use strict';

const {createDocumentJobRegistry}=require('./jobs');
const {createConfirmationService}=require('./confirmationService');
const {createExpirationService}=require('./expirationService');
const {result}=require('../async/jobResult');

function normalize(row){return Object.fromEntries(Object.entries(row).map(([key,value])=>[key.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),['expected_size','observed_size','lock_version'].includes(key)&&value!==null?Number(value):value]));}
function cancellation(signal){if(signal?.aborted)throw Object.assign(new Error('WORKER_DRAINING'),{code:'WORKER_DRAINING'});}
async function fenced(assertFence,signal){if(typeof assertFence==='function')await assertFence();cancellation(signal);}

function createDocumentWorker({portsForOrganization,actor=Object.freeze({type:'SERVICE',serviceActorCode:'F11_DOCUMENT_WORKER'}),clock=()=>new Date()}){
 if(typeof portsForOrganization!=='function')throw new TypeError('Document worker ports are required.');
 const ports=organizationId=>{const value=portsForOrganization(organizationId);if(!value||!value.repository||!value.storage||!value.scanService||!value.audit)throw new TypeError('Document worker tenant ports are incomplete.');return value;};
 const handlers={
  'document.scan':async({payload,fencingToken,signal=null,assertFence=null})=>{
    cancellation(signal);const p=ports(payload.organizationId);
    const source=await p.repository.findVersion({organizationId:payload.organizationId,versionId:payload.versionId});
    cancellation(signal);if(!source)throw new Error('DOCUMENT_NOT_AVAILABLE');
    const record=await p.scanService.scan({record:normalize(source),actor,fencingToken,signal,assertFence:assertFence||undefined});
    return Object.freeze({jobResult:result('SUCCESS'),record});
  },
  'document.reconcile':async({payload,fencingToken,signal=null,assertFence=null})=>{
    cancellation(signal);const p=ports(payload.organizationId),limit=payload.limit||25;
    const expired=await p.repository.claimExpiredMultipart({organizationId:payload.organizationId,limit});
    for(const source of expired){
      cancellation(signal);const record=normalize(source);
      await fenced(assertFence,signal);
      await p.storage.abortMultipartSession({objectId:record.objectId,storageClass:'QUARANTINE',providerUploadId:record.providerUploadId,signal});
      await fenced(assertFence,signal);
      await p.repository.abortMultipart({organizationId:payload.organizationId,versionId:record.versionId,providerUploadId:record.providerUploadId});
    }
    cancellation(signal);const candidates=await p.repository.claimTransportRecovery({organizationId:payload.organizationId,limit}),recovered=[];
    for(const source of candidates){
      cancellation(signal);let record=normalize(source);
      if(record.state==='UPLOADING'){
        const head=await p.storage.head({objectId:record.objectId,signal});cancellation(signal);
        if(!head||head.size!==Number(record.expectedSize)||head.sha256!==record.expectedSha256){await fenced(assertFence,signal);await p.reconciliation?.record({code:'CONFIRMATION_UNCERTAIN',organizationId:record.organizationId,versionId:record.versionId});continue;}
        await fenced(assertFence,signal);
        const updated=await p.repository.transition({organizationId:record.organizationId,versionId:record.versionId,fromState:'UPLOADING',toState:'UPLOADED',scanState:'PENDING',lockVersion:record.lockVersion,observedSize:head.size,detectedMime:head.mime||null,sha256:head.sha256});
        record=normalize({...source,...updated,state:'UPLOADED',observed_size:head.size,sha256:head.sha256});
      }
      if(record.state==='UPLOADED'){
        await fenced(assertFence,signal);await createConfirmationService({repository:p.repository,reconciliation:p.reconciliation,audit:p.audit}).confirm({organizationId:record.organizationId,versionId:record.versionId,sha256:record.sha256,size:Number(record.observedSize)});
        await fenced(assertFence,signal);
        const updated=await p.repository.transition({organizationId:record.organizationId,versionId:record.versionId,fromState:'UPLOADED',toState:'SCANNING',scanState:'PENDING',lockVersion:record.lockVersion});
        record=normalize({...source,...updated,state:'SCANNING',observed_size:record.observedSize,sha256:record.sha256});
      }
      if(record.state==='SCANNING'){
        await p.scanService.scan({record,actor,fencingToken,signal,assertFence:assertFence||undefined});recovered.push(record.versionId);
      }
    }
    return Object.freeze({jobResult:result('SUCCESS'),aborted:Object.freeze(expired.map(record=>record.version_id||record.versionId)),recovered:Object.freeze(recovered)});
  },
  'document.expire_upload':async({payload,signal=null,assertFence=null})=>{
    cancellation(signal);const p=ports(payload.organizationId);
    const record=await createExpirationService({repository:p.repository,storage:p.storage,audit:p.audit,clock}).expire(payload.record,{signal,assertFence:assertFence||undefined});
    return Object.freeze({jobResult:result('SUCCESS'),record});
  }
 };
 return Object.freeze({registry:createDocumentJobRegistry(handlers),handlers:Object.freeze(handlers)});
}
module.exports={createDocumentWorker};
