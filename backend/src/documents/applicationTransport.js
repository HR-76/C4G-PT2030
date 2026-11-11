'use strict';
const {createUploadService}=require('./uploadService');
const {createConfirmationService}=require('./confirmationService');
const {isDownloadable}=require('./stateMachine');
const {defaultDownloadStaging}=require('./downloadStaging');
const {sanitizeFilename}=require('./contentPolicy');
const {createDocumentDeletionService}=require('./deletionService');
const INTENT_FIELDS=Object.freeze(['expectedSize','declaredMime','filename','fileClass','checksum','idempotencyKey','versionNumber']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function required(value,names){for(const name of names)if(!value?.[name])throw new TypeError(`Application document transport dependency ${name} is required.`)}
function intentInput(value){
 if(!value||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).sort().join(',')!==[...INTENT_FIELDS].sort().join(','))throw Object.assign(new Error('DOCUMENT_INTENT_INVALID'),{code:'DOCUMENT_INTENT_INVALID'});
 if(!Number.isSafeInteger(value.versionNumber)||value.versionNumber<1||!UUID.test(value.idempotencyKey))throw Object.assign(new Error('DOCUMENT_INTENT_INVALID'),{code:'DOCUMENT_INTENT_INVALID'});
 return Object.freeze({...value});
}
function createApplicationDocumentTransport(dependencies){
 required(dependencies,['accessPort','repositoryFactory','storageFactory','auditFactory','jobs','reconciliationFactory','clock']);
 const {accessPort,repositoryFactory,storageFactory,auditFactory,jobs,reconciliationFactory,clock}=dependencies;
 function ports(organizationId){const repository=repositoryFactory(organizationId),storage=storageFactory(organizationId),audit=auditFactory(organizationId),reconciliation=reconciliationFactory(organizationId);required({repository,storage,audit,reconciliation},['repository','storage','audit','reconciliation']);return {repository,storage,audit,reconciliation}}
 async function uploadService(request,applicationId,operationCode,afterAuthorization){
  const authorization=await accessPort.authorize({request,applicationId,operationCode});afterAuthorization?.();const p=ports(authorization.context.actor.organizationId);
  const confirmation=createConfirmationService({repository:p.repository,reconciliation:p.reconciliation,audit:p.audit});
  const alreadyAuthorized=Object.freeze({authorize:async({resourceId})=>Object.freeze({allowed:resourceId===applicationId,resource:Object.freeze({id:applicationId})})});
  return {service:createUploadService({...p,authorization:alreadyAuthorized,jobs,confirmation,clock,id:dependencies.id}),context:authorization.context};
 }
 return Object.freeze({
  async createIntent({request,applicationId,input}){let safe;const {service,context}=await uploadService(request,applicationId,(input?.versionNumber??1)===1?'DOCUMENT_UPLOAD_INITIATE':'DOCUMENT_VERSION_CREATE',()=>{safe=intentInput(input)});return service.createIntent({context,resourceId:applicationId,...safe})},
  async upload({request,applicationId,versionId,token,source}){const {service,context}=await uploadService(request,applicationId,'DOCUMENT_UPLOAD_CONFIRM');return service.upload({context,versionId,token,source})},
  async deleteDocument({request,applicationId,documentId,versionId}){
   if(!UUID.test(documentId||'')||!UUID.test(versionId||''))throw Object.assign(new Error('DOCUMENT_NOT_AVAILABLE'),{code:'DOCUMENT_NOT_AVAILABLE'});
   if(typeof accessPort.assertDeletable!=='function')throw Object.assign(new Error(),{code:'SERVICE_UNAVAILABLE'});
   const authorization=await accessPort.authorize({request,applicationId,operationCode:'DOCUMENT_VERSION_CREATE'});
   const p=ports(authorization.context.actor.organizationId);
   const service=createDocumentDeletionService({repository:p.repository,storage:p.storage,audit:p.audit,guard:{assertDeletable:input=>accessPort.assertDeletable({request,applicationId,documentId:input.documentId})}});
   return service.deleteDocument({context:authorization.context,applicationId,documentId,versionId});
  },
  async download({organizationId,versionId,signal,revalidate}){
   if(typeof revalidate!=='function')throw Object.assign(new Error(),{code:'SERVICE_UNAVAILABLE'});
   await revalidate();
   const {repository,storage,audit}=ports(organizationId);
   const unavailable=()=>Object.assign(new Error('DOCUMENT_NOT_AVAILABLE'),{code:'DOCUMENT_NOT_AVAILABLE'});
   const identity=record=>{
    if(!isDownloadable(record)||!(record.confirmedAt||record.confirmed_at))throw unavailable();
    return {objectId:record.objectId||record.object_id,storageClass:record.storageClass||record.storage_class||'QUARANTINE',
     size:Number(record.observedSize??record.observed_size),sha256:record.sha256};
   };
   const record=await repository.findVersion({organizationId,versionId}),expected=identity(record);
   const staged=await (dependencies.downloadStaging||defaultDownloadStaging).prepare({storage,...expected,signal});
   try{
    // Critical audit records a verified access grant, not issuance of a signed URL.
    await audit.accept('DOCUMENT_ALLOWED',{organizationId,versionId,result:'VERIFIED_DOWNLOAD'});
    await revalidate();
    const current=identity(await repository.findVersion({organizationId,versionId}));
    if(JSON.stringify(current)!==JSON.stringify(expected))throw unavailable();
    signal?.throwIfAborted();
    const filename=sanitizeFilename(record.displayFilename||record.display_filename);
    return Object.freeze({...staged,headers:Object.freeze({'Content-Type':'application/octet-stream',
     'Content-Length':String(staged.size),'Content-Disposition':`attachment; filename="${filename.replace(/[^\x20-\x7e]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g,value=>'%'+value.charCodeAt(0).toString(16))}`,
     'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Accept-Ranges':'none'})});
   }catch(error){await staged.dispose();throw error;}
  }
 });
}
module.exports={createApplicationDocumentTransport};
