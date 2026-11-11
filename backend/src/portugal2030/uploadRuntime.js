'use strict';
const {Readable}=require('node:stream');
const {createFundingRepository}=require('../fundingTenders/repository');
const {createPlatformAudit}=require('../fundingTenders/audit');
const {createCentralUpload}=require('./upload');
const {createCentralPortugal2030CandidateComposition}=require('./composition');
const {MIME,MAX_BYTES}=require('./planXlsxV2');
const {LIMITS}=require('../documents/constants');
const {authoritySql}=require('../platformDirectory/service');
async function sessionAuthority(client,userId,sessionId){
 if(typeof sessionId!=='string'||!sessionId||!(await client.query(authoritySql+' FOR SHARE OF s,u,a',[sessionId,userId])).rowCount)throw Object.assign(Error(),{code:'C4G_ADMIN_REQUIRED'});
}
function createCentralImportUploadRuntime({pool,store,scanner,audit=createPlatformAudit({source:'API'})}){
 const central=createFundingRepository({pool});
 const projection=row=>row?{userId:row.requested_by,requestId:row.request_id,documentId:row.document_id,documentVersionId:row.document_version_id,filename:row.filename,mime:MIME,sizeBytes:row.size_bytes,sha256:row.sha256,sheets:row.sheets}:null;
 const repository={
  find(userId,requestId){return central.transaction(async c=>{await central.administrator(c,userId);return projection((await c.query('SELECT * FROM opportunity_catalog.pt2030_document_upload WHERE requested_by=$1 AND request_id=$2 AND scan_state=\'CLEAN\'',[userId,requestId])).rows[0])},true)},
  save(row,sessionId){return central.transaction(async c=>{
   await sessionAuthority(c,row.userId,sessionId);
   await central.administrator(c,row.userId,true);
   const inserted=await c.query('INSERT INTO opportunity_catalog.pt2030_document_upload(document_id,document_version_id,requested_by,request_id,filename,size_bytes,sha256,sheets) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(requested_by,request_id) DO NOTHING',[row.documentId,row.documentVersionId,row.userId,row.requestId,row.filename,row.sizeBytes,row.sha256,JSON.stringify(row.sheets)]);
   const saved=projection((await c.query('SELECT * FROM opportunity_catalog.pt2030_document_upload WHERE requested_by=$1 AND request_id=$2',[row.userId,row.requestId])).rows[0]);
   if(saved.sha256!==row.sha256||saved.filename!==row.filename)throw Object.assign(Error(),{code:'PT2030_UPLOAD_CONFLICT'});
   if(inserted.rowCount)await audit(c,{actor:{type:'HUMAN',id:row.userId},eventCode:'OPPORTUNITY_IMPORT_UPLOADED',requestId:`pt2030:upload:${row.userId}:${row.requestId}`,detailCode:'PT2030_CENTRAL_ORIGINAL_VERIFIED'});
   return saved;
  })}
 };
 const storage={async put(objectId,bytes,sha256){
  const handle=await store.beginWrite({objectId,storageClass:'QUARANTINE',expectedSize:bytes.length,expectedSha256:sha256,declaredMime:MIME,conditionalCreate:true});
  try{await store.write(handle,Readable.from([bytes]));await store.commit(handle,{size:bytes.length,sha256,mime:MIME})}catch(error){await store.abort(handle).catch(()=>{});throw error}
 },async read(objectId){
  const head=await store.head({objectId});if(!head||head.size>MAX_BYTES)throw Object.assign(Error(),{code:'PT2030_DOCUMENT_CHANGED'});
  const chunks=[];for(let start=0;start<head.size;start+=LIMITS.maxRangeBytes){const source=await store.readRange({objectId,start,end:Math.min(head.size-1,start+LIMITS.maxRangeBytes-1),etag:head.etag});for await(const chunk of source)chunks.push(Buffer.from(chunk))}
  return Buffer.concat(chunks);
 }};
 const upload=createCentralUpload({repository,storage,scanner});
 async function lookup(client,userId,documentId,documentVersionId){return projection((await client.query('SELECT * FROM opportunity_catalog.pt2030_document_upload WHERE requested_by=$1 AND document_id=$2 AND document_version_id=$3 AND scan_state=\'CLEAN\'',[userId,documentId,documentVersionId])).rows[0])}
 const documents={async readVerifiedCentral({userId,documentId,documentVersionId}){
  const row=await central.transaction(async c=>{await central.administrator(c,userId);return lookup(c,userId,documentId,documentVersionId)},true);if(!row)throw Error('Unavailable');
  const verified=await upload.read({userId,requestId:row.requestId});
  return {authority:'CENTRAL',organizationId:null,documentId,documentVersionId,filename:row.filename,mime:MIME,sizeBytes:row.sizeBytes,sha256:row.sha256,state:'AVAILABLE',scanState:'CLEAN',buffer:verified.buffer};
 },async assertCurrent(client,input){const row=await lookup(client,input.userId,input.documentId,input.documentVersionId);if(!row||row.sha256!==input.sha256||row.sizeBytes!==input.sizeBytes)throw Error('Changed')}};
 return Object.freeze({
  async availability(){try{
   const schema=await central.transaction(async c=>{
    await require('../security/centralSchemaManifest').assertCentralSchemaForVersions(c,[require('../security/centralImportMigrationPackage').entry.version,require('../security/billingPdfMigrationPackage').entry.version]);
    const exists=(await c.query("SELECT to_regclass('opportunity_catalog.pt2030_document_upload') IS NOT NULL AND to_regclass('opportunity_catalog.pt2030_plan_preview') IS NOT NULL AS ready")).rows[0]?.ready;
    if(!exists)return false;
    await c.query('SELECT document_id,document_version_id,requested_by,request_id,filename,size_bytes,sha256,sheets,scan_state FROM opportunity_catalog.pt2030_document_upload LIMIT 0');
    await c.query('SELECT preview_id,requested_by,request_id,preview_digest,intent_digest,payload_digest,document_binding,bundle FROM opportunity_catalog.pt2030_plan_preview LIMIT 0');
    return (await c.query("SELECT has_table_privilege(current_user,'opportunity_catalog.pt2030_document_upload','SELECT,INSERT') AND has_table_privilege(current_user,'opportunity_catalog.pt2030_plan_preview','SELECT,INSERT') AS ready")).rows[0]?.ready===true;
   },true);
   if(!schema)return {available:false,code:'CENTRAL_IMPORT_SCHEMA_REQUIRED'};
   const [storageHealth,scanHealth]=await Promise.all([store.health(),scanner.health()]);
   return {available:storageHealth?.ready===true&&scanHealth?.ready===true,mode:'PREVIEW_ONLY',maxBytes:MAX_BYTES};
  }catch{return {available:false,code:'CENTRAL_IMPORT_DEPENDENCY_UNAVAILABLE'}}},
  upload:upload.upload,get:upload.get,
  async preview({userId,requestId,sheetName,previewRequestId,sessionId}){
   const previewService=createCentralPortugal2030CandidateComposition({pool,documents,audit,assertSession:client=>sessionAuthority(client,userId,sessionId)});
   const row=await upload.get({userId,requestId});if(!row.sheets.includes(sheetName))throw Object.assign(Error(),{code:'PT2030_PLAN_SHEET_NOT_FOUND'});
   const result=await previewService.preview({userId,documentId:row.documentId,documentVersionId:row.documentVersionId,sheetName,requestId:previewRequestId});
   return {...result,rows:result.rows.map(row=>({line:row.physicalRow,reference:row.externalIdentifier,errors:row.errors,values:{...Object.fromEntries(Object.entries(row.sourceCells).map(([col,cell])=>[col,cell.value])),...(row.canonicalSnapshot?{I:row.canonicalSnapshot.schedule.plannedOpening.value?.value||null,J:row.canonicalSnapshot.schedule.plannedClosing.value?.value||null}:{})}}))};
  },close:()=>store.shutdown()
 });
}
function configuredCentralImport({pool,env=process.env}){
 if(!env.CENTRAL_PT2030_IMPORT_RUNTIME||env.CENTRAL_PT2030_IMPORT_RUNTIME==='disabled')return null;
 if(env.CENTRAL_PT2030_IMPORT_RUNTIME!=='preview')throw TypeError('Central import runtime configuration invalid');
 const config=require('../config/applicationDocuments').loadApplicationDocumentConfiguration(env);
 const store=require('../documents/r2Storage').createR2Storage(config.r2,{authority:'CENTRAL',credentials:config.credentials});
 try{return createCentralImportUploadRuntime({pool,store,scanner:require('../documents/clamavScanner').createClamavScanner({authority:'CENTRAL',storage:store,...config.scanner})})}catch(error){store.shutdown();throw error}
}
module.exports={createCentralImportUploadRuntime,configuredCentralImport};
