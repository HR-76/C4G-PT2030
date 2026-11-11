'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createReadRepository}=require('../src/opportunities/catalogRead/readRepository');
const {buildProjection,emptyExtension,stableId}=require('../src/opportunities/catalogRead/model');
const source=require('../../test/integration/catalog-read/snapshot-v2.json');
function setup(bytes=35000){
 const asOf='2027-01-20T00:00:00.000Z',id=stableId('bounded'),generationId=stableId('generation');
 const e=emptyExtension(source,{opportunityId:id,revisionId:stableId('revision'),extensionId:stableId('extension'),acceptanceDigest:'a'.repeat(64),recordedAt:asOf});
 const payload=buildProjection(source,e,{asOf});let admissions=0;const queries=[];
 const client={release(){},async query(sql,params){queries.push(sql);
 if(sql.includes('AS reset'))return {rows:[{reset:true,limited:true}]};
 if(sql.includes('SELECT g.*'))return {rows:[{generation_id:generationId,as_of:asOf,expected_count:10000}]};
 if(sql.includes('AS signature'))return {rows:[{n:10000,signature:'immutable-generation'}]};
 if(sql.startsWith('SELECT opportunity_id,payload_digest')){assert.deepEqual(params,[generationId,[id]]);return {rows:[{opportunity_id:id,payload_digest:'b'.repeat(64),bytes}]};}
 if(sql.startsWith('SELECT payload,payload_digest')){assert.deepEqual(params,[generationId,[id]]);return {rows:[{payload,payload_digest:'b'.repeat(64)}]};}
 if(/^(BEGIN|SET|SELECT pg_advisory|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};throw Error('Unexpected unbounded read');
 }};
 return {id,queries,admissions:()=>admissions,repository:createReadRepository({pool:{connect:async()=>client},admit:async()=>{admissions++}})};
}
test('detail of a 10000-row generation fetches one bounded payload; every cache hit re-admits',async()=>{
 const f=setup();for(let i=0;i<2;i++){const result=await f.repository.load(null,{opportunityId:f.id});assert.equal(result.rows.length,1);assert(result.verified);assert(Object.isFrozen(result.rows[0]));}
 assert.equal(f.admissions(),2);assert.equal(f.queries.filter(q=>q.startsWith('SELECT payload,payload_digest')).length,1);
 assert(!f.queries.some(q=>q.includes('sum(octet_length(payload::text))')));
});
test('oversized selected payload is refused before transfer, without increasing the 64MiB budget',async()=>{
 const f=setup(67108865);await assert.rejects(f.repository.load(null,{opportunityId:f.id}),{code:'PROJECTION_ITEM_TOO_LARGE'});
 assert(!f.queries.some(q=>q.startsWith('SELECT payload,payload_digest')));
});

test('concurrent cold index readers share one build without holding metadata connections',async()=>{
 const asOf='2027-01-20T00:00:00.000Z',e=emptyExtension(source,{opportunityId:stableId('cold'),revisionId:stableId('cold-r'),extensionId:stableId('cold-e'),acceptanceDigest:'a'.repeat(64),recordedAt:asOf}),p=buildProjection(source,e,{asOf});
 const item={payloadDigest:'c'.repeat(64),version:p.version,summary:p.detail.summary,calendar:{publication:source.publication,status:source.status,schedule:source.schedule},extension:{windows:e.windows,conflicts:e.conflicts},relationships:[]};
 let active=0,builds=0,admissions=0,releaseBuild,started;const building=new Promise(r=>started=r),blocked=new Promise(r=>releaseBuild=r);
 const pool={async connect(){active++;return {release(){active--},async query(sql){
 if(sql.includes('AS reset'))return {rows:[{reset:true,limited:true}]};
 if(sql.includes('SELECT g.*'))return {rows:[{generation_id:stableId('cold-g'),as_of:asOf,published_at:asOf,expected_count:1}]};
 if(sql.includes(' AS bytes'))return {rows:[{bytes:'4096'}]};
 if(sql.includes(' AS item FROM')){builds++;started();await blocked;return {rows:[{item}]};}
 return {rows:[]};
 }}}};
 const repo=createReadRepository({pool,admit:async()=>{admissions++}}),requests=Array.from({length:10},()=>repo.load());
 await building;await new Promise(setImmediate);assert.equal(active,1);releaseBuild();const results=await Promise.all(requests);
 assert.equal(builds,1);assert.equal(admissions,11);assert.equal(active,0);await repo.load();assert.equal(admissions,12);assert.equal(builds,1);for(const result of results)assert.equal(result.index.summaries(asOf).length,1);
});

test('empty generations cannot grow the immutable cache without an entry bound',async()=>{
 const asOf='2027-01-20T00:00:00.000Z';let builds=0;
 const pool={async connect(){return {release(){},async query(sql,params){
 if(sql.includes('AS reset'))return {rows:[{reset:true,limited:true}]};
 if(sql.startsWith('SELECT * FROM catalog_read.published_generation'))return {rows:[{generation_id:params[0],as_of:asOf,published_at:asOf,expected_count:0}]};
 if(sql.includes(' AS bytes'))return {rows:[{bytes:'0'}]};
 if(sql.includes(' AS item FROM')){builds++;return {rows:[]};}return {rows:[]};
 }}}};
 const repo=createReadRepository({pool,admit:async()=>{}});for(let i=0;i<130;i++)await repo.load(stableId('empty',i));
 assert.equal(builds,130);await repo.load(stableId('empty',0));assert.equal(builds,131);
});
