'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSource,normalizeRecord,formData,LIMITS}=require('../src/fundingTenders/source');
const asOf='2026-10-17',clock=()=>Date.parse(asOf+'T12:00:00Z');
const item=(id,dates,status='31094502')=>({content:'Public call',metadata:{identifier:[id],deadlineDate:dates,status:[status]}});
test('selects next civil deadline across unordered past and future rounds, including today',()=>{
 assert.equal(normalizeRecord(item('x',['2028-01-01','2021-01-01','2026-10-17','2027-01-01']),{asOf}).fields.closingDate,asOf);
 assert.equal(normalizeRecord(item('x',['2021-01-01','2027-01-01']),{asOf}).fields.closingDate,'2027-01-01');
 for(const record of [item('old',['2020-01-01']),item('unknown',[]),item('closed',['2028-01-01'],'31094503')])assert.throws(()=>normalizeRecord(record,{asOf}),{code:'SOURCE_NOT_CURRENT'});
 assert.throws(()=>normalizeRecord(item('invalid',['not-a-date','2028-01-01']),{asOf}),{code:'SOURCE_RECORD_INVALID'});
});
test('recent source order and local verification preserve caps without backfilling expired results',async()=>{
 assert.deepEqual(JSON.parse(await formData().get('sort').text()),[{field:'deadlineDate',order:'DESC'},{field:'identifier',order:'ASC'},{field:'callccm2Id',order:'ASC'}]);
 let calls=0;
 const source=createSource({clock,limits:{...LIMITS,results:5,pageSize:5,pages:1},fetchImpl:async(target)=>{
   calls++;assert.equal(new URL(target).searchParams.get('language'),'en');
   return new Response(JSON.stringify({totalResults:500,results:[item('old',['2020-01-01']),item('multi',['2020-01-01','2027-05-01']),item('multi',['2020-01-01','2027-04-01']),item('unknown',[]),item('closed',['2028-01-01'],'31094503')]}));
 }});
 const result=await source.collect();assert.equal(calls,1);assert.equal(result.received,5);assert.equal(result.excluded,3);assert.equal(result.failed,0);assert.equal(result.records.length,1);assert.equal(result.records[0].fields.closingDate,'2027-04-01');assert.equal(result.limited,true);
});
