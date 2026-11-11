'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {manifest:fullManifest,migrationSql}=require('../../../backend/src/security/tenantMigrationManifest');
// Preserve the closed slice-7 regression boundary; cumulative 012 is checked separately.
const manifest=Object.freeze(fullManifest.slice(0,12));
const {createTenantMigrationRunner}=require('../../../backend/src/security/tenantMigrationRunner');
const {preflightTenant}=require('../../../backend/src/security/tenantMigrationPreflight');
const {tenantSchemaSnapshot,tenantSchemaFingerprint}=require('../../../backend/src/security/tenantSchemaFingerprint');
const {createMembershipRepository}=require('../../../backend/src/security/membershipRepository');
const {createOperationalRuntimeComposition}=require('../../../backend/src/organizationalProfile/operationalComposition');
const {createOperationalTelemetry}=require('../../../backend/src/organizationalProfile/operationalTelemetry');
const {runtimeFixture}=require('./runtime-fixture');
const {centralAuthorityFixture}=require('./central-authority-fixture');
const tables=['operational_assertion','operational_assertion_revision','operational_idempotency_record'];
async function run(){
 if(process.env.F13_S2_DISPOSABLE_PROOF!=='C4G_F13_S2_DISPOSABLE_V1')throw new Error('Disposable proof required');
 const url=new URL(process.env.F13_S2_ADMIN_URL);
 if(url.hostname!=='127.0.0.1'||['5432','5433'].includes(url.port))throw new Error('Unsafe target');
 const admin=new Pool({connectionString:url.toString(),max:2}),databases=[],fixtures=[];
 let central;
 try{
  for(const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime'])await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');await admin.query('GRANT c4g_tenant_migrator TO c4g_f12_admin');
  for(let n=0;n<2;n++){
   const name=`c4g_f13_operational_${n}`,org=randomUUID(),gen=randomUUID();
   await admin.query(`CREATE DATABASE ${name} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
   await admin.query(`ALTER DATABASE ${name} SET timezone TO 'UTC'`);
   await admin.query(`GRANT CONNECT,CREATE ON DATABASE ${name} TO c4g_tenant_owner`);
   await admin.query(`GRANT CONNECT ON DATABASE ${name} TO c4g_tenant_migrator,c4g_tenant_runtime`);
   const tenantUrl=new URL(url);tenantUrl.pathname=`/${name}`;
   const pool=new Pool({connectionString:tenantUrl.toString(),max:8}),db={name,org,gen,pool};databases.push(db);
   await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');await pool.query(`REVOKE CONNECT,TEMP ON DATABASE ${name} FROM PUBLIC`);
   await pool.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${name} SET search_path TO pg_catalog,c4g_app`);
   const runner=(entries=manifest,source=pool)=>createTenantMigrationRunner({pool:source,entries,observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}});
   const request={tenantId:org,databaseGenerationId:gen,expectedRevision:1,correlationId:'operational-gate',idempotencyKey:'operational-gate'};
   await runner(Object.freeze(manifest.slice(0,11))).migrate(request);
   if(process.env.F13_OPERATIONAL_CAPTURE==='1'){
    const client=await pool.connect();try{await client.query('BEGIN');await client.query(migrationSql(manifest[11].version,'up').sql);
     const fingerprint=tenantSchemaFingerprint(await tenantSchemaSnapshot(client));
     await client.query(migrationSql(manifest[11].version,'down').sql);
     assert.equal(tenantSchemaFingerprint(await tenantSchemaSnapshot(client)),manifest[10].schemaFingerprint);
     await client.query('ROLLBACK');process.stdout.write(JSON.stringify({captureOnly:true,fingerprint,emptyDownReturns010:true})+'\n');
    }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}return;
   }
   const failing={async connect(){const c=await pool.connect();return{release:e=>c.release(e),async query(sql,values){
    if(sql.includes('INSERT INTO c4g_system.schema_migration')&&values?.[1]===11)throw new Error('011_LEDGER_FAILURE');return c.query(sql,values);}};}};
   await assert.rejects(()=>runner(manifest,failing).migrate(request));
   assert.equal((await pool.query("SELECT to_regclass('organization_profile.operational_assertion_revision') AS present")).rows[0].present,null);
   assert.equal((await preflightTenant(pool,{tenantId:org,databaseGenerationId:gen},manifest,{timeoutMs:10000})).currentVersion,manifest[10].version);
   const upgraded=await runner().migrate(request);assert.deepEqual(upgraded.appliedVersions,[manifest[11].version]);
   assert.deepEqual((await runner().migrate(request)).appliedVersions,[]);
   const reverted=await runner().downgrade({...request,targetVersion:manifest[10].version,expectedRevision:2});
   assert.deepEqual(reverted.revertedVersions,[manifest[11].version]);assert.equal(reverted.evidence.schemaFingerprint,manifest[10].schemaFingerprint);
   assert.equal((await pool.query('SELECT count(*)::int n FROM c4g_system.schema_migration')).rows[0].n,11);
   assert.deepEqual((await runner().migrate({...request,expectedRevision:3})).appliedVersions,[manifest[11].version]);
   await assert.rejects(()=>runner().downgrade({...request,targetVersion:manifest[7].version}));
   db.evidence=await preflightTenant(pool,{tenantId:org,databaseGenerationId:gen},manifest,{timeoutMs:10000});
  }
  central=await centralAuthorityFixture(url.toString());
  const decisions=[],metrics=[];let auditFailure=false,loseCommit=false,functionalSql=0,allows=0,finalHook=null;
  const [a,b]=databases;
  const preparedPool={async connect(){const client=await a.pool.connect();return{release:e=>client.release(e),async query(sql,values){
   if(sql.includes('organization_profile.'))functionalSql++;
   if(sql.includes('audit.append_event_v1')&&auditFailure)throw new Error('AUTHORING_F7_FAILURE');
   const result=await client.query(sql,values);
   if(sql==='RESET ROLE'&&finalHook){const hook=finalHook;finalHook=null;await hook();}
   if(sql==='COMMIT'&&loseCommit){loseCommit=Number(loseCommit)-1;throw new Error('AUTHORING_COMMIT_UNKNOWN');}
   return result;
  }};}};
  const composition=createOperationalRuntimeComposition({sessionStore:central.store,sessionRegistry:central.registry,authorityCoordinator:central.coordinator,
   authorizationCatalogs:central.catalogs,assurancePolicyVersion:'c4g-assurance-v1',recentMfaRequirement:central.requirement,
   telemetry:createOperationalTelemetry({metrics:{record(name,value,labels){metrics.push({name,labels});}}})});
  async function bind(db,target){const evidence=await preflightTenant(target,{tenantId:db.org,databaseGenerationId:db.gen},manifest,{timeoutMs:10000});
   const fixture=await runtimeFixture({pool:target,evidence,sessions:{memberships:new Map()}});fixtures.push(fixture);
   fixture.dependencies.membershipRepository=createMembershipRepository(central.pool,central.coordinator);
   return composition.bindTenant({pool:target,organizationId:db.org,tenantId:db.org,tenantCapabilityEvidence:evidence,tenantRuntimeDependencies:fixture.dependencies,
    authorizationAuditPort:{async accept(event){decisions.push(event);if(event.result==='ALLOW')allows++;return'ACCEPTED';}}});
  }
  a.bound=await bind(a,preparedPool);b.bound=await bind(b,b.pool);

  await require('./operational-probes').runOperationalProbes({central,a,b,fixtures,decisions,metrics,controls:{audit(value){auditFailure=value;},commit(value){loseCommit=value;}}});
  process.stdout.write(JSON.stringify({realCentralAndTwoTenants:true,upgrade010To011:true,canonical011To010To011:true,migrationLedgerRollback:true,checksum:manifest[11].sqlChecksum,fingerprint:manifest[11].schemaFingerprint})+'\n');
 }finally{
  for(const fixture of fixtures)await fixture.manager.closeAll();
  if(central)await central.close();for(const db of databases){await db.pool.end();await admin.query(`DROP DATABASE ${db.name}`);}
  await admin.end();
 }
}
run().catch(error=>{console.error(error.code||error.internalCode||'GATE_FAILURE',error.stack||error);process.exitCode=1;});
