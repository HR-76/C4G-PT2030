'use strict';
// Explicit native upgrade. No startup migration or automatic collection.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const {Pool}=require('pg'),cfg=require('./config');
const {preflightCentral}=require('../../src/security/centralMigrationPreflight');
async function fingerprint(pool){
 const tables=(await pool.query("SELECT table_schema,table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema IN ('public','opportunity_catalog') AND table_name<>'c4g_schema_migration' ORDER BY table_schema,table_name")).rows;
 const result={};for(const t of tables){const table=`"${t.table_schema}"."${t.table_name}"`;const rows=(await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;result[table]={count:rows.length,digest:createHash('sha256').update(JSON.stringify(rows)).digest('hex')}}return result;
}
async function main(){
 assert(process.argv.slice(2).every(x=>x==='--apply'));const apply=process.argv.includes('--apply');
 const config=cfg.readConfig(),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));
 require('./runtime').runtimeEnvironment(config,state);assert.equal(state.funding?.source,'live-local');
 const pool=new Pool(cfg.connection(config,config.centralDatabase));
 try {
  const ready=await preflightCentral(pool);assert(['016_membership_access','017_funding_programmes'].includes(ready.currentVersion));
  assert.equal((await pool.query("SELECT count(*)::int n FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING')")).rows[0].n,0);
  if(!apply){console.log(JSON.stringify({status:'READY',currentVersion:ready.currentVersion,results:100,pages:4,selections:['EU_FUNDING_TENDERS','CORDIS','ERASMUS']}));return}
  const proof=JSON.parse(fs.readFileSync(path.join(cfg.root,'output/funding-programmes/disposable-verification.json')));assert.equal(proof.status,'PASS');
  const before=await fingerprint(pool),backup=path.join(cfg.folder,'funding-programmes-backup-'+Date.now());fs.mkdirSync(backup);
  const identity=spawnSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});const sid=identity.stdout.match(/S-1-5-[0-9-]+/)?.[0];assert(sid);
  assert.equal(spawnSync('icacls',[backup,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{windowsHide:true}).status,0);
  cfg.saveState(state,path.join(backup,'runtime-before.json'));cfg.saveState(before,path.join(backup,'data-before.json'));
  const binary='C:/Program Files/PostgreSQL/18/bin/',file=path.join(backup,'central.dump');
  const dump=spawnSync(binary+'pg_dump.exe',['-h',config.host,'-p',String(config.port),'-U',config.user,'-Fc','-f',file,config.centralDatabase],{env:{...process.env,PGPASSWORD:config.password},windowsHide:true});
  if(dump.status!==0||fs.statSync(file).size<1000)throw Error('LOCAL_BACKUP_FAILED');
  if(spawnSync(binary+'pg_restore.exe',['--list',file],{windowsHide:true}).status!==0)throw Error('LOCAL_BACKUP_UNREADABLE');
  await require('../runCentralMigrations').applyCentralMigrations(pool);
  assert.equal((await preflightCentral(pool)).currentVersion,'017_funding_programmes');assert.deepEqual(await fingerprint(pool),before);
  state.funding.approval='central-programmes-100';cfg.saveState(state);
  cfg.saveState({result:'PASS',centralMigration:'017_funding_programmes',businessDataUnchanged:true,backup:path.relative(cfg.root,backup)},path.join(cfg.root,'output/funding-programmes/local-upgrade.json'));
  console.log('LOCAL_FUNDING_PROGRAMMES_UPGRADE_PASS');
 }finally{await pool.end()}
}
main().catch(e=>{console.error(e.code||(/^[A-Z0-9_]+$/.test(e.message)?e.message:'LOCAL_FUNDING_PROGRAMMES_UPGRADE_FAILED'));process.exitCode=1});
