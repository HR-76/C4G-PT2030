'use strict';
const assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),{Readable}=require('node:stream');
const sdk=require('../../../backend/node_modules/@aws-sdk/client-s3');
const {createR2AdapterBoundary}=require('../../../backend/src/documents/r2Adapter');
const {createAuditEvent}=require('../../../backend/src/audit/event');
const {createAppendService}=require('../../../backend/src/audit/appendService');
const {PostgresAppendRepository}=require('../../../backend/src/audit/postgresAppendRepository');
const {verifyEvents}=require('../../../backend/src/audit/verifier');
const {createUuidV7}=require('../../../backend/src/audit/uuidV7');
const digest=value=>createHash('sha256').update(value).digest('hex');
const config={enabled:true,jurisdiction:'eu',endpoint:'https://fixture.eu.r2.cloudflarestorage.com',documentsBucket:'proof-documents',quarantineBucket:'proof-quarantine',bucketAccess:'PRIVATE',capabilities:{layerCValidated:true,multipartConditionalValidated:false}};
function client(){return new sdk.S3Client({endpoint:'http://127.0.0.1:'+Number(process.env.CIA_OBJECT_PORT),region:'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.MINIO_ROOT_USER,secretAccessKey:process.env.MINIO_ROOT_PASSWORD},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',maxAttempts:1});}
function adapter(org){return createR2AdapterBoundary(config,{organizationId:org,credentials:{accessKeyId:process.env.MINIO_ROOT_USER,secretAccessKey:process.env.MINIO_ROOT_PASSWORD},client:client()});}
async function append(pool,tenant,tenantId,index){const c=await pool.connect();try{
 await c.query('BEGIN');
 const now=new Date(),candidate=createAuditEvent({trustedContext:{organizationId:tenant.organizationId,tenantId,operationAuthority:'TENANT',operationCode:'APPLICATION_READ',catalogVersion:'f13-editorial-events-v1',source:'API',channel:'APPLICATION',synchronous:true},
  input:{eventCode:'AUTHORIZATION_ALLOWED',actor:{type:'HUMAN',id:tenant.owner.id,membershipId:tenant.owner.membershipId,serviceActorCode:null,supportGrantId:null},subject:null,resource:{type:'APPLICATION',id:tenant.organizationId},decision:'ALLOW',outcome:'SUCCESS',observedAt:now.toISOString(),correlationId:createUuidV7(),causationId:null,idempotencyKey:'RESTORE-PROOF:'+randomUUID()+':'+index,streamType:'ACCESS',payload:{detailCode:'AUTHORIZED',policyVersion:'c4g-user-mfa-v1'}}});
 await createAppendService({appendPort:new PostgresAppendRepository()}).append(candidate,c);await c.query('COMMIT');
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}}
async function verify(pool,org,expected){const rows=(await pool.query("SELECT event_data,event_hash,sequence FROM audit.event WHERE organization_id=$1 AND stream_type='ACCESS' ORDER BY sequence",[org])).rows;
 assert.equal(rows.length,expected);const events=rows.map(row=>({...row.event_data,eventHash:row.event_hash}));const checked=verifyEvents(events);assert.equal(checked.valid,true);
 const head=(await pool.query("SELECT last_sequence,last_hash FROM audit.chain_head WHERE organization_id=$1 AND stream_type='ACCESS'",[org])).rows[0];assert.equal(Number(head.last_sequence),expected);assert.equal(head.last_hash,checked.lastHash);
 const tampered=structuredClone(events);tampered[0].eventHash='f'.repeat(64);assert.equal(verifyEvents(tampered).valid,false);
 return checked;
}
async function store(adapter,value,objectId){const expected={objectId,storageClass:'DOCUMENTS',conditionalCreate:true,expectedSize:value.length,expectedSha256:digest(value),declaredMime:'application/pdf'};
 const handle=await adapter.beginWrite(expected);await adapter.write(handle,Readable.from([value]));await adapter.commit(handle,{size:value.length,sha256:digest(value),mime:'application/pdf'});}
