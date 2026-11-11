'use strict';
// One-off organization directory/profile upgrade retained for local recovery.
// Explicit local upgrade only. Never called by application startup.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const {Pool}=require('pg'),{withInstallerAuthority,nativePool}=require('./installerAuthority');
const cfg=require('./config');
async function fingerprint(pool,tables){const result={};for(const table of tables){const rows=(await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;result[table]={count:rows.length,digest:createHash('sha256').update(JSON.stringify(rows)).digest('hex')}}return result}
async function main(){
 const apply=process.argv.includes('--apply');assert(process.argv.slice(2).every(a=>a==='--apply'));
 const config=cfg.readConfig(),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));
 assert.equal(config.port,5432);assert.equal(config.centralDatabase,'c4g_central_dev');assert.equal(config.tenantDatabase,'c4g_tenant_dev');
 require('./runtime').runtimeEnvironment(config,state);
 const central=new Pool(cfg.connection(config,config.centralDatabase)),tenant=new Pool(cfg.connection(config,config.tenantDatabase));let authority;
 try{
  const before={central:await fingerprint(central,['public.global_user','public.organization','public.organization_membership','opportunity_catalog.opportunity','opportunity_catalog.revision','opportunity_catalog.funding_run']),tenant:await fingerprint(tenant,['organizational_scope.scope','organizational_scope.person','organizational_scope.person_unit','organizational_scope.organization_card','opportunity_catalog.application'])};
  const versions={central:(await central.query('SELECT version FROM public.c4g_schema_migration ORDER BY version DESC LIMIT 1')).rows[0],tenant:(await tenant.query('SELECT migration_id FROM c4g_system.schema_migration ORDER BY ordinal DESC LIMIT 1')).rows[0]};
  assert.equal(require('../../src/security/centralMigrationManifest').manifest.at(-1).version,'016_membership_access');
  assert.equal(require('../../src/security/tenantMigrationManifest').manifest.at(-1).version,'026_personal_profile');
  assert(['015_funding_tenders_central','016_membership_access'].includes(versions.central.version));
  assert(['025_organization_directory','026_personal_profile'].includes(versions.tenant.migration_id));
  if(!apply){const records=Object.fromEntries(Object.entries(before).map(([k,v])=>[k,Object.fromEntries(Object.entries(v).map(([t,x])=>[t,x.count]))]));console.log(JSON.stringify({result:'READY_FOR_LOCAL_UPGRADE',versions,records}));return}
  const proof=JSON.parse(fs.readFileSync(path.join(cfg.root,'output/playwright/c4g-pilot-people/browser-verification.json')));assert.equal(proof.result,'PASS');
  const backup=path.join(cfg.folder,'pilot-people-backup-'+Date.now());fs.mkdirSync(backup);
  const identity=spawnSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});const sid=identity.stdout.match(/S-1-5-[0-9-]+/)?.[0];assert(sid);
  assert.equal(spawnSync('icacls',[backup,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{windowsHide:true}).status,0);
  cfg.saveState(state,path.join(backup,'runtime-before.json'));cfg.saveState(before,path.join(backup,'data-before.json'));
  const binary='C:/Program Files/PostgreSQL/18/bin/';
  for(const db of [config.centralDatabase,config.tenantDatabase]){
   const file=path.join(backup,db+'.dump');
   const dump=spawnSync(binary+'pg_dump.exe',['-h',config.host,'-p',String(config.port),'-U',config.user,'-Fc','-f',file,db],{env:{...process.env,PGPASSWORD:config.password},windowsHide:true});
   if(dump.status!==0||fs.statSync(file).size<1000)throw Error('LOCAL_BACKUP_FAILED');
   if(spawnSync(binary+'pg_restore.exe',['--list',file],{windowsHide:true}).status!==0)throw Error('LOCAL_BACKUP_UNREADABLE');
  }
  await withInstallerAuthority(central,{},async({demote})=>{
   await require('../runCentralMigrations').applyCentralMigrations(nativePool(central));
   await require('../../src/security/tenantMigrationRunner').createTenantMigrationRunner({pool:nativePool(tenant),observationPublisher:{async publish(){}},timeoutMs:30000,scheduler:{setTimeout,clearTimeout}}).migrate({tenantId:state.tenantId,databaseGenerationId:state.generationId,expectedRevision:1,correlationId:state.installationId,idempotencyKey:state.installationId+'-people'});
   await demote();
  });
  const observation=await require('../../src/security/tenantMigrationPreflight').preflightTenant(tenant,{tenantId:state.tenantId,databaseGenerationId:state.generationId},undefined,{timeoutMs:15000});
  state.snapshot.schema={...state.snapshot.schema,currentVersion:observation.currentVersion,schemaFingerprint:observation.schemaFingerprint,verifiedCapabilities:Object.fromEntries(observation.capabilities.map(code=>[code,true]))};
  const grantsBefore=(await central.query('SELECT * FROM public.authority_f5_state WHERE organization_id=$1 AND membership_id=$2',[state.organizationId,state.membershipId])).rows[0];
  cfg.saveState(grantsBefore,path.join(backup,'grants-before.json'));
  const grants=structuredClone(grantsBefore.grants);
  for(const permission of ['personal_profile.read','personal_profile.edit','organization_membership.manage'])if(!grants.some(g=>g.permission===permission&&g.scope?.type==='ORGANIZATION'&&g.scope?.id===state.organizationId))grants.push({permission,scope:{type:'ORGANIZATION',id:state.organizationId,organizationId:state.organizationId}});
  if(grants.length!==grantsBefore.grants.length){
   authority=new Pool({...cfg.connection(config,config.centralDatabase),user:'c4g_authority_runtime',password:state.authorityPassword});
   const coordinator=require('../../src/security/authorityCoordinator').createAuthorityCoordinator({pool:authority,permitSecret:state.permitSecret});
   await require('../../src/authorization/authorityDataRepository').createAuthorityDataRepository({coordinator,catalogs:require('../../src/authorization/catalogs').createProductionCatalogs({catalogVersion:'f13'}),policyVersion:grantsBefore.policy_version,recentMfaRequirement:grantsBefore.assurance_requirements}).change({organizationId:state.organizationId,membershipId:state.membershipId,expectedVersion:Number(grantsBefore.authorization_version),grants,assuranceRequirements:grantsBefore.assurance_requirements});
  }
  const after={central:await fingerprint(central,Object.keys(before.central)),tenant:await fingerprint(tenant,Object.keys(before.tenant))};assert.deepEqual(after,before);
  cfg.saveState(state);cfg.saveState({result:'PASS',centralMigration:'016_membership_access',tenantMigration:'026_personal_profile',businessDataUnchanged:true,identityAndMembershipsUnchanged:true,grantsAdded:grants.length-grantsBefore.grants.length,backup:path.relative(cfg.root,backup)},path.join(cfg.root,'output/playwright/c4g-pilot-people/local-upgrade.json'));
  console.log('LOCAL_ORGANIZATION_PEOPLE_UPGRADE_PASS: backups verified; business data, identities and memberships preserved; no person/account association inferred.');
 }finally{await authority?.end();await tenant.end();await central.end()}
}
main().catch(e=>{console.error(e.code||(/^[A-Z0-9_]+$/.test(e.message)?e.message:'LOCAL_ORGANIZATION_PEOPLE_UPGRADE_FAILED'));process.exitCode=1});
