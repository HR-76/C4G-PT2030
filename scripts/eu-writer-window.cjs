'use strict';
// Preparation only. No migration, source resume, acceptance or writer-selection port.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
const {Pool}=require('../backend/node_modules/pg');
const cfg=require('../backend/scripts/localPlatform/config');
const pkg=require('../backend/src/security/opportunityEuWriterMigrationPackage');
const backup=require('../backend/scripts/localPlatform/backupOpportunityV2');
const {acceptableWork,duringPause,release}=require('./opportunity-v2-window.cjs');
const SHA=/^[a-f0-9]{64}$/;const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=value=>createHash('sha256').update(value).digest('hex');
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const relative=file=>path.relative(cfg.root,file).replaceAll('\\','/');
function args(argv){assert(Array.isArray(argv)&&argv.length===2&&argv[0]==='--prepare-window');const validation=argv[1].slice('--validation='.length);assert(argv[1].startsWith('--validation=')&&/^output\/opportunity-eu-writer-window-validation(?:-[a-f0-9-]{36})?\/validation\.json$/.test(validation));return {validation};}
function readFile(relativePath){assert(typeof relativePath==='string'&&!path.isAbsolute(relativePath)&&!relativePath.includes(':')&&!relativePath.includes('\\')&&!relativePath.split('/').some(v=>!v||v==='.'||v==='..'));let file=cfg.root;for(const component of relativePath.split('/')){file=path.join(file,component);assert(!fs.lstatSync(file).isSymbolicLink(),'WINDOW_LINK_REFUSED');}assert.equal(fs.realpathSync(file),file);return fs.readFileSync(file);}
function validateGate(value){
 assert.equal(value?.gateType,'OPPORTUNITY_V2_EU_WRITER');assert.equal(value.packageDigest,pkg.packageDigest);assert.equal(value.status,'PASS');assert.equal(value.cleanup,true);assert.equal(value.isolated,true);assert.equal(value.habitualEnvironmentAccess,false);
 assert(Array.isArray(value.checks)&&value.checks.length&&value.checks.every(v=>typeof v.name==='string'&&v.name&&v.status==='PASS'));
 assert(value.inputHashes&&Object.keys(value.inputHashes).length);for(const [file,digest]of Object.entries(value.inputHashes)){assert(!path.isAbsolute(file)&&!file.includes(':')&&!file.includes('\\')&&!file.split('/').some(v=>!v||v==='.'||v==='..'));assert(SHA.test(digest));}return value;
}
function readValidation(file){
 const bytes=readFile(file),value=JSON.parse(bytes);assert.equal(value.status,'PASS');assert.equal(value.packageDigest,pkg.packageDigest);assert(value.gate&&SHA.test(value.gate.sha256));const gateBytes=readFile(value.gate.path);assert.equal(hash(gateBytes),value.gate.sha256);const gate=validateGate(JSON.parse(gateBytes));
 for(const [input,digest]of Object.entries(gate.inputHashes))assert.equal(hash(readFile(input)),digest,'WINDOW_GATE_INPUT_CHANGED');
 assert(value.inputs&&Object.keys(value.inputs).length);for(const [input,digest]of Object.entries(value.inputs)){assert(SHA.test(digest));assert.equal(hash(readFile(input)),digest,'WINDOW_VALIDATION_INPUT_CHANGED');}
 return {value,sha256:hash(bytes),gate};
}
function validateBackup(value,windowId){
 assert.equal(value?.status,'PASS');assert.equal(value.windowId,windowId);assert.equal(value.profile,'EU_WRITER_PREPARATION');assert.equal(value.packageDigest,pkg.packageDigest);
 for(const key of ['cleanup','noSourceDrift','aclRestricted'])assert.equal(value[key],true);
 assert.equal(value.baselines.central.version,pkg.CENTRAL_BASELINE);assert.equal(value.baselines.tenant.version,'034_application_snapshot_v2');
 const previous=require('../backend/src/security/opportunityV2MigrationPackage');assert.equal(value.baselines.central.fingerprint,previous.centralEntries.at(-1).schemaFingerprint);assert.equal(value.baselines.tenant.fingerprint,previous.tenantAddition.schemaFingerprint);
 assert.deepEqual(Object.keys(value.databases).sort(),['central','tenant']);for(const item of Object.values(value.databases))for(const key of ['dataMatches','sourceStillMatches','preflight'])assert.equal(item[key],true);
 return value;
}
function command(action,extra=[]){const result=spawnSync('powershell',['-NoProfile','-File',path.join(__dirname,'interest-maintenance-processes.ps1'),'-Action',action,...extra],{encoding:'utf8',windowsHide:true,timeout:20000});assert.equal(result.status,0,'WINDOW_PROCESS_'+action.toUpperCase()+'_FAILED');return JSON.parse(result.stdout);}
async function health(){try{const result=await fetch('http://localhost:3000/api/local-health',{signal:AbortSignal.timeout(3000)}),value=await result.json();return result.status===200&&value.ready===true&&value.environment==='C4G local'&&value.workerReady===true&&value.admissionReady===true;}catch{return false;}}
async function acquire(pool){const client=await pool.connect();try{await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='2500ms'");await client.query("SET LOCAL statement_timeout='5000ms'");const tables=(await client.query("SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY 1,2")).rows;assert(tables.length);await client.query('LOCK TABLE '+tables.map(r=>quote(r.nspname)+'.'+quote(r.relname)).join(',')+' IN SHARE MODE');return client;}catch(error){await client.query('ROLLBACK').catch(()=>{});client.release();throw error;}}
async function main(argv=process.argv.slice(2)){
 const selected=args(argv),validation=readValidation(selected.validation),preview=require('../backend/scripts/localPlatform/prepareEuWriterWindow');
 const config=cfg.readConfig(),stateBytes=fs.readFileSync(path.join(cfg.folder,'runtime.json')),state=JSON.parse(stateBytes);require('../backend/scripts/localPlatform/prepareOpportunityInterests').target(config,state);
 assert(!Object.hasOwn(state,'opportunityEuWriter'),'WINDOW_WRITER_ALREADY_SELECTED');assert(await health(),'WINDOW_HEALTH_REQUIRED');
 const observation=await preview.observeOfficial(),stored=preview.storeObservation(observation),observed=command('Inspect');
 const windowId=randomUUID(),folder=path.join(cfg.root,'output','opportunity-eu-writer-window-'+windowId);fs.mkdirSync(folder);const output=path.join(folder,'window.json');
 const report={kind:'eu-writer-preparation-window-v1',windowId,status:'IN_PROGRESS',startedAt:new Date().toISOString(),packageDigest:pkg.packageDigest,validation:{path:selected.validation,sha256:validation.sha256},supervisorBefore:observed,migrationsApplied:false,configurationChanged:false,euResumed:false,acceptanceApplied:false};
 const options='-c timezone=UTC -c statement_timeout=30000 -c lock_timeout=3000',pools={central:new Pool({...cfg.connection(config,config.centralDatabase),max:1,options}),tenant:new Pool({...cfg.connection(config,config.tenantDatabase),max:1,options})};
 let stopped=false;
 try{
  await duringPause({pause:async()=>{
   const deadline=Date.now()+120000;while(Date.now()<deadline){const clients=[];let quiet=false;try{clients.push(await acquire(pools.central));clients.push(await acquire(pools.tenant));const counts={central:await backup.pendingWork(clients[0],'central'),tenant:await backup.pendingWork(clients[1],'tenant')};report.workBefore=counts;
    const source=(await clients[0].query('SELECT opportunity_catalog.eu_source_state_v2() AS value')).rows[0].value;assert.equal(source.state,'QUIESCED');assert.equal(source.activeRunLeases+source.activeOutboxLeases+source.activeInboxLeases+source.pendingRuns,0);
    if(acceptableWork(counts)){stopped=true;report.stop=command('Stop',['-ExpectedId',String(observed.id),'-ExpectedCreated',observed.created]);report.pausedAt=new Date().toISOString();quiet=true;}
   }catch(error){if(stopped||!['55P03','57014'].includes(error.code))throw error;}finally{await release(clients);}if(quiet)return;await sleep(1500);}throw Error('WINDOW_NO_SAFE_IDLE_PERIOD');
  },perform:async()=>{
   await Promise.all(Object.values(pools).map(p=>p.end()));const probe=new Pool({...cfg.connection(config,config.centralDatabase),max:1,options:'-c default_transaction_read_only=on'});
   try{let external;for(let n=0;n<20;n++){external=(await probe.query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname=ANY($1::text[]) AND pid<>pg_backend_pid()',[[config.centralDatabase,config.tenantDatabase]])).rows[0].n;if(external===0)break;await sleep(250);}assert.equal(external,0,'WINDOW_UNKNOWN_DATABASE_SESSIONS');}finally{await probe.end();}
   const before=await preview.readHabitualPreview(stored);report.preview={path:relative(before.file),sha256:hash(fs.readFileSync(before.file))};report.expected=before.report.central.value.expected;report.source=before.report.central.value.sourceControl;
   const pauseProof=await backup.provePausedWindow({windowId,packageDigest:pkg.packageDigest,profile:backup.WRITER_PROFILE,stopReceipt:report.stop});cfg.saveState(report,output);
   const restored=validateBackup(await backup.main(['--backup-and-restore'],{pauseProof}),windowId);
   const backupId=path.basename(restored.backup).slice('opportunity-v2-backup-'.length),backupFile=path.join(cfg.root,'output','opportunity-v2-window',windowId,'backup-restore-'+backupId+'.json');
   assert.deepEqual(JSON.parse(fs.readFileSync(backupFile)),JSON.parse(JSON.stringify(restored)));report.backup={path:relative(backupFile),sha256:hash(fs.readFileSync(backupFile)),backupId,result:'PASS'};
   assert.equal(hash(fs.readFileSync(path.join(cfg.folder,'runtime.json'))),hash(stateBytes),'WINDOW_CONFIGURATION_DRIFT');report.backupVerified=true;
  },resume:async()=>{
   if(!stopped)return;let current;try{current=command('Inspect');}catch{}report.supervisorAfter=current||command('Start',['-LogPrefix',path.join(cfg.folder,'eu-writer-window-'+windowId)]);
   for(let n=0;n<60;n++){if(await health()){report.healthRestored=true;report.resumedAt=new Date().toISOString();return;}await sleep(1000);}throw Error('WINDOW_HEALTH_NOT_RESTORED');
  }});
  readValidation(selected.validation);assert.equal(hash(fs.readFileSync(path.join(cfg.folder,'runtime.json'))),hash(stateBytes),'WINDOW_CONFIGURATION_DRIFT');
  const verify=new Pool({...cfg.connection(config,config.centralDatabase),max:1,options:'-c default_transaction_read_only=on'});
  try{const current=(await verify.query('SELECT opportunity_catalog.eu_source_state_v2() AS value')).rows[0].value;assert.equal(current.state,'QUIESCED');assert.equal(current.fence,report.source.fence);assert.equal(current.pendingRuns+current.activeRunLeases+current.activeOutboxLeases+current.activeInboxLeases,0);report.sourceAfter=current;}finally{await verify.end();}
  report.status='PASS';
 }catch(error){report.status='FAIL';report.failure=/^[A-Z0-9_]+$/.test(error.message||'')?error.message:'WINDOW_PREPARATION_FAILED';throw error;}
 finally{await Promise.allSettled(Object.values(pools).map(p=>p.ended?Promise.resolve():p.end()));report.completedAt=new Date().toISOString();cfg.saveState(report,output);console.log(JSON.stringify({status:report.status,windowId,healthRestored:report.healthRestored===true,evidence:relative(output),failure:report.failure||null}));}
 return {report,folder};
}
if(require.main===module)main().catch(()=>{console.error('EU_WRITER_WINDOW_FAILED_SEE_REPORT');process.exitCode=1;});
module.exports={args,readFile,validateGate,readValidation,validateBackup,main};
