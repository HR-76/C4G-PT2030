'use strict';
// Explicit, local-only activation of the additive organization notices.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const {Pool}=require('pg'),cfg=require('./config');
async function fingerprint(pool){const result=await require('./officialSources').fingerprint(pool,['opportunity_catalog','organizational_scope','organization_profile','document_storage']);delete result['"opportunity_catalog"."organization_notice"'];delete result['"opportunity_catalog"."organization_notice_recipient"'];return result}
async function identities(pool){const result={};for(const table of ['global_user','auth_identity_ref','organization','organization_membership','platform_admin_assignment']){
 const rows=(await pool.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY to_jsonb(t)::text`)).rows;
 result[table]={count:rows.length,digest:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
}return result}
async function main(){
 const apply=process.argv.includes('--apply');assert(process.argv.slice(2).every(v=>v==='--apply'));
 const config=cfg.readConfig(),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));require('./runtime').runtimeEnvironment(config,state);
 assert.equal(config.port,5432);assert.equal(config.centralDatabase,'c4g_central_dev');assert.equal(config.tenantDatabase,'c4g_tenant_dev');
 const pool=new Pool(cfg.connection(config,config.tenantDatabase));const central=new Pool(cfg.connection(config,config.centralDatabase));let elevated=false,authority;
 try{
  const version=(await pool.query('SELECT migration_id FROM c4g_system.schema_migration ORDER BY ordinal DESC LIMIT 1')).rows[0].migration_id;
  assert(['029_application_alerts','030_organization_notices'].includes(version));
  assert.equal(require('../../src/security/tenantMigrationManifest').manifest.at(-1).version,'030_organization_notices');
  const before=await fingerprint(pool);const centralBefore=await require('./officialSources').fingerprint(central,['opportunity_catalog']),identitiesBefore=await identities(central);
  const members=(await central.query(`SELECT m.id,f.policy_version,f.assurance_requirements FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id JOIN public.authority_f5_state f ON f.membership_id=m.id AND f.organization_id=m.organization_id WHERE m.organization_id=$1 AND m.status='ACTIVE' AND u.status='ACTIVE' AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()) ORDER BY m.id`,[state.organizationId])).rows;assert(members.length>0);
  if(!apply){console.log(JSON.stringify({result:'READY_FOR_LOCAL_UPGRADE',from:version,to:'030_organization_notices',records:Object.fromEntries(Object.entries(before).map(([name,v])=>[name,v.count]))}));return}
  const out=path.join(cfg.root,'output/playwright/c4g-notices');
  assert.equal(JSON.parse(fs.readFileSync(path.join(out,'verification.json'))).result,'PASS');
  assert.equal(JSON.parse(fs.readFileSync(path.join(out,'visual-verification.json'))).result,'PASS');
  const backup=path.join(cfg.folder,'notices-backup-'+Date.now());fs.mkdirSync(backup);
  const identity=spawnSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}),sid=identity.stdout.match(/S-1-5-[0-9-]+/)?.[0];assert(sid);
  assert.equal(spawnSync('icacls',[backup,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{windowsHide:true}).status,0);
  cfg.saveState(state,path.join(backup,'runtime-before.json'));cfg.saveState(before,path.join(backup,'data-before.json'));
  cfg.saveState(identitiesBefore,path.join(backup,'identity-before.json'));
  cfg.saveState((await central.query('SELECT * FROM public.authority_f5_state WHERE organization_id=$1',[state.organizationId])).rows,path.join(backup,'grants-before.json'));
  const binary='C:/Program Files/PostgreSQL/18/bin/';
  for(const db of [config.centralDatabase,config.tenantDatabase]){
   const file=path.join(backup,db+'.dump');
   const dump=spawnSync(binary+'pg_dump.exe',['-h',config.host,'-p',String(config.port),'-U',config.user,'-Fc','-f',file,db],{env:{...process.env,PGPASSWORD:config.password},windowsHide:true});
   assert.equal(dump.status,0);assert(fs.statSync(file).size>1000);assert.equal(spawnSync(binary+'pg_restore.exe',['--list',file],{windowsHide:true}).status,0);
  }
  const role=(await pool.query("SELECT rolcanlogin,rolsuper FROM pg_roles WHERE rolname='c4g_f12_admin'")).rows[0];assert.equal(role.rolcanlogin,false);assert.equal(role.rolsuper,false);
  await pool.query('ALTER ROLE c4g_f12_admin SUPERUSER');elevated=true;
  const native={async connect(){const c=await pool.connect();await c.query('SET SESSION AUTHORIZATION c4g_f12_admin');return{query:(...args)=>c.query(...args),release:error=>c.release(error||Error('INSTALLER_DISPOSED'))}}};
  await require('../../src/security/tenantMigrationRunner').createTenantMigrationRunner({pool:native,observationPublisher:{async publish(){}},timeoutMs:30000,scheduler:{setTimeout,clearTimeout}}).migrate({tenantId:state.tenantId,databaseGenerationId:state.generationId,expectedRevision:1,correlationId:state.installationId,idempotencyKey:state.installationId+'-notices'});
  await pool.query('ALTER ROLE c4g_f12_admin NOSUPERUSER NOCREATEROLE NOCREATEDB NOLOGIN');elevated=false;
  const observation=await require('../../src/security/tenantMigrationPreflight').preflightTenant(pool,{tenantId:state.tenantId,databaseGenerationId:state.generationId},undefined,{timeoutMs:15000});
  assert.deepEqual(await fingerprint(pool),before);
  state.snapshot.schema={...state.snapshot.schema,currentVersion:observation.currentVersion,schemaFingerprint:observation.schemaFingerprint,verifiedCapabilities:Object.fromEntries(observation.capabilities.map(code=>[code,true]))};
  authority=new Pool({...cfg.connection(config,config.centralDatabase),user:'c4g_authority_runtime',password:state.authorityPassword});
  const coordinator=require('../../src/security/authorityCoordinator').createAuthorityCoordinator({pool:authority,permitSecret:state.permitSecret});
  const catalogs=require('../../src/authorization/catalogs').createProductionCatalogs({catalogVersion:'f13'});let grantsAdded=0;
  for(const member of members)grantsAdded+=(await require('./noticeGrants').grantNoticeAccess({coordinator,catalogs,organizationId:state.organizationId,membershipId:member.id,policyVersion:member.policy_version,requirement:member.assurance_requirements,installationId:state.installationId})).added;
  assert.deepEqual(await require('./officialSources').fingerprint(central,['opportunity_catalog']),centralBefore);
  assert.deepEqual(await identities(central),identitiesBefore);
  cfg.saveState(state);cfg.saveState({result:'PASS',tenantMigration:'030_organization_notices',existingFieldsHistoryTasksReceiptsUnchanged:true,centralCatalogUnchanged:true,identitiesMembershipsUnchanged:true,grantsAdded,backup:path.relative(cfg.root,backup)},path.join(out,'local-upgrade.json'));
  console.log('LOCAL_ORGANIZATION_NOTICES_UPGRADE_PASS');
 }finally{if(elevated)await pool.query('ALTER ROLE c4g_f12_admin NOSUPERUSER NOCREATEROLE NOCREATEDB NOLOGIN');await authority?.end();await central.end();await pool.end()}
}
main().catch(error=>{console.error(error.code||'LOCAL_ORGANIZATION_NOTICES_UPGRADE_FAILED');process.exitCode=1});
