'use strict';
// Disposable PostgreSQL proof for registered tenant migration 039_document_deletion (official runner, ledger and fingerprint).
// Refuses anything except a loopback database named explicitly by the operator; never touches usual environments.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../../backend');
const { Pool } = require(path.join(root, 'node_modules/pg'));
const { documentDeletionManifest: manifest } = require(path.join(root, 'src/security/tenantMigrationManifest'));
const { createTenantMigrationRunner } = require(path.join(root, 'src/security/tenantMigrationRunner'));
const { createDocumentRepository } = require(path.join(root, 'src/documents/repository'));

function target() {
  if (process.env.DOCDEL_PROOF !== 'C4G_DOCUMENT_DELETION_LOCAL_V1') throw new Error('Disposable document deletion proof is required.');
  const url = new URL(process.env.DOCDEL_ADMIN_URL);
  if (url.hostname !== '127.0.0.1' || url.port !== process.env.DOCDEL_PORT || url.username !== 'docdel_admin' || url.pathname !== '/postgres') throw new Error('Unexpected disposable PostgreSQL target.');
  return url;
}
const withDb = (source, name) => { const url = new URL(source); url.pathname = `/${name}`; return url.toString(); };
const request = (label, identity) => ({ tenantId: identity.tenantId, databaseGenerationId: identity.databaseGenerationId, expectedRevision: 1, correlationId: `${label}-${crypto.randomUUID()}`, idempotencyKey: `${label}-${crypto.randomUUID()}` });
const uuid = () => crypto.randomUUID();
const checks = [];
const ok = (name, detail = null) => { checks.push({ name, result: 'PASS', detail }); };