async function read(adapter,objectId){const head=await adapter.head({objectId,storageClass:'DOCUMENTS'});if(!head)return null;const parts=[];for await(const part of await adapter.readRange({objectId,storageClass:'DOCUMENTS',start:0,end:head.size-1,etag:head.etag}))parts.push(part);return Buffer.concat(parts);}
async function setup(a,b,report){
 assert(/^\d+$/.test(process.env.CIA_OBJECT_PORT||'')&&Number(process.env.CIA_OBJECT_PORT)!==9000);
 const s3=client(),aStore=adapter(a.organizationId),bStore=adapter(b.organizationId),orgs=[a,b],items=[];
 try {
  let ready=false;for(let i=0;i<40;i++){try{await s3.send(new sdk.ListBucketsCommand({}));ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}if(!ready)throw Error('SYNTHETIC_STORE_NOT_READY');
  for(const Bucket of ['proof-documents','proof-quarantine','proof-backup'])await s3.send(new sdk.CreateBucketCommand({Bucket}));
  for(const [i,t] of orgs.entries()){
   const tenantId=(await t.pool.query('SELECT tenant_id FROM c4g_system.tenant_identity')).rows[0].tenant_id;
   await append(t.pool,t,tenantId,0);await append(t.pool,t,tenantId,1);await verify(t.pool,t.organizationId,2);
   const documentId=randomUUID(),versionId=randomUUID(),objectId=randomUUID(),bytes=Buffer.from('%PDF-1.7\nSynthetic restore proof '+i+'\n%%EOF\n'),hash=digest(bytes),storePort=i===0?aStore:bStore;
   await store(storePort,bytes,objectId);
   await t.pool.query("INSERT INTO document_storage.document(document_id,organization_id,resource_type,resource_id,created_by_actor_id,correlation_id) VALUES($1,$2,'APPLICATION',$3,'synthetic',$4)",[documentId,t.organizationId,randomUUID(),randomUUID()]);
   await t.pool.query("INSERT INTO document_storage.document_version(version_id,document_id,organization_id,version_number,object_id,storage_class,expected_size,expected_file_class,expected_sha256,observed_size,declared_mime,detected_mime,display_filename,sha256,state,scan_state,idempotency_key,correlation_id,created_by_actor_id) VALUES($1,$2,$3,1,$4,'DOCUMENTS',$5,'PDF',$6,$5,'application/pdf','application/pdf','synthetic.pdf',$6,'AVAILABLE','CLEAN',$7,$8,'synthetic')",[versionId,documentId,t.organizationId,objectId,bytes.length,hash,'synthetic-'+randomUUID(),randomUUID()]);
   const key=t.organizationId+'/'+objectId,source=await s3.send(new sdk.GetObjectCommand({Bucket:'proof-documents',Key:key})),copy=Buffer.from(await source.Body.transformToByteArray());assert.equal(digest(copy),hash);
   await s3.send(new sdk.PutObjectCommand({Bucket:'proof-backup',Key:key,Body:copy,Metadata:{sha256:hash},ContentType:'application/pdf'}));
   items.push({tenant:t,tenantId,documentId,versionId,objectId,bytes,hash,key,storePort});
  }
  assert.equal(await bStore.head({objectId:items[0].objectId,storageClass:'DOCUMENTS'}),null);assert.equal(await aStore.head({objectId:items[1].objectId,storageClass:'DOCUMENTS'}),null);
  report.checks.push({syntheticObjectIsolation:'PASS',auditSourceEvents:4,backupObjects:2});
  return {s3,aStore,bStore,items};
 }catch(error){await Promise.allSettled([aStore.shutdown(),bStore.shutdown()]);s3.destroy();throw error;}
}
async function recover(state,restored,report){
 try{for(const [i,item] of state.items.entries()){
  const pool=restored[i],row=(await pool.query('SELECT organization_id,object_id,expected_size,sha256,state,scan_state FROM document_storage.document_version WHERE version_id=$1',[item.versionId])).rows[0];
  assert.equal(row.organization_id,item.tenant.organizationId);assert.equal(row.object_id,item.objectId);assert.equal(row.sha256.trim(),item.hash);assert.equal(row.state,'AVAILABLE');assert.equal(row.scan_state,'CLEAN');
  await verify(pool,item.tenant.organizationId,2);
  await state.s3.send(new sdk.DeleteObjectCommand({Bucket:'proof-documents',Key:item.key}));assert.equal(await read(item.storePort,item.objectId),null);
  const backup=await state.s3.send(new sdk.GetObjectCommand({Bucket:'proof-backup',Key:item.key})),bytes=Buffer.from(await backup.Body.transformToByteArray());assert.equal(digest(bytes),row.sha256.trim());
  // Corrupt input is refused by the application adapter before any committed object exists.
  const bad=Buffer.from(bytes);bad[0]^=1;const attempt=await item.storePort.beginWrite({objectId:item.objectId,storageClass:'DOCUMENTS',conditionalCreate:true,expectedSize:bytes.length,expectedSha256:item.hash,declaredMime:'application/pdf'});
  try{await item.storePort.write(attempt,Readable.from([bad]));await assert.rejects(item.storePort.commit(attempt,{size:bad.length,sha256:item.hash,mime:'application/pdf'}),{code:'STORAGE_COMMIT_MISMATCH'});}finally{await item.storePort.abort(attempt);}
  assert.equal(await read(item.storePort,item.objectId),null);await store(item.storePort,bytes,item.objectId);assert.deepEqual(await read(item.storePort,item.objectId),item.bytes);
  await append(pool,item.tenant,item.tenantId,2);await verify(pool,item.tenant.organizationId,3);
  report.checks.push({tenant:i===0?'A':'B',restoredObject:'HASH_AND_BYTES_MATCH',wrongHash:'DENIED',restoredAuditEvents:2,auditChainContinues:3});
 }}finally{await Promise.allSettled([state.aStore.shutdown(),state.bStore.shutdown()]);state.s3.destroy();}
}
module.exports={setup,recover};
