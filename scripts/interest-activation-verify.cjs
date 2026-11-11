'use strict';
// Read-only receipt after service recovery. Never replays the activation.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const cfg=require('../backend/scripts/localPlatform/config'),{Pool}=require('../backend/node_modules/pg');
const {MEMBER_SQL,mergeGrants}=require('./interest-activation.cjs');
const read=file=>JSON.parse(fs.readFileSync(file));
const hash=value=>createHash('sha256').update(value).digest('hex');
async function main(){
 const config=cfg.readConfig(),state=read(path.join(cfg.folder,'runtime.json'));
 require('../backend/scripts/localPlatform/prepareOpportunityInterests').target(config,state);
 const windowFile='output/organizational-opportunity-interest/window-bbdac3c4-00e1-4c4c-a54a-f302f938077b.json';
 const window=read(path.join(cfg.root,windowFile)),backup=path.join(cfg.root,window.backup);
 assert(window.activationApplied);assert(window.backupVerified);
 const plan=read(path.join(cfg.folder,'opportunity-interest-activation-plan.json'));
 const backupProof=read(path.join(cfg.root,'output/organizational-opportunity-interest/backup-restore-e2cfb8b8-dc35-4d24-a89f-3d15f5be252b.json'));
 assert.equal(backupProof.status,'PASS');assert.equal(backupProof.cleanup,true);
 const pools=['central','tenant'].map(name=>new Pool({...cfg.connection(config,config[name+'Database']),max:1,options:'-c default_transaction_read_only=on -c timezone=UTC'}));
 const [central,tenant]=pools,report={status:'IN_PROGRESS',window:windowFile,backup:window.backup,checks:[]};
 try{
  await require('../backend/src/security/centralMigrationPreflight').preflightCentral(central);
  await require('../backend/src/security/tenantMigrationPreflight').preflightTenant(tenant,{tenantId:state.tenantId,databaseGenerationId:state.generationId},undefined,{timeoutMs:30000});
  report.checks.push('CENTRAL_AND_TENANT_PREFLIGHT');
  const schema=(await central.query('SELECT current_version,revision FROM public.tenant_schema_state WHERE tenant_id=$1',[state.tenantId])).rows[0];
  assert.equal(schema.current_version,'033_organizational_opportunity_interests');assert.equal(Number(schema.revision),4);report.schema=schema;
  const members=(await central.query(MEMBER_SQL,[state.organizationId])).rows;
  for(const expected of plan.authority.memberships.filter(m=>m.addPermissions.length)){
   const row=members.find(m=>m.membership_id===expected.membershipId);
   assert.equal(Number(row.authorization_version),expected.authorizationVersion+1);assert.deepEqual(mergeGrants(row,expected,state.organizationId),row.grants);
  }
  report.checks.push('EXACT_PLANNED_GRANTS_AND_VERSION');
  const inventory=read(path.join(backup,'tenant-inventory.json'));
  const ledger=(await tenant.query('SELECT to_jsonb(t)::text value FROM c4g_system.schema_migration t WHERE ordinal<=30')).rows.map(r=>r.value).sort();
  assert.equal(hash(JSON.stringify(ledger)),inventory.before.data['"c4g_system"."schema_migration"'].digest);
  report.checks.push('EXACT_HISTORICAL_LEDGER_PRESERVED');
  const reader=await tenant.connect();try{
   await reader.query('SET SESSION AUTHORIZATION c4g_local_api');await reader.query('BEGIN READ ONLY');
   const observed=await require('../backend/src/security/tenantRuntimeMetadata').observeTenantRuntimeMetadata(reader,{tenantId:state.tenantId,databaseGenerationId:state.generationId});
   assert.equal(observed.currentVersion,schema.current_version);await reader.query('ROLLBACK');await reader.query('RESET SESSION AUTHORIZATION');
  }finally{reader.release();}
  report.checks.push('RESTRICTED_API_METADATA');
  for(const relative of Object.keys(backupProof.configuration)){
   const before=path.join(backup,'configuration',relative),after=path.join(cfg.root,relative);
   if(relative.endsWith('/runtime.json')||relative.endsWith('/members/worker.json')){
    const strip=value=>{const v=structuredClone(value);if(v.snapshot)delete v.snapshot.schema;for(const b of v.bindings||[])if(b.snapshot)delete b.snapshot.schema;return v;};
    assert.deepEqual(strip(read(after)),strip(read(before)));
   }else assert.equal(hash(fs.readFileSync(after)),hash(fs.readFileSync(before)));
  }
  report.checks.push('CONFIGURATION_AND_CREDENTIALS_PRESERVED');
  for(const table of ['opportunity_interest','application'])assert.equal(Number((await tenant.query(`SELECT count(*) n FROM opportunity_catalog.${table}`)).rows[0].n),0);
  report.checks.push('NO_BUSINESS_RECORDS_CREATED');
  const response=await fetch('http://localhost:3000/api/local-health'),health=await response.json();assert.equal(response.status,200);
  for(const key of ['ready','workerReady','admissionReady'])assert.equal(health[key],true);
  report.checks.push('API_WORKER_ADMISSIONS_HEALTHY');
  assert.equal(read(path.join(cfg.root,'output/organizational-opportunity-interest/live/verification.json')).status,'PASS');
  report.checks.push('REAL_OIDC_HTTP_UI_PASS');report.status='PASS';
 }finally{
  await Promise.all(pools.map(pool=>pool.end()));report.at=new Date().toISOString();
  fs.writeFileSync(path.join(cfg.root,'output/organizational-opportunity-interest/activation-recovery.json'),JSON.stringify(report,null,2));
 }
 console.log(JSON.stringify(report));
}
main().catch(error=>{console.error('ACTIVATION_VERIFICATION_FAILED:'+error.name);process.exitCode=1;});
