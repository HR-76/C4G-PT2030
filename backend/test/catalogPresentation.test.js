'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),{randomBytes}=require('node:crypto');
const {loadPresentation,canonicalPresentation}=require('../src/opportunities/catalogRead/presentation');
const {loadStoredCatalog}=require('../src/opportunities/catalogRead/storedEvidence');
const {buildProjection,emptyExtension,stableId,digest}=require('../src/opportunities/catalogRead/model');
const {createReadService}=require('../src/opportunities/catalogRead/readService');
const {createIndex,atTime}=require('../src/opportunities/catalogRead/readIndex');
const {validate}=require('../src/opportunities/catalogRead/contractValidation');
const directory=path.resolve(__dirname,'../../context/references/opportunity-v2/evidence'),asOf='2026-11-02T00:00:00.000Z';
const records=loadStoredCatalog(directory).records;
const rows=records.filter(r=>r.snapshot.sourceRecords[0].namespace==='EU_FUNDING_TENDERS'||r.snapshot.sourceRecords[0].externalId==='8485').map(r=>buildProjection(r.snapshot,emptyExtension(r.snapshot,{opportunityId:r.opportunityId,revisionId:r.revisionId,extensionId:stableId(r.revisionId),acceptanceDigest:'a'.repeat(64),recordedAt:asOf}),{asOf}));
const eu=rows.find(r=>r.detail.summary.kind==='cascade_call'),pt=rows.find(r=>r!==eu),presentation=loadPresentation(directory);
function compact(p){return {payloadDigest:digest(p),version:p.version,summary:p.detail.summary,calendar:p.inputs.snapshot,extension:p.inputs.extension,relationships:[]};}
test('archived EU presentation exposes exact sections, duration and thematic text with correct provenance',()=>{
 const before=structuredClone(eu),detail=presentation.describe(eu),info=detail.callInformation;
 assert.equal(info.topic.value,'DIGITAL-2023-SKILLS-05-SPECIALEDU');assert.equal(info.topic.source,'canonical');
 assert.equal(info.eligibleCandidates.value,'Medical, Engineering and Biomedical - Bioinformatics Students (BSc/MSc)');
 assert.equal(info.location.value,'Remote (Virtual) or On-Site at Gnomon Informatics SA Offices');
 assert.equal(info.duration.value,'4 months\u202f(640 hours)');
 assert.equal(info.location.sourcePointer,'/variants/0/metadata/furtherInformation/0');assert.equal(info.duration.sourcePointer,'/variants/0/metadata/duration/0');
 assert.equal(detail.summary.presentation.typification.value,'Financiamento em cascata');
 assert.match(detail.summary.presentation.areas.value,/Artificial intelligence applications in healthcare/);
 assert.equal(detail.summary.presentation.areas.sourcePointer,'/variants/0/metadata/description/0');
 assert(detail.description.value.length>2000);assert.equal(validate('Detail',detail).valid,true);assert.deepEqual(eu,before);
 assert.equal(detail.summary.funding.value.currency,null); // Presentation never fabricates source currency.
});
test('PT concepts retain their meaning and missing duration is not inferred from planned dates',()=>{
 const detail=presentation.describe(pt),info=detail.callInformation;
 assert.equal(detail.summary.presentation.typification.value,'Concurso');
 assert.equal(detail.summary.presentation.areas.value,'Objetivo específico: ESO4.8 — Inclusão ativa e empregabilidade');
 assert.equal(info.topic.value,detail.summary.presentation.areas.value);
 assert.equal(info.eligibleCandidates.value,'Privada · Pública');assert.equal(info.location.value,'Norte (âmbito não especificado)');
 assert.equal(info.location.source,'canonical');assert.equal(info.location.sourceUrl,null);
 assert.deepEqual(info.duration,{value:null,source:'unavailable',sourceUrl:null,sourcePointer:null});
 assert.equal(validate('Detail',detail).valid,true);
});
test('archive enrichment refuses a changed source digest or absent artifact binding',()=>{
 for(const modified of [{...eu,sourceDigest:'0'.repeat(64)},{...eu,collections:{...eu.collections,evidence:[]}}]){
  const info=presentation.describe(modified).callInformation;
  assert.equal(info.duration.source,'unavailable');assert.equal(info.location.value,null);assert.equal(info.eligibleCandidates.value,null);
 }
 const absent=structuredClone(eu);absent.inputs.snapshot.identity.references={state:'NOT_COLLECTED',value:null};
 assert.equal(canonicalPresentation(absent).callInformation.topic.value,null);
});
test('changed archived bytes are refused instead of supplying an unverified display value',()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'gcni-presentation-'));
 try{fs.writeFileSync(path.join(temporary,'eu-11145.json'),'{}');assert.throws(()=>loadPresentation(temporary),/EVIDENCE_MISMATCH/);}finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
