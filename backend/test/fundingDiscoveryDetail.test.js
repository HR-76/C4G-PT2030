'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const detail=require('../src/fundingTenders/discoveryDetails');
const {buildEvidence}=require('../src/fundingTenders/sourceEvidence');
const observedAt='2026-10-30T12:00:00.000Z';
const fields=()=>({title:'New published call',funderName:'European Commission',callReference:'NEW',officialUrl:'https://ec.europa.eu/call',sourceTemporal:{status:'OPEN',deadlines:['2027-01-01'],openings:[]}});
const evidence=()=>buildEvidence('NEW',[{content:'New published call',language:'en',metadata:{type:['1'],identifier:['NEW'],language:['en'],DATASOURCE:['SEDIA'],ccm2Id:['123'],callccm2Id:['123'],status:['31094502']}}]);
function fixture(){
 const checkpoint={run_id:randomUUID(),cycle_id:randomUUID(),ordinal:2,input_cursor:{phase:detail.PHASE,externalIdentifier:'NEW'},next_cursor:null};
 const queries=[];
 const client={async query(sql,p){queries.push([sql,p]);if(sql.startsWith('UPDATE opportunity_catalog.funding_batch')){checkpoint.next_cursor=structuredClone(p[1]);return {rowCount:1,rows:[{run_id:checkpoint.run_id}]};}return {rowCount:1,rows:[]};}};
 return {checkpoint,queries,client,run:{run_id:checkpoint.run_id,checkpoint}};
}
function found(){return {outcome:'FOUND',record:{externalIdentifier:'NEW',fields:fields()},received:1,observedAt,evidence:evidence()};}

test('new identity lookup binds complete evidence, observation and exact staged legacy fields',async()=>{
 const f=fixture(),batch=found(),records=await detail.stage(f.client,f.run,batch,{enrichmentEnabled:true});
 assert.equal(records.length,1);assert.equal(records[0].externalIdentifier,'NEW');
 assert.equal(f.checkpoint.next_cursor.outcome,'FOUND');assert.equal(f.checkpoint.next_cursor.evidenceFingerprint,batch.evidence.fingerprint);
 assert.doesNotThrow(()=>detail.verifyStaged(f.checkpoint,{external_identifier:'NEW',source_fields:records[0].fields},observedAt));
 assert.throws(()=>detail.verifyStaged(f.checkpoint,{external_identifier:'NEW',source_fields:{...records[0].fields,title:'Forged'}},observedAt),{code:'FUNDING_DISCOVERY_REQUIRES_LOOKUP'});
 assert.throws(()=>detail.verifyStaged(f.checkpoint,{external_identifier:'NEW',source_fields:records[0].fields},'2026-10-30T12:01:00.000Z'),{code:'FUNDING_DISCOVERY_REQUIRES_LOOKUP'});
  const forged=structuredClone(f.checkpoint);forged.next_cursor.received='1';
  assert.throws(()=>detail.verifyStaged(forged,{external_identifier:'NEW',source_fields:records[0].fields},observedAt),{code:'FUNDING_DISCOVERY_REQUIRES_LOOKUP'});
 assert.equal(f.queries.some(([sql])=>/INSERT INTO opportunity_catalog\.(opportunity|funding_identity|funding_refresh_target)/.test(sql)),false);
});

test('new-identity conflicts, absence and lookup errors persist diagnostics but never stage catalogue records',async()=>{
 for(const outcome of ['CONFLICT','ABSENT','ERROR']){
  const f=fixture();assert.deepEqual(await detail.stage(f.client,f.run,{outcome,received:outcome==='ABSENT'?0:1,observedAt},{enrichmentEnabled:true}),[]);
  assert.equal(f.checkpoint.next_cursor.outcome,outcome);
  assert.throws(()=>detail.verifyStaged(f.checkpoint,{external_identifier:'NEW',source_fields:fields()},observedAt),{code:'FUNDING_DISCOVERY_REQUIRES_LOOKUP'});
 }
});

test('new-identity conflict stores a bounded causal code and rejects arbitrary reasons',async()=>{
 const f=fixture();
 assert.deepEqual(await detail.stage(f.client,f.run,{outcome:'CONFLICT',conflictReasons:['SOURCE_VARIANTS_DIVERGE'],received:2,observedAt},{enrichmentEnabled:true}),[]);
 assert.deepEqual(f.checkpoint.next_cursor.conflictReasons,['SOURCE_VARIANTS_DIVERGE']);
 assert.equal(f.checkpoint.next_cursor.phase,detail.RESULT_PHASE);
 assert.equal(f.queries.length,1);
 const invalid=fixture();
 await assert.rejects(detail.stage(invalid.client,invalid.run,{outcome:'CONFLICT',conflictReasons:['FREE_TEXT:'+ 'x'.repeat(5000)],received:2,observedAt},{enrichmentEnabled:true}),{code:'FUNDING_CHECKPOINT_INVALID'});
 assert.equal(invalid.queries.length,0);
});

