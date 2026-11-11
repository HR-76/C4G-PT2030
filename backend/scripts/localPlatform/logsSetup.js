'use strict';
// Explicit local activation; startup never migrates the database.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{spawnSync}=require('node:child_process'),{Pool}=require('pg');
const cfg=require('./config'),{fingerprint}=require('./officialSources');
async function main(){
 assert.deepEqual(process.argv.slice(2),['--apply']);
 const config=cfg.readConfig(),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));
 assert.equal(config.centralDatabase,'c4g_central_dev');assert.equal(config.tenantDatabase,'c4g_tenant_dev');assert.equal(config.port,5432);
 const out=path.join(cfg.root,'output/playwright/c4g-logs');assert.equal(JSON.parse(fs.readFileSync(path.join(out,'service-verification.json'))).result,'PASS');
 const folder=path.join(cfg.folder,'logs');fs.mkdirSync(folder,{recursive:true});
 const sid=spawnSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}).stdout.match(/S-1-5-[0-9-]+/)?.[0];assert(sid);
 assert.equal(spawnSync('icacls',[folder,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{windowsHide:true,stdio:'pipe'}).status,0);
 const central=new Pool(cfg.connection(config,config.centralDatabase)),tenant=new Pool(cfg.connection(config,config.tenantDatabase));
 try{
  const ready=await require('../../src/security/centralMigrationPreflight').preflightCentral(central);assert.equal(ready.currentVersion,'025_entity_admission_completion');
  assert.equal((await central.query("SELECT count(*)::int n FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING')")).rows[0].n,0);
  const centralSchemas=['public','audit','async_exec','opportunity_catalog'],tenantSchemas=['public','opportunity_catalog','organizational_scope','organization_profile','document_storage'];
  const before={central:await fingerprint(central,centralSchemas),tenant:await fingerprint(tenant,tenantSchemas)};
  const backup=path.join(folder,'backup-'+Date.now());fs.mkdirSync(backup);cfg.saveState(state,path.join(backup,'runtime.json'));cfg.saveState(before,path.join(backup,'fingerprints.json'));
  const bin='C:/Program Files/PostgreSQL/18/bin/',env={...process.env,PGPASSWORD:config.password};
  const run=(exe,args)=>{const r=spawnSync(bin+exe,args,{env,windowsHide:true,stdio:'pipe'});if(r.status!==0)throw Error('LOGS_BACKUP_FAILED')};
  for(const [database,name,schemas] of [[config.centralDatabase,'central',centralSchemas],[config.tenantDatabase,'tenant',tenantSchemas]]){
   const dump=path.join(backup,name+'.dump');run('pg_dump.exe',['-h',config.host,'-p',String(config.port),'-U',config.user,'-Fc','-f',dump,database]);assert(fs.statSync(dump).size>1000);
   const restore='c4g_logs_restore_'+randomUUID().replaceAll('-','');await central.query(`CREATE DATABASE ${cfg.identifier(restore)} TEMPLATE template0`);let restored;
   try{await central.query(`REVOKE CONNECT ON DATABASE ${cfg.identifier(restore)} FROM PUBLIC`);run('pg_restore.exe',['--exit-on-error','-h',config.host,'-p',String(config.port),'-U',config.user,'-d',restore,dump]);restored=new Pool(cfg.connection(config,restore));assert.deepEqual(await fingerprint(restored,schemas),before[name]);}
   finally{await restored?.end();await central.query(`DROP DATABASE ${cfg.identifier(restore)}`)}
  }
  console.log('LOGS_BACKUP_RESTORE_PASS');
  await require('../runCentralMigrations').applyCentralMigrations(central);assert.equal((await require('../../src/security/centralMigrationPreflight').preflightCentral(central)).currentVersion,'026_platform_logs');
  const after=await fingerprint(central,centralSchemas);delete after['"public"."platform_support_event"'];assert.deepEqual(after,before.central);assert.deepEqual(await fingerprint(tenant,tenantSchemas),before.tenant);
  state.platformLogs=true;cfg.saveState(state);
  cfg.saveState({result:'PASS',backup:path.relative(cfg.root,backup),backupRestored:true,centralMigration:'026_platform_logs',existingDataPreserved:true,observedAt:new Date().toISOString()},path.join(out,'local-upgrade.json'));console.log('LOGS_LOCAL_SETUP_PASS');
 }finally{await central.end();await tenant.end()}
}
if(require.main===module)main().catch(e=>{console.error(e.code||'LOGS_SETUP_FAILED');process.exitCode=1});
module.exports={main};
