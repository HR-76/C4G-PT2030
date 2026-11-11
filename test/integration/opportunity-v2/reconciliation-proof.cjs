'use strict';
// Public, immutable source fixtures only. This proof performs no catalogue writes
// and never opens a database or a network connection on import or execution.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../../..');
const {previewReconciliation,rawSnapshotDigest}=require('../../../backend/src/opportunities/v2/reconciliation');
const {createOpportunityReadModel}=require('../../../backend/src/opportunities/v2/readModel');
const {semanticSnapshotV2}=require('../../../backend/src/opportunities/v2/digests');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=file=>fs.readFileSync(path.join(root,file));
const id=n=>'01910000-0000-7000-8000-'+String(n).padStart(12,'0');
function implementationDigest(version,files){return sha(JSON.stringify({version,files:Object.fromEntries([...files].sort().map(file=>[file,sha(read(file))]))}));}
async function buildCorpus(){
 const {buildEvidence}=require('../../../backend/src/fundingTenders/sourceEvidence');
 const {adaptEuOpportunityV2}=require('../../../backend/src/fundingTenders/adapterV2');
 const {inspectPlanXlsxV2}=require('../../../backend/src/portugal2030/planXlsxV2');
 const {createOfficialProgrammeEvidenceV2,adaptOfficialProgrammeV2}=require('../../../backend/src/fundingTenders/officialAdapterV2');
 const {SOURCES}=require('../../../backend/src/fundingTenders/officialSources');
 const manual=require('../../../backend/src/opportunities/manualV2');
 const evidence=buildEvidence('CASCADE:11145',JSON.parse(read('context/references/opportunity-v2/evidence/eu-11145.json')).results);
 const eu=adaptEuOpportunityV2(evidence,{observedAt:'2026-10-30T22:45:39.461Z'});
 const euMapping=implementationDigest(eu.provenance.mappingVersion,['backend/src/fundingTenders/adapterV2.js','backend/src/fundingTenders/sourceEvidence.js','backend/src/fundingTenders/sourceDescription.js','backend/src/fundingTenders/programmeTaxonomy.js']);
 const candidates=[{candidateId:'EU_FUNDING_TENDERS:CASCADE:11145',snapshot:eu,mappingDigest:euMapping}];
 const filename='PlanoAnualAvisos_download_140926-1.xlsx';
 const workbook=read('backend/test/fixtures/portugal2030/'+filename);
 const plan=await inspectPlanXlsxV2(workbook,{filename,sheetName:'Sheet1',observedAt:'2026-10-30T22:47:58.470Z'});
 assert.equal(plan.validRows,177);assert.equal(plan.errorRows,0);
 for(const row of plan.rows)candidates.push({candidateId:'PORTUGAL2030_PLAN:'+row.externalIdentifier,snapshot:row.canonicalSnapshot,mappingDigest:plan.mappingDigest});
 const officialMapping=implementationDigest('official-programmes-v2.0',['backend/src/fundingTenders/officialAdapterV2.js','backend/src/fundingTenders/officialEvidenceV2.js','backend/src/fundingTenders/officialSources.js']);
 for(const source of ['INTERREG_EUROPE','POCTEP']){
  const documents=source==='INTERREG_EUROPE'?[{url:SOURCES[source].url,mediaType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bodyBase64:read('backend/test/fixtures/official-programmes/interreg.xlsx').toString('base64')}]
   :['calendar','open'].map((name,index)=>({url:index?SOURCES[source].details:SOURCES[source].url,mediaType:'application/json',bodyBase64:read('backend/test/fixtures/official-programmes/v2/'+name+'.json').toString('base64')}));
  const sourceEvidence=createOfficialProgrammeEvidenceV2({source,observedAt:'2026-10-30T23:45:00.000Z',documents});
  for(let number=1;number<=(source==='INTERREG_EUROPE'?3:10);number++){
   const externalIdentifier=source+':2021-2027:CALL:'+number;
   candidates.push({candidateId:externalIdentifier,snapshot:adaptOfficialProgrammeV2({sourceEvidence,externalIdentifier}),mappingDigest:officialMapping});
  }
 }
 const snapshot=manual.adaptManualOpportunityV2({kind:'CALL',fields:{'/description/title':{state:'PRESENT',value:'S6 editorial rehearsal',reason:null}}},{editorialId:'a'.repeat(64),observedAt:'2026-10-30T12:00:00.000Z'}).snapshot;
 candidates.push({candidateId:'C4G_MANUAL:S6',snapshot,mappingDigest:manual.MAPPING_DIGEST});
 return {candidates,workbookSha256:sha(workbook),mappingEvidence:{eu:{kind:'S6_IMPLEMENTATION_FINGERPRINT',digest:euMapping},official:{kind:'S6_IMPLEMENTATION_FINGERPRINT',digest:officialMapping},portugal2030:{kind:'MAPPING_DESCRIPTOR',digest:plan.mappingDigest},manual:{kind:'MAPPING_DESCRIPTOR',digest:manual.MAPPING_DIGEST}}};
}
function acceptedCorpus(candidates){return candidates.map((candidate,index)=>({opportunityId:id(index*2+1),revisionId:id(index*2+2),rowVersion:1,snapshot:candidate.snapshot,mappingDigest:candidate.mappingDigest,
 privateReferences:[{kind:'APPLICATION',organizationId:id(500),id:id(1000+index),revisionId:id(index*2+2),snapshotDigest:rawSnapshotDigest(candidate.snapshot)}]}));}
