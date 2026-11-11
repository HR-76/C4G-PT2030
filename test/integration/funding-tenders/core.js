'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Pool } = require('../../../backend/node_modules/pg');
const { manifest, migrationSql } = require('../../../backend/src/security/centralMigrationManifest');
const { applyCentralMigrationsWithManifest } = require('../../../backend/scripts/runCentralMigrations');
const { createFundingRepository } = require('../../../backend/src/fundingTenders/repository');
const { createSource } = require('./v1FixtureFunder');
const { createFundingWorker } = require('../../../backend/src/fundingTenders/worker');
const { createPgBossQueueAdapter } = require('../../../backend/src/async/adapters/pgBossQueueAdapter');
async function main() {
  const target = new URL(process.env.FUNDING_TEST_DATABASE_URL);
  if (target.hostname !== '127.0.0.1' || target.port !== '5558' || target.pathname !== '/funding_fixture') throw Error('DISPOSABLE_TARGET_REQUIRED');
  const pool = new Pool({ connectionString: target.toString() }); let worker, boss;
  try {
    for (const role of ['c4g_central_owner', 'c4g_central_runtime']) await pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
    await applyCentralMigrationsWithManifest(pool, manifest, migrationSql);

    const {centralSchemaSnapshot,schemaFingerprint}=require('../../../backend/src/security/centralSchemaManifest');
    const {authoritySecuritySnapshot,digest}=require('../../../backend/src/security/authoritySecurityManifest');
    console.log('FUNDING_CENTRAL_FINGERPRINT',schemaFingerprint(await centralSchemaSnapshot(pool)));
    console.log('FUNDING_AUTHORITY_FINGERPRINT',digest(await authoritySecuritySnapshot(pool)));
    await require('../../../backend/src/opportunities/preflight').opportunityPreflight(pool,'central');
    const admin = randomUUID(), client = randomUUID();
    for (const [id, name] of [[admin, 'Platform'], [client, 'Client']]) await pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,$2,$3,'ACTIVE')", [id, name, `${id}@example.invalid`]);
    await pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')", [randomUUID(), admin]);
    const repository = createFundingRepository({ pool });
    await assert.rejects(repository.enqueue(client, randomUUID()), { code: 'FUNDING_FORBIDDEN' });
    const id = randomUUID(); const [one, two] = await Promise.all([repository.enqueue(admin, id), repository.enqueue(admin, id)]);
    assert.equal(one.runId, two.runId); assert.equal((await repository.enqueue(admin, id)).runId, one.runId);
    const { PgBoss } = await import('../../../backend/node_modules/pg-boss/dist/index.js');
    boss = new PgBoss({ connectionString: target.toString(), supervise: false, schedule: false }); await boss.start();
    await boss.createQueue('funding-tenders-refresh', { retryLimit: 0 }); await boss.stop(); boss = null;
    const queue = await createPgBossQueueAdapter({ connectionString: target.toString(), queueMap: { 'funding_tenders.refresh': 'funding-tenders-refresh' }, inspectSchema: async () => ({ schemaVersion: Number((await pool.query('SELECT version FROM pgboss.version')).rows[0].version), schema: 'pgboss' }) });
    let title = 'Synthetic funding call';
    const source = createSource({ fetchImpl: async () => new Response(JSON.stringify({ results: [{ content: title, url: 'https://example.invalid/funding', metadata: { identifier: ['SYNTHETIC-FT-1'], frameworkProgramme: ['43108390'], deadlineDate: ['2099-12-31'] } }] })) });
    worker = createFundingWorker({ pool, queue, source });
    await worker.runOnce();
    assert.equal((await repository.status(admin)).lastRun.status, 'SUCCESS');
    const listing = await repository.list(); assert.equal(listing.items.length, 1);
    const opportunityId = listing.items[0].opportunityId;
    const first = await repository.get(opportunityId);
    await repository.enqueue(admin, randomUUID()); await worker.runOnce();
    assert.equal((await repository.get(opportunityId)).revisionId, first.revisionId);
    title = 'Synthetic changed call'; await repository.enqueue(admin, randomUUID()); await worker.runOnce();
    const updated = await repository.get(opportunityId); assert.notEqual(updated.revisionId, first.revisionId); assert.equal(updated.snapshot.title, title);
    assert.equal((await repository.list()).items.length, 1);
    assert.equal(Number((await pool.query('SELECT count(*) FROM opportunity_catalog.revision')).rows[0].count), 2);
    assert.equal(Number((await pool.query('SELECT count(*) FROM opportunity_catalog.funding_observation')).rows[0].count), 3);
    // Manual changes are revisions through the existing catalog contract.
    const {CentralOpportunityRepository}=require('../../../backend/src/opportunities/centralRepository');
    const catalog=new CentralOpportunityRepository({pool,identityFactory:require('../../../backend/src/opportunities/identity').createIdentityFactory()});
    await catalog.update({schemaVersion:1,requestId:randomUUID(),opportunityId,expectedRowVersion:Number(updated.rowVersion),snapshot:{...updated.snapshot,title:'Manual title',provenanceId:randomUUID()},provenance:{schemaVersion:1,sourceType:'C4G_MANUAL',sourceNamespace:'C4G',observedAt:new Date().toISOString()}},{actor:{type:'SERVICE',reference:'SYNTHETIC_FIXTURE'}});
    title='API divergent title';await repository.enqueue(admin,randomUUID());await worker.runOnce();
    assert.equal((await repository.get(opportunityId)).snapshot.title,'Manual title');
    assert.deepEqual((await repository.get(opportunityId)).conflicts,['title']);
    // A committed first item survives a transient failure on the second item.
    await worker.shutdown();worker=null;
    const newQueue=await createPgBossQueueAdapter({connectionString:target.toString(),queueMap:{'funding_tenders.refresh':'funding-tenders-refresh'},inspectSchema:async()=>({schema:'pgboss',schemaVersion:Number((await pool.query('SELECT version FROM pgboss.version')).rows[0].version)})});
    let failOnce=true;
    const resumedRepository={...repository,async apply(run,item){if(item.external_identifier==='SYNTHETIC-FT-3'&&failOnce){failOnce=false;throw Object.assign(new Error('fixture transient'),{code:'40001'})}return repository.apply(run,item)}};
    const partialSource=createSource({fetchImpl:async()=>new Response(JSON.stringify({results:[2,3].map(n=>({content:`Synthetic ${n}`,metadata:{identifier:[`SYNTHETIC-FT-${n}`],deadlineDate:['2099-12-31']}})).concat([{content:'Invalid item'}])}))});
    worker=createFundingWorker({pool,queue:newQueue,source:partialSource,repository:resumedRepository});
    const partial=await repository.enqueue(admin,randomUUID());await worker.runOnce();
    assert.equal((await repository.status(admin)).lastRun.created,1);
    assert.equal((await repository.status(admin)).lastRun.status,'RUNNING');
    await worker.shutdown();worker=null;
    await pool.query("UPDATE async_exec.outbox SET available_at=clock_timestamp() WHERE state='PENDING'");
    const restartQueue=await createPgBossQueueAdapter({connectionString:target.toString(),queueMap:{'funding_tenders.refresh':'funding-tenders-refresh'},inspectSchema:async()=>({schema:'pgboss',schemaVersion:Number((await pool.query('SELECT version FROM pgboss.version')).rows[0].version)})});
    worker=createFundingWorker({pool,queue:restartQueue,source:{collect(){throw Error('Must reuse staged collection')}}});
    await worker.runOnce();const resumed=(await repository.status(admin)).lastRun;
    assert.equal(resumed.runId,partial.runId);assert.equal(resumed.created,2);assert.equal(resumed.failed,1);assert.equal(resumed.status,'ERROR');
    assert.equal((await repository.list()).items.length,3,'Missing source rows must not delete existing opportunities');
    assert.equal((await pool.query('SELECT count(*)::int n FROM opportunity_catalog.funding_observation WHERE run_id=$1',[partial.runId])).rows[0].n,2);
    console.log('FUNDING_MANUAL_PARTIAL_RESTART_PASS');
    await worker.shutdown();worker=null;
    await repository.enqueue(admin,randomUUID());
    const child=require('node:child_process').spawn(process.execPath,[path.resolve(__dirname,'../../../backend/src/worker.js')],{windowsHide:true,stdio:'ignore',env:{...process.env,NODE_ENV:'development',FUNDING_TENDERS_RUNTIME:'central',FUNDING_TENDERS_SOURCE:'fixture',CENTRAL_DATABASE_URL:target.toString()}});
    try {
      for(let attempt=0;attempt<80&&(await repository.status(admin)).lastRun.status!=='SUCCESS';attempt++)await new Promise(resolve=>setTimeout(resolve,250));
      assert.equal((await repository.status(admin)).lastRun.status,'SUCCESS','Separate worker process must consume the queued run');
      console.log('FUNDING_SEPARATE_WORKER_PROCESS_PASS');
    } finally {if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited}}
    const crashRun=await repository.enqueue(admin,randomUUID());
    const crashing=require('node:child_process').fork(path.join(__dirname,'crash-worker.js'),[],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,FUNDING_TEST_DATABASE_URL:target.toString()}});
    try {await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Crash fixture timeout')),10000);crashing.once('message',value=>{clearTimeout(timer);value==='FIRST_ITEM_COMMITTED'?resolve():reject(Error('Crash fixture failed'))})});}
    finally {if(crashing.exitCode===null){const exited=new Promise(resolve=>crashing.once('exit',resolve));crashing.kill();await exited}}
    assert.equal((await repository.status(admin)).lastRun.created,1);
    // Advance only the expired-lease condition instead of waiting 150 seconds.
    await pool.query("UPDATE opportunity_catalog.funding_run SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1",[crashRun.runId]);
    await pool.query("UPDATE async_exec.inbox SET lease_until=clock_timestamp()-interval '1 second' WHERE organization_id IS NULL AND idempotency_key=$1",[crashRun.runId]);
    const afterCrashQueue=await createPgBossQueueAdapter({connectionString:target.toString(),queueMap:{'funding_tenders.refresh':'funding-tenders-refresh'},inspectSchema:async()=>({schema:'pgboss',schemaVersion:Number((await pool.query('SELECT version FROM pgboss.version')).rows[0].version)})});
    worker=createFundingWorker({pool,queue:afterCrashQueue,source:{collect(){throw Error('Crash recovery must use durable staging')}}});
    await worker.runOnce();assert.equal((await repository.status(admin)).lastRun.status,'SUCCESS');assert.equal((await repository.status(admin)).lastRun.created,2);
    console.log('FUNDING_HARD_CRASH_RECOVERY_PASS');
    const {createTenantMigrationRunner}=require('../../../backend/src/security/tenantMigrationRunner');
    const {manifest:tenants}=require('../../../backend/src/security/tenantMigrationManifest');
    const {tenantSchemaSnapshot,tenantSchemaFingerprint}=require('../../../backend/src/security/tenantSchemaFingerprint');
    for(const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime','c4g_import_worker_runtime'])await pool.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await pool.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
    for(const name of ['funding_tenant_a','funding_tenant_b']) {
      await pool.query(`CREATE DATABASE ${name} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
      await pool.query(`GRANT CONNECT,CREATE ON DATABASE ${name} TO c4g_tenant_owner`);
      await pool.query(`GRANT CONNECT ON DATABASE ${name} TO c4g_tenant_migrator,c4g_tenant_runtime`);
      const url=new URL(target);url.pathname=`/${name}`;const tenant=new Pool({connectionString:url.toString()});
      try {
        await tenant.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');await tenant.query(`REVOKE CONNECT,TEMP ON DATABASE ${name} FROM PUBLIC`);
        await tenant.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${name} SET search_path TO pg_catalog,c4g_app`);
        await createTenantMigrationRunner({pool:tenant,entries:tenants,observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}}).migrate({tenantId:randomUUID(),databaseGenerationId:randomUUID(),expectedRevision:1,correlationId:'funding-fixture',idempotencyKey:'funding-fixture'});

        console.log('FUNDING_TENANT_FINGERPRINT',tenantSchemaFingerprint(await tenantSchemaSnapshot(tenant)));
      } finally {await tenant.end()}
    }
    console.log('FUNDING_CORE_POSTGRES_PASS: central authority, concurrency, pg-boss worker, persistence, repeat, revision history');
  } finally { if (worker) await worker.shutdown(); if (boss) await boss.stop(); await pool.end(); }
}
main().catch(error => { console.error(error.internalCode || error.code || error.name, error.message); process.exitCode = 1; });
