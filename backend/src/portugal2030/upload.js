'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {MIME,MAX_BYTES}=require('./planXlsxV2');
const {listPlanSheets}=require('./planXlsxReader');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code})};
const publicRecord=row=>({requestId:row.requestId,documentId:row.documentId,documentVersionId:row.documentVersionId,filename:row.filename,sizeBytes:row.sizeBytes,sha256:row.sha256,sheets:row.sheets,state:'AVAILABLE',scanState:'CLEAN'});
function createCentralUpload({repository,storage,scanner,listSheets=listPlanSheets}){
 const pending=new Set();
 function identifiers(userId,requestId){if(!UUID.test(userId||'')||!UUID.test(requestId||''))fail('PT2030_UPLOAD_INVALID');}
 async function read({userId,requestId}){
  identifiers(userId,requestId);const row=await repository.find(userId,requestId);if(!row)fail('PT2030_UPLOAD_NOT_FOUND');
  const buffer=await storage.read(row.documentId);
  if(!Buffer.isBuffer(buffer)||buffer.length!==row.sizeBytes||sha(buffer)!==row.sha256)fail('PT2030_DOCUMENT_CHANGED');
  return {...row,buffer};
 }
 return Object.freeze({read,async get(input){return publicRecord(await read(input))},async upload({userId,requestId,file,sessionId}){
  identifiers(userId,requestId);
  if(!file||!Buffer.isBuffer(file.buffer)||file.buffer.length<4||file.buffer.length>MAX_BYTES||file.mime!==MIME||typeof file.filename!=='string'||file.filename.length>120||/[\\/:\u0000-\u001f\u007f]/.test(file.filename)||!/\.xlsx$/i.test(file.filename))fail('PT2030_UPLOAD_INVALID');
  const bytes=Buffer.from(file.buffer),digest=sha(bytes),key=userId+requestId;
  if(pending.has(key)||pending.size>=2)fail('PT2030_UPLOAD_BUSY');pending.add(key);
  try{
   const prior=await repository.find(userId,requestId);
   if(prior){if(prior.sha256!==digest||prior.filename!==file.filename)fail('PT2030_UPLOAD_CONFLICT');return publicRecord(await read({userId,requestId}));}
   const row={userId,requestId,documentId:randomUUID(),documentVersionId:randomUUID(),filename:file.filename,mime:MIME,sizeBytes:bytes.length,sha256:digest};
   await storage.put(row.documentId,bytes,digest);
   const result=await scanner.scan({objectId:row.documentId,authority:'CENTRAL',expectedSize:bytes.length,expectedSha256:digest});
   if(result?.status!=='CLEAN')fail(result?.status==='INFECTED'?'PT2030_UPLOAD_REJECTED':'PT2030_SCAN_UNAVAILABLE');
   // Inspect exactly the stored/scanned bytes, never an unverified client projection.
   const stored=await storage.read(row.documentId);if(!Buffer.isBuffer(stored)||stored.length!==row.sizeBytes||sha(stored)!==digest)fail('PT2030_DOCUMENT_CHANGED');
   row.sheets=await listSheets(stored);
   const saved=await repository.save(row,sessionId);
   if(saved.sha256!==digest||saved.filename!==row.filename)fail('PT2030_UPLOAD_CONFLICT');
   return publicRecord(saved);
  }finally{pending.delete(key);}
 }});
}
module.exports={createCentralUpload};
