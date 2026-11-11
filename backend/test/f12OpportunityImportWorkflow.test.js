'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const xlsx=require('xlsx');
const {createProductionCatalogs}=require('../src/authorization/catalogs');
const {createOpportunityImportWorkflow,csv}=require('../src/opportunityImports/workflow');
const {createOpportunityImportJobRegistry,JOB_TYPE}=require('../src/opportunityImports/jobs');
const {createOpportunityImportF9JobPort}=require('../src/opportunityImports/f9JobPort');
const {MIME}=require('../src/opportunityImports/portugal2030Xlsx');
const {createOpportunityImportTelemetry}=require('../src/opportunityImports/telemetry');

const ORG='11111111-1111-4111-8111-111111111111',ACTOR='22222222-2222-4222-8222-222222222222',MEMBER='33333333-3333-4333-8333-333333333333',CORRELATION='018bcfe5-6800-7000-8000-000000000001';
function workbook(rows,{extraHeader=null}={}){const book=xlsx.utils.book_new(),headers=['ID','Designação do Aviso','Programa','Objetivo Específico','Tipo Ent. Beneficiária','Data Início Prevista','Data Fim Prevista',...(extraHeader?[extraHeader]:[])];xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet([headers,...rows]),'Avisos');xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet([['not','selected']]),'Ignorar');return xlsx.write(book,{type:'buffer',bookType:'xlsx'});}
function memory(){
 const jobs=new Map(),outcomes=new Map(),files=new Map(),created=[],events=[],enqueued=[];let next=0;const uuid=()=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(++next).padStart(12,'0')}`;
 const repository={
  async lockLine(){},async getOutcome(c,importId,line){return outcomes.get(`${importId}:${line}`)||null;},
  async createUpload(c,input){const replay=[...jobs.values()].find(j=>j.fileDigest===input.fileDigest);if(replay)return replay;const value={...input,state:'UPLOADED',mappingDigest:null,sheetName:null,totalRows:0,validRows:0,errorRows:0,processedRows:0,createdRows:0,exactRows:0,possibleRows:0,rejectedRows:0,conflictRows:0,rowVersion:1,createdAt:new Date().toISOString()};jobs.set(input.importId,value);return value;},
  async find(c,id){return jobs.get(id)||null;},async list(){return [...jobs.values()]},
  async savePreview(c,input){const j=jobs.get(input.importId);Object.assign(j,input,{state:'READY_FOR_CONFIRMATION',processedRows:input.errorRows,rejectedRows:input.errorRows});for(const e of input.errors)outcomes.set(`${input.importId}:${e.line}`,{line:e.line,rowDigest:e.rowDigest,state:'INVALID',code:e.codes[0]});return j;},
  async confirm(c,id){const active=[...jobs.values()].find(j=>j.importId!==id&&['QUEUED','RUNNING','CANCELLATION_REQUESTED'].includes(j.state));if(active)throw new Error('IMPORT_ACTIVE_JOB_CONFLICT');const j=jobs.get(id);if(j.state==='READY_FOR_CONFIRMATION')j.state='QUEUED';return j;},
  async claim(c,id){const j=jobs.get(id);if(j.state==='QUEUED')j.state='RUNNING';return j;},
  async cancel(c,id){const j=jobs.get(id);j.state=j.state==='RUNNING'?'CANCELLATION_REQUESTED':'CANCELLED';return j;},
  async outcome(c,input){const key=`${input.importId}:${input.line}`,previous=outcomes.get(key);if(previous)return previous;const value={line:input.line,rowDigest:input.rowDigest,state:input.state,code:input.code,conflictId:input.conflictId||null,resultId:input.resultId||null};outcomes.set(key,value);const j=jobs.get(input.importId);j.processedRows++;if(input.state==='CREATED')j.createdRows++;if(input.state==='EXACT')j.exactRows++;if(input.state==='POSSIBLE')j.possibleRows++;if(input.state==='CONFLICT')j.conflictRows++;return value;},
  async outcomes(c,id){return [...outcomes.entries()].filter(([key])=>key.startsWith(`${id}:`)).map(([,value])=>value).sort((a,b)=>a.line-b.line)},
  async finish(c,id,state){jobs.get(id).state=state;return jobs.get(id);},async linkReport(c,id,doc){Object.assign(jobs.get(id),{reportDocumentId:doc.documentId,reportDocumentVersionId:doc.documentVersionId});return jobs.get(id);},
  async reportReconciliation(c,id,resolved){const j=jobs.get(id);j.state=resolved&&j.state==='RECONCILIATION_REQUIRED'?'COMPLETED_WITH_ISSUES':resolved?j.state:'RECONCILIATION_REQUIRED';return j;},
  async review(c,input){const value=outcomes.get(`${input.importId}:${input.line}`);if(value?.state!=='POSSIBLE')return value?.decision===input.decision?{...value,replayed:true}:null;Object.assign(value,{state:input.decision==='CREATE'?'CREATED':'REJECTED',code:input.code,resultId:input.resultId||null,decision:input.decision});const j=jobs.get(input.importId);j.possibleRows--;if(input.decision==='CREATE')j.createdRows++;else j.rejectedRows++;return value;},
  async candidates(c,snapshot,externalIdentifier){return created.filter(value=>value.preexisting&&(value.provenance.externalIdentifier===externalIdentifier||value.snapshot.title===snapshot.title||value.snapshot.funderName===snapshot.funderName));}
 };
 function preexisting(snapshot,externalIdentifier){created.push({preexisting:true,opportunityId:uuid(),revisionId:uuid(),snapshot,provenance:{sourceNamespace:'PORTUGAL_2030_XLSX',externalIdentifier}});}
 const documents={async storeOriginal({importId,buffer}){files.set(`${importId}:original`,buffer);return{documentId:uuid(),documentVersionId:uuid()};},async read({documentId}){const job=[...jobs.values()].find(j=>j.originalDocumentId===documentId);return files.get(`${job.importId}:original`);},async storeReport({importId,buffer}){files.set(`${importId}:report`,buffer);return{documentId:uuid(),documentVersionId:uuid()};},async download(){return Buffer.from('report');}};
 const dependencies={transactions:{async run(context,work){return work({query:async()=>({rows:[]})});}},authorization:{async protect(c,{context,operationCode}){if(['OPPORTUNITY_IMPORT_CONFIRM','OPPORTUNITY_IMPORT_REVIEW'].includes(operationCode)&&!context.mfaRecent){const e=new Error('RECENT_MFA_REQUIRED');e.code='RECENT_MFA_REQUIRED';throw e;}return{allowed:true};}},documents,repository,jobs:{async enqueue(c,value){if(!enqueued.some(j=>j.idempotencyKey===value.idempotencyKey))enqueued.push(value);}},opportunities:{async create(c,command){const value={opportunityId:uuid(),revisionId:uuid(),snapshot:command.snapshot,provenance:command.provenance};created.push(value);return value;}},audit:{async append(c,value){if(!events.some(e=>e.idempotencyKey===value.idempotencyKey))events.push(value);}},id:uuid};
 return{dependencies,jobs,outcomes,files,created,events,enqueued,preexisting};
}
function context(mfaRecent=true){return{actor:{id:ACTOR,membershipId:MEMBER,membershipVersion:1,organizationId:ORG},correlationId:CORRELATION,mfaRecent};}
const base={schemaVersion:1,title:'Aviso exato',funderName:'Programa A',provenanceId:'00000000-0000-4000-8000-000000000000',lifecycleState:'DRAFT',validationState:'PENDING_REVIEW',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1',programmeName:'Programa A',callReference:'EX-1',openingDate:'2026-01-01',closingDate:'2026-02-01'};

test('F12 import catalogs expose seven independent F5 actions and only confirm/review require MFA',()=>{const c=createProductionCatalogs({catalogVersion:'f12'}),items=c.permissionCatalog.permissions.filter(p=>p.code.startsWith('opportunity_import.'));assert.equal(items.length,7);assert.deepEqual(items.filter(p=>p.sensitive).map(p=>p.code),['opportunity_import.confirm','opportunity_import.review']);assert.ok(items.every(p=>p.sodRule===null));});

test('XLSX workflow previews without creation, requires MFA, and processes EXACT/POSSIBLE/DISTINCT idempotently',async()=>{
 const h=memory();h.preexisting(base,'EX-1');h.preexisting({...base,title:'Aviso possível',callReference:'OTHER'},'OTHER');const service=createOpportunityImportWorkflow(h.dependencies),buffer=workbook([['EX-1','Aviso exato','Programa A','','','01/01/2026','01/02/2026'],['NEW-2','Aviso possível','Programa A','','','01/01/2026','01/02/2026'],['NEW-3','Aviso distinto','Programa Z','','','01/03/2026','01/04/2026'],['BAD','','Programa Z','','','01/03/2026','01/04/2026']]);
 const uploaded=await service.upload({context:context(),file:{buffer,mime:MIME,filename:'pt2030.xlsx'},requestId:'88888888-8888-4888-8888-888888888888'});assert.deepEqual(uploaded.sheets.map(s=>s.name),['Avisos','Ignorar']);const before=h.created.length;const preview=await service.preview({context:context(),importId:uploaded.job.importId,sheetName:'Avisos'});assert.equal(preview.created,0);assert.equal(h.created.length,before);assert.equal(preview.validRows,3);assert.equal(preview.errorRows,1);
 await assert.rejects(service.confirm({context:context(false),importId:uploaded.job.importId}),/RECENT_MFA/);await service.confirm({context:context(),importId:uploaded.job.importId});assert.equal(h.enqueued.length,1);await service.process({context:context(),importId:uploaded.job.importId});await service.process({context:context(),importId:uploaded.job.importId});const states=[...h.outcomes.values()].map(o=>o.state).sort();assert.deepEqual(states,['CREATED','EXACT','INVALID','POSSIBLE']);assert.equal(h.created.filter(v=>!v.preexisting).length,1);assert.equal(h.events.filter(e=>e.eventCode==='OPPORTUNITY_IMPORT_COMPLETED').length,1);assert.ok(h.files.get(`${uploaded.job.importId}:report`).toString('utf8').startsWith('\uFEFFline,state,code,conflict,result'));
 await assert.rejects(service.review({context:context(false),importId:uploaded.job.importId,line:3,decision:'CREATE'}),/RECENT_MFA/);const store=h.dependencies.documents.storeReport;let failOnce=true;h.dependencies.documents.storeReport=async input=>{if(failOnce){failOnce=false;throw new Error('F11_UNAVAILABLE');}return store(input);};await assert.rejects(service.review({context:context(),importId:uploaded.job.importId,line:3,decision:'CREATE'}),e=>e.code==='IMPORT_REPORT_RECONCILIATION_REQUIRED');assert.equal(h.jobs.get(uploaded.job.importId).state,'RECONCILIATION_REQUIRED');assert.equal(h.created.filter(v=>!v.preexisting).length,2);await service.review({context:context(),importId:uploaded.job.importId,line:3,decision:'CREATE'});assert.equal(h.jobs.get(uploaded.job.importId).state,'COMPLETED_WITH_ISSUES');assert.equal(h.created.filter(v=>!v.preexisting).length,2);assert.equal(h.events.filter(e=>e.eventCode==='OPPORTUNITY_IMPORT_POSSIBLE_REVIEWED').length,1);
});

test('explicitly ignored unknown headers are persisted and replayed by the worker',async()=>{
 const h=memory(),service=createOpportunityImportWorkflow(h.dependencies),buffer=workbook([['NEW-1','Aviso distinto','Programa Z','','','01/03/2026','01/04/2026','valor ignorado']],{extraHeader:'Coluna Local'});
 const uploaded=await service.upload({context:context(),file:{buffer,mime:MIME,filename:'pt2030-extra.xlsx'},requestId:'77777777-7777-4777-8777-777777777777'});
 await assert.rejects(service.preview({context:context(),importId:uploaded.job.importId,sheetName:'Avisos'}),e=>e.code==='IMPORT_HEADER_DECISION_REQUIRED');
 const preview=await service.preview({context:context(),importId:uploaded.job.importId,sheetName:'Avisos',headerDecisions:{'Coluna Local':'IGNORE'}});
 assert.deepEqual(preview.mapping.explicitlyIgnored,['Coluna Local']);
 await service.confirm({context:context(),importId:uploaded.job.importId});await service.process({context:context(),importId:uploaded.job.importId});
 assert.equal(h.jobs.get(uploaded.job.importId).state,'COMPLETED');assert.equal(h.created.length,1);
});

test('history can resume an upload with verified sheet choices',async()=>{
 const h=memory(),service=createOpportunityImportWorkflow(h.dependencies),buffer=workbook([['N','Title','Programme','','','01/03/2026','01/04/2026']]);
 const uploaded=await service.upload({context:context(),file:{buffer,mime:MIME,filename:'plan.xlsx'},requestId:'77777777-7777-4777-8777-777777777777'});
 const detail=await service.get({context:context(),importId:uploaded.job.importId});
 assert.deepEqual(detail.sheets.map(s=>s.name),['Avisos','Ignorar']);assert.equal(h.created.length,0);
 h.files.set(`${uploaded.job.importId}:original`,workbook([['M','Changed','Programme','','','01/03/2026','01/04/2026']]));
 await assert.rejects(service.get({context:context(),importId:uploaded.job.importId}),/IMPORT_FILE_DIGEST_MISMATCH/);
});

test('worker refuses changed original bytes even when the mapping is identical',async()=>{
 const h=memory(),service=createOpportunityImportWorkflow(h.dependencies),buffer=workbook([['N','Title','Programme','','','01/03/2026','01/04/2026']]);
 const uploaded=await service.upload({context:context(),file:{buffer,mime:MIME,filename:'plan.xlsx'},requestId:'77777777-7777-4777-8777-777777777777'}),importId=uploaded.job.importId;
 await service.preview({context:context(),importId,sheetName:'Avisos'});await service.confirm({context:context(),importId});
 h.files.set(`${importId}:original`,workbook([['M','Changed','Programme','','','01/03/2026','01/04/2026']]));
 await assert.rejects(service.process({context:context(),importId}),/IMPORT_FILE_DIGEST_MISMATCH/);
 assert.equal(h.created.length,0);assert.equal(h.jobs.get(importId).state,'FAILED');
});

test('queued legacy parser approvals never silently use the corrected interpretation',async()=>{
 const h=memory(),service=createOpportunityImportWorkflow(h.dependencies),buffer=workbook([['N','Title','Programme','','','01/03/2026','01/04/2026']]);
 const uploaded=await service.upload({context:context(),file:{buffer,mime:MIME,filename:'plan.xlsx'},requestId:'77777777-7777-4777-8777-777777777777'}),importId=uploaded.job.importId;
 const preview=await service.preview({context:context(),importId,sheetName:'Avisos'});assert.equal(preview.mapping.version,2);
 await service.confirm({context:context(),importId});h.jobs.get(importId).mappingDigest='0'.repeat(64);
 await assert.rejects(service.process({context:context(),importId}),/IMPORT_MAPPING_DIGEST_MISMATCH/);assert.equal(h.created.length,0);assert.equal(h.jobs.get(importId).state,'FAILED');
});

test('CSV report has only the five approved columns and no row content',()=>{const value=csv([{line:2,state:'REJECTED',code:'IMPORT_TITLE_REQUIRED',conflictId:null,resultId:null}]).toString('utf8');assert.equal(value,'\uFEFFline,state,code,conflict,result\r\n2,REJECTED,IMPORT_TITLE_REQUIRED,,\r\n');assert.ok(!value.includes('title'));});

test('confirmation creates one closed F9 envelope-v2 lineage without file content',async()=>{const received=[],registry=createOpportunityImportJobRegistry(async()=>{}),port=createOpportunityImportF9JobPort({registry,id:()=> '99999999-9999-4999-8999-999999999999',clock:()=>new Date('2026-10-12T10:00:00.000Z'),outboxRepository:{async enqueueLineage(client,value){received.push(value);return{created:true};}}});await port.enqueue({query:async()=>{}},{type:JOB_TYPE,organizationId:ORG,importId:'88888888-8888-4888-8888-888888888888',idempotencyKey:'IMPORT_JOB:88888888-8888-4888-8888-888888888888',actor:{id:ACTOR,membershipId:MEMBER,membershipVersion:1},correlationId:CORRELATION});assert.equal(received.length,1);assert.equal(received[0].envelope.envelopeVersion,2);assert.deepEqual(received[0].envelope.payload,{importId:'88888888-8888-4888-8888-888888888888'});assert.equal(received[0].envelope.actor.membershipId,MEMBER);assert.ok(!JSON.stringify(received[0]).includes('filename'));await registry.resolve(JOB_TYPE).handler(received[0].envelope);await assert.rejects(()=>registry.resolve(JOB_TYPE).handler({...received[0].envelope,payload:{importId:'bad'}}),/payload/);});

test('F12 import telemetry is closed and low-cardinality',async()=>{const records=[],telemetry=createOpportunityImportTelemetry({metrics:{record(name,value,labels){records.push({name,value,labels});}},clock:(()=>{let value=0;return()=>value++;})()});assert.equal(await telemetry.observe('opportunity_import.preview',async()=>42),42);assert.equal(records.length,2);assert.ok(records.every(item=>Object.keys(item.labels).sort().join(',')==='operation,resultClass'));await assert.rejects(()=>telemetry.observe('opportunity_import.unknown',async()=>{}),/invalid/);});
