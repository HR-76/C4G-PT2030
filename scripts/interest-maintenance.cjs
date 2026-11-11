'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {randomUUID,createHash}=require('node:crypto');
const {Pool}=require('../backend/node_modules/pg');
const cfg=require('../backend/scripts/localPlatform/config');
const {target,main:prepare}=require('../backend/scripts/localPlatform/prepareOpportunityInterests');
const {main:backup}=require('../backend/scripts/localPlatform/backupOpportunityInterests');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const q=value=>'"'+value.replaceAll('"','""')+'"';
function args(argv){assert.equal(argv.length,1);assert(['--renew-backups','--activate-interests'].includes(argv[0]));}
function command(action,extra=[]){
 const result=spawnSync('powershell',['-NoProfile','-File',path.join(__dirname,'interest-maintenance-processes.ps1'),'-Action',action,...extra],{encoding:'utf8',windowsHide:true,timeout:20000});
 if(result.status!==0)throw Error('MAINTENANCE_PROCESS_'+action.toUpperCase()+'_FAILED');
 return JSON.parse(result.stdout);
}
function acceptableWork(counts){return counts&&Object.keys(counts).length===4&&['funding','execution','inbox','outbox'].every(key=>Number.isSafeInteger(counts[key])&&counts[key]===0);}
async function work(client){return (await client.query(`SELECT
 (SELECT count(*)::int FROM opportunity_catalog.funding_run WHERE status='RUNNING') funding,
 (SELECT count(*)::int FROM async_exec.execution WHERE state IN ('RUNNING','CLAIMED')) execution,
 (SELECT count(*)::int FROM async_exec.inbox WHERE state='PROCESSING') inbox,
 (SELECT count(*)::int FROM async_exec.outbox WHERE state='CLAIMED') outbox`)).rows[0];}
