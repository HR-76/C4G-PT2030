'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const {Pool}=require('../../../backend/node_modules/pg');
const {acquireApplicationMutationLock}=require('../../../backend/src/applications/composition');

const root=path.resolve(__dirname,'../../..');
const runtime=JSON.parse(fs.readFileSync(path.join(root,'.tmp/local-platform/runtime.json'),'utf8'));
const target=runtime.target,credential=runtime.credentials;
if(!['localhost','127.0.0.1','::1'].includes(target.host)||credential.database!==target.tenantDatabase)throw new Error('LOCAL_TARGET_REQUIRED');

const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]};
const fixed=value=>Number(value.toFixed(3));
const pool=new Pool({host:target.host,port:target.port,database:credential.database,user:credential.login,password:credential.password,ssl:credential.ssl||false,max:4,connectionTimeoutMillis:3000});

async function prepare(client){
 await client.query('BEGIN TRANSACTION READ WRITE');
 await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
 await client.query("SELECT set_config('app.organization_id',$1,true),set_config('app.membership_id',$2,true)",[runtime.organizationId,runtime.membershipId]);
}
async function readProbe(delayMs){
 const admittedAt=performance.now(),client=await pool.connect(),startedAt=performance.now();let queries=0,lockQueries=0,error=null;
 const counted={query(statement,values){queries++;if(String(statement).includes('pg_advisory_xact_lock'))lockQueries++;return client.query(statement,values)}};
 try{
  await prepare(counted);
  assert.equal(await acquireApplicationMutationLock(counted,'browse',runtime.organizationId),false);
  await counted.query('SELECT pg_sleep($1::double precision),count(*)::int AS applications FROM opportunity_catalog.application WHERE organization_id=$2',[delayMs/1000,runtime.organizationId]);
 }catch(reason){error=reason;throw reason}
 finally{await counted.query('ROLLBACK').catch(()=>{});client.release()}
 const endedAt=performance.now();
 return {admittedAt,startedAt,endedAt,poolWaitMs:fixed(startedAt-admittedAt),durationMs:fixed(endedAt-startedAt),queries,lockQueries,error:error?.code||null};
}
async function writeLockProbe(){
 const first=await pool.connect(),second=await pool.connect();
 try{
  await Promise.all([prepare(first),prepare(second)]);
  assert.equal(await acquireApplicationMutationLock(first,'edit',runtime.organizationId),true);
  const held=Number((await first.query("SELECT count(*)::int AS count FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND granted")).rows[0].count);
  assert.ok(held>=1);
  const startedAt=performance.now(),waiting=acquireApplicationMutationLock(second,'transition',runtime.organizationId);
  await new Promise(resolve=>setTimeout(resolve,100));
  await first.query('ROLLBACK');
  assert.equal(await waiting,true);
  const waitMs=fixed(performance.now()-startedAt);
  await second.query('ROLLBACK');
  return {firstTransactionAdvisoryLocks:held,secondWriterWaitMs:waitMs,writeLockQueries:2};
 }finally{
  await first.query('ROLLBACK').catch(()=>{});await second.query('ROLLBACK').catch(()=>{});first.release();second.release();
 }
}
async function main(){
 const warmupCount=4;await Promise.all(Array.from({length:warmupCount},()=>readProbe(1)));
 const samples=[];
 for(let i=0;i<5;i++)samples.push(...await Promise.all([readProbe(50),readProbe(50)]));
 const overlaps=[];
 for(let i=0;i<samples.length;i+=2)overlaps.push(samples[i].startedAt<samples[i+1].endedAt&&samples[i+1].startedAt<samples[i].endedAt);
 assert.ok(overlaps.every(Boolean));assert.ok(samples.every(sample=>sample.lockQueries===0&&!sample.error));
 const durations=samples.map(sample=>sample.durationMs),poolWait=samples.map(sample=>sample.poolWaitMs),write=await writeLockProbe();
 process.stdout.write(JSON.stringify({kind:'local_postgresql_current_baseline_not_slo',sampleCount:samples.length,readDelayMs:50,readOverlapPairs:overlaps.filter(Boolean).length,
  warmupCount,readDurationMs:{p50:fixed(percentile(durations,.5)),p95:fixed(percentile(durations,.95))},poolWaitMs:{p50:fixed(percentile(poolWait,.5)),p95:fixed(percentile(poolWait,.95))},queriesPerRead:[...new Set(samples.map(sample=>sample.queries))],
  readAdvisoryLockQueries:samples.reduce((sum,sample)=>sum+sample.lockQueries,0),errors:samples.filter(sample=>sample.error).length,simultaneousReadsCompleted:samples.length,...write})+'\n');
}
main().finally(()=>pool.end()).catch(error=>{process.stderr.write(`${error.code||error.name}: ${error.message}\n`);process.exitCode=1});
