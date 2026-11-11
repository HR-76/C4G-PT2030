'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {OutboxRelay}=require('../src/async/outboxRelay');
const {createExecutionLineageProjection}=require('../src/async/executionLineageProjection');
const {validateEnvelope,createTrustedObservability}=require('../src/async/envelope');
const {normalizeClaimedJob}=require('../src/async/adapters/pgBossQueueAdapter');
const ID='11111111-1111-4111-8111-111111111111';
const ROOT='22222222-2222-4222-8222-222222222222',PREVIOUS='33333333-3333-4333-8333-333333333333',REPLAY='44444444-4444-4444-8444-444444444444';
function fixture({rollback=false,kind='INITIAL'}={}){
 const envelope={envelopeVersion:3,authority:'CENTRAL',jobType:'funding_tenders.refresh',jobVersion:1,payloadVersion:1,organizationId:null,actor:{kind:'SERVICE',serviceActorCode:'FUNDING_TENDERS_CENTRAL'},operation:'opportunity.central.manage',correlationId:ID,causationId:ID,idempotencyKey:ID,executionId:ID,createdAt:'2030-01-01T00:00:00.000Z',deadlineAt:'2030-01-01T00:05:00.000Z',payload:{runId:ID},observability:createTrustedObservability({traceparent:null,tracestate:null})};
 const valid=validateEnvelope(envelope,{supports:()=>true});
 const lineage={lineage_version:1,delivery_kind:kind,attempt:kind==='RETRY'?3:1,root_execution_id:kind==='INITIAL'?ID:ROOT,previous_execution_id:kind==='INITIAL'?null:PREVIOUS,content_digest:valid.contentDigest,envelope_digest:valid.envelopeDigest,replay_request_id:kind==='REPLAY'?REPLAY:null};
 const row={outbox_id:ID,fence:1,envelope,organization_id:null,digest_sha256:valid.contentDigest,...lineage};
 const current={execution_id:ID,organization_id:null,job_type:envelope.jobType,...lineage};
 const outboxRows=[row];
 const committed=new Map(),calls=[];let checkouts=0,published=0;
 async function transaction(work){
  const checkout=++checkouts,writes=new Map();calls.push(['BEGIN',checkout]);
  const client={query:async sql=>{calls.push([sql,checkout]);if(sql.startsWith('INSERT INTO async_exec.execution')){writes.set(ID,current);return {rows:[]};}if(sql.includes('FROM async_exec.outbox'))return {rows:outboxRows};if(sql.startsWith('SELECT execution_id::text'))return {rows:[writes.get(ID)||committed.get(ID)].filter(Boolean)};throw Error('Unexpected SQL');}};
  try{const result=await work(client);for(const [key,value]of writes)committed.set(key,value);calls.push(['COMMIT',checkout]);return result;}
  catch(error){calls.push(['ROLLBACK',checkout]);throw error;}
 }
 const projection=createExecutionLineageProjection({transaction});
 const failure=Object.assign(Error('SQL transaction aborted'),{code:'25P02'});
 const repository={claim:async()=>[row],markPublished:async()=>{if(rollback)throw failure;return true;},markUncertain:async()=>{if(rollback)throw failure;return true;}};
 const relay=new OutboxRelay({repository,queue:{publish:async()=>{published++;return 'delivery-id';}},transaction,workerId:'relay-test',projectionPort:projection});
 return {relay,projection,row,envelope,committed,calls,outboxRows,get checkouts(){return checkouts;},get published(){return published;}};
}
test('relay projects lineage on its existing transaction without a nested pool checkout',async()=>{
 const f=fixture();assert.deepEqual(await f.relay.poll(),['PUBLISHED']);
 assert.equal(f.checkouts,1);assert.equal(f.published,1);assert.equal(f.committed.size,1);
 assert.deepEqual(new Set(f.calls.filter(([sql])=>sql.startsWith('INSERT')||sql.startsWith('SELECT')).map(([,checkout])=>checkout)),new Set([1]));
});
test('relay transaction rollback also rolls back lineage projection after transport publication',async()=>{
 const f=fixture({rollback:true});await assert.rejects(f.relay.poll(),{code:'25P02'});
 assert.equal(f.checkouts,1);assert.equal(f.published,1);assert.equal(f.committed.size,0);
 assert.deepEqual(f.calls.filter(([sql])=>sql==='ROLLBACK'),[['ROLLBACK',1]]);
});
test('standalone lineage projection retains its transaction and refuses an invalid supplied client',async()=>{
 const f=fixture();await f.projection.project({row:f.row,envelope:f.envelope});assert.equal(f.checkouts,1);assert.equal((await f.projection.load(ID)).executionId,ID);assert.equal(f.checkouts,2);
 for(const client of [null,{}, {query:true}])await assert.rejects(f.projection.project({row:f.row,envelope:f.envelope,client}),/projection client/);
 assert.equal(f.checkouts,2);
});
test('relay rejects an incomplete projection port before any transaction or publication',()=>{
 assert.throws(()=>new OutboxRelay({projectionPort:{}}),/projection port/);
});
test('a concurrent consumer reads exact retry lineage from durable outbox before projection commit',async()=>{
 const f=fixture({kind:'RETRY'}),lineage=await f.projection.load(ID);
 const delivery=normalizeClaimedJob({id:'transport',data:f.envelope},f.envelope.jobType,lineage);
 assert.equal(delivery.attempt,3);assert.equal(delivery.rootExecutionId,ROOT);assert.equal(delivery.replay,false);assert.equal(lineage.previousExecutionId,PREVIOUS);
 assert.equal(f.committed.size,0);assert(f.calls.filter(([sql])=>!['BEGIN','COMMIT'].includes(sql)).every(([sql])=>sql.startsWith('SELECT')&&!sql.includes('FOR ')));
});
test('published replay keeps its exact root and replay binding when relay projection rolls back',async()=>{
 const f=fixture({rollback:true,kind:'REPLAY'});await assert.rejects(f.relay.poll(),{code:'25P02'});assert.equal(f.committed.size,0);
 const lineage=await f.projection.load(ID),delivery=normalizeClaimedJob({id:'transport',data:f.envelope},f.envelope.jobType,lineage);
 assert.equal(delivery.replay,true);assert.equal(delivery.attempt,1);assert.equal(delivery.rootExecutionId,ROOT);assert.equal(lineage.replayRequestId,REPLAY);assert.equal(f.committed.size,0);
});
test('missing, ambiguous or corrupt durable lineage fails closed instead of falling back to attempt one',async()=>{
 for(const mutate of [f=>f.outboxRows.splice(0),f=>f.outboxRows.push(f.row),f=>{f.row.content_digest='a'.repeat(64);},f=>{f.row.envelope_digest='a'.repeat(64);},f=>{f.row.digest_sha256='a'.repeat(64);},f=>{f.row.lineage_version=0;},f=>{f.row.attempt=6;},f=>{f.row.root_execution_id=null;},f=>{f.row.previous_execution_id=null;},f=>{f.row.replay_request_id=REPLAY;},f=>{f.row.organization_id=ROOT;},f=>{f.row.envelope={...f.envelope,executionId:ROOT};}]){
  const f=fixture({kind:'RETRY'});mutate(f);await assert.rejects(f.projection.load(ID),/ASYNC_LINEAGE_PROJECTION/);assert.equal(f.committed.size,0);
 }
 const f=fixture();await f.projection.project({row:f.row,envelope:f.envelope});f.committed.get(ID).root_execution_id=null;
 await assert.rejects(f.projection.load(ID),/ASYNC_LINEAGE_PROJECTION/);
});

test('projection rejects malformed attempts before opening a transaction',async()=>{
 for(const attempt of ['invalid',1.5,null,0,6,true]){const f=fixture();f.row.attempt=attempt;await assert.rejects(f.projection.project({row:f.row,envelope:f.envelope}),/ASYNC_LINEAGE_PROJECTION_INVALID/);assert.equal(f.checkouts,0);}
});