async function acquire(pool){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='2500ms'");
  await client.query("SET LOCAL statement_timeout='5000ms'");
  const tables=(await client.query(`SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY 1,2`)).rows;
  await client.query('LOCK TABLE '+tables.map(t=>q(t.nspname)+'.'+q(t.relname)).join(',')+' IN SHARE MODE');
  return client;
 }catch(e){await client.query('ROLLBACK').catch(()=>{});client.release();throw e;}
}
async function release(clients){for(const client of clients){await client.query('ROLLBACK');client.release();}}
async function health(){try{const r=await fetch('http://localhost:3000/api/local-health',{signal:AbortSignal.timeout(3000)}),b=await r.json();return r.status===200&&b.ready===true&&b.environment==='C4G local'&&b.workerReady===true&&b.admissionReady===true;}catch{return false;}}
// Always restore normal service, including when backup or validation fails.
async function duringPause({pause,perform,resume}){let attempted=false;try{attempted=true;await pause();return await perform();}finally{if(attempted)await resume();}}
async function main(argv=process.argv.slice(2)){
 args(argv);const config=cfg.readConfig(),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));target(config,state);
 const authorizedPlan=argv[0]==='--activate-interests'?JSON.parse(fs.readFileSync(path.join(cfg.folder,'opportunity-interest-activation-plan.json'))):null;
 if(authorizedPlan){const proof=JSON.parse(fs.readFileSync(path.join(cfg.root,'output/organizational-opportunity-interest/activation-rehearsal.json')));assert.equal(proof.status,'PASS');assert.equal(proof.cleanup,true);assert.equal(proof.result.permissionsAdded,3);}
 assert(await health(),'HABITUAL_HEALTH_REQUIRED');
 const observed=command('Inspect'),id=randomUUID(),logPrefix=path.join(cfg.folder,'interest-window-'+id);
 const report={status:'IN_PROGRESS',startedAt:new Date().toISOString(),supervisorBefore:observed,activationApplied:false};
 const out=path.join(cfg.root,'output/organizational-opportunity-interest/window-'+id+'.json');
 const pools={central:new Pool({...cfg.connection(config,config.centralDatabase),max:2}),tenant:new Pool({...cfg.connection(config,config.tenantDatabase),max:1})};
 let stopped=false,safeToResume=true;
 try{
  await duringPause({
   pause:async()=>{
    const deadline=Date.now()+120000;
    while(Date.now()<deadline){
     const locked=[];let quiet=false;
     try{
      locked.push(await acquire(pools.central));locked.push(await acquire(pools.tenant));
      const counts=await work(locked[0]);report.workBefore=counts;
      if(acceptableWork(counts)){
       // Set this before dispatch so recovery also runs after a partial stop.
       stopped=true;
       report.stop=command('Stop',['-ExpectedId',String(observed.id),'-ExpectedCreated',observed.created]);
       report.pausedAt=new Date().toISOString();quiet=true;
      }
     }catch(e){if(stopped||!['55P03','57014'].includes(e.code))throw e;}
     finally{await release(locked);}
     if(quiet)return;
     await sleep(1500);
    }
    throw Error('NO_SAFE_IDLE_WINDOW');
   },
   perform:async()=>{
    // Do not kill unknown sessions. Wait only for the stopped tree to disconnect.
    for(let i=0;i<20;i++){
     const connections=(await pools.central.query(`SELECT count(*)::int n FROM pg_stat_activity WHERE datname=ANY($1::text[])
      AND pid<>pg_backend_pid() AND application_name<>$2`,[[config.centralDatabase,config.tenantDatabase],'interest-window'])).rows[0].n;
     // Close our lock pools before requiring zero external sessions below.
     if(connections<=1)break;await sleep(250);
    }
    await Promise.all(Object.values(pools).map(p=>p.end()));
    const probe=new Pool({...cfg.connection(config,config.centralDatabase),max:1,options:'-c default_transaction_read_only=on'});
    try{assert.equal((await probe.query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname=ANY($1::text[]) AND pid<>pg_backend_pid()',[[config.centralDatabase,config.tenantDatabase]])).rows[0].n,0,'UNKNOWN_DATABASE_SESSIONS');}finally{await probe.end();}
    report.noExternalSessions=true;
    const plan=await prepare(['--prepare']);assert.equal(plan.tenant.preflight.passed,true);
    if(authorizedPlan){assert.deepEqual(plan.authority,authorizedPlan.authority,'ACTIVATION_AUTHORITY_DRIFT');assert.equal(plan.runtime.stateDigest,createHash('sha256').update(JSON.stringify(state)).digest('hex'),'ACTIVATION_CONFIG_DRIFT');assert.equal(plan.tenant.version,'030_organization_notices');}
    report.planDigest=createHash('sha256').update(JSON.stringify(plan)).digest('hex');
    const result=await backup(['--backup-and-restore']);
    assert.equal(result.status,'PASS');assert.equal(result.activationRequiresFreshBackup,false,'SOURCE_CHANGED_DURING_WINDOW');
    assert(Object.values(result.databases).every(item=>item.sourceStillMatches));
    report.backup=result.backup;report.backupVerified=true;report.noDataDrift=true;report.backupCompletedAt=result.completedAt;
    if(argv[0]==='--activate-interests'){
     // Do not restart consumers on a partially committed cross-database activation.
     safeToResume=false;report.activationStarted=true;cfg.saveState(report,out);
     const tenant=new Pool(cfg.connection(config,config.tenantDatabase)),central=new Pool(cfg.connection(config,config.centralDatabase));
     const authority=new Pool({...cfg.connection(config,config.centralDatabase),user:'c4g_authority_runtime',password:state.authorityPassword});
     try{
      report.activation=await require('./interest-activation.cjs').activate({tenant,central,authority,state,plan,
       stateFiles:['runtime.json','members/worker.json'].map(file=>path.join(cfg.folder,file)),
       checkpoint:stage=>{report.activationStage=stage;cfg.saveState(report,out);}});
      report.activationApplied=true;safeToResume=true;cfg.saveState(report,out);
     }finally{await Promise.all([tenant.end(),central.end(),authority.end()]);}
    }
   },
   resume:async()=>{
    if(!stopped)return;
    if(!safeToResume){report.consumersHeldForReconciliation=true;return;}
    // If stop failed before removing the supervisor, inspect may still succeed.
    let existing;try{existing=command('Inspect');}catch{}
    if(!existing)report.supervisorAfter=command('Start',['-LogPrefix',logPrefix]);else report.supervisorAfter=existing;
    for(let i=0;i<60;i++){if(await health()){report.healthRestored=true;report.resumedAt=new Date().toISOString();return;}await sleep(1000);}
    throw Error('HABITUAL_HEALTH_NOT_RESTORED');
   }
  });
  report.status='PASS';
 }catch(e){report.status='FAIL';report.failure=/^[A-Z0-9_]+$/.test(e.message||'')?e.message:'MAINTENANCE_WINDOW_FAILED';throw e;}
 finally{
  await Promise.allSettled(Object.values(pools).map(p=>p.ended?Promise.resolve():p.end()));
  report.completedAt=new Date().toISOString();report.validity='Consistent during the recorded pause; revalidate after service resumption before activation.';
  cfg.saveState(report,out);console.log(JSON.stringify({status:report.status,evidence:path.relative(cfg.root,out),backup:report.backup,healthRestored:report.healthRestored}));
 }
 return report;
}
if(require.main===module)main().catch(()=>{console.error('MAINTENANCE_WINDOW_FAILED_SEE_REPORT');process.exitCode=1;});
module.exports={args,acceptableWork,duringPause};
