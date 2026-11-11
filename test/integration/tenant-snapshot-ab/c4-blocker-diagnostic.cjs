'use strict';
// Isolated, read-only instrumentation over the frozen B runtime. No runtime source is changed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {AsyncLocalStorage}=require('node:async_hooks');
const {verifyAB,sha}=require('../../../scripts/verify-tenant-snapshot-ab.cjs');
const root=path.resolve(__dirname,'../../..');
const manifest=path.resolve(root,'output/tenant-snapshot-ab-6e878cc249d44bf09781c51e856aa711/ab.json');
const tls=path.resolve(root,'.tmp/f2-integration');
const output=path.resolve(root,'output/c4-blocker-diagnostic');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const safe=e=>({code:/^[A-Z0-9_]+$/.test(e?.code||'')?e.code:'DIAGNOSTIC_FAILED',name:e?.name||'Error'});
function source(){return verifyAB({manifestPath:manifest,expectedHarnessRoot:path.join(path.dirname(manifest),'common'),verifyDependencies:true});}
function moduleAt(identity,name){return require(path.join(identity.variants.B.sourceRoot,'test/integration/eu-writer-performance',name+'.cjs'));}
function save(file,value){const safeValue={...value};delete safeValue.fixture;delete safeValue.httpReadiness;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(safeValue,null,2)+'\n');}

function diagnosticMetrics(identity){
 const pg=require(path.join(identity.variants.B.sourceRoot,'backend/node_modules/pg'));
 const baseline=moduleAt(identity,'instrumentation').install({pg,load:name=>require(path.join(identity.variants.B.sourceRoot,'backend/src/security',name))});
 const requestScope=new AsyncLocalStorage(),pidInfo=new Map(),requestIds=new Map();let requestSeq=0,phase='setup',timer,sampling=false,closed=false,frames=[],sampleErrors=[];
 const originalQuery=pg.Client.prototype.query;
 pg.Client.prototype.query=function(...args){
  const tag=requestScope.getStore(),sql=typeof args[0]==='string'?args[0]:args[0]?.text||'';
  if(!tag||!this.processID)return originalQuery.apply(this,args);
  const id=requestIds.get(tag),pid=this.processID,start=performance.now();
  const info=pidInfo.get(pid)||{};info.request=id;info.active=true;const category=sql.startsWith('SELECT * FROM audit.prepare_append_v1')?'audit-prepare':sql==='SELECT pg_advisory_xact_lock(43001306,1)'?'authority-lock':/^(COMMIT|ROLLBACK)/.test(sql)?'transaction':/pg_catalog|pg_roles|pg_class|pg_namespace|pg_proc|information_schema|c4g_system\.runtime_metadata_v1/.test(sql)?'metadata':'other';info.category=category;
  pidInfo.set(pid,info);
  const finish=error=>{info.active=false;if(category==='audit-prepare'&&!error)info.auditLockedAt=performance.now();if(/^(COMMIT|ROLLBACK)/.test(sql))delete info.auditLockedAt;};
  if(typeof args.at(-1)==='function'){const callback=args.at(-1);args[args.length-1]=function(error,...values){finish(error);return callback.call(this,error,...values);};return originalQuery.apply(this,args);}
  try{const result=originalQuery.apply(this,args);if(result&&typeof result.then==='function')result.then(()=>finish(),finish).catch(()=>{});else finish();return result;}catch(error){finish(error);throw error;}
 };
 let observer;
 async function sample(){if(sampling||closed||phase!=='dashboard-c4'||!observer)return;sampling=true;
  try{const {rows}=await observer.query(`SELECT pid,datname,state,wait_event_type,wait_event,query,pg_blocking_pids(pid) AS blockers,
    EXTRACT(EPOCH FROM(clock_timestamp()-xact_start))*1000 AS transaction_ms
    FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()`);
   const blocked=rows.filter(r=>r.query?.startsWith('SELECT * FROM audit.prepare_append_v1')&&r.wait_event_type==='Lock'&&r.blockers?.length);
   if(blocked.length)frames.push({at:performance.now(),waiters:blocked.map(r=>({pid:r.pid,request:pidInfo.get(r.pid)?.request??null,wait:r.wait_event,transactionMs:Number(r.transaction_ms),blockers:r.blockers.map(pid=>{const b=rows.find(x=>x.pid===pid),info=pidInfo.get(pid);return {pid,request:info?.request??null,state:b?.state||null,wait:b?.wait_event||null,transactionMs:b?.transaction_ms===null?null:Number(b?.transaction_ms),lastCategory:info?.category||null,auditLockHeldMs:info?.auditLockedAt===undefined?null:performance.now()-info.auditLockedAt};})}))});
  }catch(error){sampleErrors.push(safe(error));}finally{sampling=false;}}
 return Object.freeze({
  middleware(req,res,next){const tag=req.get('X-EU-Trial-Request');if(!tag)return baseline.middleware(req,res,next);requestIds.set(tag,++requestSeq);requestScope.run(tag,()=>baseline.middleware(req,res,next));},
  failure:baseline.failure,take:baseline.take,drain:baseline.drain,records:baseline.records,managers:baseline.managers,
  setPhase(value){phase=value;baseline.setPhase(value);},
  async startSampling(pool){observer=pool;await baseline.startSampling(pool);timer=setInterval(()=>{void sample();},50);},
  evidence(){return {frames,sampleErrors,requests:requestSeq};},
  async close(){closed=true;clearInterval(timer);while(sampling)await wait(10);pg.Client.prototype.query=originalQuery;await baseline.close();}
 });
}

