'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createOpportunityReadModel,boundedCatalogPage,assertDetailSize}=require('../src/opportunities/v2/readModel');
const eu=require('../../context/references/opportunity-v2/examples/eu-11145.json');
const pt=require('../../context/references/opportunity-v2/examples/pt2030-8614.json');
const zero=require('../../context/references/opportunity-v2/examples/pt2030-8664.json');
const asOf='2026-10-30T12:00:00.000Z',revisionId='01900000-0000-7000-8000-000000000001';
const legacy=extra=>({schemaVersion:1,title:'Legacy',funderName:'Historical funder',provenanceId:revisionId,lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1',...extra});

test('common read model preserves normative money, unknown currency, project and every cutoff',()=>{
 const model=createOpportunityReadModel(eu,{asOf,revisionId});
 assert.equal(model.version,'opportunity-read-v2.0');assert.equal(model.sourceVersion,2);assert.equal(model.revisionId,revisionId);
 assert.equal(model.projection.financing.allocations.value[0].money.amount,'120000');
 assert.equal(model.projection.financing.allocations.value[0].money.currency.value,null);
 assert.equal(model.projection.relatedProject.acronym.value,'SUSA');assert.equal(model.projection.relatedProject.grantAgreementNumber.value,'101190010');
 assert.equal(model.projection.schedule.deadlines.value.length,7);assert.equal(model.temporal.finalDeadline.at.value,'2028-09-02T04:59:00.000Z');
 assert.equal(model.quality.verification,'NOT_CERTIFIED');assert.ok(model.quality.totalFields>0);assert.ok(Object.isFrozen(model));
 assert.equal(model.snapshot,undefined);assert.deepEqual(model.identity.references.value,eu.identity.references.value);
});

test('plans stay planned without multiplying allocations across programmes, including literal zero',()=>{
 const model=createOpportunityReadModel(pt,{asOf:'2028-01-01T00:00:00.000Z'});
 assert.equal(model.temporal.effectiveState,'PLANNED');assert.equal(model.temporal.nextDeadline,null);
 assert.equal(model.projection.programmes.value.length,3);assert.equal(model.projection.financing.allocations.value.length,1);
 assert.equal(createOpportunityReadModel(zero,{asOf}).projection.financing.allocations.value[0].money.amount,'0');
});

test('all 177 normative Excel rows reach the common model with their full facts and planning status',async()=>{
 const fs=require('node:fs'),path=require('node:path');
 const {inspectPlanXlsxV2}=require('../src/portugal2030/planXlsxV2');
 const filename='PlanoAnualAvisos_download_140926-1.xlsx';
 const bytes=fs.readFileSync(path.join(__dirname,'fixtures/portugal2030',filename));
 const bundle=await inspectPlanXlsxV2(bytes,{filename,sheetName:'Sheet1',observedAt:'2026-10-30T22:47:58.470Z'});
 assert.equal(bundle.rows.length,177);
 for(const row of bundle.rows){
  const snapshot=row.canonicalSnapshot;
  const model=createOpportunityReadModel(snapshot,{asOf:'2028-01-01T00:00:00.000Z'});
  assert.equal(model.temporal.effectiveState,'PLANNED',row.externalIdentifier);
  assert.equal(model.temporal.nextDeadline,null,row.externalIdentifier);
  for(const key of ['title','summary'])assert.deepEqual(model.projection.description[key].value,snapshot.description[key].value);
  assert.deepEqual(model.projection.financing.allocations.value,snapshot.financing.allocations.value);
  assert.deepEqual(model.projection.programmes.value,snapshot.programmes.value);
  assert.deepEqual(model.projection.schedule.plannedOpening.value,snapshot.schedule.plannedOpening.value);
  assert.deepEqual(model.projection.schedule.plannedClosing.value,snapshot.schedule.plannedClosing.value);
 }
});

test('legacy facts remain original and tagged, large decimal ranges never become call allocations',()=>{
 const raw=legacy({fundingAmountMin:'0.00',fundingAmountMax:'123456789012345678901234567890.123456789',currencyCode:'EUR',openingDate:'2026-01-01',closingDate:'2027-01-01'});
 const model=createOpportunityReadModel(raw,{asOf});
 assert.equal(model.sourceVersion,1);assert.equal(model.projection.legacy.fundingRange.value.maximum,raw.fundingAmountMax);
 assert.equal(model.projection.financing.allocations.state,'NOT_COLLECTED');assert.equal(model.temporal.effectiveState,'OPEN');
 assert.equal(model.temporal.finalDeadline.at.precision,'DATE');assert.ok(model.temporal.reasonCodes.includes('LEGACY_TEMPORAL_SEMANTICS'));
 assert.equal(raw.readModel,undefined);
});

test('review/freshness are independent of availability and do not certify current source accuracy',()=>{
 const model=createOpportunityReadModel(eu,{asOf,sourceReview:'ABSENT',observedAt:'2026-10-29T12:00:00.000Z'});
 assert.equal(model.temporal.effectiveState,'UNKNOWN');assert.equal(model.freshness.ageSeconds,86400);assert.equal(model.quality.reviewRequired,true);
 assert.equal(model.projection.financing.allocations.state,'PRESENT');assert.ok(model.temporal.reasonCodes.includes('SOURCE_REVIEW_REQUIRED'));
 assert.throws(()=>createOpportunityReadModel({...eu,schemaVersion:3},{asOf}));
 assert.throws(()=>createOpportunityReadModel(eu,{asOf:'2026-10-30T12:00:00'}));
});

test('catalog pagination respects byte budget without truncating a fact or skipping the next item',()=>{
 const rows=Array.from({length:26},(_,i)=>({opportunityId:String(i).padStart(2,'0'),value:'x'.repeat(100000)}));
 const result=boundedCatalogPage(rows,{programmes:[],asOf});
 assert.ok(Buffer.byteLength(JSON.stringify(result))<=1024*1024);assert.equal(result.items.length,10);assert.equal(result.nextCursor,'09');
 assert.equal(result.items[9].value.length,100000);assert.equal(rows[10].opportunityId,'10');
 assert.throws(()=>boundedCatalogPage([{opportunityId:'x',value:'x'.repeat(1024*1024)}],{programmes:[],asOf}),{code:'OPPORTUNITY_READ_LIMIT_EXCEEDED'});
 assert.throws(()=>assertDetailSize({snapshot:'x'.repeat(512*1024)}),{code:'OPPORTUNITY_READ_LIMIT_EXCEEDED'});
});

test('valid legacy instants retain historical readability even when outside the stricter v2 input grammar',()=>{
 for(const deadline of ['2027-01-01T00:00:00-0000','2027-01-01T24:00:00Z']){
  const model=createOpportunityReadModel(legacy({sourceTemporal:{status:'OPEN',openings:[],deadlines:[deadline]}}),{asOf});
  assert.equal(model.projection.schedule.deadlines.value[0],deadline);
  assert.equal(model.temporal.finalDeadline.at.value,new Date(deadline).toISOString());
 }
});

test('SQL facets do not promote an unconfirmed legacy alias over observed programme absence or conflict',()=>{
 const {programmeLabelsExpression}=require('../src/opportunities/v2/catalogSql');
 const sql=programmeLabelsExpression();
 assert.match(sql,/sourceEnrichment.*IS NOT NULL THEN '\[\]'::jsonb/s);
 assert.ok(sql.indexOf("IS NOT NULL THEN '[]'::jsonb")<sql.indexOf('o.programme_name IS NOT NULL'));
});

test('a currency conflict remains explicit even inside an otherwise present allocation',()=>{
 const snapshot=structuredClone(eu);
 const currency=snapshot.financing.allocations.value[0].money.currency;
 Object.assign(currency,{state:'CONFLICT',value:null,reason:'CURRENCY_CONFLICT',evidenceRefs:snapshot.provenance.evidence.slice(0,2).map(e=>e.id)});
 const model=createOpportunityReadModel(snapshot,{asOf});
 assert.equal(model.projection.financing.allocations.state,'PRESENT');
 assert.equal(model.quality.fieldStates.CONFLICT,1);
 assert.ok(model.quality.issues.some(issue=>issue.code==='FIELD_CONFLICT'&&issue.field==='/financing/allocations/value/0/money/currency'));
});

test('catalog page budget equals the size of the serialized envelope at every boundary',()=>{
 const {prepareOpportunitySnapshot}=require('../src/opportunities/v2/readModel');
 const limit=1024*1024-4096,metadata={programmes:['Programa é'],asOf,interventionAreas:[{code:'DIGITAL',label:'Digital'}]};
 for(const length of [40000,41500,41600,41700,43000]){
  const rows=Array.from({length:26},(_,i)=>({opportunityId:'id-'+String(i).padStart(2,'0'),value:'é'.repeat(length/2)}));
  const result=boundedCatalogPage(rows,metadata);
  const envelope=count=>Buffer.byteLength(JSON.stringify({interventionAreas:metadata.interventionAreas,items:rows.slice(0,count),programmes:metadata.programmes,nextCursor:rows[count-1].opportunityId,asOf}));
  assert.ok(envelope(result.items.length)<=limit);
  if(result.items.length<25)assert.ok(envelope(result.items.length+1)>limit);
  assert.equal(result.nextCursor,result.items.at(-1).opportunityId);
 }
 // A prepared immutable revision produces exactly the same read model.
 for(const snapshot of [eu,pt,zero,legacy({closingDate:'2027-01-01'})])
  assert.deepEqual(createOpportunityReadModel(snapshot,{asOf,revisionId,prepared:prepareOpportunitySnapshot(snapshot)}),createOpportunityReadModel(snapshot,{asOf,revisionId}));
});
