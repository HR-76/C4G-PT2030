'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSource}=require('../src/fundingTenders/source');
const item=(status,deadline)=>({content:'Known call',metadata:{type:['1'],identifier:['KNOWN'],status:[status],deadlineDate:[deadline],startDate:['2020-01-01']}});
const source=results=>createSource({clock:()=>Date.parse('2026-10-28T12:00:00Z'),fetchImpl:async()=>new Response(JSON.stringify({totalResults:results.length,results}))});
test('known lookup includes closed records and preserves all published temporal evidence',async()=>{
 const result=await source([item('31094503','2024-01-01T17:00:00+00:00')]).lookup({externalIdentifier:'KNOWN'});
 assert.equal(result.outcome,'FOUND');assert.equal(result.record.fields.sourceTemporal.status,'CLOSED');
 assert.equal(Object.hasOwn(result.record.fields,'funderName'),false);
 assert.equal(result.record.fields.closingDate,'2024-01-01');
 assert.deepEqual(result.record.fields.sourceTemporal.deadlines,['2024-01-01T17:00:00+00:00']);
});
test('known lookup never chooses between contradictory source versions',async()=>{
 const result=await source([item('31094503','2024-01-01'),item('31094502','2027-01-01')]).lookup({externalIdentifier:'KNOWN'});
 assert.equal(result.outcome,'CONFLICT');assert.equal(result.record,undefined);
 assert.deepEqual(result.conflictReasons,['SOURCE_VARIANTS_DIVERGE']);
 const absent=await source([]).lookup({externalIdentifier:'KNOWN'});assert.equal(absent.outcome,'ABSENT');
});
test('identical source duplicates are safe but truncated lookups cannot change a record',async()=>{
 assert.equal((await source([item('31094503','2024-01-01'),item('31094503','2024-01-01')]).lookup({externalIdentifier:'KNOWN'})).outcome,'FOUND');
 const port=createSource({fetchImpl:async()=>new Response(JSON.stringify({totalResults:26,results:Array.from({length:25},()=>item('31094503','2024-01-01'))}))});
 const truncated=await port.lookup({externalIdentifier:'KNOWN'});
 assert.equal(truncated.outcome,'CONFLICT');assert.deepEqual(truncated.conflictReasons,['LOOKUP_TRUNCATED']);
});
test('explicit cancellation is retained and unknown provider codes require review',async()=>{
 const cancelled=await source([item('CANCELLED','2027-01-01')]).lookup({externalIdentifier:'KNOWN'});
 assert.equal(cancelled.record.fields.sourceTemporal.status,'CANCELLED');
 const unknown=await source([item('NEW_PROVIDER_CODE','2027-01-01')]).lookup({externalIdentifier:'KNOWN'});
 assert.equal(unknown.outcome,'CONFLICT');assert.deepEqual(unknown.conflictReasons,['STATUS_UNRECOGNIZED']);
});
test('multiple independent lookup conflicts retain both bounded reasons',async()=>{
 const first=item('31094503','2024-01-01'),second=item('31094502','2027-01-01');
 const results=[first,second,...Array.from({length:23},()=>first)];
 const port=createSource({clock:()=>Date.parse('2026-10-28T12:00:00Z'),fetchImpl:async()=>new Response(JSON.stringify({totalResults:26,results}))});
 const result=await port.lookup({externalIdentifier:'KNOWN'});
 assert.equal(result.outcome,'CONFLICT');
 assert.deepEqual(result.conflictReasons,['LOOKUP_TRUNCATED','SOURCE_VARIANTS_DIVERGE']);
});
test('refresh targets are selected on a catalogue without the v2 package: the schema-version column is read tolerantly',async()=>{
 const statements=[];const client={async query(sql,values){statements.push([sql,values]);return {rows:[],rowCount:0};}};
 await require('../src/fundingTenders/refresh').start(client,'00000000-0000-4000-8000-000000000001','EU_FUNDING_TENDERS');
 const select=statements.map(([sql])=>sql).find(sql=>sql.includes('funding_refresh_target')&&sql.includes('funding_identity'));
 assert.ok(select.includes("to_jsonb(o)->>'current_schema_version'='2'"));
 assert.equal(/\bo\.current_schema_version\b/.test(select),false);
 assert.equal(statements.find(([sql])=>sql===select)[1][2],false);
});
