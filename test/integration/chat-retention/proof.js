'use strict';
// Disposable PostgreSQL proof for tenant migration 040_application_chat_retention.
// Loopback only, explicit operator opt-in; never touches usual environments.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '../../../backend');
const { Pool } = require(path.join(root, 'node_modules/pg'));
const { chatRetentionManifest: manifest } = require(path.join(root, 'src/security/tenantMigrationManifest'));
const { createTenantMigrationRunner } = require(path.join(root, 'src/security/tenantMigrationRunner'));

function target() {
  if (process.env.CHATRET_PROOF !== 'C4G_CHAT_RETENTION_LOCAL_V1') throw new Error('Disposable chat retention proof is required.');
  const url = new URL(process.env.CHATRET_ADMIN_URL);
  if (url.hostname !== '127.0.0.1' || url.port !== process.env.CHATRET_PORT || url.username !== 'docdel_admin' || url.pathname !== '/postgres') throw new Error('Unexpected disposable PostgreSQL target.');
  return url;
}
const withDb = (source, name) => { const url = new URL(source); url.pathname = `/${name}`; return url.toString(); };
const request = (label, identity) => ({ tenantId: identity.tenantId, databaseGenerationId: identity.databaseGenerationId, expectedRevision: 1, correlationId: `${label}-${crypto.randomUUID()}`, idempotencyKey: `${label}-${crypto.randomUUID()}` });
const uuid = () => crypto.randomUUID();
const checks = [];
const ok = (name, detail = null) => { checks.push({ name, result: 'PASS', detail }); if (process.env.CHATRET_DEBUG) process.stderr.write(`${name}
`); };

