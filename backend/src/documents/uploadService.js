const crypto = require('node:crypto');
const { assertObjectStoragePort } = require('./objectStoragePort');
const { digest, issueUploadCapability, verifyUploadCapability } = require('./capability');
const { createObjectIdentity } = require('./objectIdentity');
const { validateContent, sanitizeFilename } = require('./contentPolicy');
const { FILE_CLASSES, LIMITS, UPLOAD_FILE_CLASSES } = require('./constants');
function requireDependencies(value) { for (const key of ['authorization','repository','storage','audit','jobs','confirmation','clock']) if (!value[key]) throw new TypeError(`Upload service dependency ${key} is required.`); }
function createUploadService(dependencies) {
  requireDependencies(dependencies); const storage=assertObjectStoragePort(dependencies.storage); const { authorization,repository,audit,jobs,confirmation,clock }=dependencies; const id=dependencies.id||crypto.randomUUID;
  async function authorize(operationCode, context, resourceId) { const decision=await authorization.authorize({operationCode,actor:context.actor,resourceId,assuranceEvidence:context.assuranceEvidence,correlationId:context.correlationId}); if(!decision.allowed) throw Object.assign(new Error('DOCUMENT_NOT_AVAILABLE'),{code:'DOCUMENT_NOT_AVAILABLE'}); return decision; }
  function conflict(){throw Object.assign(new Error('IDEMPOTENCY_CONFLICT'),{code:'IDEMPOTENCY_CONFLICT'});}
  return Object.freeze({
    async createIntent({ context, resourceId, expectedSize, declaredMime, filename, fileClass, checksum, idempotencyKey, versionNumber=1 }) {
      const decision=await authorize(versionNumber===1?'DOCUMENT_UPLOAD_INITIATE':'DOCUMENT_VERSION_CREATE',context,resourceId);
      const policy=FILE_CLASSES[fileClass]; if(!UPLOAD_FILE_CLASSES.includes(fileClass)||!policy||!Number.isInteger(expectedSize)||expectedSize<1||expectedSize>policy.maxBytes||!policy.mime.includes(declaredMime)||!/^[a-f0-9]{64}$/.test(checksum)) throw new Error('DOCUMENT_INTENT_INVALID');
      const displayFilename=sanitizeFilename(filename);
      const existing=typeof repository.findIntent==='function'?await repository.findIntent({organizationId:context.actor.organizationId,idempotencyKey}):null;
      if(existing){
        if(existing.resource_id!==decision.resource.id||existing.created_by_actor_id!==context.actor.id||Number(existing.version_number)!==versionNumber
          ||Number(existing.expected_size)!==expectedSize||existing.expected_file_class!==fileClass||existing.expected_sha256!==checksum
          ||existing.declared_mime!==declaredMime||existing.display_filename!==displayFilename)conflict();
        const binding={organizationId:existing.organization_id,actorId:existing.created_by_actor_id,documentId:existing.document_id,
          versionId:existing.version_id,objectId:existing.object_id,resourceId:existing.resource_id,expectedSize:Number(existing.expected_size),
          declaredMime:existing.declared_mime,checksum:existing.expected_sha256,fileClass:existing.expected_file_class};
        await audit.accept('DOCUMENT_UPLOAD_INTENT_ACCEPTED',{context,documentId:binding.documentId,versionId:binding.versionId});
        if(existing.state!=='PENDING')return Object.freeze({documentId:binding.documentId,versionId:binding.versionId,
          capability:null,expiresAt:null,state:existing.state,replayed:true});
        if(typeof repository.addCapability!=='function')throw new Error('DOCUMENT_INTENT_RECOVERY_UNAVAILABLE');
        const capability=issueUploadCapability({binding,clock});
        await repository.addCapability({organizationId:binding.organizationId,versionId:binding.versionId,
          capabilityDigest:capability.persisted.digest,capabilityExpiresAt:capability.persisted.expiresAt});
        return Object.freeze({documentId:binding.documentId,versionId:binding.versionId,capability:capability.token,
          expiresAt:capability.persisted.expiresAt,state:existing.state,replayed:true});
      }
      const documentId=id(),versionId=id();
      const objectIdentity=createObjectIdentity({documentId,versionId,uuid:id}); const binding={organizationId:context.actor.organizationId,actorId:context.actor.id,documentId,versionId,objectId:objectIdentity.objectId,resourceId:decision.resource.id,expectedSize,declaredMime,checksum,fileClass};
      const capability=issueUploadCapability({binding,clock});
      await audit.accept('DOCUMENT_UPLOAD_INTENT_ACCEPTED',{context,documentId,versionId});
      await repository.createIntent({ ...binding, resourceType:'DOCUMENT_OWNER', versionNumber, objectId:objectIdentity.objectId, displayFilename,idempotencyKey,correlationId:context.correlationId,causationId:context.causationId||null,capabilityDigest:capability.persisted.digest,capabilityExpiresAt:capability.persisted.expiresAt });
      try { dependencies.telemetryPort?.record('F11', 1, { operation: 'upload_intent', result: 'success' }); } catch { /* non-authoritative */ }
      return Object.freeze({documentId,versionId,capability:capability.token,expiresAt:capability.persisted.expiresAt,state:'PENDING',replayed:false});
    },
    async upload({ context, token, source, filename, versionId=null }) {
      const capabilityRecord=await repository.loadCapability({digest:digest(token),organizationId:context.actor.organizationId}); if(!capabilityRecord)throw new Error('UPLOAD_CAPABILITY_INVALID');
      verifyUploadCapability(token,capabilityRecord,{clock});
      if(capabilityRecord.organizationId!==context.actor.organizationId||capabilityRecord.actorId!==context.actor.id||(versionId&&capabilityRecord.versionId!==versionId)) throw new Error('UPLOAD_CAPABILITY_INVALID');
      await authorize('DOCUMENT_UPLOAD_CONFIRM',context,capabilityRecord.resourceId);
      const consumed=await repository.consumeCapability({digest:digest(token),organizationId:capabilityRecord.organizationId,versionId:capabilityRecord.versionId,now:clock().toISOString()}); if(!consumed) throw new Error('UPLOAD_CAPABILITY_INVALID');
      const prefixChunks=[]; let prefixBytes=0; const hasher=crypto.createHash('sha256'); let size=0;
      async function* guarded(){ for await(const raw of source){const chunk=Buffer.from(raw); size+=chunk.length;if(size>capabilityRecord.expectedSize||size>FILE_CLASSES[capabilityRecord.fileClass].maxBytes)throw new Error('DOCUMENT_SIZE_LIMIT_EXCEEDED');hasher.update(chunk);if(prefixBytes<8192){const take=chunk.subarray(0,8192-prefixBytes);prefixChunks.push(take);prefixBytes+=take.length;}yield chunk;} }
      const multipart=capabilityRecord.expectedSize>=LIMITS.multipartThreshold;
      const handle=await storage[multipart?'beginMultipart':'beginWrite']({objectId:capabilityRecord.objectId||capabilityRecord.versionId,storageClass:'QUARANTINE',conditionalCreate:true,expectedSize:capabilityRecord.expectedSize,expectedSha256:capabilityRecord.checksum,declaredMime:capabilityRecord.declaredMime});
      try {
        await repository.transition?.({organizationId:capabilityRecord.organizationId,versionId:capabilityRecord.versionId,fromState:'PENDING',toState:'UPLOADING',scanState:'NOT_REQUESTED',lockVersion:0});
        if(multipart){if(typeof handle.multipartSessionId!=='string'||!handle.multipartSessionId)throw new Error('STORAGE_PROVIDER_RESPONSE_INVALID');await repository.registerMultipart({organizationId:capabilityRecord.organizationId,versionId:capabilityRecord.versionId,objectId:handle.objectId,providerUploadId:handle.multipartSessionId,expiresAt:new Date(clock().getTime()+60*60*1000).toISOString()});}
        if(!multipart) await storage.write(handle,guarded(),{signal:context.signal});
        else { let part=1,buffer=Buffer.alloc(0);for await(const chunk of guarded()){buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=LIMITS.partBytes){if(part>LIMITS.maxParts)throw new Error('DOCUMENT_MULTIPART_LIMIT_EXCEEDED');const result=await storage.writePart(handle,part,require('node:stream').Readable.from([buffer.subarray(0,LIMITS.partBytes)]),{signal:context.signal});await repository.recordMultipartPart({organizationId:capabilityRecord.organizationId,versionId:capabilityRecord.versionId,partNumber:part,size:result.size,sha256:result.sha256||null});part++;buffer=buffer.subarray(LIMITS.partBytes);}}if(buffer.length){if(part>LIMITS.maxParts)throw new Error('DOCUMENT_MULTIPART_LIMIT_EXCEEDED');const result=await storage.writePart(handle,part,require('node:stream').Readable.from([buffer]),{signal:context.signal});await repository.recordMultipartPart({organizationId:capabilityRecord.organizationId,versionId:capabilityRecord.versionId,partNumber:part,size:result.size,sha256:result.sha256||null});}}
        const policy=validateContent({prefix:Buffer.concat(prefixChunks),declaredMime:capabilityRecord.declaredMime,filename:filename||capabilityRecord.displayFilename,expectedClass:capabilityRecord.fileClass}); const sha256=hasher.digest('hex'); if(size!==capabilityRecord.expectedSize||sha256!==capabilityRecord.checksum)throw new Error('DOCUMENT_CHECKSUM_OR_SIZE_MISMATCH'); await storage.commit(handle,{size,sha256,mime:policy.mime||capabilityRecord.declaredMime}); const head=await storage.head({objectId:handle.objectId}); if(!head||head.size!==size||head.sha256!==sha256)throw new Error('DOCUMENT_PROVIDER_CONFIRMATION_MISMATCH');
        await repository.transition?.({organizationId:capabilityRecord.organizationId,versionId:capabilityRecord.versionId,fromState:'UPLOADING',toState:'UPLOADED',scanState:'PENDING',lockVersion:1,observedSize:size,detectedMime:policy.mime||capabilityRecord.declaredMime,sha256});
        await confirmation.confirm({organizationId:capabilityRecord.organizationId,versionId:capabilityRecord.versionId,sha256,size});
        if(multipart)await repository.completeMultipart({organizationId:capabilityRecord.organizationId,versionId:capabilityRecord.versionId,providerUploadId:handle.multipartSessionId});
        await repository.transition?.({organizationId:capabilityRecord.organizationId,versionId:capabilityRecord.versionId,fromState:'UPLOADED',toState:'SCANNING',scanState:'PENDING',lockVersion:2});
        await jobs.enqueueScan({organizationId:capabilityRecord.organizationId,versionId:capabilityRecord.versionId,correlationId:context.correlationId}); try { dependencies.telemetryPort?.record('F11', 1, { operation: 'upload_stream', result: 'success' }); } catch { /* non-authoritative */ } return Object.freeze({state:'PENDING_SCAN',size,sha256,detectedMime:policy.mime,deepInspectionRequired:Boolean(policy.deepInspectionRequired)}); }
      catch (error) {
        const cleanup = await storage.abort(handle).catch(() => null);
        // Leave unconfirmed provider sessions eligible for worker reconciliation.
        if (multipart && cleanup?.aborted === true) {
          await repository.abortMultipart({
            organizationId: capabilityRecord.organizationId,
            versionId: capabilityRecord.versionId,
            providerUploadId: handle.multipartSessionId || null
          }).catch(() => {});
        }
        throw error;
      }
    }
  });
}
module.exports = { createUploadService };