test('incomplete, inconsistent, disabled or unrecognised lookup cannot establish the apply proof',async()=>{
 for(const change of [b=>{delete b.evidence;},b=>{b.received=2;},b=>{b.record.externalIdentifier='OTHER';},b=>{b.evidence.fingerprint='f'.repeat(64);},b=>{b.record.fields.sourceTemporal.status='UNKNOWN';}]){
  const f=fixture(),batch=found();change(batch);await assert.rejects(detail.stage(f.client,f.run,batch,{enrichmentEnabled:true}));assert.equal(f.queries.length,0);
 }
 const f=fixture();await assert.rejects(detail.stage(f.client,f.run,found(),{enrichmentEnabled:false}));assert.equal(f.queries.length,0);
});

test('new identity queue is durable, replay-safe and independent from the catalogue identity FK',async()=>{
 const seen=new Set(),targets=new Set(['OLD']),attempted=new Set(),checkpoint={cycle_id:randomUUID(),ordinal:3};
 const client={async query(sql,p){
  if(sql.startsWith('INSERT INTO opportunity_catalog.funding_cycle_seen')){for(const id of p[1])seen.add(id);return {rows:[],rowCount:p[1].length};}
  if(sql.includes('FROM opportunity_catalog.funding_cycle_seen'))return {rows:[...seen].sort().filter(id=>!targets.has(id)&&!attempted.has(id)).slice(0,1).map(external_identifier=>({external_identifier}))};
  throw Error(sql);
 }};
 const records=['OLD','NEW'].map(externalIdentifier=>({externalIdentifier,fields:fields()}));
 await detail.enqueue(client,checkpoint,records);await detail.enqueue(client,checkpoint,records);
 assert.equal(seen.size,2);let next=await detail.next(client,checkpoint);assert.deepEqual(next.next_cursor,{phase:detail.PHASE,externalIdentifier:'NEW'});
 attempted.add('NEW');assert.equal(await detail.next(client,checkpoint),null);
});

test('expired or changed checkpoint cannot store a detail result',async()=>{
 const f=fixture();f.client.query=async()=>({rows:[],rowCount:0});
 await assert.rejects(detail.stage(f.client,f.run,found(),{enrichmentEnabled:true}),{code:'FUNDING_CHECKPOINT_INVALID'});
});

test('legacy discovery remains unchanged while enrichment mode defers all accepted hits',async()=>{
 const {discovered}=require('../src/fundingTenders/refresh'),records=['OLD','NEW'].map(externalIdentifier=>({externalIdentifier,fields:fields()}));
 const queries=[],client={query:async(sql,p)=>{queries.push(sql);return {rows:sql.startsWith('UPDATE')?[{external_identifier:'OLD'}]:[],rowCount:1};}};
 assert.deepEqual((await discovered(client,{cycle_id:randomUUID()},records)).map(r=>r.externalIdentifier),['NEW']);
 assert.deepEqual(await discovered(client,{cycle_id:randomUUID()},records,{enrichmentEnabled:true}),[]);
});

test('detail completion counts applied work once and does not treat diagnostic result as pagination',async()=>{
 const f=fixture(),updates=[],nextJobs=[];
 f.checkpoint.next_cursor={phase:detail.RESULT_PHASE,outcome:'FOUND'};
 f.client.query=async(sql,p)=>{
  if(sql.startsWith('SELECT * FROM opportunity_catalog.funding_batch'))return {rows:[f.checkpoint],rowCount:1};
  if(sql.startsWith('UPDATE opportunity_catalog.funding_cycle')){updates.push(p);return {rows:[{cycle_id:f.checkpoint.cycle_id}],rowCount:1};}
  if(sql.startsWith('SELECT refresh_enabled'))return {rows:[{refresh_enabled:true}]};
  if(sql.includes('FROM opportunity_catalog.funding_cycle_seen'))return {rows:[{external_identifier:'NEXT'}]};
  if(sql.includes('FROM opportunity_catalog.funding_refresh_target'))return {rows:[]};
  throw Error(sql);
 };
 await require('../src/fundingTenders/coverage').finish(f.client,{run_id:f.run.run_id,status:'SUCCESS',created_count:1,updated_count:0,unchanged_count:0,failed_count:0},async checkpoint=>nextJobs.push(checkpoint),true,true);
 assert.deepEqual(updates[0],[f.checkpoint.cycle_id,1,0,0,0]);assert.equal(nextJobs.length,1);
 assert.deepEqual(nextJobs[0].next_cursor,{phase:detail.PHASE,externalIdentifier:'NEXT'});
});

test('lookup failures finish visibly and do not repeatedly enqueue the same identity',async()=>{
 const f=fixture(),queries=[];
 f.client.query=async(sql,p)=>{queries.push(sql);return {rows:[{cycle_id:f.checkpoint.cycle_id}],rowCount:1};};
 let next=0;
 await detail.finish(f.client,{status:'ERROR',error_code:'SOURCE_TIMEOUT',created_count:0,updated_count:0,unchanged_count:0,failed_count:0},f.checkpoint,async()=>next++,{enrichmentEnabled:true});
 assert.equal(next,0);assert.ok(queries.some(sql=>sql.includes("THEN 'ERROR'")));
 assert.ok(queries.some(sql=>sql.includes('SOURCE_DISCOVERY_REVIEW_REQUIRED')&&sql.includes('funding_cycle_seen')));
});