async function reconciliationProof({check=async(_name,work)=>work(),report={},evidenceDir}={}){
 let corpus,empty,existing,legacyMigration,withDuplicates,partial,accepted;
 await check('RECONCILIATION_PUBLIC_CORPUS_192',async()=>{
  corpus=await buildCorpus();assert.equal(corpus.candidates.length,192);
  assert.deepEqual(semanticSnapshotV2(corpus.candidates[0].snapshot),semanticSnapshotV2(JSON.parse(read('context/references/opportunity-v2/examples/eu-11145-v2.1.json'))));
  assert.equal(corpus.candidates[0].snapshot.financing.allocations.value[0].money.amount,'120000');
  assert.equal(corpus.candidates[0].snapshot.schedule.deadlines.value.length,7);
  for(const candidate of corpus.candidates.filter(x=>x.candidateId.startsWith('PORTUGAL2030_PLAN:')))assert.equal(createOpportunityReadModel(candidate.snapshot,{asOf:'2028-01-01T00:00:00.000Z'}).temporal.effectiveState,'PLANNED');
 });
 await check('RECONCILIATION_NO_AUTOMATIC_ADMISSION_DOCUMENT_CONFLICT_BLOCKED',async()=>{
  empty=previewReconciliation({accepted:[],candidates:corpus.candidates});
  assert.deepEqual(empty.counts,{UNCHANGED:0,NEW:191,CHANGE_REQUIRES_APPROVAL:0,BLOCKED:1});
  assert.equal(empty.items.find(x=>x.action==='BLOCKED').candidateId,'POCTEP:2021-2027:CALL:10');
  assert.ok(empty.items.every(x=>x.canReplaceAccepted===false));
 });
 await check('RECONCILIATION_PRESERVES_ACCEPTED_PRIVATE_BINDINGS_AND_NOOP',async()=>{
  accepted=acceptedCorpus(corpus.candidates);const before=JSON.stringify(accepted);
  existing=previewReconciliation({accepted,candidates:corpus.candidates});
  assert.deepEqual(existing.counts,{UNCHANGED:191,NEW:0,CHANGE_REQUIRES_APPROVAL:0,BLOCKED:1});
  assert.equal(JSON.stringify(accepted),before);assert.equal(existing.unseenAcceptedOpportunityIds.length,0);
  assert.equal(existing.previewDigest,previewReconciliation({accepted:[...accepted].reverse(),candidates:[...corpus.candidates].reverse()}).previewDigest);
 });
 await check('RECONCILIATION_V1_MIGRATION_REQUIRES_EXPLICIT_REVIEW',async()=>{
  const legacy={schemaVersion:1,title:'Gnomon Internships Offer',funderName:'Historical value preserved',provenanceId:id(700),lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1'};
  const current={...accepted[0],snapshot:legacy,mappingDigest:null,identities:[{namespace:'EU_FUNDING_TENDERS',externalId:'CASCADE:11145'}]};
  legacyMigration=previewReconciliation({accepted:[current],candidates:corpus.candidates});
  assert.deepEqual(legacyMigration.counts,{UNCHANGED:0,NEW:190,CHANGE_REQUIRES_APPROVAL:1,BLOCKED:1});
  assert.equal(legacyMigration.items.find(x=>x.candidateId===corpus.candidates[0].candidateId).accepted.opportunityId,current.opportunityId);
  const blocked=previewReconciliation({accepted:[{...current,corrections:{title:{value:legacy.title}},resolutions:[{decisionId:id(701),kind:'KEEP_ACCEPTED'}]}],candidates:[corpus.candidates[0]]});
  assert.equal(blocked.items[0].action,'BLOCKED');
 });
 await check('RECONCILIATION_DUPLICATES_AND_PARTIAL_EDITION_NEVER_DELETE',async()=>{
  withDuplicates=previewReconciliation({accepted:[],candidates:[...corpus.candidates,{...corpus.candidates[0],candidateId:'duplicate-eu'}]});
  assert.equal(withDuplicates.totalCandidates,193);assert.equal(withDuplicates.counts.BLOCKED,3);
  const removed=corpus.candidates.find(x=>x.candidateId==='PORTUGAL2030_PLAN:8614');
  const index=corpus.candidates.indexOf(removed);
  partial=previewReconciliation({accepted,candidates:corpus.candidates.filter(x=>x!==removed)});
  assert.deepEqual(partial.unseenAcceptedOpportunityIds,[accepted[index].opportunityId]);assert.equal(partial.canDeleteAccepted,false);
 });
 report.reconciliation={scope:'PUBLIC_FIXTURES_AND_SYNTHETIC_ACCEPTED_BINDINGS_ONLY',totalCandidates:192,sourceCounts:{EU_FUNDING_TENDERS:1,PORTUGAL2030_PLAN:177,INTERREG_EUROPE:3,POCTEP:10,C4G_MANUAL:1},workbookSha256:corpus.workbookSha256,mappingEvidence:corpus.mappingEvidence,
  fresh:empty.counts,accepted:existing.counts,legacyMigration:legacyMigration.counts,duplicates:withDuplicates.counts,partialEditionUnseen:partial.unseenAcceptedOpportunityIds.length,
  previewDigest:empty.previewDigest,publicationAuthorized:false,historicalDataTouched:false};
 if(evidenceDir){fs.mkdirSync(evidenceDir,{recursive:true});for(const [name,value]of Object.entries({fresh:empty,accepted:existing,legacy:legacyMigration,duplicates:withDuplicates,partial}))fs.writeFileSync(path.join(evidenceDir,'reconciliation-'+name+'.json'),JSON.stringify(value,null,2)+'\n');}
 return {corpus,preview:empty};
}
module.exports={buildCorpus,acceptedCorpus,reconciliationProof};