async function child(identity,file){
 const report={schemaVersion:1,status:'RUNNING',kind:'C4_BLOCKER_DIAGNOSTIC',sourceSetDigest:identity.variants.B.sourceSetDigest,manifestSha256:sha(fs.readFileSync(manifest)),startedAt:new Date().toISOString(),attempts:[],cleanup:false};
 let fixture,http,metrics;const check=async(name,work)=>{await work();report.checks=(report.checks||[]).concat(name);save(file,report);};save(file,report);
 try{
  const owned=JSON.parse(process.env.EU_TRIAL_OWNED||'null');assert(Array.isArray(owned)&&owned.length===2,'OWNED_RESOURCES_REQUIRED');
  const infra=moduleAt(identity,'infra');for(const item of owned)await infra.inspectOwned(item);
  metrics=diagnosticMetrics(identity);
  fixture=await moduleAt(identity,'fixture').createFixture({adminUrl:process.env.EU_TRIAL_ADMIN_URL,keycloakBase:process.env.EU_TRIAL_KEYCLOAK,keycloakPassword:process.env.EU_TRIAL_KEYCLOAK_PASSWORD,runId:process.env.EU_TRIAL_RUN,centralRevision:'043',report,check});
  assert.equal(fixture.seed.digest,identity.protocol.seedDigest);
  const h=moduleAt(identity,'http'),readiness=moduleAt(identity,'readiness');
  http=await h.createHttpHarness({fixture,tlsDirectory:tls,metrics,check});await metrics.startSampling(fixture.central.pool);
  await readiness.runReadiness({fixture,http,report,check});assert.equal(report.httpReadiness.status,'PASS');
  http.setPhase('dashboard-c4-warmup');const warm=await http.request(0,'dashboard');assert.equal(warm.status,200,'WARMUP_FAILED');readiness.functionalSummary('dashboard',warm.data,fixture.tenants[0]);await http.drain(30000);
  http.setPhase('dashboard-c4');let next=0;await Promise.all(Array.from({length:4},async()=>{while(next<8){const attempt=next++;const response=await http.request(0,'dashboard');let functional=false;try{if(response.status===200){readiness.functionalSummary('dashboard',response.data,fixture.tenants[0]);functional=true;}}catch{}const record=response.metrics;const audit=record?.queryEvents?.filter(x=>x.category==='audit-prepare').map(x=>x.endMs-x.startMs)||[];report.attempts.push({attempt,status:response.status,code:response.data?.error?.code||response.code||null,ms:response.ms,functional,auditPrepareCount:audit.length,auditPrepareMaxMs:audit.length?Math.max(...audit):null,auditPrepareTotalMs:audit.reduce((a,b)=>a+b,0),sqlErrors:record?.sqlErrors||[],failures:record?.failures||[]});save(file,report);}}));
  await http.drain(30000);report.attempts.sort((a,b)=>a.attempt-b.attempt);report.observation=metrics.evidence();
  report.status=report.attempts.length===8&&report.attempts.every(x=>x.status===200&&x.functional)?'PASS':'FUNCTIONAL_FAIL';
 }catch(error){report.status='FAIL';report.failure=safe(error);}
 finally{
  const errors=[];for(const close of [()=>http?.close(),()=>metrics?.close(),()=>fixture?.close()])try{await close();}catch(error){errors.push(safe(error));}
  report.cleanup=errors.length===0;if(errors.length){report.cleanupErrors=errors;report.status='FAIL';}
  try{source();report.sourceIntegrityAfter='PASS';}catch(error){report.sourceIntegrityAfter='FAIL';report.status='FAIL';report.sourceError=safe(error);}
  report.finishedAt=new Date().toISOString();save(file,report);
 }
 process.stdout.write(JSON.stringify({status:report.status,attempts:report.attempts.length,blockedFrames:report.observation?.frames.length||0,cleanup:report.cleanup})+'\n');
 if(report.status!=='PASS')process.exitCode=1;
}