test('disabled discovery mode completes an errored resumed detail without scheduling successors',async()=>{
 for(const refreshEnabled of [true,false]){
  const f=fixture(),queries=[],nextJobs=[];
  f.checkpoint.next_cursor={phase:detail.RESULT_PHASE,outcome:'FOUND'};
  f.client.query=async(sql,p)=>{
   queries.push([sql,p]);
   if(sql.startsWith('SELECT * FROM opportunity_catalog.funding_batch'))return {rows:[f.checkpoint],rowCount:1};
   if(sql.startsWith('UPDATE opportunity_catalog.funding_cycle'))return {rows:[{cycle_id:f.checkpoint.cycle_id}],rowCount:1};
   throw Error('Disabled detail cleanup must not select or enqueue another identity');
  };
  const row={run_id:f.run.run_id,status:'ERROR',error_code:'FUNDING_DISCOVERY_MODE_DISABLED',created_count:0,updated_count:0,unchanged_count:0,failed_count:0};
  await require('../src/fundingTenders/coverage').finish(f.client,row,async checkpoint=>nextJobs.push(checkpoint),refreshEnabled,false);
  assert.deepEqual(nextJobs,[]);
  const updates=queries.filter(([sql])=>sql.startsWith('UPDATE opportunity_catalog.funding_cycle'));
  assert.equal(updates.length,2);
  assert.deepEqual(updates[0][1],[f.checkpoint.cycle_id,0,0,0,0]);
  assert.ok(updates[1][0].includes("THEN 'ERROR'"));
  assert.deepEqual(updates[1][1],[f.checkpoint.cycle_id,'FUNDING_DISCOVERY_MODE_DISABLED']);
 }
});

test('disabled discovery mode cannot finish a successful detail or continue its queue',async()=>{
 const f=fixture();let scheduled=0;
 await assert.rejects(detail.finish(f.client,{status:'SUCCESS',created_count:0,updated_count:0,unchanged_count:0,failed_count:0},f.checkpoint,async()=>scheduled++,{enrichmentEnabled:false}),{code:'FUNDING_CHECKPOINT_INVALID'});
 assert.equal(scheduled,0);assert.deepEqual(f.queries,[]);
});

function workerFixture({collected=false,failStage=null,abortBeforeApply=false}={}){
 const {createFundingWorker}=require('../src/fundingTenders/worker'),calls=[];
 const run={run_id:randomUUID(),source_code:'EU_FUNDING_TENDERS',collected,checkpoint:{input_cursor:{phase:detail.PHASE,externalIdentifier:'NEW'}}};
 let worker;
 const repository={transaction:async work=>work({query:async()=>({rows:[]})}),discoveryDetailSupported:true,
  claim:async()=>{calls.push('claim');return run;},stage:async()=>{calls.push('stage');if(failStage)throw Object.assign(new Error(failStage),{code:failStage});},
  pending:async()=>{calls.push('pending');if(abortBeforeApply)await worker.shutdown();return [{external_identifier:'NEW'}];},
  apply:async()=>calls.push('apply'),finish:async()=>calls.push('finish')};
 const source={lookup:async input=>{calls.push('lookup');assert.equal(input.externalIdentifier,'NEW');assert.ok(input.signal instanceof AbortSignal);return found();},collect:async()=>{calls.push('collect');throw Error('unexpected discovery collect');}};
 worker=createFundingWorker({pool:{},queue:{shutdown:async()=>{},claim:async()=>[]},repository,source});
 return {worker,calls,execute:()=>worker.registry.resolve('funding_tenders.refresh').handler({payload:{runId:run.run_id},attempt:1})};
}

test('worker performs individual lookup before stage/apply and replay skips collection',async()=>{
 const fresh=workerFixture();assert.equal((await fresh.execute()).code,'SUCCESS');
 assert.deepEqual(fresh.calls,['claim','lookup','stage','pending','apply','finish']);
 assert.equal(fresh.worker.health().discoveryDetailSupported,true);
 const replay=workerFixture({collected:true});assert.equal((await replay.execute()).code,'SUCCESS');assert.deepEqual(replay.calls,['claim','pending','apply','finish']);
});

test('stale fenced staging or shutdown prevents applying a new identity',async()=>{
 const stale=workerFixture({failStage:'FUNDING_FENCE_STALE'});assert.equal((await stale.execute()).code,'PERMANENT');assert.deepEqual(stale.calls,['claim','lookup','stage']);
 const draining=workerFixture({abortBeforeApply:true});assert.equal((await draining.execute()).code,'RETRYABLE');assert.equal(draining.calls.includes('apply'),false);assert.equal(draining.calls.includes('finish'),false);
});