test('presentation contract rejects unknown fields and inconsistent unavailable provenance',()=>{
 const value={value:null,source:'unavailable',sourceUrl:null,sourcePointer:null};
 assert.equal(validate('PresentationValue',value).valid,true);
 assert.equal(validate('PresentationValue',{...value,value:'invented'}).valid,false);
 assert.equal(validate('PresentationValue',{...value,extra:true}).valid,false);
 assert.equal(validate('PresentationValue',{value:'text',source:'archived',sourcePointer:'/metadata',sourceUrl:'javascript:alert(1)'}).valid,false);
});
for(const indexed of [false,true])test(`list and detail presentation agree without altering immutable summaries (index=${indexed})`,async()=>{
 let verifications=0;const index=createIndex(rows.map(compact)),before=structuredClone(rows);
 const generation={id:stableId('presentation-generation'),asOf,rows};
 const repository={async load(_id,{opportunityId}){return indexed&&!opportunityId?{id:generation.id,asOf,index,async verify(summaries,at){verifications++;return summaries.map(s=>{const p=atTime(rows.find(r=>r.opportunityId===s.id),at);assert.deepEqual(p.detail.summary,s);return p;});}}:generation;}};
 const service=createReadService({repository,key:randomBytes(32),clock:()=>Date.parse(asOf),authorize:async()=>({scope:'member',expiresAt:Date.parse(asOf)+900000}),...presentation});
 const list=await service.request({principal:'member',path:'/opportunities'});assert.equal(validate('ListResponse',list).valid,true);
 assert.equal(verifications,indexed?1:0);
 for(const summary of list.data){const detail=await service.request({principal:'member',path:'/opportunities/'+summary.id,pairs:[['snapshot',list.meta.snapshot]]});assert.deepEqual(detail.data.summary,summary);assert.equal(validate('DetailResponse',detail).valid,true);}
 assert.deepEqual(rows,before);
});
test('failed page verification prevents presentation and final revocation prevents release',async()=>{
 const index=createIndex(rows.map(compact));let allowed=true,verifyFails=true,presentations=0;
 const service=createReadService({key:randomBytes(32),clock:()=>Date.parse(asOf),authorize:async()=>{if(!allowed)throw Object.assign(Error('Denied'),{status:403});return {scope:'member',expiresAt:Date.parse(asOf)+900000};},repository:{load:async()=>({id:stableId('presentation-revocation'),asOf,index,verify:async()=>{if(verifyFails)throw Object.assign(Error('Unverified'),{status:503});return rows;}})},presentSummary:(s,p)=>{presentations++;allowed=false;return presentation.presentSummary(s,p);}});
 await assert.rejects(service.request({principal:'member',path:'/opportunities'}),{status:503});assert.equal(presentations,0);
 verifyFails=false;await assert.rejects(service.request({principal:'member',path:'/opportunities'}),{status:403});
});
test('repository verification returns already-admitted full projections with no extra reads for presentation',async()=>{
 const {createReadRepository}=require('../src/opportunities/catalogRead/readRepository');let queries=0,admissions=0;
 const client={release(){},async query(sql,params){queries++;
  if(sql.includes('AS reset'))return {rows:[{reset:true,limited:true}]};
  if(sql.includes('SELECT g.*'))return {rows:[{generation_id:stableId('presentation-repository'),as_of:asOf,published_at:asOf,expected_count:rows.length}]};
  if(sql.startsWith('SELECT COALESCE(sum'))return {rows:[{bytes:'8192'}]};
  if(sql.includes(' AS item FROM'))return {rows:rows.map(p=>({item:compact(p)}))};
  if(sql.startsWith('SELECT opportunity_id,payload_digest'))return {rows:rows.filter(p=>params[1].includes(p.opportunityId)).map(p=>({opportunity_id:p.opportunityId,payload_digest:digest(p),bytes:20000}))};
  if(sql.startsWith('SELECT payload,payload_digest'))return {rows:rows.filter(p=>params[1].includes(p.opportunityId)).map(p=>({payload:p,payload_digest:digest(p)}))};
  if(/^(BEGIN|SET|SELECT pg_advisory|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};throw Error('Unexpected read');
 }};
 const repo=createReadRepository({pool:{connect:async()=>client},admit:async()=>{admissions++;}}),generation=await repo.load();
 const summaries=generation.index.summaries(asOf),verified=await generation.verify(summaries,asOf),count=queries;
 assert.equal(verified.length,2);assert(verified.every(p=>p.inputs.snapshot));
 const second=await generation.verify(summaries,asOf);assert.equal(queries,count);
 second.forEach((p,index)=>{const summary=presentation.presentSummary(summaries[index],p);assert.equal(validate('Summary',summary).valid,true);});
 assert.equal(queries,count);assert.equal(admissions,3);
});


