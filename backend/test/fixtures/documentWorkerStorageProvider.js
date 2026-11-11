'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Readable}=require('node:stream');
const {assertObjectStoragePort}=require('../../src/documents/objectStoragePort');

function createDocumentWorkerStorageProvider({env}={}){
 const root=path.resolve(String(env?.DOCUMENT_WORKER_TEST_STORAGE_ROOT||''));
 if(env?.NODE_ENV!=='test'||env?.DOCUMENT_WORKER_TEST_ADAPTERS!=='enabled'||!path.isAbsolute(root)||!fs.statSync(root).isDirectory())throw new TypeError('Controlled document storage root is invalid.');
 const readDelayMs=Number(env?.DOCUMENT_WORKER_TEST_READ_DELAY_MS||0);if(!Number.isSafeInteger(readDelayMs)||readDelayMs<0||readDelayMs>60000)throw new TypeError('Controlled storage delay is invalid.');
 const stores=new Map();let closed=false;
 function location(organizationId,objectId){if(!/^[0-9a-f-]{36}$/i.test(organizationId)||!/^[0-9a-f-]{36}$/i.test(objectId))throw new TypeError('Controlled storage identity is invalid.');const directory=path.join(root,organizationId.toLowerCase()),file=path.join(directory,`${objectId.toLowerCase()}.bin`),meta=path.join(directory,`${objectId.toLowerCase()}.json`);if(!file.startsWith(directory)||!meta.startsWith(directory))throw new Error('CONTROLLED_STORAGE_PATH_INVALID');return{directory,file,meta};}
 function create({organizationId}){
  if(closed)throw new Error('CONTROLLED_STORAGE_CLOSED');if(stores.has(organizationId))return stores.get(organizationId);const writes=new Map();
  const port=assertObjectStoragePort({
   async beginWrite(input){const target=location(organizationId,input.objectId);if(input.conditionalCreate!==true||fs.existsSync(target.file)||writes.has(input.objectId))throw new Error('STORAGE_CONDITIONAL_CREATE_FAILED');const handle=Object.freeze({objectId:input.objectId,storageClass:input.storageClass,id:crypto.randomUUID()});writes.set(input.objectId,{handle,input,chunks:[]});return handle;},
   async write(handle,source,{signal=null}={}){const item=writes.get(handle.objectId);if(!item||item.handle.id!==handle.id)throw new Error('STORAGE_WRITE_NOT_FOUND');for await(const raw of source){if(signal?.aborted)throw Object.assign(new Error('STORAGE_ABORTED'),{code:'STORAGE_ABORTED'});item.chunks.push(Buffer.from(raw));}},
   async beginMultipart(){throw new Error('CONTROLLED_STORAGE_MULTIPART_UNSUPPORTED');},async writePart(){throw new Error('CONTROLLED_STORAGE_MULTIPART_UNSUPPORTED');},
   async commit(handle,metadata){const item=writes.get(handle.objectId);if(!item)throw new Error('STORAGE_WRITE_NOT_FOUND');const bytes=Buffer.concat(item.chunks),digest=crypto.createHash('sha256').update(bytes).digest('hex');if(bytes.length!==metadata.size||digest!==metadata.sha256)throw new Error('STORAGE_COMMIT_MISMATCH');const target=location(organizationId,handle.objectId);fs.mkdirSync(target.directory,{recursive:true});fs.writeFileSync(target.file,bytes,{flag:'wx'});fs.writeFileSync(target.meta,JSON.stringify({size:bytes.length,sha256:digest,mime:metadata.mime,storageClass:handle.storageClass,etag:`controlled-${digest}`})+'\n',{flag:'wx'});writes.delete(handle.objectId);return Object.freeze({objectId:handle.objectId,size:bytes.length,sha256:digest});},
   async abort(handle){return Object.freeze({aborted:writes.delete(handle.objectId)});},async abortMultipartSession(){return Object.freeze({aborted:false});},async deleteObject(){return Object.freeze({deleted:true});},
   async head({objectId}){const target=location(organizationId,objectId);if(!fs.existsSync(target.file)||!fs.existsSync(target.meta))return null;const meta=JSON.parse(fs.readFileSync(target.meta,'utf8'));return Object.freeze({objectId,...meta});},
   async readRange({objectId,start=0,end,signal=null}){const target=location(organizationId,objectId),bytes=fs.readFileSync(target.file);if(signal?.aborted)throw Object.assign(new Error('STORAGE_ABORTED'),{code:'STORAGE_ABORTED'});if(readDelayMs)await new Promise((resolve,reject)=>{let settled=false;const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener?.('abort',abort);error?reject(error):resolve();},abort=()=>finish(Object.assign(new Error('STORAGE_ABORTED'),{code:'STORAGE_ABORTED'})),timer=setTimeout(()=>finish(),readDelayMs);signal?.addEventListener?.('abort',abort,{once:true});});if(signal?.aborted)throw Object.assign(new Error('STORAGE_ABORTED'),{code:'STORAGE_ABORTED'});return Readable.from([bytes.subarray(start,end+1)]);},
   async createDownloadCapability(){throw new Error('CONTROLLED_STORAGE_DOWNLOAD_UNSUPPORTED');},async health(){return Object.freeze({ready:!closed,adapter:'controlled-local-document-storage-v1'});},async shutdown(){writes.clear();}
  });stores.set(organizationId,port);return port;
 }
 return Object.freeze({create,async close(){if(closed)return;closed=true;for(const store of stores.values())await store.shutdown();stores.clear();}});
}
module.exports={createDocumentWorkerStorageProvider};
