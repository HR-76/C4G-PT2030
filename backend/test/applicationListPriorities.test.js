const test=require('node:test'),assert=require('node:assert/strict');
const {hydratePriorities}=require('../src/applications/listPriorities');
test('denied work and documents do not query or imply zero',async()=>{
 const items=await hydratePriorities({query:()=>{throw Error('unexpected')}},{org:'org',items:[{applicationId:'app'}],authorize:async()=>false});
 assert.deepEqual(items[0].priorities,{tasks:null,documents:null});
});
test('summaries scope queries and exclude restricted document decisions',async()=>{
 const client={async query(sql,params){assert.deepEqual(params,['org',['app']]);return {rows:sql.includes('application_task')?[{application_id:'app',open:3,deadline:'2026-11-10'}]:[{application_id:'app',document_id:'visible',request_id:'r',decision:null},{application_id:'app',document_id:'hidden',request_id:'r2',decision:'CHANGES_REQUESTED'}]}}};
 const items=await hydratePriorities(client,{org:'org',items:[{applicationId:'app'}],authorize:async(op,target)=>target.id!=='hidden'});
 assert.deepEqual(items[0].priorities,{tasks:{open:3,next:'2026-11-10'},documents:{pending:1,changes:0,restricted:true}});
});
test('authority errors fail closed instead of becoming empty counts',async()=>{
 await assert.rejects(hydratePriorities({}, {org:'org',items:[{applicationId:'app'}],authorize:async()=>{throw Error('STALE')}}),/STALE/);
});
