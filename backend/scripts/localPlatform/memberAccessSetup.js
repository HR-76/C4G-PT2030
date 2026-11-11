'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomBytes,randomUUID}=require('node:crypto'),{spawnSync}=require('node:child_process'),{Pool}=require('pg');
const cfg=require('./config'),{preflightCentral}=require('../../src/security/centralMigrationPreflight'),{authorityFingerprint}=require('./internalAccess'),{fingerprint}=require('./officialSources');
async function main(){
 const mode=process.argv[2];assert(['--prepare','--apply'].includes(mode));assert.equal(process.argv.length,3);
 const config=cfg.readConfig(),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));assert.equal(config.centralDatabase,'c4g_central_dev');assert.equal(config.tenantDatabase,'c4g_tenant_dev');assert.equal(config.port,5432);assert.equal(state.identity.origin,'http://localhost:3000');assert.equal(state.identity.issuer,'https://localhost:8443/realms/c4g-native-local');
 const folder=path.join(cfg.folder,'members');fs.mkdirSync(folder,{recursive:true});
 const sid=spawnSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}).stdout.match(/S-1-5-[0-9-]+/)?.[0];assert(sid);assert.equal(spawnSync('icacls',[folder,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{windowsHide:true}).status,0);
 const settingsFile=path.join(folder,'http.json'),settings=fs.existsSync(settingsFile)?JSON.parse(fs.readFileSync(settingsFile)):{installationId:state.installationId,issuer:state.identity.issuer,origin:state.identity.origin,manualClientId:'c4g-member-activation',existingClientId:'c4g-member-existing',bridgeSecret:randomBytes(32).toString('hex')};assert.equal(settings.installationId,state.installationId);cfg.saveState(settings,settingsFile);
 fs.writeFileSync(path.join(folder,'c4g-activation.properties'),`realm=c4g-native-local\nclient=c4g-member-activation\nendpoint=http://host.docker.internal:5285/bridge/check\nsecret=${settings.bridgeSecret}\n`,{mode:0o600});
 if(mode==='--prepare'){console.log('MEMBER_ACTIVATION_CONFIGURATION_PREPARED');return;}
 const out=path.join(cfg.root,'output/playwright/c4g-member-onboarding');for(const file of ['service-verification.json','real-verification.json'])assert.equal(JSON.parse(fs.readFileSync(path.join(out,file))).result,'PASS');
 const central=new Pool(cfg.connection(config,config.centralDatabase)),tenant=new Pool(cfg.connection(config,config.tenantDatabase));
 try{
  const ready=await preflightCentral(central);assert(['019_internal_access_profiles','020_platform_onboarding','021_platform_members'].includes(ready.currentVersion));
  console.log('MEMBER_SETUP_PREFLIGHT_PASS');
  const before={authority:await authorityFingerprint(central),catalog:await fingerprint(central,['opportunity_catalog']),tenant:await fingerprint(tenant,['opportunity_catalog','organizational_scope','organization_profile','document_storage'])};
  const backup=path.join(folder,'backup-'+Date.now());fs.mkdirSync(backup);const bin='C:/Program Files/PostgreSQL/18/bin/',dump=path.join(backup,'central.dump'),env={...process.env,PGPASSWORD:config.password};
  const run=(exe,args)=>{const r=spawnSync(bin+exe,args,{env,windowsHide:true,stdio:'pipe'});if(r.status!==0)throw Error('MEMBER_BACKUP_FAILED');};
  run('pg_dump.exe',['-h',config.host,'-p',String(config.port),'-U',config.user,'-Fc','-f',dump,config.centralDatabase]);assert(fs.statSync(dump).size>1000);
  const restore='c4g_members_restore_'+randomUUID().replaceAll('-','');assert(/^c4g_members_restore_[a-f0-9]{32}$/.test(restore));
  await central.query(`CREATE DATABASE ${cfg.identifier(restore)} TEMPLATE template0`);let restored;
  try{await central.query(`REVOKE CONNECT ON DATABASE ${cfg.identifier(restore)} FROM PUBLIC`);run('pg_restore.exe',['--exit-on-error','-h',config.host,'-p',String(config.port),'-U',config.user,'-d',restore,dump]);restored=new Pool(cfg.connection(config,restore));assert.deepEqual(await authorityFingerprint(restored),before.authority);}
  finally{await restored?.end();await central.query(`DROP DATABASE ${cfg.identifier(restore)}`);}
  console.log('MEMBER_BACKUP_RESTORE_PASS');
  await require('../runCentralMigrations').applyCentralMigrations(central);assert.equal((await preflightCentral(central)).currentVersion,'021_platform_members');
  const evidence=await require('../../src/security/tenantMigrationPreflight').preflightTenant(tenant,{tenantId:state.tenantId,databaseGenerationId:state.generationId},undefined,{timeoutMs:15000});assert.equal(evidence.schemaFingerprint,state.snapshot.schema.schemaFingerprint);assert.equal(evidence.systemIdentifier,state.snapshot.observedSystemIdentifier);
  console.log('MEMBER_SCHEMA_AND_TENANT_PASS');
  state.snapshot=await require('../../src/platformOnboarding/registerExistingTenant').registerExistingTenant({pool:central,snapshot:state.snapshot,correlationId:state.installationId});
  console.log('MEMBER_DIRECTORY_PASS');
  const admin=await require('./optionalIdentity').identityAdmin(require('./identity').identityConfig());const realm=await admin(state.identity.realm);assert.equal(realm.attributes?.['c4g.local.installation'],state.installationId);
  const kc=(p,m,b)=>admin(state.identity.realm+'/'+p,m,b),browser=(await kc('authentication/flows')).find(f=>f.alias===realm.browserFlow);assert(browser);
  const clients=await require('../../src/platformOnboarding/configureMemberIdentity').configureMemberIdentity({kc,origin:settings.origin,installationId:state.installationId,browserFlowId:browser.id});
  const workerFile=path.join(folder,'worker.json'),prior=fs.existsSync(workerFile)?JSON.parse(fs.readFileSync(workerFile)):null;
  cfg.saveState({issuer:settings.issuer,clientId:clients.clientId,clientSecret:clients.clientSecret,ownershipKey:prior?.ownershipKey||randomBytes(32).toString('hex'),certificate:require('./identity').identityConfig().NODE_EXTRA_CA_CERTS,bindings:[{organizationId:state.organizationId,credentials:state.credentials,snapshot:state.snapshot}]},workerFile);
  assert.deepEqual({authority:await authorityFingerprint(central),catalog:await fingerprint(central,['opportunity_catalog']),tenant:await fingerprint(tenant,['opportunity_catalog','organizational_scope','organization_profile','document_storage'])},before);
  state.memberAccess=true;cfg.saveState(state);cfg.saveState({result:'PASS',centralMigration:'021_platform_members',backupRestored:true,existingAccountsAndMembershipsPreserved:true,catalogAndTenantDataPreserved:true,physicalDirectoryRegistered:true,observedAt:new Date().toISOString()},path.join(out,'local-upgrade.json'));console.log('MEMBER_ACCESS_LOCAL_READY');
 }finally{await central.end();await tenant.end();}
}
if(require.main===module)main().catch(e=>{console.error(e.code||(/^[A-Z0-9_]+$/.test(e.message)?e.message:'MEMBER_ACCESS_SETUP_FAILED'));process.exitCode=1});
module.exports={main};
