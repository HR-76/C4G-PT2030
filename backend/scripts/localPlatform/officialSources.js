'use strict';
// Explicit local schema activation. Never dispatches a collection or alternate sync.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const {Pool}=require('pg'),cfg=require('./config');
const {preflightCentral}=require('../../src/security/centralMigrationPreflight');
const version='018_official_programme_sources',approval='central-official-sources-100';
async function fingerprint(pool,schemas){
 const tables=(await pool.query("SELECT table_schema,table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema=ANY($1) AND table_name<>'c4g_schema_migration' ORDER BY table_schema,table_name",[schemas])).rows;
 const result={};for(const t of tables){const name=cfg.identifier(t.table_schema)+'.'+cfg.identifier(t.table_name);const rows=(await pool.query(`SELECT to_jsonb(t)::text row FROM ${name} t ORDER BY to_jsonb(t)::text`)).rows;result[name]={count:rows.length,digest:createHash('sha256').update(JSON.stringify(rows)).digest('hex')}}return result;
}
async function main(){
 assert(process.argv.slice(2).every(x=>x==='--apply'));const apply=process.argv.includes('--apply');
 const config=cfg.readConfig(),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));
 require('./runtime').runtimeEnvironment(config,state);assert.equal(config.centralDatabase,'c4g_central_dev');assert.equal(config.tenantDatabase,'c4g_tenant_dev');assert.equal(config.port,5432);assert.equal(state.funding?.source,'live-local');
 const pool=new Pool(cfg.connection(config,config.centralDatabase)),tenant=new Pool(cfg.connection(config,config.tenantDatabase));
 try{
  const ready=await preflightCentral(pool);assert(['017_funding_programmes',version].includes(ready.currentVersion));
  assert.equal((await pool.query("SELECT count(*)::int n FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING')")).rows[0].n,0);
  const counts=(await pool.query('SELECT (SELECT count(*)::int FROM opportunity_catalog.funding_identity) identities,(SELECT count(*)::int FROM opportunity_catalog.funding_run) runs')).rows[0];
  const retiredTables=(await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('opportunities','integration_runs','integration_sources')")).rows;assert.equal(retiredTables.length,0);
  if(!apply){console.log(JSON.stringify({status:'READY',currentVersion:ready.currentVersion,...counts,retiredCentralTables:0,importsPlanned:0}));return;}
  const proof=JSON.parse(fs.readFileSync(path.join(cfg.root,'output/interreg-poctep/disposable-verification.json')));assert.equal(proof.status,'PASS');
  const before=await fingerprint(pool,['public','opportunity_catalog']),tenantBefore=await fingerprint(tenant,['opportunity_catalog','organizational_scope','organizational_profile','application','applications']);
  const backup=path.join(cfg.folder,'official-sources-backup-'+Date.now());fs.mkdirSync(backup);
  const identity=spawnSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});const sid=identity.stdout.match(/S-1-5-[0-9-]+/)?.[0];assert(sid);
  assert.equal(spawnSync('icacls',[backup,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{windowsHide:true}).status,0);
  cfg.saveState(state,path.join(backup,'runtime-before.json'));cfg.saveState({central:before,tenant:tenantBefore},path.join(backup,'data-before.json'));
  const bin='C:/Program Files/PostgreSQL/18/bin/',file=path.join(backup,'central.dump');
  const dump=spawnSync(bin+'pg_dump.exe',['-h',config.host,'-p',String(config.port),'-U',config.user,'-Fc','-f',file,config.centralDatabase],{env:{...process.env,PGPASSWORD:config.password},windowsHide:true});
  if(dump.status!==0||fs.statSync(file).size<1000)throw Error('LOCAL_BACKUP_FAILED');
  if(spawnSync(bin+'pg_restore.exe',['--list',file],{windowsHide:true}).status!==0)throw Error('LOCAL_BACKUP_UNREADABLE');
  await require('../runCentralMigrations').applyCentralMigrations(pool);
  assert.equal((await preflightCentral(pool)).currentVersion,version);
  assert.deepEqual(await fingerprint(pool,['public','opportunity_catalog']),before);
  assert.deepEqual(await fingerprint(tenant,['opportunity_catalog','organizational_scope','organizational_profile','application','applications']),tenantBefore);
  state.funding.approval=approval;cfg.saveState(state);
  cfg.saveState({status:'PASS',observedAt:new Date().toISOString(),centralMigration:version,...counts,businessDataUnchanged:true,tenantDataUnchanged:true,retiredCentralTables:0,realImports:0,backup:path.relative(cfg.root,backup)},path.join(cfg.root,'output/interreg-poctep/local-upgrade.json'));
  console.log('LOCAL_OFFICIAL_SOURCES_UPGRADE_PASS');
 }finally{await pool.end();await tenant.end();}
}
if(require.main===module)main().catch(e=>{console.error(e.code||(/^[A-Z0-9_]+$/.test(e.message)?e.message:'LOCAL_OFFICIAL_SOURCES_UPGRADE_FAILED'));process.exitCode=1});
module.exports={fingerprint};
