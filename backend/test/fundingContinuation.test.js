'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSource}=require('../src/fundingTenders/source');
const record=i=>({content:`Call ${i}`,metadata:{identifier:[`ID-${i}`],frameworkProgramme:['43108390'],startDate:['2026-01-01'],deadlineDate:['2027-12-31']}});
test('1200 remote results continue in bounded batches without restarting page one',async()=>{
 const pages=[];const source=createSource({clock:()=>Date.parse('2026-10-28'),fetchImpl:async target=>{
  const page=Number(new URL(target).searchParams.get('pageNumber'));pages.push(page);
  return new Response(JSON.stringify({totalResults:1200,results:Array.from({length:25},(_,i)=>record((page-1)*25+i))}));
 }});
 let cursor=null;const ids=new Set();let batches=0;
 do{const batch=await source.collect({cursor});assert.ok(batch.received<=100);assert.equal(batch.remoteTotal,1200);batch.records.forEach(r=>ids.add(r.externalIdentifier));cursor=batch.nextCursor;assert.ok(++batches<=12);}while(cursor);
 assert.equal(batches,12);assert.equal(ids.size,1200);assert.deepEqual(pages,Array.from({length:48},(_,i)=>i+1));
});
test('a persisted page checkpoint resumes after the third page even if page four fails',async()=>{
 let saved=null;const pages=[];let fail=true;
 const source=createSource({clock:()=>Date.parse('2026-10-28'),fetchImpl:async target=>{
  const page=Number(new URL(target).searchParams.get('pageNumber'));pages.push(page);
  if(page===4&&fail)return new Response('',{status:403});
  return new Response(JSON.stringify({totalResults:100,results:Array.from({length:25},(_,i)=>record((page-1)*25+i))}));
 }});
 await assert.rejects(source.collect({onPage:async page=>{saved=page.nextCursor;}}),{code:'SOURCE_REJECTED'});
 assert.equal(saved.nextPage,4);fail=false;const batch=await source.collect({cursor:saved});assert.equal(batch.received,25);assert.equal(batch.nextCursor,null);assert.deepEqual(pages,[1,2,3,4,4]);
});
test('cursor is bound to source, adapter contract and fixed page size',async()=>{
 const source=createSource({fetchImpl:async()=>new Response(JSON.stringify({totalResults:200,results:Array.from({length:25},(_,i)=>record(i))}))});
 const batch=await source.collect();assert.ok(batch.nextCursor);
 for(const cursor of [{...batch.nextCursor,nextPage:0},{...batch.nextCursor,version:99},{...batch.nextCursor,pageSize:5}])await assert.rejects(source.collect({cursor}),{code:'SOURCE_CURSOR_INVALID'});
 await assert.rejects(source.collect({source:'CORDIS',cursor:batch.nextCursor}),{code:'SOURCE_CURSOR_INVALID'});
});
test('short pages cannot silently claim completion when the reported total promises more',async()=>{
 const source=createSource({fetchImpl:async()=>new Response(JSON.stringify({totalResults:1200,results:[record(1)]}))});
 await assert.rejects(source.collect(),{code:'SOURCE_RESPONSE_INVALID'});
});
test('batch accounting separates duplicates, expired records and invalid records',async()=>{
 const old=record('old');old.metadata.deadlineDate=['2020-01-01'];
 const batch=await createSource({clock:()=>Date.parse('2026-10-28'),fetchImpl:async()=>new Response(JSON.stringify({totalResults:5,results:[record(1),record(1),record(2),old,{}]}))}).collect();
 assert.equal(batch.received,5);assert.equal(batch.records.length,2);assert.equal(batch.duplicates,1);assert.equal(batch.failed,1);assert.equal(batch.excluded,1);assert.equal(batch.nextCursor,null);
 assert.equal(batch.records.length+batch.duplicates+batch.failed+batch.excluded,batch.received);
});

test('retry preserves page number and obeys Retry-After before accepting a response',async()=>{
 const pages=[],waits=[];let attempts=0;
 const source=createSource({clock:()=>Date.parse('2026-10-28'),sleep:async ms=>waits.push(ms),fetchImpl:async target=>{
  pages.push(Number(new URL(target).searchParams.get('pageNumber')));
  if(++attempts===1)return new Response('',{status:429,headers:{'retry-after':'2'}});
  return new Response(JSON.stringify({totalResults:1,results:[record(1)]}));
 }});
 const batch=await source.collect();
 assert.deepEqual(pages,[1,1]);assert.deepEqual(waits,[2000]);assert.equal(batch.records.length,1);assert.equal(batch.nextCursor,null);
});
