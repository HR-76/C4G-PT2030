'use strict';
// Explicit, recoverable local installation. Startup never runs migrations.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomBytes,randomUUID}=require('node:crypto'),{spawnSync}=require('node:child_process'),{Pool}=require('pg');
const cfg=require('./config'),{fingerprint}=require('./officialSources'),{authorityFingerprint}=require('./internalAccess');
async function main(){
 assert.equal(process.argv[2],'--apply');assert.equal(process.argv.length,3);
 const config=cfg.readConfig(),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));
 assert.equal(config.centralDatabase,'c4g_central_dev');assert.equal(config.tenantDatabase,'c4g_tenant_dev');assert.equal(config.port,5432);assert.equal(state.memberAccess,true);assert.equal(state.identity.issuer,'https://localhost:8443/realms/c4g-native-local');
 const out=path.join(cfg.root,'output/playwright/c4g-completion');
 for(const file of ['service-verification.json','real-verification.json'])assert.equal(JSON.parse(fs.readFileSync(path.join(out,file))).result,'PASS');
 const folder=path.join(cfg.folder,'admissions');fs.mkdirSync(folder,{recursive:true});
 const sid=spawnSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}).stdout.match(/S-1-5-[0-9-]+/)?.[0];assert(sid);
 assert.equal(spawnSync('icacls',[folder,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{windowsHide:true,stdio:'pipe'}).status,0);
 const central=new Pool(cfg.connection(config,config.centralDatabase)),tenant=new Pool(cfg.connection(config,config.tenantDatabase));
 try{
  const ready=await require('../../src/security/centralMigrationPreflight').preflightCentral(central);assert(['021_platform_members','025_entity_admission_completion'].includes(ready.currentVersion));
  assert.equal((await central.query("SELECT count(*)::int n FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING')")).rows[0].n,0);
  const schemas=['opportunity_catalog','organizational_scope','organization_profile','document_storage'];
  const before={authority:await authorityFingerprint(central),catalog:await fingerprint(central,['opportunity_catalog']),tenant:await fingerprint(tenant,schemas)};
  const backup=path.join(folder,'backup-'+Date.now());fs.mkdirSync(backup);cfg.saveState(state,path.join(backup,'runtime.json'));cfg.saveState(before,path.join(backup,'fingerprints.json'));
  fs.cpSync(path.join(cfg.folder,'members'),path.join(backup,'members'),{recursive:true});
  for(const name of ['worker.json','credentials','provisioning'])if(fs.existsSync(path.join(folder,name)))fs.cpSync(path.join(folder,name),path.join(backup,name),{recursive:true});
  const bin='C:/Program Files/PostgreSQL/18/bin/',env={...process.env,PGPASSWORD:config.password};
  const run=(exe,args)=>{const r=spawnSync(bin+exe,args,{env,windowsHide:true,stdio:'pipe'});if(r.status!==0)throw Error('ADMISSION_BACKUP_FAILED');};
  const admin=require('./optionalIdentity').identityAdmin;const idp=await admin(require('./identity').identityConfig());
  const realm=await idp(state.identity.realm);assert.equal(realm.attributes?.['c4g.local.installation'],state.installationId);
  const kc=(p,m,b)=>idp(state.identity.realm+'/'+p,m,b),clients=[];
  for(const name of ['c4g-member-activation','c4g-member-existing']){const c=(await kc('clients?clientId='+name))[0];assert(c);clients.push(await kc('clients/'+c.id));}
  cfg.saveState({realm,clients},path.join(backup,'identity.json'));
  const accounts=await kc('users/count');
  for(const [database,name] of [[config.centralDatabase,'central'],[config.tenantDatabase,'tenant']]){
   const dump=path.join(backup,name+'.dump');run('pg_dump.exe',['-h',config.host,'-p',String(config.port),'-U',config.user,'-Fc','-f',dump,database]);assert(fs.statSync(dump).size>1000);
   const restore='c4g_admission_restore_'+randomUUID().replaceAll('-','');await central.query(`CREATE DATABASE ${cfg.identifier(restore)} TEMPLATE template0`);let restored;
   try{await central.query(`REVOKE CONNECT ON DATABASE ${cfg.identifier(restore)} FROM PUBLIC`);run('pg_restore.exe',['--exit-on-error','-h',config.host,'-p',String(config.port),'-U',config.user,'-d',restore,dump]);restored=new Pool(cfg.connection(config,restore));
    if(name==='central'){assert.deepEqual(await authorityFingerprint(restored),before.authority);assert.deepEqual(await fingerprint(restored,['opportunity_catalog']),before.catalog)}else assert.deepEqual(await fingerprint(restored,schemas),before.tenant);
   }finally{await restored?.end();await central.query(`DROP DATABASE ${cfg.identifier(restore)}`);}
  }
  console.log('ADMISSION_BACKUP_RESTORE_PASS');
  await require('../runCentralMigrations').applyCentralMigrations(central);assert.equal((await require('../../src/security/centralMigrationPreflight').preflightCentral(central)).currentVersion,'025_entity_admission_completion');
  for(const client of clients){const redirect=state.identity.origin+'/api/admission-activation/callback';if(!client.redirectUris.includes(redirect))await kc('clients/'+client.id,'PUT',{...client,redirectUris:[...client.redirectUris,redirect]});const updated=await kc('clients/'+client.id);assert(updated.redirectUris.includes(redirect));assert.deepEqual({...updated,redirectUris:client.redirectUris},client);}
  const member=JSON.parse(fs.readFileSync(path.join(cfg.folder,'members','worker.json'))),file=path.join(folder,'worker.json'),previous=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;
  cfg.saveState({installationId:state.installationId,issuer:state.identity.issuer,certificate:member.certificate,clientId:member.clientId,clientSecret:member.clientSecret,ownershipKey:previous?.ownershipKey||randomBytes(32).toString('hex'),journalKey:previous?.journalKey||randomBytes(32).toString('hex')},file);
  assert.deepEqual({authority:await authorityFingerprint(central),catalog:await fingerprint(central,['opportunity_catalog']),tenant:await fingerprint(tenant,schemas)},before);assert.deepEqual(await kc('users/count'),accounts);
  state.admissionAccess=true;cfg.saveState(state);
  cfg.saveState({result:'PASS',backup:path.relative(cfg.root,backup),backupRestored:true,centralMigration:'025_entity_admission_completion',existingDataPreserved:true,identityAccountsPreserved:true,observedAt:new Date().toISOString()},path.join(out,'local-upgrade.json'));
  console.log('ADMISSION_LOCAL_SETUP_PASS');
 }finally{await central.end();await tenant.end();}
}
if(require.main===module)main().catch(e=>{console.error(e.code||(/^[A-Z0-9_]+$/.test(e.message)?e.message:'ADMISSION_SETUP_FAILED'));process.exitCode=1});
module.exports={main};
