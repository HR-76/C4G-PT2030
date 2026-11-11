'use strict';
// Targeted PostgreSQL proof of the new reader against the ACTUAL existing
// migrations/RLS and shared lock. Not an HTTP, F7 or browser acceptance gate.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('../../../backend/node_modules/pg');
const { createTenantMigrationRunner } = require('../../../backend/src/security/tenantMigrationRunner');
const { observeVerifications } = require('../../../backend/src/prequalification/admissibility');
const { fixture, verify, id, at } = require('../../../backend/test/fixtures/pq1Activation');
const { extract } = require('../../../backend/src/organizationalProfile/pq1Material');
async function run() {
  if (process.env.F13_EDITORIAL_DISPOSABLE_PROOF !== 'C4G_F13_EDITORIAL_DISPOSABLE_V1') throw Error('Disposable proof required');
  const url = new URL(process.env.F13_EDITORIAL_ADMIN_URL);
  if (url.hostname !== '127.0.0.1' || url.port !== '5578' || url.pathname !== '/postgres') throw Error('Unsafe target');
  const admin = new Pool({ connectionString: url.toString(), max: 2 });
  let pool;
  try {
    for (const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime','c4g_import_worker_runtime'])
      await admin.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
    await admin.query('GRANT c4g_tenant_migrator TO c4g_f12_admin');
    await admin.query("CREATE DATABASE c4g_pq1_activation_core ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0");
    await admin.query('GRANT CONNECT,CREATE ON DATABASE c4g_pq1_activation_core TO c4g_tenant_owner');
    await admin.query('GRANT CONNECT ON DATABASE c4g_pq1_activation_core TO c4g_tenant_migrator,c4g_tenant_runtime');
    url.pathname = '/c4g_pq1_activation_core'; pool = new Pool({ connectionString: url.toString(), max: 5 });
    await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await pool.query('REVOKE CONNECT,TEMP ON DATABASE c4g_pq1_activation_core FROM PUBLIC');
    await pool.query('ALTER ROLE c4g_tenant_runtime IN DATABASE c4g_pq1_activation_core SET search_path TO pg_catalog,c4g_app');
    await createTenantMigrationRunner({ pool, observationPublisher: { async publish() {} }, timeoutMs: 15000,
      scheduler: { setTimeout, clearTimeout } }).migrate({ tenantId: id(1), databaseGenerationId: randomUUID(),
      expectedRevision: 1, correlationId: 'pq1-activation-core', idempotencyKey: 'pq1-activation-core' });
    const f = verify(fixture()), content = extract(f).content;
    await pool.query("INSERT INTO organization_profile.profile_scope(profile_scope_id,organization_id,scope_type) VALUES($1,$2,'ORGANIZATION')", [id(200),id(1)]);
    await pool.query("INSERT INTO organization_profile.competency_catalog_release(release_id,organization_id,release_version,lifecycle,semantic_digest) VALUES($1,$2,'synthetic-v1','PUBLISHED',$3)", [id(44),id(1),'a'.repeat(64)]);
    for (const [entry,kind] of [[42,'COMPETENCY_CONCEPT'],[71,'VERIFICATION_METHOD']])
      await pool.query('INSERT INTO organization_profile.competency_catalog_entry(entry_id,release_id,organization_id,kind,stable_code,max_validity_seconds) VALUES($1,$2,$3,$4,$4,$5)', [id(entry),id(44),id(1),kind,entry===71?3600:null]);
    await pool.query("INSERT INTO organization_profile.competency_assertion_version(version_id,assertion_id,organization_id,profile_scope_id,knowledge_status,concept_id,actor_subject_id,membership_id,correlation_id) VALUES($1,$2,$3,$4,'KNOWN',$5,$6,$7,$8)", [id(41),id(40),id(1),id(200),id(42),id(2),id(201),id(202)]);
    await pool.query("INSERT INTO organization_profile.competency_verification_result(verification_id,organization_id,profile_scope_id,assertion_version_id,method_id,verified_at,valid_until,status,material_digest,actor_subject_id,membership_id,correlation_id,authorization_evidence) VALUES($1,$2,$3,$4,$5,$6,$7,'VERIFIED',$8,$9,$10,$11,'{}')", [id(70),id(1),id(200),id(41),id(71),at,f.verifications[0].validUntil,f.verifications[0].materialDigest,id(3),id(201),id(202)]);
    const reader = await pool.connect(), writer = await pool.connect();
    const begin = async (c, org = id(1)) => { await c.query('BEGIN'); await c.query("SET LOCAL statement_timeout TO '3000ms'"); await c.query('SET LOCAL ROLE c4g_organization_profile_runtime'); await c.query("SELECT set_config('app.organization_id',$1,true)",[org]); };
    const lock = c => c.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-P1:' || $1::text,43001301))", [id(1)]);
    const revoke = c => c.query("INSERT INTO organization_profile.pq1_verification_status_event(event_id,organization_id,profile_scope_id,verification_id,sequence,status,reason_code,actor_subject_id,membership_id,recorded_at) VALUES($1,$2,$3,$4,1,'REVOKED','EVIDENCE_WITHDRAWN',$5,$6,$7)", [id(99),id(1),id(200),id(70),id(3),id(201),at]);
    try {
      await begin(reader);
      const original = await observeVerifications(reader,id(1),content,()=>new Date(at));
      assert.equal(original.verifications[0].status,'VERIFIED');
      await begin(writer); await writer.query("SET LOCAL lock_timeout TO '100ms'");
      await assert.rejects(lock(writer), { code: '55P03' }); await writer.query('ROLLBACK');
      await reader.query('COMMIT');
      // Writer first: uncommitted status is not observed; reader waits on SAME key.
      await begin(writer); await lock(writer); await revoke(writer);
      await begin(reader); await reader.query("SET LOCAL lock_timeout TO '100ms'");
      await assert.rejects(observeVerifications(reader,id(1),content,()=>new Date(at)), { code:'55P03' }); await reader.query('ROLLBACK');
      await writer.query('COMMIT');
      await begin(reader); const current = await observeVerifications(reader,id(1),content,()=>new Date(at));
      assert.equal(current.verifications[0].status,'REVOKED'); assert.equal(content.verifications[0].effectiveStatusAtSubmission,'VERIFIED'); await reader.query('COMMIT');
      // Foreign IDs under runtime/RLS cannot be used as absent proof.
      await begin(reader,id(999)); await assert.rejects(observeVerifications(reader,id(999),content,()=>new Date(at)),{code:'INTEGRITY_UNAVAILABLE'}); await reader.query('ROLLBACK');
      await begin(reader); await assert.rejects(reader.query('UPDATE organization_profile.pq1_verification_status_event SET reason_code=reason_code WHERE organization_id=$1',[id(1)])); await reader.query('ROLLBACK');
      // An autocommit caller must not obtain an observation as if a lock survived.
      await reader.query('SET ROLE c4g_organization_profile_runtime'); await reader.query("SELECT set_config('app.organization_id',$1,false)",[id(1)]);
      await assert.rejects(observeVerifications(reader,id(1),content,()=>new Date(at)),{code:'TRANSACTION_REQUIRED'}); await reader.query('RESET ROLE');
      console.log('PQ1_ACTIVATION_CORE_POSTGRES: PASS (real migrations, runtime/RLS, grouped ledger, both lock orderings, immutable history, autocommit refusal)');
    } finally { await reader.query('ROLLBACK').catch(()=>{}); await writer.query('ROLLBACK').catch(()=>{}); reader.release(); writer.release(); }
  } finally { if(pool)await pool.end(); await admin.end(); }
}
run().catch(error=>{ console.error(error.code||error.name, error.message?.startsWith('Assertion')?error.message:'targeted probe failed'); process.exitCode=1; });
