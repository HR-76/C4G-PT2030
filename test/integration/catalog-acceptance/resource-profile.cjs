'use strict';
const fs=require('node:fs'),path=require('node:path'),inspector=require('node:inspector');
const {monitorEventLoopDelay,performance}=require('node:perf_hooks');
const {promisify}=require('node:util'),exec=promisify(require('node:child_process').execFile);
const assert=require('node:assert/strict');
const {category}=require('./resource-hooks.cjs');
async function create({db,catalog,hooks,out}){
 const {Pool}=require('../../../backend/node_modules/pg');
 const pool=new Pool({connectionString:db.central.connectionString,max:1,application_name:'gcni_profile_observer'});
 let client;try{client=await pool.connect();hooks.ignore(client);
 const core=require('../../../backend/src/security/centralSchemaManifest'),schema=require('../../../backend/src/opportunities/catalogRead/readSchema');
 async function fingerprints(){const c=await catalog.catalogPool.connect();try{return [await core.centralSchemaSnapshot(c),await schema.fingerprint(c)];}finally{c.release();}}
 const before=await fingerprints();
 await client.query('CREATE SCHEMA gcni_profile_observer; CREATE EXTENSION pg_stat_statements WITH SCHEMA gcni_profile_observer; REVOKE ALL ON SCHEMA gcni_profile_observer FROM PUBLIC; REVOKE ALL ON ALL TABLES IN SCHEMA gcni_profile_observer FROM PUBLIC; REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gcni_profile_observer FROM PUBLIC;');
 assert.deepEqual(await fingerprints(),before,'OBSERVER_CHANGED_ADMITTED_SCHEMA');
 const run=process.env.HTTP_PROOF_RUN;assert.match(run,/^[a-f0-9]{32}$/);const container='c4g-http-pg-'+run;
 const labels=JSON.parse((await exec('docker',['inspect','--format','{{json .Config.Labels}}',container],{windowsHide:true})).stdout);assert.equal(labels['c4g.http-proof'],run);
 async function cpu(){const {stdout}=await exec('docker',['exec',container,'cat','/sys/fs/cgroup/cpu.stat'],{windowsHide:true});return Object.fromEntries(stdout.trim().split(/\r?\n/).map(s=>{const [k,v]=s.split(/\s+/);return[k,Number(v)];}));}
 async function stats(){const rows=(await client.query('SELECT userid::text,queryid::text,query,calls,total_exec_time,total_plan_time,plans,rows,shared_blks_hit,shared_blks_read,temp_blks_read,temp_blks_written FROM gcni_profile_observer.pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())')).rows;const info=(await client.query('SELECT * FROM gcni_profile_observer.pg_stat_statements_info')).rows[0];return {info,rows:rows.map(({query,...r})=>({...r,category:category(query)}))};}
 let active;
 return {observerSchemaFingerprintUnchanged:true,
 async start(name,profile){
  const initial=await stats(),pg=await cpu();let session,post;
  if(profile){session=new inspector.Session();session.connect();post=(method,params={})=>new Promise((resolve,reject)=>session.post(method,params,(e,r)=>e?reject(e):resolve(r)));await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:1000});await post('Profiler.start');hooks.start();}
  const delay=monitorEventLoopDelay({resolution:10});delay.enable();
  active={name,profile,initial,pg,session,post,delay,start:performance.now(),node:process.cpuUsage(),elu:performance.eventLoopUtilization(),polls:[],pollErrors:0,stop:false};
  if(profile){const w=active;w.poller=(async()=>{while(!w.stop){const at=performance.now();try{const rows=(await client.query("SELECT backend_type,state,wait_event_type,wait_event,count(*)::int AS n,count(*) FILTER(WHERE cardinality(pg_blocking_pids(pid))>0)::int AS blocked FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() GROUP BY backend_type,state,wait_event_type,wait_event")).rows;w.polls.push({atMs:at-w.start,queryMs:performance.now()-at,rows});}catch{w.pollErrors++;}if(!w.stop)await new Promise(r=>setTimeout(r,25));}})();}
 },
 async stop(){const w=active;assert(w);const wallMs=performance.now()-w.start,nodeCpu=process.cpuUsage(w.node),elu=performance.eventLoopUtilization(w.elu);w.delay.disable();w.stop=true;await w.poller;let queries=null,cpuFile=null;
  if(w.profile){queries=hooks.finish();const {profile}=await w.post('Profiler.stop');await w.post('Profiler.disable');w.session.disconnect();for(const n of profile.nodes){const u=n.callFrame.url.replaceAll('\\','/');const marker=u.indexOf('/GCNI_C4G/');n.callFrame.url=marker>=0?u.slice(marker+10):u.startsWith('node:')?u:u?'[external]/'+u.split('/').at(-1):'';}cpuFile=w.name+'.cpuprofile';fs.writeFileSync(path.join(out,cpuFile),JSON.stringify(profile));}
  const pgEnd=await cpu(),end=await stats();assert.equal(String(w.initial.info.stats_reset),String(end.info.stats_reset));assert.equal(Number(w.initial.info.dealloc),Number(end.info.dealloc),'PG_STATS_EVICTION');
  const map=new Map(w.initial.rows.map(r=>[r.userid+':'+r.queryid,r]));const statements=[];for(const r of end.rows){const old=map.get(r.userid+':'+r.queryid)||{};if(Number(r.calls)-Number(old.calls||0)<=0)continue;const d={queryid:r.queryid,category:r.category};for(const k of ['calls','total_exec_time','total_plan_time','plans','rows','shared_blks_hit','shared_blks_read','temp_blks_read','temp_blks_written'])d[k]=Number(r[k])-Number(old[k]||0);statements.push(d);}
  active=null;return {wallMs,nodeCpu,pgCpuDelta:Object.fromEntries(Object.keys(pgEnd).map(k=>[k,pgEnd[k]-w.pg[k]])),eventLoop:elu,eventLoopDelayMs:{mean:w.delay.mean/1e6,p95:w.delay.percentile(95)/1e6,max:w.delay.max/1e6},queries,cpuFile,activity:{intervalMs:25,polls:w.polls,errors:w.pollErrors},statements};
 },
 async close(){if(active){active.stop=true;await active.poller;active.session?.disconnect();active.delay.disable();}client.release();await pool.end();}
 };
 }catch(error){client?.release();await pool.end();throw error;}
}
module.exports={create};
