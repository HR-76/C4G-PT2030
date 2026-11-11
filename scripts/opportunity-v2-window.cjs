'use strict';
// A bounded preparation window: no migration, data acceptance or source flag.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
const {Pool}=require('../backend/node_modules/pg');
const cfg=require('../backend/scripts/localPlatform/config'),{target}=require('../backend/scripts/localPlatform/prepareOpportunityInterests');
const preview=require('../backend/scripts/localPlatform/prepareOpportunityV2Window');
const {pendingWork,isQuiescentWork}=require('../backend/scripts/localPlatform/backupOpportunityV2');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const digest=value=>createHash('sha256').update(value).digest('hex');
function args(argv){assert.deepEqual(argv,['--prepare-window']);}
function acceptableWork(counts){return Boolean(counts&&Object.keys(counts).length===2&&['central','tenant'].every(scope=>isQuiescentWork(counts[scope],scope)));}
async function duringPause({pause,perform,resume}){let attempted=false;try{attempted=true;await pause();return await perform();}finally{if(attempted)await resume();}}
function command(action,extra=[]){
 const run=spawnSync('powershell',['-NoProfile','-File',path.join(__dirname,'interest-maintenance-processes.ps1'),'-Action',action,...extra],{encoding:'utf8',windowsHide:true,timeout:20000});
 if(run.status!==0)throw Error('WINDOW_PROCESS_'+action.toUpperCase()+'_FAILED');return JSON.parse(run.stdout);
}
async function health(){try{const response=await fetch('http://localhost:3000/api/local-health',{signal:AbortSignal.timeout(3000)}),value=await response.json();return response.status===200&&value.ready===true&&value.environment==='C4G local'&&value.workerReady===true&&value.admissionReady===true;}catch{return false;}}
async function acquire(pool){
 const client=await pool.connect();try{
  await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='2500ms'");await client.query("SET LOCAL statement_timeout='5000ms'");
  const tables=(await client.query("SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY 1,2")).rows;
  assert(tables.length>0);await client.query('LOCK TABLE '+tables.map(row=>quote(row.nspname)+'.'+quote(row.relname)).join(',')+' IN SHARE MODE');return client;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});client.release();throw error;}
}
async function release(clients){
 const failures=[];
 for(const client of clients){let rollbackError;try{await client.query('ROLLBACK');}catch(error){rollbackError=error;failures.push(error);}
  try{client.release(rollbackError);}catch(error){failures.push(error);}}
 if(failures.length)throw new AggregateError(failures,'WINDOW_LOCK_CLEANUP_FAILED');
}
function validGate(report){
 assert.equal(report.gateType,'OPPORTUNITY_V2_REGISTERED_PACKAGE');assert.equal(report.status,'PASS');assert.equal(report.cleanup,true);assert.equal(report.habitualEnvironmentAccess,false);assert(report.packageDigest&&/^[a-f0-9]{64}$/.test(report.packageDigest));
 assert(Array.isArray(report.checks)&&report.checks.length>0&&report.checks.every(check=>typeof check.name==='string'&&check.name&&check.status==='PASS'));
 assert(report.inputHashes&&Object.keys(report.inputHashes).length>0);
 for(const [relative,checksum]of Object.entries(report.inputHashes)){assert(!path.isAbsolute(relative)&&!relative.split(/[\\/]/).some(part=>part==='..'||part===''));assert(/^[a-f0-9]{64}$/.test(checksum));}
 return report.packageDigest;
}
async function main(argv=process.argv.slice(2)){
 args(argv);const config=cfg.readConfig(),stateFile=path.join(cfg.folder,'runtime.json'),stateBytes=fs.readFileSync(stateFile),state=JSON.parse(stateBytes);target(config,state);
 // This pointer is produced only after the independent registered-package gate.
 const approvalFile=path.join(cfg.root,'output/opportunity-v2-window/registered-package-proof.json');
 const gate=JSON.parse(fs.readFileSync(approvalFile,'utf8')),packageDigest=validGate(gate);
 assert.equal(gate.packageDigest,require('../backend/src/security/opportunityV2MigrationPackage').packageDigest,'WINDOW_PACKAGE_DRIFT');
 for(const [relative,expected]of Object.entries(gate.inputHashes||{}))assert.equal(digest(fs.readFileSync(path.join(cfg.root,relative))),expected,'WINDOW_INPUT_DRIFT');
 assert(await health(),'WINDOW_HABITUAL_HEALTH_REQUIRED');
 const observation=await preview.observeOfficial(),stored=preview.storeObservation(observation);
 const observed=command('Inspect'),windowId=randomUUID(),logPrefix=path.join(cfg.folder,'opportunity-window-'+windowId),out=path.join(cfg.root,'output/opportunity-v2-window/window-'+windowId+'.json');
 const report={version:'opportunity-11145-preparation-window-v1',windowId,packageDigest,status:'IN_PROGRESS',startedAt:new Date().toISOString(),sourceObservation:stored.summary.metadata,sourceFactsChanged:stored.summary.normativeComparison.changed,supervisorBefore:observed,migrationsApplied:false,acceptanceApplied:false,configurationChanged:false};
 const options='-c timezone=UTC -c statement_timeout=30000 -c lock_timeout=3000';
 const pools={central:new Pool({...cfg.connection(config,config.centralDatabase),max:1,options}),tenant:new Pool({...cfg.connection(config,config.tenantDatabase),max:1,options})};
 let stopped=false;
 try{
  await duringPause({pause:async()=>{
   const deadline=Date.now()+120000;
   while(Date.now()<deadline){const locked=[];let quiet=false;try{
    locked.push(await acquire(pools.central));locked.push(await acquire(pools.tenant));
    const counts={central:await pendingWork(locked[0],'central'),tenant:await pendingWork(locked[1],'tenant')};report.workBefore=counts;
    if(acceptableWork(counts)){stopped=true;report.stop=command('Stop',['-ExpectedId',String(observed.id),'-ExpectedCreated',observed.created]);report.pausedAt=new Date().toISOString();quiet=true;}
   }catch(error){if(stopped||!['55P03','57014'].includes(error.code))throw error;}finally{await release(locked);}
   if(quiet)return;await sleep(1500);
   }throw Error('WINDOW_NO_SAFE_IDLE_PERIOD');
  },perform:async()=>{
   await Promise.all(Object.values(pools).map(pool=>pool.end()));
   const probe=new Pool({...cfg.connection(config,config.centralDatabase),max:1,options:'-c default_transaction_read_only=on'});
   try{let external;for(let n=0;n<20;n++){external=(await probe.query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname=ANY($1::text[]) AND pid<>pg_backend_pid()',[[config.centralDatabase,config.tenantDatabase]])).rows[0].n;if(external===0)break;await sleep(250);}assert.equal(external,0,'WINDOW_UNKNOWN_DATABASE_SESSIONS');}finally{await probe.end();}
   report.noExternalSessions=true;
   const before=await preview.readHabitualPreview(stored);report.preview=path.relative(cfg.root,before.file).replaceAll('\\','/');report.previewDigest=digest(fs.readFileSync(before.file));report.expected=before.report.central.value.expected;report.previewAction=before.report.central.value.preview.items[0].action;
   const backup=require('../backend/scripts/localPlatform/backupOpportunityV2');
   const pauseProof=await backup.provePausedWindow({windowId,packageDigest,stopReceipt:report.stop});
   cfg.saveState(report,out);
   const restored=await backup.main(['--backup-and-restore'],{pauseProof});
   assert.equal(restored.status,'PASS');assert.equal(restored.cleanup,true);assert.equal(restored.noSourceDrift,true,'WINDOW_SOURCE_DRIFT');
   assert(Object.values(restored.databases).every(item=>item.sourceStillMatches&&item.dataMatches&&item.preflight));
   assert.equal(digest(fs.readFileSync(stateFile)),digest(stateBytes),'WINDOW_CONFIGURATION_DRIFT');
   report.backup=restored.backup;report.backupCompletedAt=restored.completedAt;report.backupVerified=true;report.noDataDrift=true;
  },resume:async()=>{
   if(!stopped)return;let current;try{current=command('Inspect');}catch{}
   report.supervisorAfter=current||command('Start',['-LogPrefix',logPrefix]);
   for(let n=0;n<60;n++){if(await health()){report.healthRestored=true;report.resumedAt=new Date().toISOString();return;}await sleep(1000);}throw Error('WINDOW_HABITUAL_HEALTH_NOT_RESTORED');
  }});
  report.status='PASS';
 }catch(error){report.status='FAIL';report.failure=/^[A-Z0-9_]+$/.test(error.message||'')?error.message:'WINDOW_PREPARATION_FAILED';throw error;}
 finally{await Promise.allSettled(Object.values(pools).map(pool=>pool.ended?Promise.resolve():pool.end()));report.completedAt=new Date().toISOString();report.validity='Consistent during the recorded pause. Refresh preview and backup after any source/configuration/data drift before applying.';cfg.saveState(report,out);console.log(JSON.stringify({status:report.status,healthRestored:report.healthRestored===true,backup:report.backup||null,evidence:path.relative(cfg.root,out)}));}
 return report;
}
if(require.main===module)main().catch(()=>{console.error('OPPORTUNITY_WINDOW_FAILED_SEE_SANITIZED_REPORT');process.exitCode=1;});
module.exports={args,acceptableWork,duringPause,validGate,release,main};
