'use strict';
// Imported by the explicit isolated S6 gate. This module creates no connection,
// server, role or schema and cannot choose a target database of its own.
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {createOpportunityReadModel}=require('../../../backend/src/opportunities/v2/readModel');
const {temporalSql}=require('../../../backend/src/opportunities/temporalSql');
const {programmeLabelsExpression,referenceValuesExpression}=require('../../../backend/src/opportunities/v2/catalogSql');
const {opportunitySummary}=require('../../../backend/src/applications/opportunitySummary');
const eu=require('../../../context/references/opportunity-v2/examples/eu-11145.json');
const normative=['eu-11145','pt2030-8485','pt2030-8514','pt2030-8583','pt2030-8614','pt2030-8664'];
const AS_OF='2026-10-30T12:00:00.000Z';
const absent=()=>({state:'NOT_COLLECTED',value:null,evidenceRefs:[],reason:'NOT_REQUESTED_IN_MAPPING'});
const date=value=>({precision:'DATE',value});
const instant=value=>({precision:'INSTANT',value,originalTimezone:'+00:00'});
const period=(start,end,label='Published period')=>({precision:'PERIOD',start,end,label,periodKind:'RANGE'});
const clone=value=>structuredClone(value);
function calendar(atValues){const snapshot=clone(eu);snapshot.schedule.deadlines.value=atValues.map(at=>({at,phase:null}));return snapshot;}
function v1(extra={}){return {schemaVersion:1,title:'Historical source',funderName:'Historical funder',
 provenanceId:'01900000-0000-7000-8000-000000000001',lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',
 normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1',...extra};}

function temporalCases(){
 const cases=[];
 const add=(name,snapshot,expectedState,asOf=AS_OF,corrections={},sourceReview=null)=>cases.push({name,snapshot,expectedState,asOf,corrections,sourceReview});
 for(const name of normative){const snapshot=require('../../../context/references/opportunity-v2/examples/'+name+'.json');add(name,clone(snapshot),name==='eu-11145'?'OPEN':'PLANNED');}
 for(const asOf of ['2026-10-29T23:59:59.999Z','2026-10-30T00:00:00.000Z','2026-10-30T12:00:00.000Z','2026-10-30T23:59:59.999Z','2026-10-31T00:00:00.000Z']){
  add('DATE boundary '+asOf,calendar([date('2026-10-30')]),asOf<'2026-10-30'?'OPEN':asOf<'2026-10-31'?'UNKNOWN':'CLOSED',asOf);
 }
 for(const asOf of ['2026-10-30T11:59:59.999Z','2026-10-30T12:00:00.000Z','2026-10-30T12:00:00.001Z'])add('INSTANT boundary '+asOf,calendar([instant(AS_OF)]),asOf<AS_OF?'OPEN':'CLOSED',asOf);
 add('DATE spring DST last hour',calendar([date('2026-03-29')]),'UNKNOWN','2026-03-29T23:30:00.000Z');
 add('DATE autumn DST following midnight',calendar([date('2026-10-25')]),'CLOSED','2026-10-26T00:30:00.000Z');
 add('PERIOD spring DST last hour',calendar([period('2026-03-01','2026-03-29')]),'UNKNOWN','2026-03-29T23:30:00.000Z');
 add('PERIOD autumn DST following midnight',calendar([period('2026-10-01','2026-10-25')]),'CLOSED','2026-10-26T00:30:00.000Z');
 for(const asOf of ['2026-09-30T23:59:59.999Z','2026-10-01T00:00:00.000Z','2026-10-30T12:00:00.000Z','2026-11-30T23:59:59.999Z','2026-12-01T00:00:00.000Z']){
  add('PERIOD boundary '+asOf,calendar([period('2026-10-01','2026-11-30')]),asOf<'2026-10-01'?'OPEN':asOf<'2026-12-01'?'UNKNOWN':'CLOSED',asOf);
 }
 for(const [name,values] of [
  ['mixed overlap',[date('2026-11-01'),instant('2026-11-01T14:00:00.000Z')]],
  ['mixed disjoint',[date('2026-11-01'),instant('2026-11-02T14:00:00.000Z')]],
  ['period overlap',[period('2026-11-01','2026-12-01'),period('2026-11-15','2026-12-15')]],
  ['period and instant overlap',[period('2026-11-01','2026-12-01'),instant('2026-11-15T12:00:00.000Z')]],
  ['period disjoint',[period('2026-11-01','2026-12-01'),period('2027-01-01','2027-02-01')]],
  ['date and exact today',[date('2026-10-30'),instant('2026-10-30T18:00:00.000Z')]],
  ['adjacent civil days',[date('2026-10-30'),date('2026-10-31')]]
 ])add(name,calendar(values),name.endsWith('today')||name==='adjacent civil days'?'UNKNOWN':'OPEN');
 const same=calendar([instant('2027-01-03T04:59:00.000Z')]);
 same.schedule.deadlines.value=[{...clone(same.schedule.deadlines.value[0]),phase:'A'},{...clone(same.schedule.deadlines.value[0]),phase:'B'}];add('same instant different phases',same,'OPEN');
 for(const [index,deadline] of eu.schedule.deadlines.value.entries()){
  for(const offset of [-1,0,1]){const asOf=new Date(Date.parse(deadline.at.value)+offset).toISOString();add(`EU cutoff ${index+1} ${offset}ms`,clone(eu),index===eu.schedule.deadlines.value.length-1&&offset>=0?'CLOSED':asOf<eu.schedule.opening.value.value?'UPCOMING':'OPEN',asOf);}
 }
 for(const state of ['CLOSED','CANCELLED']){const snapshot=calendar([date('2026-10-30')]);snapshot.status.published.value=state;snapshot.status.publishedCode=absent();add('published '+state,snapshot,state);}
 const conflict=clone(eu);conflict.schedule.deadlines={state:'CONFLICT',value:null,evidenceRefs:['deadlines','unused-closing'],reason:'CONTRADICTORY_CALENDARS'};add('calendar conflict',conflict,'UNKNOWN');
 const publicationConflict=clone(eu);publicationConflict.publication={state:'CONFLICT',value:null,evidenceRefs:['deadlines','unused-closing'],reason:'CONTRADICTORY_PUBLICATION'};add('publication conflict',publicationConflict,'UNKNOWN');
 const notPublished=clone(eu);notPublished.publication=absent();add('publication absent',notPublished,'UNKNOWN');
 const noStatus=clone(eu);noStatus.status.published=absent();noStatus.status.publishedCode=absent();add('open from confirmed calendar',noStatus,'OPEN');
 const noOpening=clone(noStatus);noOpening.schedule.opening=absent();add('no opening or source status',noOpening,'UNKNOWN');
 const openOnly=clone(eu);openOnly.schedule.opening=absent();openOnly.schedule.deadlines=absent();add('source OPEN without deadline',openOnly,'OPEN');
 const continuous=calendar([instant('2026-10-01T14:00:00.000Z')]);continuous.schedule.deadlineModel.value='CONTINUOUS';add('continuous with past cutoff',continuous,'OPEN');
 for(const opening of [date('2026-10-31'),instant('2026-10-31T00:00:00.000Z'),period('2026-11-01','2026-12-31')]){const snapshot=calendar([date('2027-01-01')]);snapshot.schedule.opening.value=opening;add('future opening '+opening.precision,snapshot,'UPCOMING');}
 const openingToday=calendar([date('2027-01-01')]);openingToday.status.published=absent();openingToday.status.publishedCode=absent();openingToday.schedule.opening.value=date('2026-10-30');add('civil opening today without status',openingToday,'UNKNOWN');
 const isoZero=calendar([date('0000-12-31')]);isoZero.schedule.opening.value=date('0000-01-01');add('year zero DATE facts',isoZero,'CLOSED');
 const isoZeroInstant=calendar([instant('0000-12-31T23:59:59.999Z')]);isoZeroInstant.schedule.opening.value=instant('0000-01-01T00:00:00.000Z');add('year zero INSTANT facts',isoZeroInstant,'CLOSED');
 const isoZeroPeriod=calendar([period('0000-01-01','0000-12-31')]);isoZeroPeriod.schedule.opening=absent();add('year zero PERIOD facts',isoZeroPeriod,'CLOSED');
 for(const snapshot of [clone(eu),clone(require('../../../context/references/opportunity-v2/examples/pt2030-8485.json'))])add('source review '+snapshot.publication.value,snapshot,'UNKNOWN',AS_OF,{},'ABSENT');
 for(const [name,snapshot,state,corrections,review] of [
  ['v1 ordinary',v1({openingDate:'2026-01-01',closingDate:'2027-01-01'}),'OPEN',{},null],
  ['v1 cutoff today',v1({closingDate:'2026-10-30'}),'OPEN',{},null],
  ['v1 past',v1({closingDate:'2026-10-29'}),'CLOSED',{},null],
  ['v1 correction closing',v1({closingDate:'2027-01-01',sourceTemporal:{status:'OPEN',openings:[],deadlines:['2025-01-01']}}),'OPEN',{closingDate:'2027-01-01'},null],
  ['v1 correction opening',v1({openingDate:'2026-01-01',closingDate:'2027-01-01',sourceTemporal:{status:'OPEN',openings:['2028-01-01'],deadlines:['2027-01-01']}}),'OPEN',{openingDate:'2026-01-01'},null],
  ['v1 source review',v1({closingDate:'2027-01-01'}),'UNKNOWN',{},'ABSENT'],
  ['v1 valid historical offset',v1({sourceTemporal:{status:'OPEN',openings:[],deadlines:['2027-01-01T00:00:00-0000']}}),'OPEN',{},null],
  ['v1 valid historical 24h',v1({sourceTemporal:{status:'OPEN',openings:[],deadlines:['2027-01-01T24:00:00Z']}}),'OPEN',{},null]
 ])add(name,snapshot,state,AS_OF,corrections,review);
 return cases;
}

function caseSql(){return `WITH r AS (SELECT $1::jsonb AS snapshot), o AS (SELECT
 CASE WHEN $1::jsonb->>'schemaVersion'='1' THEN ($1::jsonb->>'openingDate')::date ELSE '2020-01-01'::date END AS opening_date,
 CASE WHEN $1::jsonb->>'schemaVersion'='1' THEN ($1::jsonb->>'closingDate')::date ELSE '2020-01-02'::date END AS closing_date)
 SELECT temporal.temporal_state,schedule.next_deadline,schedule.next_deadline_at,schedule.final_deadline,schedule.final_deadline_at,
 schedule.planned_opening_at,schedule.planned_closing_at,v2_schedule.deadline_count
 FROM r CROSS JOIN o ${temporalSql({now:'$2::timestamptz',today:"($2::timestamptz AT TIME ZONE 'UTC')::date",corrections:'$3::jsonb',sourceReview:'$4::text'})}`;}
function comparable(row,model){
 if(model.sourceVersion===1)return {state:row.temporal_state,next:row.next_deadline===null?null:row.next_deadline.length===10?{precision:'DATE',value:row.next_deadline}:{precision:'INSTANT',value:new Date(row.next_deadline).toISOString()}};
 return {state:row.temporal_state,next:row.next_deadline_at,final:row.final_deadline_at,
  nextScalar:row.next_deadline,finalScalar:row.final_deadline,
  plannedOpening:row.planned_opening_at,plannedClosing:row.planned_closing_at};
}
function expectedProjection(model){
 const temporal=model.temporal;
 if(model.sourceVersion===1)return {state:temporal.effectiveState,next:temporal.nextDeadline?.at||null};
 return {state:temporal.effectiveState,next:temporal.nextDeadline?.at||null,final:temporal.finalDeadline?.at||null,
 nextScalar:temporal.nextDeadline?.at.value||null,finalScalar:temporal.finalDeadline?.at.value||null,
 plannedOpening:model.projection.schedule.plannedOpening.value,plannedClosing:model.projection.schedule.plannedClosing.value};
}
function publicCase(entry,model){return {name:entry.name,sourceVersion:model.sourceVersion,asOf:entry.asOf,state:model.temporal.effectiveState,next:model.temporal.nextDeadline?.at||null,final:model.temporal.finalDeadline?.at||null};}

async function temporalProof({pool,check,report}){
 const cases=temporalCases(),evidence={cases:[],performance:[],scope:'Isolated PostgreSQL queries; normative/synthetic public fixtures; no production data or authority claims'};
 report.temporalParity=evidence;
 await check('TEMPORAL_SQL_JS_PARITY',async()=>{
  for(const entry of cases){
   const model=createOpportunityReadModel(entry.snapshot,{asOf:entry.asOf,corrections:entry.corrections,sourceReview:entry.sourceReview});
   assert.equal(model.temporal.effectiveState,entry.expectedState,entry.name+' normative expectation');
   let row;
   try{row=(await pool.query(caseSql(),[entry.snapshot,entry.asOf,entry.corrections,entry.sourceReview])).rows[0];}
   catch(error){error.message='Temporal SQL case '+entry.name+': '+error.message;throw error;}
   assert.deepEqual(comparable(row,model),expectedProjection(model),entry.name);
   evidence.cases.push(publicCase(entry,model));
  }
  evidence.total=cases.length;
 });
 await check('TEMPORAL_SQL_TIMEZONE_INDEPENDENCE',async()=>{
  const client=await pool.connect();
  try{
   await client.query('BEGIN');await client.query("SET LOCAL TIME ZONE 'Europe/Lisbon'");
   for(const name of ['DATE boundary 2026-10-30T23:59:59.999Z','DATE spring DST last hour','DATE autumn DST following midnight','PERIOD spring DST last hour','PERIOD autumn DST following midnight','mixed overlap','year zero DATE facts']){
    const entry=cases.find(item=>item.name===name),model=createOpportunityReadModel(entry.snapshot,{asOf:entry.asOf});
    const row=(await client.query(caseSql(),[entry.snapshot,entry.asOf,{},null])).rows[0];
    assert.deepEqual(comparable(row,model),expectedProjection(model),name);
   }
   await client.query('ROLLBACK');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 });
 await check('CATALOGUE_FILTER_PROGRAMME_REFERENCE_AND_PLANNED_SQL',async()=>{
  const rows=normative.map(name=>({name,snapshot:require('../../../context/references/opportunity-v2/examples/'+name+'.json')}));
  const prefix=`WITH r AS (SELECT value->>'name' AS name,value->'snapshot' AS snapshot FROM jsonb_array_elements($1::jsonb)),o AS (SELECT NULL::text AS programme_name,NULL::text AS call_reference,NULL::date AS closing_date,NULL::date AS opening_date)
   SELECT r.name,${programmeLabelsExpression()} AS programmes,${referenceValuesExpression()} AS references,temporal.temporal_state,schedule.next_deadline
   FROM r CROSS JOIN o ${temporalSql({now:'$2::timestamptz',today:"($2::timestamptz AT TIME ZONE 'UTC')::date"})}`;
  const result=(await pool.query(prefix+' ORDER BY r.name',[JSON.stringify(rows),AS_OF])).rows;
  assert.equal(result.length,6);assert.equal(result.filter(r=>r.temporal_state==='PLANNED').length,5);
  assert.equal(result.find(r=>r.name==='pt2030-8614').programmes.length,3);
  assert.ok(result.find(r=>r.name==='eu-11145').references.includes('DIGITAL-2023-SKILLS-05-SPECIALEDU'));
  const filtered=(await pool.query(prefix+` WHERE temporal.temporal_state='PLANNED' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(${programmeLabelsExpression()}) AS programme(value) WHERE programme.value=$3) ORDER BY r.name LIMIT 1`,[JSON.stringify(rows),AS_OF,'ALGARVE2030'])).rows;
  assert.equal(filtered.length,1);assert.ok(filtered[0].programmes.includes('ALGARVE2030'));assert.equal(filtered[0].next_deadline,null);
  evidence.catalogue={rows:6,planned:5,multiProgramme8614:3,filterBeforeLimit:true};
 });
 await check('DASHBOARD_PRODUCTION_QUERY_WITH_ISOLATED_ROWS',async()=>{
  // Keep production SQL intact except for relation names supplied by CTE fixtures.
  // Runtime table permissions/auth are exercised separately by the root gate.
  const snapshots=[...normative.map(name=>require('../../../context/references/opportunity-v2/examples/'+name+'.json')),cases.find(c=>c.name==='source OPEN without deadline').snapshot];
  const records=snapshots.map((snapshot,index)=>({opportunity_id:`01900000-0000-7000-8000-${String(index+1).padStart(12,'0')}`,revision_id:`01900000-0000-7000-8001-${String(index+1).padStart(12,'0')}`,snapshot}));
  const adapter={query:async(sql,params)=>{
   const fixture=`fixture AS (SELECT * FROM jsonb_to_recordset($${params.length+1}::jsonb) AS x(opportunity_id uuid,revision_id uuid,snapshot jsonb)),
    opportunity_fixture AS (SELECT opportunity_id,revision_id AS current_revision_id,'stale alias'::text AS title,NULL::date AS closing_date,NULL::date AS opening_date,'ACTIVE'::text AS lifecycle_state FROM fixture),
    revision_fixture AS (SELECT revision_id,snapshot FROM fixture),identity_fixture AS (SELECT opportunity_id,NULL::text AS external_identifier,'{}'::jsonb AS corrections,NULL::text AS source_review FROM fixture),`;
   return pool.query(sql.replace('WITH catalog AS (','WITH '+fixture+' catalog AS (').replaceAll('opportunity_catalog.opportunity o','opportunity_fixture o').replaceAll('opportunity_catalog.revision r','revision_fixture r').replaceAll('opportunity_catalog.funding_identity f','identity_fixture f'),[...params,JSON.stringify(records)]);
  }};
  const result=await opportunitySummary(adapter,{central:true,today:AS_OF.slice(0,10),asOf:AS_OF});
  assert.equal(result.total,7);assert.equal(result.open,2);assert.equal(result.planned,5);assert.equal(result.recent.length,2);
  assert.equal(result.recent.filter(row=>row.closing_date===null).length,1);assert.ok(result.recent.every(row=>row.title===eu.description.title.value));
  evidence.dashboard={total:result.total,open:result.open,planned:result.planned,unknownDeadline:1};
 });
 await check('TEMPORAL_SQL_EXPLAIN_SYNTHETIC_COST',async()=>{
  const values=Array.from({length:240},(_,index)=>({snapshot:cases[index%cases.length].snapshot,asOf:cases[index%cases.length].asOf,corrections:cases[index%cases.length].corrections,review:cases[index%cases.length].sourceReview}));
  const sql=`WITH input AS MATERIALIZED(SELECT * FROM jsonb_to_recordset($1::jsonb) AS entry(snapshot jsonb,"asOf" text,corrections jsonb,review text))
   SELECT count(*) FILTER(WHERE temporal.temporal_state='OPEN') FROM input r
   CROSS JOIN LATERAL (SELECT CASE WHEN r.snapshot->>'schemaVersion'='1' THEN (r.snapshot->>'openingDate')::date ELSE NULL::date END AS opening_date,
    CASE WHEN r.snapshot->>'schemaVersion'='1' THEN (r.snapshot->>'closingDate')::date ELSE NULL::date END AS closing_date) o
   ${temporalSql({now:'r."asOf"::timestamptz',today:'(r."asOf"::timestamptz AT TIME ZONE \'UTC\')::date',corrections:'r.corrections',sourceReview:'r.review'})}`;
  const start=performance.now(),result=await pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql,[JSON.stringify(values)]);
  const explain=result.rows[0]['QUERY PLAN'][0];
  evidence.performance.push({rows:values.length,wallMilliseconds:Math.round((performance.now()-start)*1000)/1000,planningMilliseconds:explain['Planning Time'],executionMilliseconds:explain['Execution Time'],plan:explain.Plan});
 });
 return evidence;
}
module.exports={temporalProof,temporalCases,caseSql,comparable,expectedProjection};
