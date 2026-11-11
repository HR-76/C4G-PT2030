const { isDownloadable } = require('./stateMachine');
const { LIMITS } = require('./constants');
const { sanitizeFilename } = require('./contentPolicy');
function createDownloadService({ authorization, repository, storage, audit, telemetryPort = null, clock=()=>new Date() }) { return Object.freeze({ async request({context,versionId,range=null}){
  const decision=await authorization.authorize({operationCode:'DOCUMENT_DOWNLOAD_REQUEST',actor:context.actor,resourceId:versionId,assuranceEvidence:context.assuranceEvidence,correlationId:context.correlationId}); if(!decision.allowed)throw new Error('DOCUMENT_NOT_AVAILABLE');
  const record=await repository.findVersion({organizationId:context.actor.organizationId,versionId}); if(!isDownloadable(record)) { await audit.emit('DOCUMENT_ACCESS_BLOCKED',{context,versionId,result:'DENIED'}).catch(()=>{}); throw new Error('DOCUMENT_NOT_AVAILABLE'); }
  if(range && (!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<0||range.end<range.start||range.end-range.start+1>LIMITS.maxRangeBytes))throw new Error('DOCUMENT_RANGE_INVALID');
  await audit.accept('DOCUMENT_ACCESS_CAPABILITY_ISSUED',{context,versionId}); const capability=await storage.createDownloadCapability({objectId:record.objectId||record.object_id,expiresAt:new Date(clock().getTime()+LIMITS.downloadCapabilityMs).toISOString(),range});
  try { telemetryPort?.record('F11',1,{operation:'download',result:'success'}); } catch {}
  return Object.freeze({capability,headers:Object.freeze({'Content-Disposition':`attachment; filename="${sanitizeFilename(record.displayFilename||record.display_filename)}"`,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}),cors:'EXACT_ORIGIN_ONLY',range:'SINGLE_RANGE_ONLY'});
}}); }
module.exports = { createDownloadService };
