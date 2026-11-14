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
    await service({ pool, ids, sessions });
  } finally {
    await runtime.end();
  }
}

// The application service over the same database: administrator view, edition,
// collection from a synthetic site and the reader's effective complement.
async function service({ pool, ids, sessions }) {
  const { createOpportunityComplementService } = require(path.resolve(__dirname, '../../../backend/src/opportunities/complementService'));
  const { adaptNotice } = require(path.resolve(__dirname, '../../../backend/src/portugal2030/noticeSite'));
  const request = who => ({ authContext: { sessionId: sessions[who] }, sessionID: sessions[who], user: { id: ids[who === 'expiredAdmin' ? 'admin' : who] } });
  const planned = { '7937': randomUUID(), '8000': randomUUID() }, manual = randomUUID();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL session_replication_role='replica'");
    for (const [opportunityId, records] of [[planned['7937'], [{ namespace: 'PORTUGAL2030_PLAN', externalId: '7937' }]], [planned['8000'], [{ namespace: 'PORTUGAL2030_PLAN', externalId: '8000' }]], [manual, null]]) {
      const revisionId = randomUUID();
      await c.query(`INSERT INTO opportunity_catalog.revision(revision_id,opportunity_id,revision_number,row_version,snapshot,normalized_projection,quality_projection,content_digest)
        VALUES($1,$2,1,1,$3,'{}','{}',$4)`, [revisionId, opportunityId, JSON.stringify(records ? { schemaVersion: 2, contractVersion: 'opportunity-v2.0', sourceRecords: records } : { schemaVersion: 1, title: 'Manual' }), 'a'.repeat(64)]);
      await c.query(`INSERT INTO opportunity_catalog.opportunity(opportunity_id,current_revision_id,revision_number,row_version,lifecycle_state,validation_state,title,funder_name,
        quality_score,quality_bucket,content_digest,normalization_version,quality_rule_version)
        VALUES($1,$2,1,1,'ACTIVE','PENDING_REVIEW','Synthetic complement opportunity','Synthetic',0,'LOW',$3,'opportunity-normalization-v1','opportunity-quality-v1')`, [opportunityId, revisionId, 'a'.repeat(64)]);
    }
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally { c.release(); }

  const notice = (id, summary) => adaptNotice({ link: `https://portugal2030.pt/aviso/aviso-${id}/`, modified_gmt: '2026-09-14T17:19:38', title: { rendered: 'Aviso ' + id },
    yoast_head_json: { og_description: summary }, acf: { id, codigo: 'FA' + id, prioridade: ['4A'], comparticipacao: 85 } });
  let published = [notice('7937', 'Resumo publicado do aviso [&hellip;]'), notice('8000', 'Outro resumo.'), notice('9999', 'Sem oportunidade.')];
  const readSite = async () => ({ sourceNamespace: 'PORTUGAL2030_SITE', observedAt: '2026-11-14T10:00:00.000Z', total: published.length + 1, skipped: 1, ambiguous: [], notices: published });
  const off = createOpportunityComplementService({ centralPool: pool, readSite });
  const facts = createOpportunityComplementService({ centralPool: pool, collectionMode: 'facts', readSite });
  const full = createOpportunityComplementService({ centralPool: pool, collectionMode: 'facts-and-summary', readSite });
  const code = value => ({ code: value });

  // --- administrator only, and only on opportunities that exist
  await assert.rejects(off.get(manual, request('outsider')), code('C4G_ADMIN_REQUIRED'));
  await assert.rejects(off.get(manual, request('expiredAdmin')), code('C4G_ADMIN_REQUIRED'));
  await assert.rejects(off.save(manual, { fields: {}, expectedRevision: 0, idempotencyKey: randomUUID() }, request('outsider')), code('C4G_ADMIN_REQUIRED'));
  await assert.rejects(off.get(randomUUID(), request('admin')), code('RESOURCE_NOT_AVAILABLE'));
  await assert.rejects(off.save(randomUUID(), { fields: {}, expectedRevision: 0, idempotencyKey: randomUUID() }, request('admin')), code('RESOURCE_NOT_AVAILABLE'));
  assert.equal(await off.effective(manual), null);
  const empty = await off.get(manual, request('admin'));
  assert.deepEqual([empty.editorial, empty.collected, empty.effective], [{ fields: {}, revision: 0, updatedAt: null, updatedBy: null }, null, null]);

  // --- edition of any opportunity, with staleness and refused input
  const key = randomUUID(), body = { fields: { description: 'Descrição escrita\npela C4G.', cofinancingRate: 70 }, expectedRevision: 0, idempotencyKey: key };
  const saved = await off.save(manual, body, request('admin'));
  assert.deepEqual([saved.editorial.revision, saved.editorial.updatedBy, saved.effective.fields.description], [1, ids.admin + '@example.invalid', { value: 'Descrição escrita\npela C4G.', origin: 'EDITORIAL' }]);
  assert.equal((await off.save(manual, body, request('admin'))).editorial.revision, 1);
  await assert.rejects(off.save(manual, { ...body, idempotencyKey: randomUUID() }, request('admin')), code('STALE_REVISION'));
  await assert.rejects(off.save(manual, { ...body, fields: { title: 'x' } }, request('admin')), code('INVALID_INPUT'));
  await assert.rejects(off.save(manual, { fields: {}, expectedRevision: 1 }, request('admin')), code('INVALID_INPUT'));
  assert.deepEqual(await off.effective(manual), saved.effective);

  // --- collection: off by default, facts only, then facts with the published summary
  await assert.rejects(off.collect({ idempotencyKey: randomUUID() }, request('admin')), code('COLLECTION_NOT_CONFIGURED'));
  await assert.rejects(facts.collect({ idempotencyKey: randomUUID() }, request('outsider')), code('C4G_ADMIN_REQUIRED'));
  const sweep = randomUUID();
  const firstSweep = await facts.collect({ idempotencyKey: sweep }, request('admin'));
  assert.deepEqual(firstSweep, { mode: 'facts', observedAt: '2026-11-14T10:00:00.000Z', published: 4, skipped: 1, ambiguous: 0, matched: 2, unmatched: 1, written: 2, unchanged: 0 });
  assert.deepEqual(Object.keys((await off.effective(planned['7937'])).fields).sort(), ['cofinancingRate', 'noticeCode', 'officialUrl', 'priorities']);
  assert.deepEqual([(await facts.collect({ idempotencyKey: randomUUID() }, request('admin'))).written, 0], [0, 0]);
  const second = await full.collect({ idempotencyKey: randomUUID() }, request('admin'));
  assert.deepEqual([second.written, second.unchanged], [2, 0]);
  const described = (await off.effective(planned['7937'])).fields.description;
  assert.deepEqual(described, { value: 'Resumo publicado do aviso', origin: 'COLLECTED', sourceUrl: 'https://portugal2030.pt/aviso/aviso-7937/', observedAt: '2026-11-14T10:00:00.000Z', truncated: true });

  // --- a later collection never overrides what the administrator wrote
  await off.save(planned['7937'], { fields: { description: 'Texto da C4G' }, expectedRevision: 0, idempotencyKey: randomUUID() }, request('admin'));
  published = [notice('7937', 'Resumo alterado na fonte.'), notice('8000', 'Outro resumo.')];
  const third = await full.collect({ idempotencyKey: randomUUID() }, request('admin'));
  assert.deepEqual([third.written, third.unchanged], [1, 1]);
  const view = await off.get(planned['7937'], request('admin'));
  assert.deepEqual([view.collected.fields.description, view.effective.fields.description, view.effective.fields.noticeCode.origin],
    ['Resumo alterado na fonte.', { value: 'Texto da C4G', origin: 'EDITORIAL' }, 'COLLECTED']);
  // Clearing the administrator's layer gives the collected value back.
  await off.save(planned['7937'], { fields: {}, expectedRevision: 1, idempotencyKey: randomUUID() }, request('admin'));
  assert.equal((await off.effective(planned['7937'])).fields.description.value, 'Resumo alterado na fonte.');
  // A site that cannot be read writes nothing.
  const broken = createOpportunityComplementService({ centralPool: pool, collectionMode: 'facts', readSite: async () => { throw new Error('offline'); } });
  await assert.rejects(broken.collect({ idempotencyKey: randomUUID() }, request('admin')), code('SOURCE_UNAVAILABLE'));
}

module.exports = { verify };
