'use strict';
// Exercises the 053 write boundary as the runtime role, with synthetic rows only.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { Pool } = require('../../../backend/node_modules/pg');
const { complementDigest } = require(path.resolve(__dirname, '../../../backend/src/opportunities/complement'));

const raised = message => error => error.message === message;
const WRITE = 'SELECT * FROM public.opportunity_complement_write($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)';

async function fixtures(pool) {
  const ids = { admin: randomUUID(), outsider: randomUUID() }, sessions = {};
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL session_replication_role='replica'");
    for (const key of ['admin', 'outsider']) {
      await c.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Synthetic complement test',$2,'ACTIVE')", [ids[key], ids[key] + '@example.invalid']);
    }
    await c.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')", [randomUUID(), ids.admin]);
    for (const [key, user, interval] of [['admin', ids.admin, '1 hour'], ['outsider', ids.outsider, '1 hour'], ['expiredAdmin', ids.admin, '-1 hour']]) {
      sessions[key] = randomUUID();
      await c.query(`INSERT INTO public.application_session(sid,global_user_id,status,revocation_version,created_at,last_seen_at,expires_at)
        VALUES($1,$2,'ACTIVE',1,clock_timestamp(),clock_timestamp(),clock_timestamp()+$3::interval)`, [sessions[key], user, interval]);
    }
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
  return { ids, sessions };
}

async function verify({ pool, port }) {
  const { ids, sessions } = await fixtures(pool);
  const runtime = new Pool({ host: '127.0.0.1', port, user: 'c4g_f12_admin', database: 'postgres', options: '-c role=c4g_central_runtime' });
  const opportunity = randomUUID(), other = randomUUID();
  const write = async (who, actor, { target = opportunity, layer = 'EDITORIAL', fields = { description: 'Texto da C4G' }, sha, request = randomUUID(), expected,
    namespace = null, url = null, modified = null, observed = null, truncated = null }) =>
    (await runtime.query(WRITE, [sessions[who], ids[actor], randomUUID(), target, layer, JSON.stringify(fields), sha || complementDigest(fields),
      namespace, url, modified, observed, truncated, request, expected])).rows[0];
  const collected = { namespace: 'PORTUGAL2030_SITE', url: 'https://portugal2030.pt/aviso/x/', modified: '2026-09-14T17:19:38Z', observed: '2026-11-14T10:00:00Z', truncated: true };

  try {
    // --- who may write
    await assert.rejects(write('outsider', 'outsider', { expected: 0 }), raised('C4G_ADMIN_REQUIRED'));
    await assert.rejects(write('expiredAdmin', 'admin', { expected: 0 }), raised('C4G_ADMIN_REQUIRED'));
    await assert.rejects(write('admin', 'outsider', { expected: 0 }), raised('C4G_ADMIN_REQUIRED'));

    // --- versions, staleness and repetition
    const request = randomUUID();
    const first = await write('admin', 'admin', { request, expected: 0 });
    assert.deepEqual([first.version, first.layer, first.created_by, first.source_url, first.observed_at], [1, 'EDITORIAL', ids.admin, null, null]);
    assert.deepEqual(first.fields, { description: 'Texto da C4G' });
    assert.equal((await write('admin', 'admin', { request, expected: 0 })).id, first.id);
    await assert.rejects(write('admin', 'admin', { request, expected: 0, fields: { description: 'Outro texto' } }), raised('IDEMPOTENCY_CONFLICT'));
    await assert.rejects(write('admin', 'admin', { request, expected: 1 }), raised('IDEMPOTENCY_CONFLICT'));
    await assert.rejects(write('admin', 'admin', { expected: 0 }), raised('STALE_REVISION'));
    await assert.rejects(write('admin', 'admin', { expected: null }), raised('STALE_REVISION'));
    assert.equal((await write('admin', 'admin', { expected: 1, fields: {} })).version, 2);

    // --- layers and opportunities are independent; one request may cover many opportunities
    const sweep = randomUUID();
    assert.equal((await write('admin', 'admin', { layer: 'COLLECTED', request: sweep, expected: 0, ...collected })).version, 1);
    const elsewhere = await write('admin', 'admin', { target: other, layer: 'COLLECTED', request: sweep, expected: 0, ...collected });
    assert.deepEqual([elsewhere.version, elsewhere.source_namespace, elsewhere.description_truncated], [1, 'PORTUGAL2030_SITE', true]);
    // An editorial row never carries source data, whatever the caller sends.
    const mixed = await write('admin', 'admin', { target: other, expected: 0, ...collected });
    assert.deepEqual([mixed.source_namespace, mixed.source_url, mixed.observed_at, mixed.description_truncated], [null, null, null, null]);

    // --- refused shapes
    await assert.rejects(write('admin', 'admin', { layer: 'OTHER', expected: 0 }), raised('INVALID_INPUT'));
    await assert.rejects(write('admin', 'admin', { target: randomUUID(), layer: 'COLLECTED', expected: 0 }), { code: '23514' });
    await assert.rejects(write('admin', 'admin', { target: randomUUID(), layer: 'COLLECTED', expected: 0, ...collected, url: 'http://portugal2030.pt/aviso/x/' }), { code: '23514' });
    await assert.rejects(write('admin', 'admin', { target: randomUUID(), expected: 0, sha: 'not-a-digest' }), { code: '23514' });
    await assert.rejects(runtime.query(WRITE, [sessions.admin, ids.admin, randomUUID(), randomUUID(), 'EDITORIAL', '[]', 'a'.repeat(64), null, null, null, null, null, randomUUID(), 0]), { code: '23514' });

    // --- the history cannot be rewritten, by the runtime role or by the administrator
    await assert.rejects(runtime.query('INSERT INTO public.opportunity_complement_version(id) VALUES($1)', [randomUUID()]), { code: '42501' });
    await assert.rejects(runtime.query('UPDATE public.opportunity_complement_version SET version=9'), { code: '42501' });
    await assert.rejects(runtime.query('DELETE FROM public.opportunity_complement_version'), { code: '42501' });
    await assert.rejects(pool.query('UPDATE public.opportunity_complement_version SET version=9'), raised('OPPORTUNITY_COMPLEMENT_HISTORY_IMMUTABLE'));
    await assert.rejects(pool.query('DELETE FROM public.opportunity_complement_version'), raised('OPPORTUNITY_COMPLEMENT_HISTORY_IMMUTABLE'));
    await assert.rejects(pool.query('TRUNCATE public.opportunity_complement_version'), raised('OPPORTUNITY_COMPLEMENT_HISTORY_IMMUTABLE'));
    assert.equal((await runtime.query('SELECT count(*)::int AS n FROM public.opportunity_complement_version')).rows[0].n, 5);

    // --- a concurrent second writer waits and then sees the first one's version
    const racing = randomUUID();
    const results = await Promise.allSettled([1, 2].map(() => write('admin', 'admin', { target: racing, expected: 0, fields: { noticeCode: 'A' + randomUUID().slice(0, 8) } })));
    assert.deepEqual(results.map(item => item.status).sort(), ['fulfilled', 'rejected']);
    assert.equal(results.find(item => item.status === 'rejected').reason.message, 'STALE_REVISION');
  } finally {
    await runtime.end();
  }
}

module.exports = { verify };
