'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {stage}=require('../src/fundingTenders/refresh');
const observedAt='2026-10-31T16:34:00.000Z';
function fixture(){
 const checkpoint={cycle_id:randomUUID(),input_cursor:{phase:'KNOWN',externalIdentifier:'CASCADE:17045'}};
 const run={run_id:randomUUID(),checkpoint},calls=[];
 const client={async query(sql,params){calls.push({sql,params});return {rowCount:1,rows:[{external_identifier:checkpoint.input_cursor.externalIdentifier,run_id:run.run_id}]};}};
 return {run,client,calls};
}
test('known conflict stores its specific cause in the same staged transaction',async()=>{
 const f=fixture();
 assert.deepEqual(await stage(f.client,f.run,{outcome:'CONFLICT',conflictReasons:['SOURCE_VARIANTS_DIVERGE'],received:2,observedAt},{canonicalV2:true}),[]);
 const target=f.calls.find(c=>c.sql.includes('UPDATE opportunity_catalog.funding_refresh_target'));
 const diagnostic=f.calls.find(c=>c.sql.includes('UPDATE opportunity_catalog.funding_batch'));
 assert(target);assert(diagnostic);
 assert.match(diagnostic.sql,/input_cursor->>'phase'/);
 assert.match(diagnostic.sql,/input_cursor->>'externalIdentifier'/);
 assert.deepEqual(diagnostic.params.at(-1),['SOURCE_VARIANTS_DIVERGE']);
 assert.equal(f.calls.some(c=>c.sql.includes('funding_run_item')),false);
});
test('old conflict without a cause is explicitly unclassified; malformed input writes nothing',async()=>{
 const old=fixture();await stage(old.client,old.run,{outcome:'CONFLICT',received:1,observedAt},{canonicalV2:true});
 assert.deepEqual(old.calls.find(c=>c.sql.includes('UPDATE opportunity_catalog.funding_batch')).params.at(-1),['UNCLASSIFIED_SOURCE_CONFLICT']);
 for(const reasons of [[],['UNKNOWN'],['LOOKUP_TRUNCATED','LOOKUP_TRUNCATED'],['x'.repeat(3000)]]){
  const f=fixture();await assert.rejects(stage(f.client,f.run,{outcome:'CONFLICT',conflictReasons:reasons,received:1,observedAt},{canonicalV2:true}),{code:'FUNDING_CHECKPOINT_INVALID'});assert.equal(f.calls.length,0);
 }
});
test('a found lookup with a conflict code is refused before staging',async()=>{
 const f=fixture();await assert.rejects(stage(f.client,f.run,{outcome:'FOUND',conflictReasons:['LOOKUP_TRUNCATED'],record:{externalIdentifier:'CASCADE:17045',fields:{}},received:1,observedAt},{canonicalV2:true}),{code:'FUNDING_CHECKPOINT_INVALID'});assert.equal(f.calls.length,0);
});
