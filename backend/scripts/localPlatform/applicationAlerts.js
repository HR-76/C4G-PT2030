'use strict';
// Explicit, local-only activation of the additive application alerts.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {Pool}=require('pg'),cfg=require('./config'),{withInstallerAuthority}=require('./installerAuthority');
async function fingerprint(pool){const result=await require('./officialSources').fingerprint(pool,['opportunity_catalog','organizational_scope','organization_profile','document_storage']);delete result['"opportunity_catalog"."application_alert"'];return result}
async function main(){
 const apply=process.argv.includes('--apply');assert(process.argv.slice(2).every(v=>v==='--apply'));
 const config=cfg.readConfig(),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));require('./runtime').runtimeEnvironment(config,state);
 assert.equal(config.port,5432);assert.equal(config.centralDatabase,'c4g_central_dev');assert.equal(config.tenantDatabase,'c4g_tenant_dev');
 const pool=new Pool(cfg.connection(config,config.tenantDatabase));
 try{
  const version=(await pool.query('SELECT migration_id FROM c4g_system.schema_migration ORDER BY ordinal DESC LIMIT 1')).rows[0].migration_id;
  assert(['028_application_partners','029_application_alerts'].includes(version));
  assert.equal(require('../../src/security/tenantMigrationManifest').manifest.at(-1).version,'029_application_alerts');
  const before=await fingerprint(pool);
  if(!apply){console.log(JSON.stringify({result:'READY_FOR_LOCAL_UPGRADE',from:version,to:'029_application_alerts',records:Object.fromEntries(Object.entries(before).map(([name,v])=>[name,v.count]))}));return}
  const out=path.join(cfg.root,'output/playwright/c4g-alerts');
  assert.equal(JSON.parse(fs.readFileSync(path.join(out,'verification.json'))).result,'PASS');
  assert.equal(JSON.parse(fs.readFileSync(path.join(out,'visual-verification.json'))).result,'PASS');
  const backup=path.join(cfg.folder,'alerts-backup-'+Date.now());fs.mkdirSync(backup);
  const identity=spawnSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}),sid=identity.stdout.match(/S-1-5-[0-9-]+/)?.[0];assert(sid);
  assert.equal(spawnSync('icacls',[backup,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{windowsHide:true}).status,0);
  cfg.saveState(state,path.join(backup,'runtime-before.json'));cfg.saveState(before,path.join(backup,'data-before.json'));
  const binary='C:/Program Files/PostgreSQL/18/bin/',file=path.join(backup,config.tenantDatabase+'.dump');
  const dump=spawnSync(binary+'pg_dump.exe',['-h',config.host,'-p',String(config.port),'-U',config.user,'-Fc','-f',file,config.tenantDatabase],{env:{...process.env,PGPASSWORD:config.password},windowsHide:true});
  assert.equal(dump.status,0);assert(fs.statSync(file).size>1000);assert.equal(spawnSync(binary+'pg_restore.exe',['--list',file],{windowsHide:true}).status,0);
  await withInstallerAuthority(pool,{},async({native,demote})=>{
   await require('../../src/security/tenantMigrationRunner').createTenantMigrationRunner({pool:native,observationPublisher:{async publish(){}},timeoutMs:30000,scheduler:{setTimeout,clearTimeout}}).migrate({tenantId:state.tenantId,databaseGenerationId:state.generationId,expectedRevision:1,correlationId:state.installationId,idempotencyKey:state.installationId+'-alerts'});
   await demote();
  });
  const observation=await require('../../src/security/tenantMigrationPreflight').preflightTenant(pool,{tenantId:state.tenantId,databaseGenerationId:state.generationId},undefined,{timeoutMs:15000});
  assert.deepEqual(await fingerprint(pool),before);
  state.snapshot.schema={...state.snapshot.schema,currentVersion:observation.currentVersion,schemaFingerprint:observation.schemaFingerprint,verifiedCapabilities:Object.fromEntries(observation.capabilities.map(code=>[code,true]))};
  cfg.saveState(state);cfg.saveState({result:'PASS',tenantMigration:'029_application_alerts',existingFieldsHistoryTasksReceiptsUnchanged:true,backup:path.relative(cfg.root,backup)},path.join(out,'local-upgrade.json'));
  console.log('LOCAL_APPLICATION_ALERTS_UPGRADE_PASS');
 }finally{await pool.end()}
}
main().catch(error=>{console.error(error.code||'LOCAL_APPLICATION_ALERTS_UPGRADE_FAILED');process.exitCode=1});