async function main() {
  const source = target(), admin = new Pool({ connectionString: source.toString(), max: 2 }), name = 'chatret_proof';
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
    const applied = await runner.migrate(request('chatret', identity));
    assert.equal(applied.appliedVersions.at(-1), '040_application_chat_retention');
    ok('official runner applied migration 040 (fingerprint and ledger match)', { last: applied.appliedVersions.at(-1) });
    assert.deepEqual((await runner.migrate(request('chatret-again', identity))).appliedVersions.filter(v => v.startsWith('040')), []); ok('re-running the runner is a no-op');

    const fn = (await pool.query(`SELECT pg_get_userbyid(proowner) AS owner, prosecdef FROM pg_proc WHERE proname='purge_closed_application_chat_v1'`)).rows[0];
    assert.deepEqual([fn.owner, fn.prosecdef], ['c4g_opportunity_tenant_owner', true]); ok('purge function is SECURITY DEFINER owned by the tenant owner');

    // --- synthetic data: one organization, applications in several states --------------------------------------
    const org = uuid(), other = uuid();
    const g = await pool.connect();
    await g.query("SET session_replication_role = 'replica'"); // synthetic rows without the whole catalogue graph
    const day = n => `now() - interval '${n} days'`;
    async function application(status, closedDaysAgo, messages, orgId = org) {
      const id = uuid(), membership = uuid();
      await g.query(`INSERT INTO opportunity_catalog.application(organization_id,application_id,opportunity_id,title,responsible_membership_id,deadline,status,created_by) VALUES($1,$2,$3,'t',$4,'2027-01-01',$5,$4)`, [orgId, id, uuid(), membership, status]);
      if (closedDaysAgo !== null) await g.query(`INSERT INTO opportunity_catalog.application_change(organization_id,application_id,revision,kind,from_status,to_status,title,responsible_membership_id,deadline,reason,actor_subject_id,recorded_at) VALUES($1,$2,2,'TRANSITION',$5,$3,'t',$4,'2027-01-01','r',$4,${day(closedDaysAgo)})`, [orgId, id, status, membership, status === 'PREPARATION' ? 'INTENTION' : 'PREPARATION']);
      await g.query('INSERT INTO opportunity_catalog.application_participant(organization_id,application_id,membership_id,active) VALUES($1,$2,$3,true)', [orgId, id, membership]).catch(() => {});
      const ids = [];
      for (let i = 0; i < messages; i++) {
        const messageId = uuid(); ids.push(messageId);
        await g.query('INSERT INTO opportunity_catalog.application_chat_message(organization_id,application_id,author_membership_id,message_id,body) VALUES($1,$2,$3,$4,$5)', [orgId, id, membership, messageId, `mensagem ${i}`]);
        await g.query('INSERT INTO opportunity_catalog.application_chat_receipt(organization_id,message_id,intention_digest) VALUES($1,$2,$3)', [orgId, messageId, 'a'.repeat(64)]);
      }
      return { id, membership, ids };
    }
    const archived91 = await application('ARCHIVED', 91, 3);
    const approved90 = await application('APPROVED', 90, 2);
    const cancelled30 = await application('CANCELLED', 30, 2);
    const active = await application('PREPARATION', 200, 2); // old transition, still active
    const reopened = await application('PREPARATION', 120, 1); // was closed long ago, reopened: status active
    const foreign = await application('ARCHIVED', 400, 1, other);
    await g.query("RESET session_replication_role"); g.release();
    const count = async (table, id) => Number((await pool.query(`SELECT count(*)::int AS n FROM opportunity_catalog.${table} WHERE ${table === 'application_chat_message' ? 'application_id' : 'message_id IN (SELECT message_id FROM opportunity_catalog.application_chat_message WHERE application_id'}=$1${table === 'application_chat_message' ? '' : ')'}`, [id])).rows[0].n);
    ok('synthetic applications and chat created');

    // --- privileges ---------------------------------------------------------------------------------------------
    const as = async (role, work, orgId = org) => { const c = await pool.connect(); try { await c.query('BEGIN'); await c.query(`SET LOCAL ROLE ${role}`); await c.query("SELECT set_config('app.organization_id',$1,true)", [orgId]); return await work(c); } finally { await c.query('ROLLBACK').catch(() => {}); c.release(); } };
    const call = (c, days = 90, limit = 50, orgId = org) => c.query('SELECT * FROM opportunity_catalog.purge_closed_application_chat_v1($1,$2,$3)', [orgId, days, limit]);
    await as('c4g_opportunity_tenant_runtime', async c => { await assert.rejects(c.query('DELETE FROM opportunity_catalog.application_chat_message'), /permission denied/); }); ok('application runtime cannot DELETE chat messages');
    await as('c4g_opportunity_tenant_runtime', async c => { await assert.rejects(call(c), /permission denied/); }); ok('application runtime cannot execute the purge');
    await as('c4g_tenant_runtime', async c => { await assert.rejects(call(c), /permission denied/); }); ok('other roles cannot execute the purge');
    await pool.query("SELECT 1"); // keep connection warm
    await as('c4g_chat_retention_runtime', async c => { await assert.rejects(call(c, 89), /CHAT_RETENTION_INVALID/); }); ok('retention below 90 days is refused by the function');
    await as('c4g_chat_retention_runtime', async c => { await assert.rejects(call(c, 90, 0), /CHAT_RETENTION_INVALID/); }); await as('c4g_chat_retention_runtime', async c => { await assert.rejects(call(c, 90, 501), /CHAT_RETENTION_INVALID/); }); ok('batch limit is bounded');

    // --- the purge ----------------------------------------------------------------------------------------------
    const purge = async (days = 90, limit = 50, orgId = org) => { const c = await pool.connect(); try { await c.query('BEGIN'); await c.query('SET LOCAL ROLE c4g_chat_retention_runtime'); const r = await call(c, days, limit, orgId); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };
    const first = await purge();
    const purged = new Map(first.map(row => [row.purged_application_id, row.purged_message_count]));
    assert.equal(purged.get(archived91.id), 3); assert.equal(purged.get(approved90.id), 2); ok('closed 91 and exactly 90 days ago are purged', { archived91: 3, approved90: 2 });
    assert.equal(purged.has(cancelled30.id), false); assert.equal(purged.has(active.id), false); assert.equal(purged.has(reopened.id), false); assert.equal(purged.has(foreign.id), false);
    assert.equal(await count('application_chat_message', cancelled30.id), 2); assert.equal(await count('application_chat_message', active.id), 2); assert.equal(await count('application_chat_message', reopened.id), 1);
    ok('closed 30 days ago, active and reopened applications are untouched');
    assert.equal(await count('application_chat_message', archived91.id), 0); assert.equal(await count('application_chat_message', approved90.id), 0);
    const receipts = Number((await pool.query('SELECT count(*)::int AS n FROM opportunity_catalog.application_chat_receipt WHERE organization_id=$1', [org])).rows[0].n);
    assert.equal(receipts, 5); ok('receipts of purged chats are deleted with their messages (5 remain)');
    assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM opportunity_catalog.application_chat_message WHERE organization_id=$1', [other])).rows[0].n), 1); ok('another organization is untouched');
    const log = (await pool.query('SELECT application_id,terminal_status,message_count,retention_days,purged_at,terminal_at FROM opportunity_catalog.application_chat_purge WHERE organization_id=$1 ORDER BY message_count DESC', [org])).rows;
    assert.deepEqual(log.map(r => [r.application_id, r.terminal_status, r.message_count, r.retention_days]), [[archived91.id, 'ARCHIVED', 3, 90], [approved90.id, 'APPROVED', 2, 90]]);
    assert.ok(!Object.keys(log[0]).some(key => /body|text/i.test(key))); ok('purge log records counts and dates, never text');
    assert.deepEqual(await purge(), []); ok('repeating the purge has no effect');

    // --- immutability stays for everything else -----------------------------------------------------------------
    await pool.query("SET session_replication_role = 'origin'");
    await assert.rejects(pool.query("DELETE FROM opportunity_catalog.application_chat_message WHERE application_id=$1", [active.id]), /F13_AUTHORING_APPEND_ONLY|permission|row-level|violates/);
    ok('direct DELETE of an active chat is still refused even for the owner session');
    await assert.rejects(pool.query("UPDATE opportunity_catalog.application_chat_purge SET message_count=0"), /F13_AUTHORING_APPEND_ONLY|row-level|violates/); ok('purge log is immutable');
    await assert.rejects(pool.query("TRUNCATE opportunity_catalog.application_chat_purge"), /F13_AUTHORING_APPEND_ONLY/); ok('TRUNCATE of the purge log is refused');

    // A later reopen->reclose restarts the clock: reopened application closes now.
    const c2 = await pool.connect();
    try {
      await c2.query("SET session_replication_role = 'replica'");
      await c2.query(`INSERT INTO opportunity_catalog.application_change(organization_id,application_id,revision,kind,from_status,to_status,title,responsible_membership_id,deadline,reason,actor_subject_id,recorded_at) VALUES($1,$2,3,'TRANSITION','PREPARATION','ARCHIVED','t',$3,'2027-01-01','r',$3,now())`, [org, reopened.id, reopened.membership]);
      await c2.query("UPDATE opportunity_catalog.application SET status='ARCHIVED' WHERE application_id=$1", [reopened.id]);
    } finally { await c2.query('RESET session_replication_role'); c2.release(); }
    assert.deepEqual(await purge(), []); assert.equal(await count('application_chat_message', reopened.id), 1); ok('an application closed again starts a new 90-day period');

    // --- the chat panel notice: the exact lookups chatGet runs, as the application runtime --------------------------
    await as('c4g_opportunity_tenant_runtime', async c => {
      assert.equal((await c.query("SELECT to_regclass('opportunity_catalog.application_chat_purge') IS NOT NULL AS present")).rows[0].present, true);
      assert.equal((await c.query("SELECT to_regclass('opportunity_catalog.table_that_does_not_exist') IS NOT NULL AS present")).rows[0].present, false);
      const seen = await c.query('SELECT purged_at FROM opportunity_catalog.application_chat_purge WHERE organization_id=$1 AND application_id=$2', [org, archived91.id]);
      assert.equal(seen.rowCount, 1); assert.ok(seen.rows[0].purged_at instanceof Date);
      assert.equal((await c.query('SELECT 1 FROM opportunity_catalog.application_chat_purge WHERE organization_id=$1 AND application_id=$2', [org, cancelled30.id])).rowCount, 0);
    }); ok('runtime reads the purge date of a purged application, and nothing for one that was not purged');
    await as('c4g_opportunity_tenant_runtime', async c => {
      assert.equal((await c.query('SELECT 1 FROM opportunity_catalog.application_chat_purge WHERE application_id=$1', [archived91.id])).rowCount, 0);
    }, other); ok('another organization cannot see the purge record (RLS); a missing table reports absent without error');
    await as('c4g_opportunity_tenant_runtime', async c => { await assert.rejects(c.query("INSERT INTO opportunity_catalog.application_chat_purge(organization_id,application_id,terminal_status,terminal_at,message_count,retention_days) VALUES($1,$2,'ARCHIVED',now(),0,90)", [org, active.id]), /permission denied/); }); ok('runtime cannot write the purge log');

    const result = checks.every(c => c.result === 'PASS') ? 'PASS' : 'FAIL';
    console.log(JSON.stringify({ result, checks }, null, 1));
    if (result !== 'PASS') process.exitCode = 1;
  } catch (error) { report(error); process.exit(1); } finally { await pool?.end(); await admin.end(); }
}
function report(error) { process.stderr.write(JSON.stringify({ name: error.name, code: error.code || null, internalCode: error.internalCode || null, message: error.message, detail: error.detail || null, stack: error.stack ? error.stack.split(String.fromCharCode(10)).slice(0, 6) : null, checks: checks.length }) + String.fromCharCode(10)); }
main().catch(error => { report(error); process.exitCode = 1; });
