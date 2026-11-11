'use strict';
const assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
async function migrateAndVerify({central,tenant,identity,report,check,before,preserved}){
 const cm=require('../../../backend/src/security/centralMigrationManifest'),tm=require('../../../backend/src/security/tenantMigrationManifest');
 const pkg=require('../../../backend/src/security/opportunityV2MigrationPackage'),migration=require('../../../backend/scripts/runCentralMigrations');
 report.packageDigest=pkg.packageDigest;assert.match(report.packageDigest,/^[a-f0-9]{64}$/);
 const preflight=require('../../../backend/src/security/centralMigrationPreflight').preflightCentral;
 const centralTarget=cm.registeredManifest.at(-1).version,tenantTarget=tm.registeredManifest.at(-1).version;
 const baseline='035_funding_source_resolution';
 report.package={id:pkg.PACKAGE_ID,centralTarget,tenantTarget,central:pkg.centralEntries.map(entry=>({version:entry.version,...cm.migrationSql(entry.version,'up'),entry})),tenant:{entry:tm.registeredManifest.at(-1),...tm.migrationSql(tenantTarget,'up')}};
 // Evidence contains metadata, never a duplicate executable SQL bundle.
 for(const item of report.package.central){item.sqlSha256=createHash('sha256').update(item.sql).digest('hex');delete item.sql;}
 report.package.tenant.sqlSha256=createHash('sha256').update(report.package.tenant.sql).digest('hex');delete report.package.tenant.sql;
 await check('REGISTERED_PACKAGE_CLOSED_SELECTION_AND_DEFAULT_BASELINE',async()=>{
  assert.equal(cm.manifest.at(-1).version,baseline);assert.equal(tm.manifest.at(-1).version,'033_organizational_opportunity_interests');
  assert.deepEqual(await migration.applyCentralMigrations(central),[]);assert.equal((await preflight(central)).currentVersion,baseline);
  await assert.rejects(async()=>migration.applyRegisteredCentralPackage(central,'unknown-package'));
  assert.equal((await preflight(central)).currentVersion,baseline);
 });
 await check('REGISTERED_CENTRAL_PACKAGE_ATOMIC_FAILURE_PRESERVES_BASELINE',async()=>{
  let injected=false;
  const failing={async connect(){const client=await central.connect();return{release:error=>client.release(error),async query(sql,values){if(sql.includes('INSERT INTO public.c4g_schema_migration')&&values?.[0]===centralTarget){injected=true;throw Error('ISOLATED_REGISTERED_LEDGER_FAILURE');}return client.query(sql,values);}};}};
  await assert.rejects(migration.applyRegisteredCentralPackage(failing,pkg.PACKAGE_ID),/ISOLATED_REGISTERED_LEDGER_FAILURE/);assert.equal(injected,true);
  assert.equal((await preflight(central)).currentVersion,baseline);await preserved(central,before.central);
 });
 await check('REGISTERED_CENTRAL_MIGRATOR_PREFIX_DATA_AND_REPLAY',async()=>{
  const applied=await migration.applyRegisteredCentralPackage(central,pkg.PACKAGE_ID);assert.deepEqual(applied,pkg.centralEntries.map(entry=>entry.version));
  const ready=await preflight(central);assert.equal(ready.currentVersion,centralTarget);await preserved(central,before.central);
  const ledger=(await central.query('SELECT version,checksum_sha256,irreversible,applied_at::text FROM public.c4g_schema_migration ORDER BY version')).rows;
  assert.deepEqual(await migration.applyRegisteredCentralPackage(central,pkg.PACKAGE_ID),[]);assert.deepEqual((await central.query('SELECT version,checksum_sha256,irreversible,applied_at::text FROM public.c4g_schema_migration ORDER BY version')).rows,ledger);
  assert.deepEqual(await migration.applyCentralMigrations(central),[]);assert.equal((await preflight(central)).currentVersion,centralTarget);
  report.central={applied,version:ready.currentVersion,fingerprint:ready.fingerprint,ledgerDigest:createHash('sha256').update(JSON.stringify(ledger)).digest('hex'),prefixPreserved:true,replayed:true};
 });
 await check('REGISTERED_TENANT_RUNNER_PUBLISHES_REAL_OBSERVATION_AND_REPLAYS',async()=>{
  const publisher=require('../../../backend/src/security/tenantSchemaObservationPublisher').createTenantSchemaObservationPublisher(require('../../../backend/src/security/tenantSchemaRepository').createTenantSchemaRepository(central));
  const runner=require('../../../backend/src/security/tenantMigrationRunner').createRegisteredTenantMigrationRunner({packageId:pkg.PACKAGE_ID,pool:tenant,observationPublisher:publisher,timeoutMs:30000,scheduler:{setTimeout,clearTimeout}});
  const expectedRevision=Number((await central.query('SELECT revision FROM public.tenant_schema_state WHERE tenant_id=$1',[identity.tenantId])).rows[0].revision);
  const input={...identity,expectedRevision,correlationId:randomUUID(),idempotencyKey:randomUUID()},result=await runner.migrate(input);assert.deepEqual(result.appliedVersions,[tenantTarget]);assert.equal(result.evidence.currentVersion,tenantTarget);
  await preserved(tenant,before.tenant);
  const ledger=(await tenant.query('SELECT * FROM c4g_system.schema_migration ORDER BY ordinal')).rows,observed=(await central.query('SELECT * FROM public.tenant_schema_state WHERE tenant_id=$1',[identity.tenantId])).rows[0];
  assert.equal(observed.current_version,tenantTarget);assert.equal(observed.target_version,tenantTarget);assert.equal(observed.verified_capabilities.schemaFingerprint,result.evidence.schemaFingerprint);
  const replay=await runner.migrate(input);assert.deepEqual(replay.appliedVersions,[]);assert.deepEqual((await tenant.query('SELECT * FROM c4g_system.schema_migration ORDER BY ordinal')).rows,ledger);assert.deepEqual((await central.query('SELECT * FROM public.tenant_schema_state WHERE tenant_id=$1',[identity.tenantId])).rows[0],observed);
  const ordinary=require('../../../backend/src/security/tenantMigrationRunner').createTenantMigrationRunner({pool:tenant,observationPublisher:publisher,timeoutMs:30000,scheduler:{setTimeout,clearTimeout}});
  const ordinaryReplay=await ordinary.migrate(input);assert.deepEqual(ordinaryReplay.appliedVersions,[]);assert.equal(ordinaryReplay.evidence.currentVersion,tenantTarget);assert.deepEqual((await central.query('SELECT * FROM public.tenant_schema_state WHERE tenant_id=$1',[identity.tenantId])).rows[0],observed);
  report.tenant={applied:result.appliedVersions,version:result.evidence.currentVersion,fingerprint:result.evidence.schemaFingerprint,ledgerDigest:createHash('sha256').update(JSON.stringify(ledger)).digest('hex'),prefixPreserved:true,observationPublished:true,replayed:true};
 });
}
module.exports={migrateAndVerify};
