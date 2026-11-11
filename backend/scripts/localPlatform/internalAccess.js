'use strict';
// Explicit local upgrade. Does not assign profiles or change grants/accounts.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const {Pool}=require('pg'),cfg=require('./config'),{fingerprint}=require('./officialSources');
const {preflightCentral}=require('../../src/security/centralMigrationPreflight');
async function authorityFingerprint(pool){const result={};for(const table of ['global_user','organization','organization_membership','authority_f5_state']){
 const rows=(await pool.query(`SELECT to_jsonb(t)::text row FROM public.${table} t ORDER BY to_jsonb(t)::text`)).rows;result[table]={count:rows.length,digest:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}return result;}
async function main(){
 assert(process.argv.slice(2).every(a=>a==='--apply'));const apply=process.argv.includes('--apply'),version='019_internal_access_profiles';
 const config=cfg.readConfig(),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));
 assert.equal(config.centralDatabase,'c4g_central_dev');assert.equal(config.tenantDatabase,'c4g_tenant_dev');assert.equal(config.port,5432);
 const central=new Pool(cfg.connection(config,config.centralDatabase)),tenant=new Pool(cfg.connection(config,config.tenantDatabase));
 try{
  const ready=await preflightCentral(central);assert(['018_official_programme_sources',version].includes(ready.currentVersion));
  assert.equal((await central.query("SELECT count(*)::int n FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING')")).rows[0].n,0);
  if(!apply){console.log(JSON.stringify({status:'READY',currentVersion:ready.currentVersion,profileChanges:0,pendingImports:0}));return;}
  const out=path.join(cfg.root,'output/playwright/c4g-internal-access');
  for(const file of ['http-verification.json','browser-verification.json','migration.json'])assert.equal(JSON.parse(fs.readFileSync(path.join(out,file))).result,'PASS');
  const schemas=['opportunity_catalog','organizational_scope','organization_profile','document_storage'];
  const before={authority:await authorityFingerprint(central),catalog:await fingerprint(central,['opportunity_catalog']),tenant:await fingerprint(tenant,schemas)};
  const backup=path.join(cfg.folder,'internal-access-backup-'+Date.now());fs.mkdirSync(backup);
  const identity=spawnSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});const sid=identity.stdout.match(/S-1-5-[0-9-]+/)?.[0];assert(sid);
  assert.equal(spawnSync('icacls',[backup,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{windowsHide:true}).status,0);
  cfg.saveState(before,path.join(backup,'data-before.json'));
  const bin='C:/Program Files/PostgreSQL/18/bin/',dumpFile=path.join(backup,'central.dump');
  const dump=spawnSync(bin+'pg_dump.exe',['-h',config.host,'-p',String(config.port),'-U',config.user,'-Fc','-f',dumpFile,config.centralDatabase],{env:{...process.env,PGPASSWORD:config.password},windowsHide:true});
  if(dump.status!==0||fs.statSync(dumpFile).size<1000)throw Error('LOCAL_BACKUP_FAILED');
  if(spawnSync(bin+'pg_restore.exe',['--list',dumpFile],{windowsHide:true}).status!==0)throw Error('LOCAL_BACKUP_UNREADABLE');
  await require('../runCentralMigrations').applyCentralMigrations(central);assert.equal((await preflightCentral(central)).currentVersion,version);
  assert.deepEqual({authority:await authorityFingerprint(central),catalog:await fingerprint(central,['opportunity_catalog']),tenant:await fingerprint(tenant,schemas)},before);
  cfg.saveState({result:'PASS',observedAt:new Date().toISOString(),centralMigration:version,backup:path.relative(cfg.root,backup),membershipsAndGrantsUnchanged:true,catalogUnchanged:true,tenantDataUnchanged:true},path.join(out,'local-upgrade.json'));
  console.log('INTERNAL_ACCESS_LOCAL_UPGRADE_PASS');
 }finally{await central.end();await tenant.end()}
}
if(require.main===module)main().catch(e=>{console.error(e.code||(/^[A-Z0-9_]+$/.test(e.message)?e.message:'INTERNAL_ACCESS_LOCAL_UPGRADE_FAILED'));process.exitCode=1});
module.exports={authorityFingerprint};
