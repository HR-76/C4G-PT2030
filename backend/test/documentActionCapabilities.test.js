 'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createApplicationDocumentsRepository}=require('../src/applications/documentsReview');
for(const mode of ['admin','reader','editor','reviewer','noConfirm'])test('document capabilities reflect current authority: '+mode,async()=>{
 const org=randomUUID(),app=randomUUID(),checks=[];
 const authorize=async(op,r)=>{checks.push([op,r]);assert.equal(r.organizationId,org);assert.equal(r.id,app);
 if(op==='APPLICATION_DOCUMENT_EDIT')return ['admin','editor','noConfirm'].includes(mode);
 if(op==='APPLICATION_REVIEW_DECIDE')return ['admin','reviewer'].includes(mode);
 if(op==='DOCUMENT_UPLOAD_CONFIRM'&&mode==='noConfirm')return false;
 return true;};
 const repo=createApplicationDocumentsRepository({organizationId:org,actor:{id:randomUUID()},authorize,protect:async()=>{},audit:async()=>{}});
 const client={query:async sql=>({rows:sql.startsWith('SELECT COALESCE(MAX(revision)')?[{revision:1}]:sql.startsWith('SELECT * FROM opportunity_catalog.application WHERE')?[{opportunity_id:randomUUID()}]:[]})};
 const result=await repo.documentGet(client,app,{cursor:null});
 assert.deepEqual(result.capabilities,{canEdit:['admin','editor','noConfirm'].includes(mode),canDecide:['admin','reviewer'].includes(mode),canUpload:['admin','editor'].includes(mode)});
 assert(checks.some(([op])=>op==='APPLICATION_REVIEW_DECIDE'));
});

for(const method of ['documentLink','documentRemove','reviewRequest','reviewDecide'])test('refused '+method+' never reaches protected data',async()=>{
 let queries=0;
 const repo=createApplicationDocumentsRepository({organizationId:randomUUID(),actor:{id:randomUUID()},authorize:async()=>false,protect:async()=>{throw Error('unexpected protect')},audit:async()=>{throw Error('unexpected audit')}});
 await assert.rejects(repo[method]({query:async()=>{queries++;return {rows:[]}}},randomUUID(),{}),{code:'NOT_AUTHORIZED'});
 assert.equal(queries,0);
});
for(const granted of [false,true])test('linked clean version reports its own download permission: '+granted,async()=>{
 const org=randomUUID(),app=randomUUID(),doc=randomUUID(),ver=randomUUID();
 const authorize=async(op,r)=>{
  if(op!=='DOCUMENT_DOWNLOAD_REQUEST')return true;
  assert.equal(r.id,ver);assert.equal(r.organizationId,org);return granted;
 };
 const repository=createApplicationDocumentsRepository({organizationId:org,actor:{id:randomUUID()},authorize,protect:async()=>{},audit:async()=>{}});
 const client={query:async sql=>{
  if(sql.startsWith('SELECT COALESCE(MAX(revision)'))return {rows:[{revision:1}]};
  if(sql.startsWith('SELECT document_id,version_id FROM opportunity_catalog.application_document_link'))return {rows:[{document_id:doc,version_id:ver}]};
  if(sql.startsWith('SELECT * FROM opportunity_catalog.application WHERE'))return {rows:[{opportunity_id:randomUUID()}]};
  if(sql.includes('FROM document_storage.document_version v JOIN'))return {rows:[{document_id:doc,version_id:ver,version_number:1,state:'AVAILABLE',scan_state:'CLEAN',display_filename:'teste.pdf',created_at:new Date()}]};
  return {rows:[]};
 }};
 const result=await repository.documentGet(client,app,{cursor:null});assert.equal(result.documents[0].usable,true);assert.equal(result.documents[0].canDownload,granted);
});
