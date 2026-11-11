'use strict';
// Explicit local installation window. Factual collection/approval is a separate
// authenticated browser step; this module cannot manufacture a session or plan.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
const {Pool}=require('../backend/node_modules/pg');
const cfg=require('../backend/scripts/localPlatform/config'),{target}=require('../backend/scripts/localPlatform/prepareOpportunityInterests');
const preview=require('../backend/scripts/localPlatform/prepareOpportunityV2Window');
const backup=require('../backend/scripts/localPlatform/backupOpportunityV2');
const prior=require('./opportunity-v2-window.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const q=value=>'"'+value.replaceAll('"','""')+'"';
const CONFIG_FILES=['.tmp/local-platform/runtime.json','.tmp/local-platform/members/worker.json'];
function args(argv){assert.deepEqual(argv,['--execute-window'],'HABITUAL_WINDOW_EXPLICIT_MODE_REQUIRED');}
function validateInstallerProof(gate,packageDigest){
 assert.equal(gate.gateType,'OPPORTUNITY_V2_HABITUAL_INSTALLER');assert.equal(gate.status,'PASS');assert.equal(gate.isolated,true);assert.equal(gate.cleanup,true);assert.equal(gate.habitualEnvironmentAccess,false);assert.equal(gate.packageDigest,packageDigest);
 assert(gate.checks?.length&&gate.checks.every(c=>c.name&&c.status==='PASS'));
 for(const file of ['scripts/opportunity-v2-install.cjs','scripts/opportunity-v2-execute-window.cjs','scripts/opportunity-v2-approve.cjs','backend/scripts/localPlatform/runtime.js','backend/scripts/localPlatform/opportunityV2Runtime.js'])assert.match(gate.inputHashes?.[file]||'',/^[a-f0-9]{64}$/);
 for(const [file,digest]of Object.entries(gate.inputHashes)){assert(!path.isAbsolute(file)&&!file.split(/[\\/]/).some(p=>!p||p==='..'));assert.match(digest,/^[a-f0-9]{64}$/);}
 return gate;
}
async function installationPause({pause,perform,resume,hold}){
 let safeToResume=true;
 try{await pause();return await perform({installing(){safeToResume=false;},ready(){safeToResume=true;}});}
 finally{if(safeToResume)await resume();else await hold();}
}
function applyConfiguration(items,{read=file=>fs.readFileSync(path.join(cfg.root,file),'utf8'),save=(file,value)=>cfg.saveState(value,path.join(cfg.root,file))}={}){
 assert.deepEqual(items.map(x=>x.relative).sort(),[...CONFIG_FILES].sort());
 for(const item of items)assert.equal(read(item.relative),item.before,'HABITUAL_CONFIGURATION_DRIFT');
 for(const item of items)save(item.relative,item.value);
}
function assertBackupBoundary(expected,actual){assert.equal(actual.externalSessions,0,'HABITUAL_UNKNOWN_DATABASE_SESSIONS');assert.deepEqual(actual,expected,'HABITUAL_BACKUP_DRIFT');}
async function verifyBackupBoundary({central,tenant,restored,windowId,stopReceipt,applicationName}){
 await backup.provePausedWindow({windowId,packageDigest:restored.packageDigest,stopReceipt});
 const clients=[];
 try{
  clients.push(await acquire(central));clients.push(await acquire(tenant));
  const snapshots={};for(const [name,client]of [['central',clients[0]],['tenant',clients[1]]])snapshots[name]=hash(JSON.stringify(await backup.snapshot(client)));
  const configuration=Object.fromEntries(Object.keys(restored.configuration).map(file=>{assert(!path.isAbsolute(file)&&!file.split(/[\\/]/).includes('..'));return [file,hash(fs.readFileSync(path.join(cfg.root,file)))];}));
  const externalSessions=(await clients[0].query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname=ANY($1::text[]) AND application_name<>$2',[[restored.databases.central.database,restored.databases.tenant.database],applicationName])).rows[0].n;
  const expected={central:restored.databases.central.contentSha256,tenant:restored.databases.tenant.contentSha256,configuration:Object.fromEntries(Object.entries(restored.configuration).map(([file,value])=>[file,value.sha256])),externalSessions:0};
  assertBackupBoundary(expected,{...snapshots,configuration,externalSessions});
  await backup.provePausedWindow({windowId,packageDigest:restored.packageDigest,stopReceipt});
  return {status:'PASS',at:new Date().toISOString(),dataAndSequencesMatch:true,configurationMatches:true,externalSessions:0,processesStopped:true};
 }finally{await prior.release(clients);}
}
function command(action,extra=[]){const r=spawnSync('powershell',['-NoProfile','-File',path.join(__dirname,'interest-maintenance-processes.ps1'),'-Action',action,...extra],{encoding:'utf8',windowsHide:true,timeout:20000});if(r.status!==0)throw Error('HABITUAL_PROCESS_'+action.toUpperCase()+'_FAILED');return JSON.parse(r.stdout);}
async function health(){try{const r=await fetch('http://localhost:3000/api/local-health',{signal:AbortSignal.timeout(3000)}),b=await r.json();return r.status===200&&b.ready===true&&b.environment==='C4G local'&&b.workerReady===true&&b.admissionReady===true;}catch{return false;}}
async function acquire(pool){const client=await pool.connect();try{await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='2500ms'");await client.query("SET LOCAL statement_timeout='5000ms'");const rows=(await client.query("SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY 1,2")).rows;assert(rows.length);await client.query('LOCK TABLE '+rows.map(r=>q(r.nspname)+'.'+q(r.relname)).join(',')+' IN SHARE MODE');return client;}catch(e){await client.query('ROLLBACK').catch(()=>{});client.release();throw e;}}
async function main(argv=process.argv.slice(2)){
 args(argv);const config=cfg.readConfig(),inputs=CONFIG_FILES.map(relative=>({relative,before:fs.readFileSync(path.join(cfg.root,relative),'utf8')}));const state=JSON.parse(inputs[0].before);target(config,state);assert.equal(state.opportunityActivation,undefined,'HABITUAL_ALREADY_CONFIGURED');
 const pkg=require('../backend/src/security/opportunityV2MigrationPackage');
 const installerProof=validateInstallerProof(JSON.parse(fs.readFileSync(path.join(cfg.root,'output/opportunity-v2-habitual/installation-proof.json'),'utf8')),pkg.packageDigest);
 const registered=JSON.parse(fs.readFileSync(path.join(cfg.root,'output/opportunity-v2-window/registered-package-proof.json'),'utf8'));prior.validGate(registered);assert.equal(registered.packageDigest,pkg.packageDigest);
 for(const gate of [installerProof,registered])for(const [file,digest]of Object.entries(gate.inputHashes))assert.equal(hash(fs.readFileSync(path.join(cfg.root,file))),digest,'HABITUAL_INPUT_DRIFT');
 const manifest=JSON.parse(fs.readFileSync(path.join(cfg.root,'context/references/opportunity-v2/manifest.json'),'utf8'));for(const file of manifest.artifacts)assert.equal(hash(fs.readFileSync(path.join(cfg.root,'context/references/opportunity-v2',file.path))),file.sha256,'HABITUAL_NORMATIVE_DRIFT');
 for(const file of ['C:/Users/Utilizador/Desktop/PlanoAnualAvisos_download_140926-1.xlsx',path.join(cfg.root,'backend/test/fixtures/portugal2030/PlanoAnualAvisos_download_140926-1.xlsx')])assert.equal(hash(fs.readFileSync(file)),manifest.sourceWorkbook.sha256,'HABITUAL_WORKBOOK_DRIFT');
 assert(await health(),'HABITUAL_HEALTH_REQUIRED');
 const observed=command('Inspect'),observation=await preview.observeOfficial(),stored=preview.storeObservation(observation);
 assert.equal(stored.summary.normativeComparison.sameIdentity,true,'HABITUAL_SOURCE_IDENTITY_CHANGED');assert.equal(stored.summary.normativeComparison.changed,false,'HABITUAL_SOURCE_REVIEW_REQUIRED');
 const windowId=randomUUID(),outputDirectory=path.join(cfg.root,'output/opportunity-v2-habitual-'+windowId);fs.mkdirSync(outputDirectory);const file=path.join(outputDirectory,'window.json');
 const report={kind:'opportunity11145habitualwindow-v1',windowId,packageDigest:pkg.packageDigest,result:'IN_PROGRESS',startedAt:new Date().toISOString(),source:{source:'EU_FUNDING_TENDERS',externalIdentifier:'CASCADE:11145',contentDigest:stored.summary.normativeComparison.incomingDigest,mappingDigest:stored.summary.mappingDigest},sourceObservation:observation.metadata,sourceObservationFile:path.relative(cfg.root,path.join(stored.folder,'official-observation.json')).replaceAll('\\','/'),supervisorBefore:observed,acceptanceApplied:false};
 const save=()=>cfg.saveState(report,file);save();
 const options='-c timezone=UTC -c statement_timeout=30000 -c lock_timeout=3000';
 const pools={central:new Pool({...cfg.connection(config,config.centralDatabase),max:1,options}),tenant:new Pool({...cfg.connection(config,config.tenantDatabase),max:1,options})};let stopped=false;
 try{
  await installationPause({pause:async()=>{
   const deadline=Date.now()+120000;while(Date.now()<deadline){const clients=[];let quiet=false;try{
    clients.push(await acquire(pools.central));clients.push(await acquire(pools.tenant));const work={central:await backup.pendingWork(clients[0],'central'),tenant:await backup.pendingWork(clients[1],'tenant')};report.workBefore=work;
    if(prior.acceptableWork(work)){stopped=true;report.stop=command('Stop',['-ExpectedId',String(observed.id),'-ExpectedCreated',observed.created]);report.pausedAt=new Date().toISOString();quiet=true;save();}
   }catch(e){if(stopped||!['55P03','57014'].includes(e.code))throw e;}finally{await prior.release(clients);}if(quiet)return;await sleep(1500);}throw Error('HABITUAL_NO_SAFE_IDLE_PERIOD');
  },perform:async lifecycle=>{
   await Promise.all(Object.values(pools).map(p=>p.end()));const probe=new Pool({...cfg.connection(config,config.centralDatabase),max:1,options:'-c default_transaction_read_only=on'});
   try{let sessions;for(let n=0;n<20;n++){sessions=(await probe.query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname=ANY($1::text[]) AND pid<>pg_backend_pid()',[[config.centralDatabase,config.tenantDatabase]])).rows[0].n;if(!sessions)break;await sleep(250);}assert.equal(sessions,0,'HABITUAL_UNKNOWN_DATABASE_SESSIONS');}finally{await probe.end();}
   report.noExternalSessions=true;const before=await preview.readHabitualPreview(stored),item=before.report.central.value.preview.items[0];assert.equal(item.action,'CHANGE_REQUIRES_APPROVAL','HABITUAL_RECONCILIATION_REVIEW_REQUIRED');assert.equal(before.report.central.value.protectedState.corrections,0);assert.equal(before.report.central.value.protectedState.resolutions,0);
   report.preview=path.relative(cfg.root,before.file).replaceAll('\\','/');report.previewDigest=hash(fs.readFileSync(before.file));report.expected=before.report.central.value.expected;report.acceptedBinding={snapshotDigest:item.accepted.snapshotDigest,protectedStateDigest:item.accepted.protectedStateDigest};save();
   const pauseProof=await backup.provePausedWindow({windowId,packageDigest:pkg.packageDigest,stopReceipt:report.stop}),restored=await backup.main(['--backup-and-restore'],{pauseProof});
   assert.equal(restored.status,'PASS');assert.equal(restored.cleanup,true);assert.equal(restored.noSourceDrift,true);assert(Object.values(restored.databases).every(x=>x.sourceStillMatches&&x.dataMatches&&x.preflight));
   report.backup={backupId:path.basename(restored.backup),result:'PASS',noSourceDrift:true,completedAt:restored.completedAt};save();
   for(const input of inputs)assert.equal(fs.readFileSync(path.join(cfg.root,input.relative),'utf8'),input.before,'HABITUAL_CONFIGURATION_DRIFT');
   lifecycle.installing();report.installationStartedAt=new Date().toISOString();save();
   const applicationName='opportunity11145-install-'+windowId;
   const central=new Pool({...cfg.connection(config,config.centralDatabase),options,application_name:applicationName}),tenant=new Pool({...cfg.connection(config,config.tenantDatabase),options,application_name:applicationName});
   try{
    report.backupBoundary=await verifyBackupBoundary({central,tenant,restored,windowId,stopReceipt:report.stop,applicationName});save();
    const result=await require('./opportunity-v2-install.cjs').install({central,tenant,state,stateFiles:inputs.slice(1).map(x=>({relative:x.relative,value:JSON.parse(x.before)})),checkpoint:value=>{report.installationCheckpoint=value;save();}});
    applyConfiguration([{...inputs[0],value:result.state},...inputs.slice(1).map(x=>({...x,value:result.stateFiles.find(v=>v.relative===x.relative).value}))]);
    const updated=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json'),'utf8'));require('../backend/scripts/localPlatform/runtime').runtimeEnvironment(config,updated);
    assert.equal(result.report.status,'PASS');assert.equal(result.report.after.centralVersion,pkg.centralEntries.at(-1).version);assert.equal(result.report.after.tenantVersion,pkg.tenantAddition.version);
    report.installation=result.report;report.installed={centralVersion:result.report.after.centralVersion,tenantVersion:result.report.after.tenantVersion};report.configurationChanged=true;report.installationCompletedAt=new Date().toISOString();save();lifecycle.ready();
   }catch(error){if(error.report)report.installation=error.report;throw error;}finally{await Promise.allSettled([central.end(),tenant.end()]);}
  },resume:async()=>{
   if(!stopped)return;let existing;try{existing=command('Inspect');}catch{}
   report.supervisorAfter=existing||command('Start',['-LogPrefix',path.join(cfg.folder,'opportunity11145-'+windowId)]);save();
   for(let n=0;n<60;n++){if(await health()){report.resume={health:true,at:new Date().toISOString()};save();return;}await sleep(1000);}throw Error('HABITUAL_HEALTH_NOT_RESTORED');
  },hold:()=>{report.consumersHeldForReconciliation=true;save();}});
  report.result='PASS';
 }catch(error){report.result='FAIL';report.failure=/^[A-Z0-9_]+$/.test(error.message||'')?error.message:'HABITUAL_WINDOW_FAILED';throw error;}
 finally{await Promise.allSettled(Object.values(pools).map(p=>p.ended?Promise.resolve():p.end()));report.completedAt=new Date().toISOString();save();console.log(JSON.stringify({result:report.result,evidence:path.relative(cfg.root,file).replaceAll('\\','/'),health:report.resume?.health===true,held:report.consumersHeldForReconciliation===true}));}
 return report;
}
if(require.main===module)main().catch(()=>{console.error('HABITUAL_WINDOW_FAILED_SEE_REPORT');process.exitCode=1;});
module.exports={args,installationPause,validateInstallerProof,applyConfiguration,assertBackupBoundary,verifyBackupBoundary,main};
