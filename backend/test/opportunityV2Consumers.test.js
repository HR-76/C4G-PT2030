'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {describeFrozenOpportunity,assertApplicationSnapshotFits,frozenSnapshotExpressions,centralLifecycle}=require('../src/applications/opportunitySnapshot');
const example=name=>JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../context/references/opportunity-v2/examples',name),'utf8'));
const eu=()=>example('eu-11145.json');
const asOf='2026-10-30T12:00:00.000Z';

test('dashboard keeps planned counts separate and sorts open opportunities with unknown dates last',()=>{
 const {dashboardProjection,emptyMetrics}=require('../src/routes/organizationDashboardRoutes');
 const report={metrics:emptyMetrics(),states:{},today:'2026-10-31',deadlines:[],unitsAvailable:false};
 const summary={total:3,open:2,planned:1,closing_soon:1,sources:[],recent:[{id:'known',closing_date:'2026-11-01'},{id:'unknown',closing_date:null}]};
 const result=dashboardProjection(report,summary,{total:0,open:0,planned:2,closing_soon:0,sources:[],recent:[]});
 assert.equal(result.opportunities.open,2);assert.equal(result.opportunities.planned,3);
 assert.deepEqual(result.recent_opportunities.map(item=>item.id),['known','unknown']);
});

test('frozen v2 summary reads all facts without flattening or modifying the saved snapshot',()=>{
 const source=eu(),before=JSON.stringify(source),view=describeFrozenOpportunity(source,{asOf,revisionId:randomUUID()});
 assert.equal(view.title,source.description.title.value);
 assert.equal(view.closingDate,'2028-09-02T04:59:00.000Z');
 assert.equal(view.readModel.sourceVersion,2);
 assert.equal(view.readModel.projection.financing.allocations.value[0].money.amount,'120000');
 assert.equal(view.readModel.projection.schedule.deadlines.value.length,7);
 assert.equal(JSON.stringify(source),before);
});

test('frozen planned opportunity never promotes a forecast to its confirmed closing date',()=>{
 const files=fs.readdirSync(path.resolve(__dirname,'../../context/references/opportunity-v2/examples')).filter(name=>name.startsWith('pt2030'));
 const source=example(files[0]),view=describeFrozenOpportunity(source,{asOf});
 assert.equal(view.closingDate,null);assert.equal(view.readModel.temporal.effectiveState,'PLANNED');
 assert.equal(view.readModel.projection.schedule.plannedClosing.state,'PRESENT');
});

test('legacy frozen summaries retain historical fields without relabelling them as v2',()=>{
 const source={title:'Historical',closingDate:'2026-10-31',programmeName:'Programme'};
 const result=describeFrozenOpportunity(source,{asOf});
 assert.equal(result.title,'Historical');assert.equal(result.closingDate,'2026-10-31');assert.equal(result.readModel,undefined);
 assert.equal(centralLifecycle({...source,lifecycleState:'ACTIVE'},null),'ACTIVE');
});

test('v2 lifecycle belongs to a current central envelope and cannot be invented from factual data',()=>{
 const source=eu();
 assert.equal(centralLifecycle(source,{lifecycleState:'ACTIVE'}),'ACTIVE');
 assert.equal(centralLifecycle(source,{lifecycleState:'ARCHIVED'}),'ARCHIVED');
 for(const value of [null,{}, {snapshot:{lifecycleState:'ACTIVE'}}])assert.throws(()=>centralLifecycle(source,value),{code:'RESOURCE_NOT_AVAILABLE'});
});

test('current application snapshot size gate fails explicitly before SQL and never truncates v2',()=>{
 const source=eu(),before=JSON.stringify(source);assertApplicationSnapshotFits(source);assert.equal(JSON.stringify(source),before);
 const large={...source,description:{...source.description,summary:{...source.description.summary,state:'PRESENT',value:'x'.repeat(33000),reason:null}}};
 assert.throws(()=>assertApplicationSnapshotFits(large),{code:'SCHEMA_UPGRADE_REQUIRED'});
});

