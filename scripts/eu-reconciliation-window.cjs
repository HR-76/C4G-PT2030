'use strict';
// Paused preparation only. No migration, source mutation or collection port.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const {Pool}=require('../backend/node_modules/pg'),cfg=require('../backend/scripts/localPlatform/config');
const backup=require('../backend/scripts/localPlatform/backupOpportunityV2');
const pkg=require('../backend/src/security/opportunityEuReconciliationMigrationPackage');
const plans=require('../backend/src/opportunities/v2/euRunReconciliationPlan');
const {readExpiredRunState,assertReconciliationPreviewState}=require('../backend/src/opportunities/v2/euRunReconciliationState');
const {readFile}=require('./eu-writer-window.cjs'),{duringPause,release}=require('./opportunity-v2-window.cjs');
const CYCLE='7266ad6b-8880-4ec1-9399-4751187831c5',RUN='75b462ed-a399-4bdb-bd96-ed18507761c9';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{64}$/;
const sha=b=>createHash('sha256').update(b).digest('hex'),relative=f=>path.relative(cfg.root,f).replaceAll('\\','/');
const ref=file=>({path:file,sha256:sha(readFile(file))}),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const quote=s=>'"'+s.replaceAll('"','""')+'"';
function args(argv){assert(Array.isArray(argv)&&argv.length===2&&argv[0]==='--prepare-window');assert(/^--validation=output\/opportunity-eu-reconciliation-validation-[a-f0-9-]{36}\/validation\.json$/.test(argv[1]));return {validation:argv[1].slice(13)};}
function readValidation(file){
 const bytes=readFile(file),value=JSON.parse(bytes);assert.equal(value.status,'PASS');assert.equal(value.packageDigest,pkg.packageDigest);assert(SHA.test(value.gate?.sha256));const gb=readFile(value.gate.path);assert.equal(sha(gb),value.gate.sha256);const gate=JSON.parse(gb);
 assert.equal(gate.gateType,'OPPORTUNITY_V2_EU_EXPIRED_RECONCILIATION');assert.equal(gate.packageDigest,pkg.packageDigest);for(const k of ['cleanup','isolated'])assert.equal(gate[k],true);assert.equal(gate.habitualEnvironmentAccess,false);assert.equal(gate.status,'PASS');assert(gate.checks?.length&&gate.checks.every(x=>x.status==='PASS'));
 for(const input of [gate.inputHashes,value.inputs]){assert(input&&Object.keys(input).length);for(const [f,h]of Object.entries(input)){assert(SHA.test(h));assert.equal(sha(readFile(f)),h,'RECONCILIATION_VALIDATION_INPUT_CHANGED');}}
 for(const f of ['scripts/eu-reconciliation-window.cjs','scripts/eu-reconciliation-install.cjs','scripts/eu-reconciliation-execute.cjs'])assert(SHA.test(gate.inputHashes[f]||''),'RECONCILIATION_EXECUTOR_PROOF_REQUIRED');
 return {value,gate,sha256:sha(bytes)};
}
function validateBackup(value,windowId,scope){
 assert.equal(value?.status,'PASS');assert.equal(value.windowId,windowId);assert.equal(value.profile,backup.RECONCILIATION_PROFILE);assert.equal(value.packageDigest,pkg.packageDigest);assert.deepEqual(value.reconciliation,scope);
 for(const k of ['cleanup','noSourceDrift','aclRestricted','globalsMatch'])assert.equal(value[k],true);
 for(const name of ['central','tenant']){const p=value.baselines[name];backup.assertBaseline({currentVersion:p.version,fingerprint:p.fingerprint,postgresMajor:18},name,backup.RECONCILIATION_PROFILE);for(const k of ['dataMatches','sourceStillMatches','preflight'])assert.equal(value.databases[name][k],true);}
 return value;
}
function command(action,extra=[]){const r=spawnSync('powershell',['-NoProfile','-File',path.join(__dirname,'interest-maintenance-processes.ps1'),'-Action',action,...extra],{encoding:'utf8',windowsHide:true,timeout:20000});assert.equal(r.status,0,'RECONCILIATION_PROCESS_'+action.toUpperCase()+'_FAILED');return JSON.parse(r.stdout);}
async function health(){try{const r=await fetch('http://localhost:3000/api/local-health',{signal:AbortSignal.timeout(3000)}),v=await r.json();return r.status===200&&v.ready&&v.workerReady&&v.admissionReady&&v.environment==='C4G local';}catch{return false;}}
async function acquire(pool){const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='2500ms'");await c.query("SET LOCAL statement_timeout='10000ms'");const rows=(await c.query("SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY 1,2")).rows;assert(rows.length);await c.query('LOCK TABLE '+rows.map(r=>quote(r.nspname)+'.'+quote(r.relname)).join(',')+' IN SHARE MODE');return c;}catch(e){await c.query('ROLLBACK').catch(()=>{});c.release();throw e;}}
function scopeOf(state){assert.equal(state.preview.cycleId,CYCLE);assert.equal(state.preview.run.run_id,RUN);return backup.validateReconciliationScope({cycleId:CYCLE,runId:RUN,sourceFence:state.preview.source.fence,previewDigest:state.previewDigest});}
function pools(config,applicationName){return Object.fromEntries(['central','tenant'].map(name=>[name,new Pool({...cfg.connection(config,config[name+'Database']),max:2,application_name:applicationName,options:'-c timezone=UTC -c statement_timeout=30000 -c lock_timeout=3000'})]));}
async function idle(central,tenant,scope){const own=await backup.reconciliationPendingWork(central,scope),privateWork=await backup.pendingWork(tenant,'tenant');assert(backup.isQuiescentWork(privateWork,'tenant'),'RECONCILIATION_TENANT_WORK');return {central:own.counts,matched:own.matched,tenant:privateWork};}
async function stopAtIdle({connections,scope,observed,report,save}){
 const deadline=Date.now()+120000;while(Date.now()<deadline){const clients=[];let stopped=false;try{clients.push(await acquire(connections.central));clients.push(await acquire(connections.tenant));report.workBefore=await idle(clients[0],clients[1],scope);report.stop=command('Stop',['-ExpectedId',String(observed.id),'-ExpectedCreated',observed.created]);report.pausedAt=new Date().toISOString();save();stopped=true;}
 catch(e){if(report.stop||!['55P03','57014'].includes(e.code))throw e;}finally{await release(clients);}if(stopped)return;await sleep(1500);}throw Error('RECONCILIATION_NO_SAFE_IDLE_PERIOD');
}
async function resume({report,save,prefix}){let running;try{running=command('Inspect');}catch{}report.supervisorAfter=running||command('Start',['-LogPrefix',path.join(cfg.folder,prefix)]);save();for(let n=0;n<60;n++){if(await health()){report.healthRestored=true;report.resumedAt=new Date().toISOString();save();return;}await sleep(1000);}throw Error('RECONCILIATION_HEALTH_NOT_RESTORED');}
async function assertNoExternalSessions(config){const p=new Pool({...cfg.connection(config,config.centralDatabase),max:1,options:'-c default_transaction_read_only=on'});try{for(let n=0;n<20;n++){const count=(await p.query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname=ANY($1::text[]) AND pid<>pg_backend_pid()',[[config.centralDatabase,config.tenantDatabase]])).rows[0].n;if(count===0)return;await sleep(250);}throw Error('RECONCILIATION_EXTERNAL_SESSIONS');}finally{await p.end();}}
async function freshBackup({windowId,scope,stopReceipt}){const pauseProof=await backup.provePausedWindow({windowId,packageDigest:pkg.packageDigest,profile:backup.RECONCILIATION_PROFILE,reconciliation:scope,stopReceipt}),value=validateBackup(await backup.main(['--backup-and-restore'],{pauseProof}),windowId,scope),backupId=path.basename(value.backup).slice('opportunity-v2-backup-'.length),file='output/opportunity-v2-window/'+windowId+'/backup-restore-'+backupId+'.json';assert.deepEqual(JSON.parse(readFile(file)),JSON.parse(JSON.stringify(value)));return {value,reference:ref(file),backupId};}
async function main(argv=process.argv.slice(2)){
 const selected=args(argv),validation=readValidation(selected.validation),config=cfg.readConfig(),state=JSON.parse(readFile('.tmp/local-platform/runtime.json'));require('../backend/scripts/localPlatform/prepareOpportunityInterests').target(config,state);require('../backend/scripts/localPlatform/runtime').runtimeEnvironment(config,state);assert(await health(),'RECONCILIATION_HEALTH_REQUIRED');
 const planId=randomUUID(),base='output/opportunity-eu-reconciliation-'+planId,folder=path.join(cfg.root,base);fs.mkdirSync(folder);const file=path.join(folder,'window.json'),connections=pools(config,'eu-reconciliation-preparation-'+planId),observed=command('Inspect');
 const report={kind:'eu-expired-reconciliation-preparation-v1',planId,status:'IN_PROGRESS',startedAt:new Date().toISOString(),packageDigest:pkg.packageDigest,validation:ref(selected.validation),migrationsApplied:false,resumed:false,newEnqueues:0,supervisorBefore:observed};const save=()=>cfg.saveState(report,file);save();
 try{const initial=await readExpiredRunState(connections.central,{cycleId:CYCLE}),scope=scopeOf(initial);report.scope=scope;
  await duringPause({pause:()=>stopAtIdle({connections,scope,observed,report,save}),perform:async()=>{
   await Promise.all(Object.values(connections).map(p=>p.end()));await assertNoExternalSessions(config);
   const reader=new Pool({...cfg.connection(config,config.centralDatabase),max:1,options:'-c default_transaction_read_only=on -c statement_timeout=30000'});let fresh;try{fresh=await assertReconciliationPreviewState(reader,scope);}finally{await reader.end();}
   const previewPath=base+'/preview.json';fs.writeFileSync(path.join(cfg.root,previewPath),JSON.stringify({...fresh,readOnly:true},null,2)+'\n',{flag:'wx'});report.preview=ref(previewPath);save();
   const restored=await freshBackup({windowId:planId,scope,stopReceipt:report.stop});report.backup={...restored.reference,backupId:restored.backupId};save();
  },resume:()=>report.stop?resume({report,save,prefix:'eu-reconciliation-preparation-'+planId}):Promise.resolve()});
  const revalidated=readValidation(selected.validation),b=JSON.parse(readFile(report.backup.path));assert.equal(revalidated.sha256,validation.sha256);const inputs={...validation.gate.inputHashes,...validation.value.inputs,...Object.fromEntries(Object.entries(b.configuration).map(([f,v])=>[f,v.sha256]))};
  const createdAt=new Date().toISOString(),plan=plans.buildReconciliationPlan({planId,createdAt,expiresAt:new Date(Date.now()+3600000).toISOString(),state:JSON.parse(readFile(report.preview.path)),inputs,evidence:{preview:report.preview,backup:{path:report.backup.path,sha256:report.backup.sha256},validation:report.validation}});
  fs.writeFileSync(path.join(folder,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});plans.loadReconciliationPlan(cfg.root,planId);report.plan=ref(base+'/plan.json');report.previewDigest=plan.previewDigest;report.status='PASS';
 }catch(e){report.status='FAIL';report.failure=/^[A-Z0-9_]+$/.test(e.message||'')?e.message:e.code?.startsWith('OPPORTUNITY_')?e.code:'RECONCILIATION_PREPARATION_FAILED';throw e;}
 finally{await Promise.allSettled(Object.values(connections).map(p=>p.ended?Promise.resolve():p.end()));report.completedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,planId,healthRestored:report.healthRestored===true,evidence:relative(file),failure:report.failure||null}));}return report;
}
if(require.main===module)main().catch(()=>{console.error('RECONCILIATION_PREPARATION_FAILED_SEE_REPORT');process.exitCode=1;});
module.exports={CYCLE,RUN,UUID,SHA,args,sha,ref,readFile,relative,readValidation,validateBackup,command,health,acquire,scopeOf,pools,idle,stopAtIdle,resume,assertNoExternalSessions,freshBackup,main};
