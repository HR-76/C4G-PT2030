'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {temporalSql}=require('../src/opportunities/temporalSql');
const {catalogQuery}=require('../src/fundingTenders/catalogQuery');
const {opportunitySummary}=require('../src/applications/opportunitySummary');

test('catalog admits a separate PLANNED filter without treating it as OPEN',()=>{
 assert.equal(catalogQuery({temporalState:'PLANNED'}).temporalState,'PLANNED');
 assert.throws(()=>catalogQuery({temporalState:'PUBLISHED'}),{code:'INVALID_INPUT'});
});

test('SQL temporal projection selects v2 facts and retains separate legacy correction rules',()=>{
 const sql=temporalSql({snapshot:'accepted.snapshot',corrections:'identity.corrections',sourceReview:'identity.review',now:'$9::timestamptz',today:'$10::date'});
 assert.match(sql,/accepted\.snapshot->>'schemaVersion'/);
 assert.match(sql,/\{schedule,deadlines,value\}/);
 assert.match(sql,/\{schedule,plannedClosing,value\}/);
 assert.match(sql,/\{publication,value\}/);
 assert.match(sql,/identity\.corrections \? 'closingDate'/);
 assert.match(sql,/identity\.review IS NOT NULL/);
 assert.match(sql,/v2_calendar\.is_v2 THEN v2_schedule\.next_deadline ELSE legacy_schedule\.next_deadline/);
 assert.match(sql,/v2_calendar\.is_v2 THEN v2_state\.temporal_state ELSE legacy_temporal\.temporal_state/);
 assert.doesNotMatch(sql,/funding_candidate|pt2030_plan_revision|manual_v2_candidate/);
});

test('SQL preserves ambiguous extrema and civil precision instead of selecting an arbitrary first deadline',()=>{
 const sql=temporalSql();
 assert.match(sql,/next_candidates AS/);
 assert.match(sql,/final_candidates AS/);
 assert.match(sql,/other\.end_at < candidate\.start_at/);
 assert.match(sql,/other\.start_at > candidate\.end_at/);
 assert.match(sql,/count\(\*\) FROM next_candidates\)=1/);
 assert.match(sql,/count\(\*\) FROM final_candidates\)=1/);
 assert.match(sql,/interval '24 hours' - interval '1 millisecond'/);
 assert.match(sql,/AT TIME ZONE 'UTC'/);
 assert.match(sql,/date_trunc\('milliseconds',CURRENT_TIMESTAMP\)/);
 assert.match(sql,/WHEN v2_calendar\.publication='PLANNED' THEN 'PLANNED'/);
 assert.match(sql,/WHEN v2_schedule\.uncertain_count>0 THEN 'UNKNOWN'/);
 assert.match(sql,/WHEN v2_calendar\.has_conflict THEN 'UNKNOWN'/);
 assert.match(sql,/v2_calendar\.deadline_model IS DISTINCT FROM 'CONTINUOUS'/);
});

test('dashboard SQL derives accepted v2 source/title, counts planned separately and does not sum allocations',async()=>{
 let query,params;
 const row={total:2,open:0,closing_soon:0,planned:2,upcoming:0,closed:0,cancelled:0,unknown:0,sources:[],recent:[]};
 const client={query:async(sql,p)=>{query=sql;params=p;return {rows:[row]};}};
 const result=await opportunitySummary(client,{central:true,today:'2026-10-30'});
 assert.deepEqual(result,{...row,recent:[]});
 assert.deepEqual(params,['2026-10-30']);
 assert.match(query,/\{description,title,value\}/);
 assert.match(query,/sourceRecords/);
 assert.match(query,/temporal_state='PLANNED'\) AS planned/);
 assert.match(query,/temporal_state='OPEN'/);
 assert.match(query,/schemaVersion.*THEN make_date\(CASE WHEN substring\(\(left\(schedule\.next_deadline,10\)/s);
 assert.doesNotMatch(query,/SUM\([^)]*(?:amount|allocation)|funding_candidate|pt2030_plan_revision|manual_v2_candidate/i);
});

test('dashboard summaries can share one canonical instant across central and private queries',async()=>{
 for(const central of [true,false]){
  let query,params;
  const row={total:0,open:0,closing_soon:0,planned:0,sources:[],recent:[]};
  const client={query:async(sql,p)=>{query=sql;params=p;return {rows:[row]};}};
  const today='2026-10-30',asOf='2026-10-30T12:34:56.789Z',organizationId='01900000-0000-7000-8000-000000000001';
  await opportunitySummary(client,{central,today,asOf,organizationId});
  assert.deepEqual(params,central?[today,asOf]:[today,organizationId,asOf]);
  assert.ok(query.includes(`date_trunc('milliseconds',$${central?2:3}::timestamptz)`));
  assert.doesNotMatch(query,/CURRENT_TIMESTAMP/);
  for(const invalid of ['2026-10-30T12:34:56','2026-10-31T12:34:56.789Z'])await assert.rejects(opportunitySummary({query:()=>assert.fail('Invalid clock must not reach SQL')},{central,today,asOf:invalid}));
 }
});

test('valid ISO year zero remains supported by SQL comparison helpers without changing the factual contract',()=>{
 const {validateSnapshotV2}=require('../src/opportunities/v2');
 const {civilDateSql,instantSql}=require('../src/opportunities/v2/temporalSql');
 const snapshot=structuredClone(require('../../context/references/opportunity-v2/examples/eu-11145.json'));
 snapshot.schedule.opening.value={precision:'DATE',value:'0000-01-01'};
 assert.equal(validateSnapshotV2(snapshot).schedule.opening.value.value,'0000-01-01');
 const civil=civilDateSql('source.date_value'),exact=instantSql('source.instant_value');
 assert.match(civil,/make_date\(CASE WHEN .*from 1 for 4\)::int=0 THEN -1 ELSE/s);
 assert.match(civil,/from 6 for 2/);assert.match(civil,/from 9 for 2/);
 assert.match(exact,/from 12 for 12\)::time/);assert.match(exact,/AT TIME ZONE 'UTC'/);
 const sql=temporalSql();
 assert.match(sql,/make_date\(/);
 assert.doesNotMatch(sql,/\(deadline->'at'->>'value'\)::timestamptz/);
});

test('civil UTC comparison bounds use 24 elapsed hours across session DST changes',()=>{
 const {temporalCases}=require('../../test/integration/opportunity-v2/temporal-proof.cjs');
 const {createOpportunityReadModel}=require('../src/opportunities/v2/readModel');
 for(const name of ['DATE spring DST last hour','DATE autumn DST following midnight']){
  const entry=temporalCases().find(item=>item.name===name);
  assert.equal(createOpportunityReadModel(entry.snapshot,{asOf:entry.asOf}).temporal.effectiveState,entry.expectedState);
 }
 // S6 PostgreSQL reproduced CLOSED vs UNKNOWN with TimeZone Europe/Lisbon:
 // timestamptz + '1 day' follows civil DST, but S0 bounds are exactly 24h UTC.
 const sql=temporalSql();
 assert.match(sql,/interval '24 hours' - interval '1 millisecond'/);
 assert.doesNotMatch(sql,/interval '1 day'/);
});
