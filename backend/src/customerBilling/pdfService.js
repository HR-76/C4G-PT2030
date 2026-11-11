'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {Readable}=require('node:stream');
const {validateContent}=require('../documents/contentPolicy');
const {LIMITS}=require('../documents/constants');
const {uuid,fail}=require('../platformBilling/contracts');
const {publicFile}=require('./pdfRepository');
const MAX_BYTES=10*1024*1024;
function inspectPdf(bytes,filename) {
  if(!Buffer.isBuffer(bytes)||bytes.length<16||bytes.length>MAX_BYTES)fail('PDF_INVALID');
  let safe;try{safe=validateContent({prefix:bytes.subarray(0,512),declaredMime:'application/pdf',filename,expectedClass:'PDF'}).filename}catch{fail('PDF_INVALID')}
  const tail=bytes.subarray(Math.max(0,bytes.length-2048)).toString('latin1');
  const xref=/startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
  if(!/^%PDF-(?:1\.[0-7]|2\.0)/.test(bytes.subarray(0,10).toString())||!xref||Number(xref[1])>=bytes.length)fail('PDF_INVALID');
  const target=bytes.subarray(Number(xref[1]),Number(xref[1])+40).toString('latin1');
  if(!/^(?:xref\b|\d+\s+\d+\s+obj\b)/.test(target))fail('PDF_INVALID');
  return {filename:safe,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
}
function createPdfService({repository,storageFactory,scannerFactory,customerAuthorize}) {
  async function put(storage,objectId,bytes,meta,storageClass,signal){
    const handle=await storage.beginWrite({objectId,storageClass,expectedSize:meta.size,expectedSha256:meta.sha256,declaredMime:'application/pdf',conditionalCreate:true});
    try{await storage.write(handle,Readable.from([bytes]),{signal});await storage.commit(handle,{size:meta.size,sha256:meta.sha256,mime:'application/pdf'})}
    catch(error){await storage.abort(handle).catch(()=>{});throw error}
  }
  async function scope(request,documentId,customer){
    uuid(documentId);
    const org=customer?await customerAuthorize(request):await repository.admin(request,documentId);
    if(customer)await repository.customerDocument(org,documentId);
    return org;
  }
  return {
    async list(request,documentId,customer=false){
      const org=await scope(request,documentId,customer),rows=await repository.versions(org,documentId);
      await scope(request,documentId,customer);
      return {items:rows.map(publicFile),canUpload:!customer,maxBytes:MAX_BYTES};
    },
    async upload(request,documentId,bytes,input,signal){
      signal?.throwIfAborted();
      const org=await scope(request,documentId,false);
      if(!input||Object.keys(input).sort().join(',')!=='expectedVersion,filename,requestId')fail('INVALID_INPUT');
      uuid(input.requestId);
      if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||input.expectedVersion>2147483646)fail('INVALID_INPUT');
      const meta=inspectPdf(bytes,input.filename),rows=await repository.versions(org,documentId);
      const prior=rows.find(row=>row.request_id===input.requestId&&row.created_by===request.user.id);
      if(prior){if(prior.sha256!==meta.sha256||prior.filename!==meta.filename||prior.version!==input.expectedVersion+1)fail('IDEMPOTENCY_CONFLICT');return publicFile(prior)}
      if((rows[0]?.version||0)!==input.expectedVersion)fail('STALE_REVISION');
      const objectId=randomUUID(),storage=storageFactory(org),scanner=scannerFactory(org);
      await put(storage,objectId,bytes,meta,'QUARANTINE',signal);
      const scan=await scanner.scan({organizationId:org,objectId,expectedSize:meta.size,expectedSha256:meta.sha256,signal});
      if(scan?.status!=='CLEAN')fail(scan?.status==='INFECTED'?'PDF_REJECTED':'PDF_SCAN_UNAVAILABLE');
      signal?.throwIfAborted();
      await scope(request,documentId,false);
      await put(storage,objectId,bytes,meta,'DOCUMENTS',signal);
      signal?.throwIfAborted();
      return publicFile(await repository.save(request,documentId,{...meta,...input,filename:meta.filename,objectId}));
    },
    async download(request,documentId,versionId,customer,signal){
      uuid(versionId);const org=await scope(request,documentId,customer);
      const row=(await repository.versions(org,documentId)).find(item=>item.id===versionId);
      if(!row||row.scan_state!=='CLEAN'||row.size_bytes>MAX_BYTES||row.size_bytes<16)fail('RESOURCE_NOT_AVAILABLE');
      const storage=storageFactory(org),head=await storage.head({objectId:row.object_id,storageClass:'DOCUMENTS',signal});
      if(head?.size!==row.size_bytes||!head.etag)fail('PDF_INTEGRITY_FAILED');
      const chunks=[],hash=createHash('sha256');let count=0;
      for(let start=0;start<row.size_bytes;start+=LIMITS.maxRangeBytes){
        signal?.throwIfAborted();const end=Math.min(row.size_bytes-1,start+LIMITS.maxRangeBytes-1);
        const stream=await storage.readRange({objectId:row.object_id,storageClass:'DOCUMENTS',start,end,etag:head.etag,signal});let range=0;
        try{for await(const chunk of stream){signal?.throwIfAborted();range+=chunk.length;count+=chunk.length;if(range>end-start+1||count>row.size_bytes)fail('PDF_INTEGRITY_FAILED');hash.update(chunk);chunks.push(Buffer.from(chunk))}}finally{stream.destroy?.()}
        if(range!==end-start+1)fail('PDF_INTEGRITY_FAILED');
      }
      if(count!==row.size_bytes||hash.digest('hex')!==row.sha256)fail('PDF_INTEGRITY_FAILED');
      // No response bytes are sent before the second access check.
      await scope(request,documentId,customer);signal?.throwIfAborted();
      return {filename:row.filename,bytes:Buffer.concat(chunks,count)};
    }
  };
}
module.exports={MAX_BYTES,inspectPdf,createPdfService};