test('frozen SQL expressions support v1 and v2 without treating forecasts as confirmed deadlines',()=>{
 const sql=frozenSnapshotExpressions('a.central_snapshot');
 assert.match(sql.title,/description,title,value/);assert.match(sql.title,/->>'title'/);
 assert.match(sql.join,/schedule,deadlines,state/);assert.doesNotMatch(sql.deadline,/plannedClosing/);
 assert.match(sql.deadline,/v2_schedule.final_deadline/);assert.match(sql.join,/NOT EXISTS/);
 assert.match(sql.deadlineDate,/make_date\(CASE WHEN/);assert.doesNotMatch(sql.deadlineDate,/::timestamptz/);
 assert.match(sql.deadlineDay,/THEN '0000'/);
 assert.throws(()=>frozenSnapshotExpressions('a.x;DROP TABLE x'),TypeError);
});

test('matching consumes compact v2 suggestions with planned and exact-cutoff states without eligibility claims',async()=>{
 const {createOrganizationMatching}=require('../src/organizationDirectory/matching');
 const {areas}=require('../src/organizationDirectory/thematicAreas');
 const {createOpportunityReadModel}=require('../src/opportunities/v2/readModel');
 const education=areas.find(area=>area.name==='Educação e Formação Profissional');
 const source=eu();source.description.title.value='Education training internships';
 const plan=structuredClone(source);plan.publication.value='PLANNED';
 plan.schedule.plannedClosing=structuredClone(plan.schedule.opening);plan.schedule.plannedClosing.value={precision:'DATE',value:'2027-12-31'};
 plan.schedule.opening={state:'NOT_COLLECTED',value:null,evidenceRefs:[],reason:'PLANNED_ONLY'};
 plan.schedule.deadlines={state:'NOT_COLLECTED',value:null,evidenceRefs:[],reason:'PLANNED_ONLY'};
 plan.schedule.deadlineModel={state:'NOT_COLLECTED',value:null,evidenceRefs:[],reason:'PLANNED_ONLY'};
 const closed=structuredClone(source);closed.status.published.value='CLOSED';
 const records=[source,plan,closed].map(snapshot=>({opportunityId:randomUUID(),lifecycleState:'ACTIVE',readModel:createOpportunityReadModel(snapshot,{asOf})}));
 let reads=0;const service=createOrganizationMatching({directory:{execute:async()=>({person:{active:true},profile:{areaIds:[education.id]}})},
  opportunities:{list:async()=>({items:[]})},central:{list:async()=>({items:records}),get:async()=>{reads++;throw Error('N+1 read');}},clock:()=>new Date(asOf)});
 const result=await service.execute({},{});
 assert.equal(result.items.length,2);assert.equal(reads,0);assert.match(result.explanation,/Não determina elegibilidade/);
 const planned=result.items.find(item=>item.temporalState==='PLANNED');assert.equal(planned.deadlineKind,'PLANNED');assert.equal(planned.closingDate,null);
 assert.deepEqual(planned.deadline,{precision:'DATE',value:'2027-12-31'});
 assert.ok(result.items.every(item=>item.href.startsWith('/catalogo/')&&!item.readModel&&!item.snapshot));
});

test('matching v2 honors exact expiry instead of keeping the call until the end of its civil day',()=>{
 const {projectMatchOpportunity,currentForMatching}=require('../src/organizationDirectory/matching');
 const source=eu(),date='2028-09-02T04:59:00.000Z';
 const output=projectMatchOpportunity({snapshot:source,lifecycleState:'ACTIVE'},{origin:'CENTRAL',opportunityId:randomUUID(),asOf:date});
 assert.equal(output.temporalState,'CLOSED');assert.equal(currentForMatching(output,'2028-09-02'),false);
});

test('matching preserves v2 textual conditions and missing conditions without claiming eligibility',async()=>{
 const {createOrganizationMatching,projectMatchOpportunity}=require('../src/organizationDirectory/matching');
 const {areas}=require('../src/organizationDirectory/thematicAreas');
 const education=areas.find(area=>area.name==='Educação e Formação Profissional');
 const source=eu();source.description.title.value='Neutral opportunity';
 source.description.summary={state:'NOT_COLLECTED',value:null,evidenceRefs:[],reason:'NO_OBSERVATION'};
 const missing=projectMatchOpportunity({snapshot:source,lifecycleState:'ACTIVE'},{origin:'CENTRAL',opportunityId:randomUUID(),asOf});
 source.eligibility.conditions={...source.description.title,value:'Education training internships'};
 require('../src/opportunities/v2').validateSnapshotV2(source);
 const record={opportunityId:randomUUID(),snapshot:source,lifecycleState:'ACTIVE'};
 const service=createOrganizationMatching({directory:{execute:async()=>({person:{active:true},profile:{areaIds:[education.id]}})},opportunities:{list:async()=>({items:[]})},
  central:{list:async()=>({items:[record]})},clock:()=>new Date(asOf)});
 const result=await service.execute({},{});
 assert.equal(missing.eligibility,null);
 assert.equal(result.items.length,1);assert.equal(result.items[0].eligibility,source.eligibility.conditions.value);
 assert.match(result.explanation,/Não determina elegibilidade/);assert.equal(result.items[0].eligible,undefined);
});

test('matching keeps legacy common-model summary keywords without detail reads or full-model payloads',async()=>{
 const {createOrganizationMatching}=require('../src/organizationDirectory/matching');
 const {areas}=require('../src/organizationDirectory/thematicAreas');
 const {createOpportunityReadModel}=require('../src/opportunities/v2/readModel');
 const education=areas.find(area=>area.name==='Educação e Formação Profissional');
 const {NORMALIZATION_VERSION,QUALITY_VERSION}=require('../src/opportunities/constants');
 const source={schemaVersion:1,provenanceId:randomUUID(),normalizationVersion:NORMALIZATION_VERSION,qualityRuleVersion:QUALITY_VERSION,title:'Neutral opportunity',summary:'Education training internships',lifecycleState:'ACTIVE',validationState:'VALIDATED_MANUAL',programmeName:'Neutral programme',funderName:'Commission',closingDate:'2027-12-31'};
 const record={opportunityId:randomUUID(),title:source.title,lifecycleState:'ACTIVE',readModel:createOpportunityReadModel(source,{asOf})};
 let reads=0;
 const service=createOrganizationMatching({directory:{execute:async()=>({person:{active:true},profile:{areaIds:[education.id]}})},opportunities:{list:async()=>({items:[]})},
  central:{list:async()=>({items:[record]}),get:async()=>{reads++;throw Error('N+1 read');}},clock:()=>new Date(asOf)});
 const result=await service.execute({},{});
 assert.equal(result.items.length,1);assert.equal(reads,0);assert.equal(result.items[0].summary,source.summary);
 assert.equal(result.items[0].programmeName,source.programmeName);assert.equal(result.items[0].funderName,source.funderName);
 assert.equal(result.items[0].closingDate,source.closingDate);assert.equal(result.items[0].readModel,undefined);
 assert.equal(result.items[0].snapshot,undefined);
});

function application(source,{lifecycleState='ACTIVE',denied=false,wrongOpportunity=false,staleRevision=false}={}){
 const {createApplicationRepository}=require('../src/applications/repository');
 const org=randomUUID(),opportunityId=randomUUID(),centralRevisionId=randomUUID(),actor={id:randomUUID()},state={writes:[],row:null};
 const input={origin:'CENTRAL',opportunityId,centralRevisionId,evaluationId:null,title:'Application',responsibleMembershipId:randomUUID(),deadline:'2027-01-01',idempotencyKey:randomUUID()};
 const client={async query(sql,p=[]){
  if(sql.startsWith('SELECT * FROM opportunity_catalog.application_receipt'))return {rows:[]};
  if(sql.startsWith('SELECT EXISTS'))return {rows:[{extended:false,interest_units:false}]};
  if(sql.startsWith('INSERT INTO opportunity_catalog.application(')){
   state.row={organization_id:p[0],application_id:p[1],opportunity_id:null,evaluation_id:null,title:p[2],responsible_membership_id:p[3],deadline:p[4],central_opportunity_id:p[6],central_revision_id:p[7],central_snapshot:structuredClone(p[8]),status:'INTENTION',revision:1,created_at:new Date(asOf),updated_at:new Date(asOf)};
   state.writes.push(sql);return {rows:[state.row]};
  }
  if(sql.startsWith('INSERT INTO')){state.writes.push(sql);return {rows:[]};}
  if(sql.startsWith('SELECT a.*'))return {rows:[state.row]};
  throw Error('Unexpected query '+sql);
 }};
 const repository=createApplicationRepository({organizationId:org,actor,protect:async()=>{if(denied)throw Object.assign(Error(),{code:'NOT_AUTHORIZED'});},authorize:async()=>true,verifyResponsible:async()=>true,
  cursor:{},audit:async()=>{},centralOrigin:async()=>source,centralCurrent:async()=>({opportunityId:wrongOpportunity?randomUUID():opportunityId,revisionId:staleRevision?randomUUID():centralRevisionId,lifecycleState})});
 return {state,input,client,repository};
}

test('application creation freezes the exact v2 revision and reads a common summary without rewriting history',async()=>{
 const source=eu(),f=application(source);
 const created=await f.repository.create(f.client,f.input);
 assert.deepEqual(f.state.row.central_snapshot,source);assert.equal(f.state.row.central_revision_id,f.input.centralRevisionId);
 const read=await f.repository.get(f.client,created.applicationId);
 assert.equal(read.opportunityTitle,source.description.title.value);assert.equal(read.opportunityClosingDate,'2028-09-02T04:59:00.000Z');
 assert.equal(read.opportunityReadModel.projection.financing.allocations.value[0].money.amount,'120000');
 assert.equal(f.state.row.central_snapshot.title,undefined);assert.deepEqual(f.state.row.central_snapshot,source);
});

test('v2 application creation rejects archived or denied context and an oversized valid source before writes',async()=>{
 const large=eu();for(let n=0;n<20;n++)large.provenance.evidence.push({...large.provenance.evidence[0],id:'large-'+n,excerpt:'x'.repeat(2000)});
 require('../src/opportunities/v2').validateSnapshotV2(large);
 for(const [source,options,code] of [[eu(),{lifecycleState:'ARCHIVED'},'RESOURCE_NOT_AVAILABLE'],[eu(),{denied:true},'NOT_AUTHORIZED'],[large,{},'SCHEMA_UPGRADE_REQUIRED']]){
  const f=application(source,options);await assert.rejects(f.repository.create(f.client,f.input),{code});assert.equal(f.state.writes.length,0);
 }
});

test('v2 application creation binds current metadata to the requested identity and revision before writes',async()=>{
 for(const [options,code] of [[{wrongOpportunity:true},'RESOURCE_NOT_AVAILABLE'],[{staleRevision:true},'STALE_OPPORTUNITY_REVISION']]){
  const f=application(eu(),options);await assert.rejects(f.repository.create(f.client,f.input),{code});assert.equal(f.state.writes.length,0);
 }
});
