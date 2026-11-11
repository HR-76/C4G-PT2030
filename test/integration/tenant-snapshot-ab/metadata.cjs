'use strict';
// Complete fresh tenant collectors, including all 24 security queries. No SQL
// mutation, EXPLAIN, restricted function or preflight is inside these timings.
const {REVISION,sha,fail,safeCode,assertTenantFixture,loadTenant,createLimitedPool,verifyLimited}=require('./tenant-equivalence.cjs');
const PAIRS=[['A','B'],['B','A'],['A','B'],['B','A'],['A','B'],['B','A']];
const COMPARISON='BASELINE_TENANT_VS_CANONICAL_NOT_NULL_WITH_IDENTICAL_SECURITY_READS';
function distribution(values){
 const sorted=values.slice().sort((a,b)=>a-b);
 if(!sorted.length||sorted.some(x=>!Number.isFinite(x)||x<0))throw fail('AB_METADATA_POPULATION_INVALID');
 return {count:sorted.length,p50Ms:sorted[Math.ceil(sorted.length*.5)-1],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maximumMs:sorted.at(-1)};
}
async function runMetadataAB({fixture,rootA,rootB,mode='measure',onProgress=()=>{},load=loadTenant,createPool=createLimitedPool}={}){
 assertTenantFixture(fixture);if(!['functional','measure'].includes(mode)||typeof onProgress!=='function')throw fail('AB_METADATA_ARGUMENTS_INVALID');
 const collectors={A:load(rootA),B:load(rootB)},expected=collectors.A.entry.schemaFingerprint;
 if(collectors.B.entry.schemaFingerprint!==expected)throw fail('AB_METADATA_CONTRACT_CHANGED');
 const epoch=performance.now(),report={schemaVersion:1,status:'RUNNING',mode,target:'TENANT',comparison:COMPARISON,clock:'MONOTONIC',quantiles:'NEAREST_RANK',populations:[],limits:[
  'Full tenant snapshots use a limited API login and READ ONLY transaction. Setup, identity checks and cleanup are outside sample durations but inside block control budgets.',
  'Driver intervals include execution, transport and waits; they are not SQL CPU. Functional calls are outside measured populations.'
 ]};
 let functionalElapsed=0;
 try{
  for(const tenant of fixture.tenants){
   const p={schemaVersion:1,status:'RUNNING',mode,tenantIndex:tenant.index,revision:REVISION,clock:'MONOTONIC',quantiles:'NEAREST_RANK',comparison:COMPARISON,fingerprint:expected,checks:{},samples:[],blocks:[],pairs:[],connections:[],summary:{}};
   report.populations.push(p);const populationStart=performance.now(),pool=createPool(rootA,tenant),sqlHashes={};
   async function connection(label,work){
    const start=performance.now(),client=await pool.connect();if(!client||typeof client.query!=='function'||typeof client.release!=='function')throw fail('AB_METADATA_CLIENT_INVALID');
    p.connections.push({label,acquisitionMs:performance.now()-start,callerOwned:false});let began=false;
    try{await client.query('BEGIN TRANSACTION READ ONLY');began=true;await verifyLimited(client,tenant);return await work(client);}
    finally{try{if(began)await client.query('ROLLBACK');}finally{client.release();}}
   }
   async function observe(client,arm,phase,sampleIndex,pairIndex=null,blockIndex=null){
    const start=performance.now(),queries=[],sample={arm,phase,pairIndex,blockIndex,sampleIndex,startedMs:start-epoch,status:'RUNNING',queries,queryCounts:{base:0,security:0}};p.samples.push(sample);
    const observed={async query(...args){
     const queryStart=performance.now(),kind=queries.length===0?'base':'security',text=typeof args[0]==='string'?args[0]:args[0]?.text;
     if(typeof text!=='string')throw fail('AB_METADATA_QUERY_INVALID');
     const event={kind,hash:sha(text),startedMs:queryStart-epoch,status:'RUNNING'};queries.push(event);sample.queryCounts[kind]++;
     try{const value=await client.query(...args);event.status='PASS';return value;}
     catch(error){event.status='FAIL';event.code=safeCode(error);throw error;}
     finally{event.durationMs=performance.now()-queryStart;}
    }};
    try{
     const snapshot=await collectors[arm].schema.tenantSchemaSnapshot(observed),json=JSON.stringify(snapshot),fingerprint=collectors[arm].schema.tenantSchemaFingerprint(snapshot);
     if(sample.queryCounts.base!==1||sample.queryCounts.security!==24)throw fail('AB_METADATA_SECURITY_READ_COUNT_CHANGED');
     const hashes=queries.map(q=>q.hash);
     if(sqlHashes[arm]&&JSON.stringify(sqlHashes[arm])!==JSON.stringify(hashes))throw fail('AB_METADATA_QUERY_SEQUENCE_CHANGED');
     sqlHashes[arm]||=hashes;
     if(sqlHashes.A&&sqlHashes.B&&(sqlHashes.A[0]===sqlHashes.B[0]||JSON.stringify(sqlHashes.A.slice(1))!==JSON.stringify(sqlHashes.B.slice(1))))throw fail('AB_METADATA_SECURITY_SQL_CHANGED');
     sample.fingerprint=fingerprint;
     // Equivalence caller compares bytes before the independent expected hash.
     if(phase!=='equivalence'&&fingerprint!==expected)throw fail('AB_METADATA_FINGERPRINT_MISMATCH');
     sample.status='PASS';return {json,fingerprint,sample};
    }catch(error){sample.status='FAIL';sample.code=safeCode(error);throw error;}
    finally{sample.durationMs=performance.now()-start;sample.driverObservedWorkMs=queries.reduce((n,q)=>n+q.durationMs,0);}
   }
   try{
    const functionalStart=performance.now();
    const functionalBudget=()=>{if(functionalElapsed+performance.now()-functionalStart>300000)throw fail('CONTROL_DEADLINE_EXCEEDED');};
    await connection('functional',async client=>{
     let canonical;
     for(const arm of ['A','B']){
      for(let index=0;index<2;index++){
       functionalBudget();const value=await observe(client,arm,'equivalence',index);functionalBudget();
       if(canonical===undefined)canonical=value.json;
       if(value.json!==canonical)throw fail('AB_METADATA_JSON_MISMATCH');
       if(value.fingerprint!==expected)throw fail('AB_METADATA_FINGERPRINT_MISMATCH');
      }
      for(let index=0;index<2;index++){functionalBudget();await observe(client,arm,'validation',index);functionalBudget();}
     }
    });functionalBudget();functionalElapsed+=performance.now()-functionalStart;
    p.checks={exactJsonBytes:true,exactFingerprint:true,freshReadsPerCall:true,securityReadsPreserved:true};
    await onProgress({stage:'functional-complete',tenantIndex:tenant.index,revision:REVISION,status:'PASS'});
    if(mode==='measure')for(let pairIndex=0;pairIndex<PAIRS.length;pairIndex++){
     for(const arm of PAIRS[pairIndex]){
      const start=performance.now(),blockIndex=p.blocks.length,cpu=process.cpuUsage(),memory=process.memoryUsage();
      const block={pairIndex,blockIndex,arm,status:'RUNNING',controlBudgetMs:300000};p.blocks.push(block);
      const budget=()=>{block.controlElapsedMs=performance.now()-start;if(block.controlElapsedMs>block.controlBudgetMs)throw fail('CONTROL_DEADLINE_EXCEEDED');};
      await connection('block-'+blockIndex,async client=>{
       for(const [phase,count]of [['warmup',10],['measured',100]])for(let index=0;index<count;index++){budget();await observe(client,arm,phase,index,pairIndex,blockIndex);budget();}
      });budget();
      const population=p.samples.filter(s=>s.blockIndex===blockIndex&&s.phase==='measured');
      Object.assign(block,distribution(population.map(s=>s.durationMs)),{status:'PASS',warmups:10,processCpuMicroseconds:process.cpuUsage(cpu),memoryBefore:{rss:memory.rss,heapUsed:memory.heapUsed},memoryAfter:(()=>{const m=process.memoryUsage();return{rss:m.rss,heapUsed:m.heapUsed};})()});
      await onProgress({stage:'block-complete',tenantIndex:tenant.index,revision:REVISION,pairIndex,blockIndex,arm,count:population.length});
     }
     const arms=Object.fromEntries(p.blocks.filter(b=>b.pairIndex===pairIndex).map(b=>[b.arm,b]));
     p.pairs.push({pairIndex,order:PAIRS[pairIndex].slice(),bMinusA:{p50Ms:arms.B.p50Ms-arms.A.p50Ms,p95Ms:arms.B.p95Ms-arms.A.p95Ms,maximumMs:arms.B.maximumMs-arms.A.maximumMs}});
    }
    if(mode==='measure')for(const arm of ['A','B']){const samples=p.samples.filter(s=>s.arm===arm&&s.phase==='measured');if(samples.length!==600)throw fail('AB_METADATA_SAMPLE_COUNT_INVALID');p.summary[arm]=distribution(samples.map(s=>s.durationMs));}
    p.status='PASS';
   }finally{try{await pool.end();}finally{p.totalDurationMs=performance.now()-populationStart;}}
  }
  report.status='PASS';return report;
 }catch(error){
  report.status='FAIL';report.failure={code:safeCode(error)};
  for(const p of report.populations){if(p.status==='RUNNING')p.status='FAIL';for(const b of p.blocks)if(b.status==='RUNNING')b.status='FAIL';}
  error.metadataABReport=report;throw error;
 }finally{report.totalDurationMs=performance.now()-epoch;report.functionalControlElapsedMs=functionalElapsed;}
}
module.exports={runMetadataAB,distribution};