async function main() {
  const source = target(), admin = new Pool({ connectionString: source.toString(), max: 2 }), name = 'docdel_proof';
  let pool;
  try {
    for (const role of ['c4g_tenant_owner', 'c4g_tenant_migrator', 'c4g_tenant_runtime', 'c4g_import_worker_runtime'])
      await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$`);
    await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
    await admin.query('GRANT c4g_tenant_migrator TO docdel_admin');
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
    await admin.query(`ALTER DATABASE ${name} SET timezone TO 'UTC'`);
    await admin.query(`GRANT CONNECT,CREATE ON DATABASE ${name} TO c4g_tenant_owner`);
    await admin.query(`GRANT CONNECT ON DATABASE ${name} TO c4g_tenant_migrator,c4g_tenant_runtime`);
    pool = new Pool({ connectionString: withDb(source, name), max: 4 });
    await pool.query(`REVOKE CONNECT,TEMP ON DATABASE ${name} FROM PUBLIC`);
    await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await pool.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${name} SET search_path TO pg_catalog,c4g_app`);
    const identity = { tenantId: uuid(), databaseGenerationId: uuid() };
    const runner = createTenantMigrationRunner({ pool, entries: manifest, observationPublisher: { async publish() {} }, timeoutMs: 120000, scheduler: { setTimeout, clearTimeout } });
    const applied = await runner.migrate(request('docdel', identity));
    ok('official tenant migrations applied', { count: applied.appliedVersions.length, last: applied.appliedVersions.at(-1) });

    assert.equal(applied.appliedVersions.at(-1), '039_document_deletion');
    const owners = (await pool.query(`SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='document_storage' AND p.proname LIKE '%\_document\_deletion' ORDER BY 1`)).rows;
    assert.deepEqual(owners.map(row => [row.proname, row.owner, row.prosecdef]), [['begin_document_deletion', 'c4g_document_owner', true], ['cancel_document_deletion', 'c4g_document_owner', true], ['finish_document_deletion', 'c4g_document_owner', true]]);
    ok('migration 039 registered, applied by the official runner; functions owned by c4g_document_owner (SECURITY DEFINER)', owners.map(row => row.proname));
    const again = await runner.migrate(request('docdel-again', identity));
    assert.deepEqual(again.appliedVersions.filter(version => version === '039_document_deletion'), []); ok('re-running the runner is a no-op');

    // Synthetic data (superuser inserts; behaviour is then exercised through the runtime role).
    const orgA = uuid(), orgB = uuid(), app = uuid();
    async function seed(org, resourceId, state = 'AVAILABLE', size = 1000) {
      const documentId = uuid(), versionId = uuid();
      await pool.query(`INSERT INTO document_storage.document(document_id,organization_id,resource_type,resource_id,created_by_actor_id,correlation_id) VALUES($1,$2,'DOCUMENT_OWNER',$3,'a',$4)`, [documentId, org, resourceId, uuid()]);
      const available = state === 'AVAILABLE';
      await pool.query(`INSERT INTO document_storage.document_version(version_id,document_id,organization_id,version_number,object_id,storage_class,expected_size,expected_file_class,expected_sha256,observed_size,declared_mime,display_filename,sha256,state,scan_state,idempotency_key,correlation_id,created_by_actor_id)
        VALUES($1,$2,$3,1,$4,'DOCUMENTS',$5,'PDF',$6,$7,'application/pdf','a.pdf',$8,$9,$10,$11,$12,'a')`,
        [versionId, documentId, org, uuid(), size, 'a'.repeat(64), available ? size : null, available ? 'a'.repeat(64) : null, state, available ? 'CLEAN' : 'NOT_REQUESTED', `key-${uuid()}`, uuid()]);
      return { documentId, versionId };
    }
    const repository = createDocumentRepository(pool);
    const state = async id => (await pool.query('SELECT state FROM document_storage.document_version WHERE version_id=$1', [id])).rows[0].state;

    const one = await seed(orgA, app);
    const begun = await repository.beginDeletion({ organizationId: orgA, ...one, resourceId: app, fromState: 'AVAILABLE' });
    assert.equal(begun?.state, 'DELETE_PENDING'); ok('begin reserves AVAILABLE document as DELETE_PENDING');
    assert.equal(await repository.beginDeletion({ organizationId: orgA, ...one, resourceId: app, fromState: 'AVAILABLE' }), null); ok('second begin does not match (idempotent guard)');
    const cancelled = await repository.cancelDeletion({ organizationId: orgA, ...one, toState: 'AVAILABLE' });
    assert.equal(cancelled?.state, 'AVAILABLE'); ok('cancel restores AVAILABLE');
    const wrongOwner = await repository.beginDeletion({ organizationId: orgA, ...one, resourceId: uuid(), fromState: 'AVAILABLE' });
    assert.equal(wrongOwner, null); assert.equal(await state(one.versionId), 'AVAILABLE'); ok('wrong owner application is refused');
    assert.equal(await repository.beginDeletion({ organizationId: orgA, ...one, resourceId: app, fromState: 'SCANNING' }), null); ok('non-deletable fromState is refused');

    await repository.beginDeletion({ organizationId: orgA, ...one, resourceId: app, fromState: 'AVAILABLE' });
    let finishError = null, finished = null;
    try { finished = await repository.finishDeletion({ organizationId: orgA, ...one }); } catch (error) { finishError = error; }
    checks.push({ name: 'finish moves DELETE_PENDING to DELETED', result: finishError ? 'FAIL' : (finished?.state === 'DELETED' ? 'PASS' : 'FAIL'), detail: finishError ? { code: finishError.code, constraint: finishError.constraint, message: finishError.message } : { state: finished?.state } });

    // Isolation and privileges.
    const two = await seed(orgA, app);
    const rls = await pool.connect();
    try {
      await rls.query('BEGIN'); await rls.query('SET LOCAL ROLE c4g_document_runtime'); await rls.query("SELECT set_config('app.organization_id',$1,true)", [orgB]);
      const mismatch = await rls.query('SELECT * FROM document_storage.begin_document_deletion($1,$2,$3,$4,$5)', [orgA, two.documentId, two.versionId, app, 'AVAILABLE']);
      assert.equal(mismatch.rowCount, 0); await rls.query('ROLLBACK'); ok('organization other than session setting returns nothing');
      await rls.query('BEGIN'); await rls.query('SET LOCAL ROLE c4g_document_runtime'); await rls.query("SELECT set_config('app.organization_id',$1,true)", [orgA]);
      await assert.rejects(rls.query("UPDATE document_storage.document_version SET state='DELETED' WHERE version_id=$1", [two.versionId]), /permission denied/); await rls.query('ROLLBACK'); ok('runtime cannot update document_version directly');
      await rls.query('BEGIN'); await rls.query('SET LOCAL ROLE c4g_tenant_runtime');
      await assert.rejects(rls.query('SELECT * FROM document_storage.finish_document_deletion($1,$2,$3)', [orgA, two.documentId, two.versionId]), /permission denied/); await rls.query('ROLLBACK'); ok('other roles cannot execute deletion functions');
    } finally { rls.release(); }

    // Post-fix behaviour of the final state and quota.
    const sum = async org => Number((await pool.query(`SELECT COALESCE(SUM(expected_size),0)::bigint AS used FROM document_storage.document_version WHERE organization_id=$1 AND state NOT IN ('CANCELLED','EXPIRED','DELETED')`, [org])).rows[0].used);
    assert.equal(await state(one.versionId), 'DELETED'); ok('DELETED persisted');
    assert.equal(await sum(orgA), 1000); ok('DELETED stops counting towards quota (only the second document remains)', { used: await sum(orgA) });
    assert.equal(await repository.finishDeletion({ organizationId: orgA, ...one }), null); ok('finish is not repeatable');
    assert.equal(await repository.beginDeletion({ organizationId: orgA, ...one, resourceId: app, fromState: 'AVAILABLE' }), null); ok('DELETED cannot be reserved again');
    assert.equal(await repository.cancelDeletion({ organizationId: orgA, ...one, toState: 'AVAILABLE' }), null); ok('DELETED cannot be cancelled back');
    const quarantined = await seed(orgA, app, 'QUARANTINED', 500);
    assert.equal((await repository.beginDeletion({ organizationId: orgA, ...quarantined, resourceId: app, fromState: 'QUARANTINED' }))?.state, 'DELETE_PENDING');
    assert.equal((await repository.cancelDeletion({ organizationId: orgA, ...quarantined, toState: 'QUARANTINED' }))?.state, 'QUARANTINED'); ok('QUARANTINED round trip');

    // Application guard SQL (copied from documentsReview.js) against the real tables; FKs bypassed for synthetic rows.
    const guardSql = `SELECT 1 FROM opportunity_catalog.application_document_link l JOIN opportunity_catalog.application a ON a.organization_id=l.organization_id AND a.application_id=l.application_id
      WHERE l.organization_id=$1 AND l.document_id=$2 AND (l.active OR a.status IN ('SUBMITTED','APPROVED','REJECTED','ARCHIVED'))
     UNION ALL SELECT 1 FROM opportunity_catalog.application_review_item WHERE organization_id=$1 AND document_id=$2 LIMIT 1`;
    const g = await pool.connect();
    try {
      await g.query("SET session_replication_role = 'replica'");
      const protectedBy = async (status, active) => {
        const applicationId = uuid(), doc = await seed(orgA, applicationId);
        await g.query(`INSERT INTO opportunity_catalog.application(organization_id,application_id,opportunity_id,title,responsible_membership_id,deadline,status,created_by) VALUES($1,$2,$3,'t',$4,'2027-01-01',$5,$4)`, [orgA, applicationId, uuid(), uuid(), status]);
        await g.query('INSERT INTO opportunity_catalog.application_document_link(organization_id,application_id,document_id,version_id,active) VALUES($1,$2,$3,$4,$5)', [orgA, applicationId, doc.documentId, doc.versionId, active]);
        return (await g.query(guardSql, [orgA, doc.documentId])).rowCount > 0;
      };
      assert.equal(await protectedBy('PREPARATION', true), true); ok('guard blocks active link');
      assert.equal(await protectedBy('PREPARATION', false), false); ok('guard allows removed link on application in preparation');
      assert.equal(await protectedBy('ARCHIVED', false), true); ok('guard blocks removed link on archived application');
      const free = await seed(orgA, app);
      assert.equal((await g.query(guardSql, [orgA, free.documentId])).rowCount, 0); ok('guard allows unlinked document');
      const allowed = await pool.query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='opportunity_catalog.application'::regclass AND conname='application_status_check'");
      ok('application status values in schema applied by manifest', { definition: allowed.rows[0]?.def });
    } finally { await g.query('RESET session_replication_role').catch(() => {}); g.release(); }

    console.log(JSON.stringify({ result: checks.every(c => c.result === 'PASS') ? 'PASS' : 'FAIL', checks }, null, 1));
    if (!checks.every(c => c.result === 'PASS')) process.exitCode = 1;
  } finally { await pool?.end(); await admin.end(); }
}
main().catch(error => { process.stderr.write(`${JSON.stringify({ name: error.name, code: error.code || null, internalCode: error.internalCode || null, message: error.message, stack: error.stack?.split('\n').slice(0, 6), checks })}\n`); process.exitCode = 1; });