async function parent(identity){
 assert(process.platform==='win32','WINDOWS_OWNED_RESOURCE_REQUIRED');for(const name of ['localhost.crt','localhost.key','mkcert-rootCA.pem'])assert(fs.statSync(path.join(tls,name)).isFile());
 const infra=moduleAt(identity,'infra'),images=await infra.localImages();assert.deepEqual(images,identity.protocol.images,'PINNED_IMAGES_CHANGED');
 const runId=randomUUID().replaceAll('-',''),file=path.join(output,runId+'.json');let lab,childStatus=null,cleanup;
 try{lab=await infra.createLab({runId,tlsDirectory:tls,images,stage:'043'});const env={...process.env,...lab.env,TZ:'UTC'};delete env.NODE_PATH;delete env.NODE_OPTIONS;
  childStatus=await new Promise((resolve,reject)=>{const proc=spawn(process.execPath,[__filename,'--child',file],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';proc.stdout.on('data',b=>stdout+=b.toString());proc.stderr.on('data',b=>stderr+=b.toString());proc.on('error',reject);proc.on('close',code=>resolve({code,stdout:stdout.slice(-3000),stderr:stderr.slice(-1000)}));});
 }finally{if(lab)cleanup=await lab.cleanup();}
 const report=JSON.parse(fs.readFileSync(file,'utf8'));report.ownedCleanup=cleanup;report.childExit=childStatus?.code;report.sourceIntegrityAfterParent=source()?'PASS':'FAIL';if(cleanup?.status!=='PASS'||childStatus?.code!==0)report.status='FAIL';save(file,report);
 process.stdout.write(JSON.stringify({report:file,status:report.status,blockedFrames:report.observation?.frames.length||0,cleanup:cleanup?.status,childExit:childStatus?.code,childOutput:childStatus?.stdout})+'\n');if(report.status!=='PASS')process.exitCode=1;
}

async function main(){const identity=source();if(process.argv[2]==='--child')await child(identity,path.resolve(process.argv[3]));else if(process.argv.length===2)await parent(identity);else throw Error('ARGUMENTS_INVALID');}
main().catch(error=>{process.stderr.write(JSON.stringify(safe(error))+'\n');process.exitCode=1;});
