'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('../../../backend/node_modules/pg');
const { manifest } = require('../../../backend/src/security/tenantMigrationManifest');
const { createTenantMigrationRunner } = require('../../../backend/src/security/tenantMigrationRunner');
const { tenantSchemaSnapshot, tenantSchemaFingerprint } = require('../../../backend/src/security/tenantSchemaFingerprint');
const { resolveEditorialRelease, policyRef } = require('../../../backend/src/organizationalProfile/editorialRelease');
async function run() {
  if (process.env.F13_EDITORIAL_DISPOSABLE_PROOF !== 'C4G_F13_EDITORIAL_DISPOSABLE_V1') throw new Error('Disposable proof required');
  const url = new URL(process.env.F13_EDITORIAL_ADMIN_URL);
  if (url.hostname !== '127.0.0.1' || !['5574','5576'].includes(url.port)) throw new Error('Unsafe target');
  const admin = new Pool({ connectionString: url.toString(), max: 2 });
  const databases = [];
  const fixtures = [];
  let central;
  try {
    for (const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime','c4g_import_worker_runtime']) {
      await admin.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    }
    await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
    await admin.query('GRANT c4g_tenant_migrator TO c4g_f12_admin');
    for (let n = 0; n < 2; n++) {
      const name = `c4g_f13_editorial_${n}`, org = randomUUID(), gen = randomUUID();
      await admin.query(`CREATE DATABASE ${name} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
      await admin.query(`ALTER DATABASE ${name} SET timezone TO 'UTC'`);
      await admin.query(`GRANT CONNECT,CREATE ON DATABASE ${name} TO c4g_tenant_owner`);
      await admin.query(`GRANT CONNECT ON DATABASE ${name} TO c4g_tenant_migrator,c4g_tenant_runtime`);
      const tenantUrl = new URL(url); tenantUrl.pathname = '/' + name;
      const pool = new Pool({ connectionString: tenantUrl.toString(), max: 8 });
      databases.push({ name, org, gen, pool });
      await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
      await pool.query(`REVOKE CONNECT,TEMP ON DATABASE ${name} FROM PUBLIC`);
      await pool.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${name} SET search_path TO pg_catalog,c4g_app`);
      const prefix = Object.freeze(manifest.filter(entry => entry.ordinal <= 15));
      const runner = createTenantMigrationRunner({ pool, entries: prefix, observationPublisher: { async publish() {} },
        timeoutMs: 15000, scheduler: { setTimeout, clearTimeout } });
      await runner.migrate({ tenantId: org, databaseGenerationId: gen, expectedRevision: 1,
        correlationId: 'editorial-gate', idempotencyKey: 'editorial-gate' });
      const sql = direction => fs.readFileSync(path.resolve(__dirname,
        '../../../backend/database/tenant/migrations/016_f13_editorial_baseline_publication.' + direction + '.sql'), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql('up'));
        const fingerprint = tenantSchemaFingerprint(await tenantSchemaSnapshot(client));
        await client.query('SET LOCAL ROLE c4g_organization_profile_runtime');
        await client.query("SELECT set_config('app.organization_id',$1,true)", [org]);
        assert.deepEqual((await resolveEditorialRelease(client)).policyRef, policyRef);
        await client.query('RESET ROLE');
        await client.query(sql('down'));
        assert.equal(tenantSchemaFingerprint(await tenantSchemaSnapshot(client)), prefix.at(-1).schemaFingerprint);
        await client.query('ROLLBACK');
        process.stdout.write(JSON.stringify({ database: n, migrationProbeOnly: true, fingerprint,
          policyResolvedUnderRuntime: true, emptyDownReturns015: true }) + '\n');
      } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
      if(process.env.F13_EDITORIAL_CAPTURE==='1')continue;
      await createTenantMigrationRunner({ pool, observationPublisher: { async publish() {} },
        timeoutMs: 15000, scheduler: { setTimeout, clearTimeout } }).migrate({ tenantId: org, databaseGenerationId: gen,
        expectedRevision: 2, correlationId: 'editorial-full', idempotencyKey: 'editorial-full' });
    }
    if(process.env.F13_EDITORIAL_CAPTURE==='1')return;
    let controlledTime = null;
    const clock = { now: () => new Date(controlledTime === null ? Date.now() : controlledTime) };
    central = await require('./central-authority-fixture').centralAuthorityFixture(url.toString(), { clock });
    central.temporalClock = { set: value => { controlledTime = value; } };
    const evidenceFor = require('../../../backend/src/security/tenantMigrationPreflight').preflightTenant;
    const options = { clock, sessionStore: central.store, sessionRegistry: central.registry, authorityCoordinator: central.coordinator,
      authorizationCatalogs: central.catalogs, assurancePolicyVersion: 'c4g-assurance-v1', recentMfaRequirement: central.requirement,
      telemetry: { async observe(operation, work) { try { return await work(); } catch (error) { console.error('EDITORIAL_GATE_OPERATION', operation); throw error; } } },
      onFailure(error) { console.error('EDITORIAL_GATE_DIAGNOSTIC', error.internalCode || error.code || error.name); } };
    for (const db of databases) {
      db.evidence = await evidenceFor(db.pool, { tenantId: db.org, databaseGenerationId: db.gen }, manifest, { timeoutMs: 10000 });
      db.controls={failAudit:false,loseCommit:0,loseAcknowledgments:0,beforeCommit:null};
      const observedPool={async connect(){const client=await db.pool.connect();let mutation=false,editorial=false;
        return {release:error=>client.release(error),async query(sql,values){
          if(sql.startsWith('BEGIN')){mutation=false;editorial=false;}
          if(sql.includes("'F13-EDITORIAL:'"))editorial=true;
          if(sql.includes('INSERT INTO organization_profile.editorial_'))mutation=true;
          if(db.controls.failAudit&&sql.includes('audit.append_event_v1'))throw new Error('SYNTHETIC_F7_FAILURE');
          if(sql==='COMMIT'&&mutation&&db.controls.beforeCommit){const hook=db.controls.beforeCommit;db.controls.beforeCommit=null;await hook();}
          const result=await client.query(sql,values);
          if(sql==='SET CONSTRAINTS ALL IMMEDIATE'&&mutation&&db.controls.beforeFinalValidation){
            const hook=db.controls.beforeFinalValidation;db.controls.beforeFinalValidation=null;await hook();
          }
          if(sql==='COMMIT'&&editorial&&db.controls.loseAcknowledgments>0){db.controls.loseAcknowledgments--;throw new Error('SYNTHETIC_COMMIT_ACK_LOST');}
          if(sql==='COMMIT'&&mutation&&db.controls.loseCommit>0){db.controls.loseCommit--;throw new Error('SYNTHETIC_COMMIT_ACK_LOST');}
          return result;
        }};}};
      db.evidence=await evidenceFor(observedPool,{tenantId:db.org,databaseGenerationId:db.gen},manifest,{timeoutMs:10000});
      const fixture = await require('./runtime-fixture').runtimeFixture({ pool: observedPool, evidence: db.evidence, sessions: { memberships: new Map() }, clock });
      db.snapshot=fixture.snapshot;
      fixtures.push(fixture);
      fixture.dependencies.membershipRepository = require('../../../backend/src/security/membershipRepository').createMembershipRepository(central.pool, central.coordinator);
      const binding = { pool: observedPool, organizationId: db.org, tenantId: db.org, tenantCapabilityEvidence: db.evidence,
        tenantRuntimeDependencies: fixture.dependencies, authorizationAuditPort: { async accept() { return 'ACCEPTED'; } } };
      db.editorial = require('../../../backend/src/organizationalProfile/editorialComposition').createEditorialRuntimeComposition(options).bindTenant(binding);
      db.authoring = require('../../../backend/src/organizationalProfile/authoringComposition').createAuthoringRuntimeComposition(options).bindTenant(binding);
      db.competency = require('../../../backend/src/organizationalProfile/competencyComposition').createCompetencyRuntimeComposition(options).bindTenant(binding);
    }
    // UI fixtures include real published labels; the closed domain gate's bare
    // concept fixtures intentionally do not model human-readable catalogues.
    for (const db of databases) {
      for (const role of ['maker','submitter','checker']) {
        const actor=await central.user(db.org,randomUUID(),randomUUID());
        await central.data.change({organizationId:db.org,membershipId:actor.membershipId,expectedVersion:1,
          grants:['draft.create','draft.edit','submit','approve','publish','read'].map(suffix=>({permission:'organization_profile.'+suffix,scope:{type:'ORGANIZATION',id:db.org,organizationId:db.org}})),assuranceRequirements:central.requirement});
        db[role]=actor;
      }
      const release=randomUUID(),scheme=randomUUID(),concept=randomUUID();
      await db.pool.query(`INSERT INTO organization_profile.catalog_release(release_id,organization_id,namespace,release_version,lifecycle,semantic_digest,provenance)
        VALUES($1,$2,'TENANT','ui-synthetic-v1','DRAFT',$3,'{"governance":{"defaultLocale":"pt-PT"}}')`,[release,db.org,'b'.repeat(64)]);
      await db.pool.query(`INSERT INTO organization_profile.scheme(scheme_id,release_id,organization_id,scheme_code,relation_domain) VALUES($1,$2,$3,'THEMATIC_AREA','THEMATIC')`,[scheme,release,db.org]);
      await db.pool.query(`INSERT INTO organization_profile.concept(concept_id,release_id,scheme_id,organization_id,stable_code,provenance) VALUES($1,$2,$3,$4,'SYNTHETIC','{}')`,[concept,release,scheme,db.org]);
      await db.pool.query(`INSERT INTO organization_profile.concept_label(concept_id,locale,label_kind,label) VALUES($1,'pt-PT','PREFERRED','Investigação sintética')`,[concept]);
      await db.pool.query(`UPDATE organization_profile.catalog_release SET lifecycle='PUBLISHED',published_at=clock_timestamp() WHERE release_id=$1`,[release]);
      db.draft={items:[{itemId:randomUUID(),itemVersionId:randomUUID(),domain:'THEMATIC_AREA',knowledgeStatus:'KNOWN',conceptId:concept},
        {itemId:randomUUID(),itemVersionId:randomUUID(),domain:'STRATEGIC_PRIORITY',knowledgeStatus:'UNKNOWN',conceptId:null}]};
    }
    await require('./editorial-ui-http-probes').runEditorialUiHttpProbes({databases,central,admin,url,options});
    process.stdout.write('F13_EDITORIAL_CENTRAL_AB: PASS\n');
  } finally {
    for (const fixture of fixtures) await fixture.manager.closeAll();
    if (central) await central.close();
    for (const db of databases) { await db.pool.end(); await admin.query(`DROP DATABASE ${db.name}`); }
    await admin.end();
  }
}
run().catch(error => { console.error(error.internalCode || error.code || 'GATE_FAILURE', error.message); process.exitCode = 1; });
