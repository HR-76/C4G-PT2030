'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto'),{Readable}=require('node:stream');
const sdk=require('../../../backend/node_modules/@aws-sdk/client-s3');
const {createR2AdapterBoundary}=require('../../../backend/src/documents/r2Adapter');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const invalid=()=>{throw Object.assign(new Error('Isolated test configuration required'),{code:'ISOLATED_CONFIG_REQUIRED'});};
function config(env){
 if(env.CIA_R2_TEST_ISOLATED!=='YES')invalid();
 let endpoint;try{endpoint=new URL(env.CIA_R2_ENDPOINT)}catch{invalid()}
 if(!/^https:\/\/[a-z0-9-]+\.eu\.r2\.cloudflarestorage\.com$/.test(endpoint.origin)||endpoint.href!==endpoint.origin+'/')invalid();
 const buckets=[env.CIA_R2_SOURCE_BUCKET,env.CIA_R2_BACKUP_BUCKET,env.CIA_R2_QUARANTINE_BUCKET];
 if(new Set(buckets).size!==3||buckets.some(x=>typeof x!=='string'||!/^[a-z0-9][a-z0-9-]{2,62}$/.test(x)||!/(^|-)(test|sandbox)(-|$)/.test(x)))invalid();
 if(!env.CIA_R2_ACCESS_KEY_ID||!env.CIA_R2_SECRET_ACCESS_KEY)invalid();
 return {endpoint:endpoint.origin,buckets,credentials:{accessKeyId:env.CIA_R2_ACCESS_KEY_ID,secretAccessKey:env.CIA_R2_SECRET_ACCESS_KEY}};
}
async function bytesFrom(response,expected){
 if(response.ContentLength!==expected||!response.Body?.[Symbol.asyncIterator])throw Error('BACKUP_SIZE_MISMATCH');
 const chunks=[];let size=0;for await(const chunk of response.Body){size+=chunk.length;if(size>expected)throw Error('BACKUP_SIZE_MISMATCH');chunks.push(Buffer.from(chunk));}
 if(size!==expected)throw Error('BACKUP_SIZE_MISMATCH');return Buffer.concat(chunks);
}
async function run(env=process.env){
 const c=config(env),runId=randomUUID(),objectId=randomUUID(),key=runId+'/'+objectId;
 const [source,backup,quarantine]=c.buckets,fixture=Buffer.from('%PDF-1.7\nC4G isolated recovery test\n%%EOF\n'),sha=hash(fixture);
 const dir=path.resolve(__dirname,'../../../context/reviews','cia-real-r2-recovery-'+runId);fs.mkdirSync(dir,{recursive:false});
 const report={status:'RUNNING',runId,scope:{endpointSha256:hash(Buffer.from(c.endpoint)),sourceBucket:source,backupBucket:backup,quarantineBucket:quarantine,key},checks:[],cleanup:'NOT_STARTED',limits:['Synthetic objects only; caller must establish these are dedicated test buckets and credentials.','Does not verify production backups, RPO/RTO, bucket independence, antivirus or database recovery.']};
 const save=()=>fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(report,null,2)+'\n');
 const client=new sdk.S3Client({endpoint:c.endpoint,region:'auto',forcePathStyle:true,credentials:c.credentials,maxAttempts:1,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
 const adapter=createR2AdapterBoundary({enabled:true,jurisdiction:'eu',endpoint:c.endpoint,documentsBucket:source,quarantineBucket:quarantine,bucketAccess:'PRIVATE',capabilities:{layerCValidated:true,multipartConditionalValidated:false}},{organizationId:runId,credentials:c.credentials,client});
 const send=(Command,input)=>client.send(new Command(input),{abortSignal:AbortSignal.timeout(15000)});
 const write=async bytes=>{const handle=await adapter.beginWrite({objectId,storageClass:'DOCUMENTS',conditionalCreate:true,expectedSize:fixture.length,expectedSha256:sha,declaredMime:'application/pdf'});try{await adapter.write(handle,Readable.from([bytes]));await adapter.commit(handle,{size:fixture.length,sha256:sha,mime:'application/pdf'});}finally{await adapter.abort(handle);}};
 const read=async()=>{const head=await adapter.head({objectId,storageClass:'DOCUMENTS'});if(!head)return null;const chunks=[];for await(const part of await adapter.readRange({objectId,storageClass:'DOCUMENTS',start:0,end:fixture.length-1,etag:head.etag}))chunks.push(part);return Buffer.concat(chunks);};
 try {
  save();await write(fixture);assert.deepEqual(await read(),fixture);report.checks.push('SOURCE_WRITE_VERIFIED');save();
  await send(sdk.PutObjectCommand,{Bucket:backup,Key:key,Body:fixture,Metadata:{sha256:sha},ContentType:'application/pdf',IfNoneMatch:'*'});
  const stored=await send(sdk.GetObjectCommand,{Bucket:backup,Key:key});assert.equal(stored.Metadata.sha256,sha);assert.deepEqual(await bytesFrom(stored,fixture.length),fixture);report.checks.push('BACKUP_BYTES_VERIFIED');save();
  // Exact randomly generated key only, after verified backup; no bucket-wide listing/deletion.
  await send(sdk.DeleteObjectCommand,{Bucket:source,Key:key});assert.equal(await read(),null);report.checks.push('SOURCE_ABSENCE_VERIFIED');save();
  const restored=await send(sdk.GetObjectCommand,{Bucket:backup,Key:key}),bytes=await bytesFrom(restored,fixture.length);assert.equal(hash(bytes),sha);await write(bytes);assert.deepEqual(await read(),fixture);report.checks.push('RESTORE_BYTES_VERIFIED');save();
  report.cleanup='IN_PROGRESS';save();await send(sdk.DeleteObjectCommand,{Bucket:source,Key:key});await send(sdk.DeleteObjectCommand,{Bucket:backup,Key:key});
  assert.equal(await read(),null);await assert.rejects(send(sdk.HeadObjectCommand,{Bucket:backup,Key:key}),e=>e?.$metadata?.httpStatusCode===404);
  report.cleanup='VERIFIED';report.status='PASS';save();return report;
 }catch(error){report.status='FAIL';report.cleanup='MANUAL_RECONCILIATION_REQUIRED';report.errorCode=/^[A-Z0-9_]+$/.test(error?.code||'')?error.code:'PROOF_FAILED';save();throw Object.assign(new Error('ISOLATED_R2_PROOF_FAILED'),{code:'ISOLATED_R2_PROOF_FAILED',reportPath:path.join(dir,'results.json')});}
 finally{await adapter.shutdown().catch(()=>{});}
}
if(require.main===module)run().then(r=>console.log('ISOLATED_R2_RECOVERY_PASS '+r.runId)).catch(e=>{console.error(e.code||'ISOLATED_R2_PROOF_FAILED');if(e.reportPath)console.error('Evidence: '+e.reportPath);process.exitCode=1;});
module.exports={config,run};
