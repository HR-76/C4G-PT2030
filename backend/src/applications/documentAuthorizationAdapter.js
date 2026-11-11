'use strict';
const {createUuidV7}=require('../audit/uuidV7');
const ALLOWED=new Set(['DOCUMENT_UPLOAD_INITIATE','DOCUMENT_UPLOAD_CONFIRM','DOCUMENT_VERSION_CREATE']);
function createApplicationDocumentAuthorizationAdapter({applicationService,correlationId=createUuidV7}){
 if(!applicationService||typeof applicationService.execute!=='function')throw new TypeError('Application document authorization requires the application service.');
 if(typeof correlationId!=='function')throw new TypeError('Application document authorization requires a correlation ID factory.');
 return Object.freeze({async assertDeletable({request,applicationId,documentId}){
  try{await applicationService.execute('documentDeletionGuard',{documentId},applicationId,request)}catch(error){
   if(['SESSION_REQUIRED','NOT_AUTHORIZED','AUTHORITY_REQUIRED','AUTHORITY_UNAVAILABLE','STATE_CONFLICT'].includes(error?.code))throw error;
   throw Object.assign(new Error('DOCUMENT_NOT_AVAILABLE'),{code:'DOCUMENT_NOT_AVAILABLE'});
  }
 },async authorize({request,applicationId,operationCode}){
  if(!ALLOWED.has(operationCode))throw Object.assign(new Error('DOCUMENT_NOT_AVAILABLE'),{code:'DOCUMENT_NOT_AVAILABLE'});
  let result;try{result=await applicationService.execute('documentTransportAccess',{operationCode},applicationId,request)}catch(error){
   if(['SESSION_REQUIRED','NOT_AUTHORIZED','AUTHORITY_REQUIRED','AUTHORITY_UNAVAILABLE'].includes(error?.code))throw error;
   throw Object.assign(new Error('DOCUMENT_NOT_AVAILABLE'),{code:'DOCUMENT_NOT_AVAILABLE'});
  }
  if(!result||result.organizationId!==result.actor?.organizationId)throw Object.assign(new Error('DOCUMENT_NOT_AVAILABLE'),{code:'DOCUMENT_NOT_AVAILABLE'});
  return Object.freeze({context:Object.freeze({actor:Object.freeze({...result.actor}),correlationId:correlationId(),causationId:null,signal:request.signal}),resourceId:applicationId});
 }});
}
module.exports={createApplicationDocumentAuthorizationAdapter};
