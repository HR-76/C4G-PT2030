'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto'),{Readable}=require('node:stream');
const {UUID}=require('../documents/objectIdentity');
const MAX=10*1024*1024;
const fail=code=>{throw Object.assign(Error(code),{code})};
// Development only. Root is provisioned with private OS ACLs, outside web roots.
function createLocalBillingStorage({root,organizationId,environment}){
 if(environment!=='development'||!path.isAbsolute(root||'')||!UUID.test(organizationId||''))fail('LOCAL_BILLING_STORAGE_CONFIGURATION_INVALID');
 root=path.resolve(root);const pending=new Map();let closed=false;
 const hash=b=>createHash('sha256').update(b).digest('hex');
 async function target(objectId,storageClass){
  if(closed)fail('STORAGE_CLOSED');
  if(!UUID.test(objectId||'')||!['QUARANTINE','DOCUMENTS'].includes(storageClass))fail('STORAGE_IDENTITY_INVALID');
  let dir=root;
  for(const segment of ['',organizationId.toLowerCase(),storageClass]){
   if(segment){dir=path.join(dir,segment);await fs.mkdir(dir,{recursive:false,mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e})}
   const stat=await fs.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())fail('STORAGE_PATH_INVALID');
  }
  return path.join(dir,objectId.toLowerCase());
 }
 async function bytes(input){
  input.signal?.throwIfAborted();const file=await target(input.objectId,input.storageClass);
  const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX)fail('STORAGE_OBJECT_INVALID');
  const b=await fs.readFile(file);if(b.length!==stat.size||b.length>MAX)fail('STORAGE_OBJECT_INVALID');input.signal?.throwIfAborted();return b;
 }
 return Object.freeze({
  async beginWrite(input){
   await target(input.objectId,input.storageClass);
   if(input.conditionalCreate!==true||input.declaredMime!=='application/pdf'||!Number.isSafeInteger(input.expectedSize)||input.expectedSize<1||input.expectedSize>MAX||!/^[a-f0-9]{64}$/.test(input.expectedSha256||''))fail('STORAGE_WRITE_INVALID');
   if(pending.size>=4)fail('STORAGE_CONCURRENCY_LIMIT');
   const handle=Object.freeze({id:randomUUID()});pending.set(handle,{...input});return handle;
  },
  async write(handle,source,{signal}={}){
   const item=pending.get(handle);if(!item||item.busy||item.bytes)fail('STORAGE_WRITE_NOT_FOUND');item.busy=true;
   try{const chunks=[];let size=0;for await(const raw of source){signal?.throwIfAborted();const b=Buffer.from(raw);size+=b.length;if(size>item.expectedSize)fail('STORAGE_SIZE_LIMIT');chunks.push(b)}const b=Buffer.concat(chunks);if(size!==item.expectedSize||hash(b)!==item.expectedSha256)fail('STORAGE_INTEGRITY_FAILED');item.bytes=b;}finally{item.busy=false}
  },
  async commit(handle,meta){
   const item=pending.get(handle);if(!item?.bytes||item.busy||meta.size!==item.expectedSize||meta.sha256!==item.expectedSha256||meta.mime!=='application/pdf')fail('STORAGE_WRITE_INVALID');item.busy=true;
   const file=await target(item.objectId,item.storageClass),temp=file+'.'+randomUUID()+'.staging';
   try{const fh=await fs.open(temp,'wx',0o600);try{await fh.writeFile(item.bytes);await fh.sync()}finally{await fh.close()}
    // Atomic, no-overwrite publication. Readers never see partial files.
    await fs.link(temp,file);return {size:item.expectedSize,sha256:item.expectedSha256,etag:item.expectedSha256};
   }finally{await fs.unlink(temp).catch(()=>{});pending.delete(handle)}
  },
  async abort(handle){pending.delete(handle)},
  async head(input){const b=await bytes(input),sha256=hash(b);return {size:b.length,sha256,etag:sha256,mime:'application/pdf'}},
  async readRange(input){const b=await bytes(input);if(input.etag!==hash(b)||!Number.isSafeInteger(input.start)||!Number.isSafeInteger(input.end)||input.start<0||input.end<input.start||input.end>=b.length)fail('STORAGE_RANGE_INVALID');return Readable.from([b.subarray(input.start,input.end+1)])},
  async health(){try{const stat=await fs.lstat(root);return {ready:stat.isDirectory()&&!stat.isSymbolicLink()}}catch{return {ready:false}}},
  async shutdown(){closed=true;pending.clear()},
  async beginMultipart(){fail('STORAGE_OPERATION_UNAVAILABLE')},async writePart(){fail('STORAGE_OPERATION_UNAVAILABLE')},async abortMultipartSession(){fail('STORAGE_OPERATION_UNAVAILABLE')},async createDownloadCapability(){fail('STORAGE_OPERATION_UNAVAILABLE')}
 });
}
module.exports={createLocalBillingStorage};
