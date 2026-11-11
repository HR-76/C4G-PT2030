'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Readable}=require('node:stream');
const {createPdfService,inspectPdf,MAX_BYTES}=require('../src/customerBilling/pdfService');
const {publicFile}=require('../src/customerBilling/pdfRepository');
const {financialGrants}=require('../src/customerBilling/access');
const {grantsForProfile}=require('../src/organizationDirectory/accessProfiles');
function pdf(text='Original'){
 const body=`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% ${text}\n`;
 return Buffer.from(body+`xref\n0 2\n0000000000 65535 f \n0000000009 00000 n \ntrailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n${Buffer.byteLength(body)}\n%%EOF\n`);
}
function fixture(){
 const org=randomUUID(),doc=randomUUID(),user=randomUUID(),rows=[],objects=new Map(),state={allowed:true,scan:'CLEAN',writes:0,reads:0,afterRead:null};
 const deny=()=>{if(!state.allowed)throw Object.assign(Error(),{code:'NOT_AUTHORIZED'})};
 const storage={beginWrite:async spec=>({...spec}),write:async(handle,source)=>{const chunks=[];for await(const chunk of source)chunks.push(chunk);handle.bytes=Buffer.concat(chunks)},commit:async handle=>{objects.set(handle.storageClass+handle.objectId,handle.bytes);state.writes++},abort:async()=>{},head:async({objectId,storageClass})=>({size:objects.get(storageClass+objectId)?.length,etag:'immutable'}),readRange:async({objectId,storageClass,start,end})=>{state.reads++;state.afterRead?.();return Readable.from([objects.get(storageClass+objectId).subarray(start,end+1)])}};
 const repository={admin:async()=>{deny();return org},customerDocument:async(scope,id)=>{assert.equal(scope,org);if(id!==doc)throw Object.assign(Error(),{code:'RESOURCE_NOT_AVAILABLE'})},versions:async(scope,id)=>scope===org&&id===doc?rows:[],save:async(request,id,e)=>{deny();if((rows[0]?.version||0)!==e.expectedVersion)throw Object.assign(Error(),{code:'STALE_REVISION'});const row={id:randomUUID(),version:e.expectedVersion+1,document_id:id,organization_id:org,object_id:e.objectId,filename:e.filename,size_bytes:e.size,sha256:e.sha256,request_id:e.requestId,created_by:user,created_at:new Date().toISOString(),scan_state:'CLEAN'};rows.unshift(row);return row}};
 const service=createPdfService({repository,storageFactory:()=>storage,scannerFactory:()=>({scan:async()=>({status:state.scan})}),customerAuthorize:async()=>{deny();return org}});
 const request={user:{id:user}},input={filename:'original.pdf',expectedVersion:0,requestId:randomUUID()};
 return {service,request,input,org,doc,rows,objects,state,storage,repository};
}
test('PDF validation rejects disguised, oversized and truncated input; sanitized names',()=>{
 assert.equal(inspectPdf(pdf(),'../original.pdf').filename,'._original.pdf');
 for(const bytes of [Buffer.from('%PDF-fake'),pdf().subarray(0,30),Buffer.alloc(MAX_BYTES+1),Buffer.from('executable')])assert.throws(()=>inspectPdf(bytes,'test.pdf'),{code:'PDF_INVALID'});
 assert.throws(()=>inspectPdf(pdf(),'test.exe'),{code:'PDF_INVALID'});
});
test('clean originals publish immutable versions; identical retry never uploads twice',async()=>{
 const f=fixture(),first=await f.service.upload(f.request,f.doc,pdf(),f.input);
 assert.equal(first.version,1);assert.equal(f.state.writes,2);
 assert.deepEqual(await f.service.upload(f.request,f.doc,pdf(),f.input),first);assert.equal(f.state.writes,2);
 await assert.rejects(()=>f.service.upload(f.request,f.doc,pdf('different'),f.input),{code:'IDEMPOTENCY_CONFLICT'});
 await f.service.upload(f.request,f.doc,pdf('replacement'),{...f.input,requestId:randomUUID(),expectedVersion:1});
 assert.equal(f.rows.length,2);assert.equal(f.rows[1].id,first.id);
 const data=await f.service.download(f.request,f.doc,first.id,true);assert.deepEqual(data.bytes,pdf());
 assert.equal(JSON.stringify(publicFile(f.rows[0])).includes('object_id'),false);
});
test('unavailable scanner and infected files never publish or write DOCUMENTS',async()=>{
 for(const scan of ['ERROR','INFECTED']){const f=fixture();f.state.scan=scan;await assert.rejects(()=>f.service.upload(f.request,f.doc,pdf(),f.input),{code:scan==='INFECTED'?'PDF_REJECTED':'PDF_SCAN_UNAVAILABLE'});assert.equal(f.rows.length,0);assert.equal([...f.objects.keys()].some(k=>k.startsWith('DOCUMENTS')),false)}
});
test('revoked access, foreign documents and foreign version IDs cannot read storage',async()=>{
 const f=fixture(),v=await f.service.upload(f.request,f.doc,pdf(),f.input);
 for(const [doc,id] of [[randomUUID(),v.id],[f.doc,randomUUID()]])await assert.rejects(()=>f.service.download(f.request,doc,id,true),{code:'RESOURCE_NOT_AVAILABLE'});
 f.state.allowed=false;await assert.rejects(()=>f.service.download(f.request,f.doc,v.id,true),{code:'NOT_AUTHORIZED'});assert.equal(f.state.reads,0);
});
test('revocation while reading and corrupt objects withhold all download bytes',async()=>{
 const f=fixture(),v=await f.service.upload(f.request,f.doc,pdf(),f.input);
 f.state.afterRead=()=>{f.state.allowed=false};await assert.rejects(()=>f.service.download(f.request,f.doc,v.id,true),{code:'NOT_AUTHORIZED'});
 f.state.afterRead=null;f.state.allowed=true;const buffer=f.objects.get('DOCUMENTS'+f.rows[0].object_id);buffer[12]^=1;
 await assert.rejects(()=>f.service.download(f.request,f.doc,v.id,true),{code:'PDF_INTEGRITY_FAILED'});
});
test('stale expected revision rejects before storage and cancelled requests do not publish',async()=>{
 const f=fixture();await assert.rejects(()=>f.service.upload(f.request,f.doc,pdf(),{...f.input,expectedVersion:1}),{code:'STALE_REVISION'});assert.equal(f.state.writes,0);
 const controller=new AbortController();controller.abort();await assert.rejects(()=>f.service.upload(f.request,f.doc,pdf(),f.input,controller.signal));assert.equal(f.rows.length,0);
});
test('financial grant changes preserve unrelated grants and survive job-profile change',()=>{
 const org=randomUUID(),work={permission:'application.read',resourceId:randomUUID(),scope:{type:'ORGANIZATION',id:org,organizationId:org}};
 const grants=financialGrants([work],org,true);assert.equal(grants.length,2);assert.deepEqual(financialGrants(grants,org,false),[work]);
 const changed=grantsForProfile({organizationId:org,profileCode:'CONTRIBUTOR',previousProfile:'FUNDING_MANAGER',previousGrants:grants});assert.ok(changed.some(g=>g.permission==='billing.read'));assert.ok(changed.some(g=>g.resourceId===work.resourceId));
});
module.exports={pdf};
