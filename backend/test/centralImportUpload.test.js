'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createCentralUpload}=require('../src/portugal2030/upload');
const {MIME}=require('../src/portugal2030/planXlsxV2');
function fixture(){
 const rows=new Map(),objects=new Map(),calls=[];let scan='CLEAN';
 const repository={async find(user,id){return rows.get(user+id)||null},async save(row){rows.set(row.userId+row.requestId,row);return row}};
 const storage={async put(id,bytes,hash){objects.set(id,Buffer.from(bytes));calls.push('store')},async read(id){return objects.get(id)}};
 const service=createCentralUpload({repository,storage,scanner:{async scan(){calls.push('scan');return {status:scan}}},listSheets:async()=>{calls.push('sheets');return ['Avisos']}});
 const file={buffer:Buffer.from('PK\x03\x04test'),mime:MIME,filename:'Plano.xlsx'},userId=randomUUID(),requestId=randomUUID();
 return {service,rows,objects,calls,file,userId,requestId,setScan:v=>scan=v};
}
test('verified central upload retains original, lists sheets and replays without another scan',async()=>{
 const f=fixture(),input={userId:f.userId,requestId:f.requestId,file:f.file};const result=await f.service.upload(input);assert.deepEqual(result.sheets,['Avisos']);assert.equal(result.scanState,'CLEAN');assert.deepEqual(f.calls,['store','scan','sheets']);const again=await f.service.upload(input);assert.equal(again.documentId,result.documentId);assert.equal(f.calls.length,3);
 await assert.rejects(f.service.upload({...input,file:{...f.file,buffer:Buffer.from('different')}}),{code:'PT2030_UPLOAD_CONFLICT'});
});
test('infected uploads never reach structural parsing or trusted receipts',async()=>{
 const f=fixture();f.setScan('INFECTED');await assert.rejects(f.service.upload({userId:f.userId,requestId:f.requestId,file:f.file}),{code:'PT2030_UPLOAD_REJECTED'});assert.equal(f.rows.size,0);assert.deepEqual(f.calls,['store','scan']);
});
test('verified reads reject altered storage and another owner',async()=>{
 const f=fixture(),row=await f.service.upload({userId:f.userId,requestId:f.requestId,file:f.file});
 await assert.rejects(f.service.read({userId:randomUUID(),requestId:f.requestId}),{code:'PT2030_UPLOAD_NOT_FOUND'});
 f.objects.set(row.documentId,Buffer.from('changed'));await assert.rejects(f.service.read({userId:f.userId,requestId:f.requestId}),{code:'PT2030_DOCUMENT_CHANGED'});
});
test('scanner unavailable never creates a clean receipt and oversized files never reach storage',async()=>{
 const f=fixture();f.setScan('ERROR');await assert.rejects(f.service.upload({userId:f.userId,requestId:f.requestId,file:f.file}),{code:'PT2030_SCAN_UNAVAILABLE'});assert.equal(f.rows.size,0);
 f.calls.length=0;await assert.rejects(f.service.upload({userId:f.userId,requestId:randomUUID(),file:{...f.file,buffer:Buffer.alloc(10*1024*1024+1)}}),{code:'PT2030_UPLOAD_INVALID'});assert.equal(f.calls.length,0);
});
test('normative workbook sheet discovery reuses bounded structural reader',async()=>{
 const {listPlanSheets}=require('../src/portugal2030/planXlsxReader');
 const bytes=require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/portugal2030/PlanoAnualAvisos_download_140926-1.xlsx'));
 assert.deepEqual(await listPlanSheets(bytes),['Sheet1']);await assert.rejects(listPlanSheets(Buffer.from('not xlsx')),{code:'PT2030_PLAN_FILE_INVALID'});
});
test('central storage has a separate prefix and refuses an organization binding',async()=>{
 const {createR2Storage}=require('../src/documents/r2Storage'),{createClamavScanner}=require('../src/documents/clamavScanner');
 const config={enabled:true,jurisdiction:'eu',endpoint:'https://fixture.eu.r2.cloudflarestorage.com',documentsBucket:'test-documents',quarantineBucket:'test-quarantine',bucketAccess:'PRIVATE',capabilities:{layerCValidated:true}};
 let key;const options={authority:'CENTRAL',credentials:{accessKeyId:'test',secretAccessKey:'test'},client:{async send(command){key=command.input.Key;return {ContentLength:4,Metadata:{sha256:'a'.repeat(64)},ETag:'test'}},destroy(){}}};
 const store=createR2Storage(config,options),id=randomUUID();await store.head({objectId:id});assert.equal(key,'central/portugal2030/'+id);await store.shutdown();
 assert.throws(()=>createR2Storage(config,{...options,organizationId:randomUUID()}));
 const scanner=createClamavScanner({authority:'CENTRAL',storage:{head(){throw Error('must not read')},readRange(){}}});assert.equal((await scanner.scan({objectId:id,organizationId:randomUUID(),expectedSize:4,expectedSha256:'a'.repeat(64)})).status,'ERROR');
});
