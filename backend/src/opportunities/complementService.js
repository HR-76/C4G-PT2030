'use strict';
// Opportunity complement API (Central 053). The runtime role only reads the
// version table and calls the write function: who may write, which version
// comes next and who the author is are decided inside the database function.
const { randomUUID } = require('node:crypto');
const { FIELDS, complementLayer, complementDigest, effectiveComplement } = require('./complement');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SQL = Object.freeze({
  admin: 'SELECT public.email_platform_admin($1,$2) AS allowed',
  opportunity: 'SELECT 1 FROM opportunity_catalog.opportunity WHERE opportunity_id=$1',
  // The current row of each layer: its highest version.
  current: `SELECT DISTINCT ON (v.layer) v.layer, v.version, v.fields, v.content_sha256, v.source_url, v.observed_at,
      v.description_truncated, v.created_at, u.primary_email AS author
    FROM public.opportunity_complement_version v JOIN public.global_user u ON u.id=v.created_by
    WHERE v.opportunity_id=$1 ORDER BY v.layer, v.version DESC`,
  effective: `SELECT DISTINCT ON (v.layer) v.layer, v.fields, v.source_url, v.observed_at, v.description_truncated
    FROM public.opportunity_complement_version v WHERE v.opportunity_id=$1 ORDER BY v.layer, v.version DESC`,
  write: 'SELECT (public.opportunity_complement_write($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)).version AS version',
  // Catalog opportunities that came from the annual plan, by the identifier the plan gives them.
  planOpportunities: `SELECT o.opportunity_id AS "opportunityId", source->>'externalId' AS "planId"
    FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.snapshot->'sourceRecords')='array' THEN r.snapshot->'sourceRecords' ELSE '[]'::jsonb END) source
    WHERE source->>'namespace'='PORTUGAL2030_PLAN'`,
  collected: `SELECT DISTINCT ON (v.opportunity_id) v.opportunity_id AS "opportunityId", v.version, v.content_sha256 AS digest
    FROM public.opportunity_complement_version v WHERE v.layer='COLLECTED' AND v.opportunity_id=ANY($1::uuid[])
    ORDER BY v.opportunity_id, v.version DESC`,
});
// What the collection may copy from the public site. The summary is text of the
// site's owner, so copying it is a separate, explicit choice of the deployment.
const COLLECTION_MODES = Object.freeze(['disabled', 'facts', 'facts-and-summary']);
// What the database write function raises, by name. Anything else stays internal.
const DATABASE_CODES = Object.freeze(['C4G_ADMIN_REQUIRED', 'INVALID_INPUT', 'IDEMPOTENCY_CONFLICT', 'STALE_REVISION']);

function fail(code) { throw Object.assign(new Error(code), { code }); }
function translate(error) {
  if (error?.code && !/^[0-9A-Z]{5}$/.test(String(error.code))) return error;
  const code = DATABASE_CODES.find(item => error?.message === item);
  if (code) return Object.assign(new Error(code), { code });
  if (['23505', '40001', '40P01', '55P03'].includes(error?.code)) return Object.assign(new Error('STATE_CONFLICT'), { code: 'STATE_CONFLICT' });
  if (error?.code === '23514') return Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' });
  return error;
}
function plainObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_INPUT');
  const present = Object.keys(value);
  if (present.length !== keys.length || present.some(key => !keys.includes(key))) fail('INVALID_INPUT');
  return value;
}
const identifier = (value, code = 'INVALID_INPUT') => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : fail(code);
function layer(input) {
  try { return complementLayer(input); } catch { return fail('INVALID_INPUT'); }
}

function createOpportunityComplementService({ centralPool, collectionMode = 'disabled', readSite = options => require('../portugal2030/noticeSite').readNoticeSite(options),
  clock = () => new Date(), uuid = randomUUID } = {}) {
  if (typeof centralPool?.connect !== 'function' || !COLLECTION_MODES.includes(collectionMode) || typeof readSite !== 'function'
    || typeof clock !== 'function' || typeof uuid !== 'function') throw new TypeError('Opportunity complement service composition is invalid.');

  function actor(request) {
    const sessionId = request?.authContext?.sessionId, actorId = request?.user?.id;
    if (!sessionId || sessionId !== request.sessionID || typeof actorId !== 'string' || !UUID.test(actorId)) fail('C4G_ADMIN_REQUIRED');
    return { sessionId, actorId };
  }
  async function transaction(mode, work) {
    const client = await centralPool.connect();
    try {
      await client.query(mode === 'read' ? 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      await client.query("SET LOCAL statement_timeout='20s'");
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* the original failure is the one reported */ }
      throw translate(error);
    } finally { client.release(); }
  }
  async function authorize(client, request) {
    const who = actor(request);
    if ((await client.query(SQL.admin, [who.sessionId, who.actorId])).rows[0]?.allowed !== true) fail('C4G_ADMIN_REQUIRED');
    return who;
  }
  async function existing(client, opportunityId) {
    if (!(await client.query(SQL.opportunity, [opportunityId])).rowCount) fail('RESOURCE_NOT_AVAILABLE');
  }
  const layers = rows => {
    const byLayer = Object.fromEntries(rows.map(row => [row.layer, row]));
    const collected = byLayer.COLLECTED ? { fields: complementLayer(byLayer.COLLECTED.fields), sourceUrl: byLayer.COLLECTED.source_url,
      observedAt: new Date(byLayer.COLLECTED.observed_at).toISOString(), descriptionTruncated: byLayer.COLLECTED.description_truncated === true } : null;
    const editorial = byLayer.EDITORIAL ? { fields: complementLayer(byLayer.EDITORIAL.fields) } : null;
    return { byLayer, collected, editorial };
  };
  async function view(client, opportunityId) {
    const { byLayer, collected, editorial } = layers((await client.query(SQL.current, [opportunityId])).rows);
    return { opportunityId, fieldNames: [...FIELDS],
      editorial: { fields: editorial?.fields || {}, revision: byLayer.EDITORIAL?.version || 0,
        updatedAt: byLayer.EDITORIAL ? new Date(byLayer.EDITORIAL.created_at).toISOString() : null, updatedBy: byLayer.EDITORIAL?.author || null },
      collected, effective: effectiveComplement({ collected, editorial }), collection: collectionMode };
  }

  // For detail readers that were already authorized by their own route. A Central
  // that has not received 053 yet simply has no complement.
  async function effective(opportunityId) {
    if (typeof opportunityId !== 'string' || !UUID.test(opportunityId)) return null;
    try {
      const { collected, editorial } = layers((await centralPool.query(SQL.effective, [opportunityId])).rows);
      return effectiveComplement({ collected, editorial });
    } catch (error) {
      if (['42P01', '42501'].includes(error?.code)) return null;
      throw error;
    }
  }
  async function get(opportunityIdValue, request) {
    const opportunityId = identifier(opportunityIdValue, 'RESOURCE_NOT_AVAILABLE');
    return transaction('read', async client => {
      await authorize(client, request);
      await existing(client, opportunityId);
      return view(client, opportunityId);
    });
  }
  async function save(opportunityIdValue, body, request) {
    const opportunityId = identifier(opportunityIdValue, 'RESOURCE_NOT_AVAILABLE');
    return transaction('write', async client => {
      // Authorization comes first, so someone who is not an administrator learns nothing from the validation.
      const who = await authorize(client, request);
      const input = plainObject(body, ['fields', 'expectedRevision', 'idempotencyKey']);
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision > 2147483646) fail('INVALID_INPUT');
      const fields = layer(input.fields);
      await existing(client, opportunityId);
      await client.query(SQL.write, [who.sessionId, who.actorId, uuid(), opportunityId, 'EDITORIAL', JSON.stringify(fields), complementDigest(fields),
        null, null, null, null, null, identifier(input.idempotencyKey), input.expectedRevision]);
      return view(client, opportunityId);
    });
  }

  // Administrative collection of the annual plan pages. The site is read before
  // any transaction is open; only content that differs from the current
  // collected version is written, and the administrator's layer is never touched.
  async function collect(body, request) {
    const input = plainObject(body, ['idempotencyKey']), requestId = identifier(input.idempotencyKey);
    if (collectionMode === 'disabled') {
      await transaction('read', client => authorize(client, request));
      return fail('COLLECTION_NOT_CONFIGURED');
    }
    await transaction('read', client => authorize(client, request));
    let site;
    try { site = await readSite({ clock }); } catch { return fail('SOURCE_UNAVAILABLE'); }
    return transaction('write', async client => {
      const who = await authorize(client, request);
      const byPlan = new Map(), repeated = new Set();
      for (const row of (await client.query(SQL.planOpportunities)).rows) {
        if (byPlan.has(row.planId)) repeated.add(row.planId); else byPlan.set(row.planId, row.opportunityId);
      }
      for (const planId of repeated) byPlan.delete(planId);
      const matched = site.notices.filter(notice => byPlan.has(notice.planId));
      const current = new Map((await client.query(SQL.collected, [matched.map(notice => byPlan.get(notice.planId))])).rows.map(row => [row.opportunityId, row]));
      let written = 0, unchanged = 0;
      for (const notice of matched) {
        const opportunityId = byPlan.get(notice.planId), kept = { ...notice.fields };
        if (collectionMode === 'facts') delete kept.description;
        const fields = complementLayer(kept), digest = complementDigest(fields), previous = current.get(opportunityId);
        if (previous?.digest === digest) { unchanged++; continue; }
        await client.query(SQL.write, [who.sessionId, who.actorId, uuid(), opportunityId, 'COLLECTED', JSON.stringify(fields), digest,
          site.sourceNamespace, notice.sourceUrl, notice.sourceModifiedAt, site.observedAt,
          Object.hasOwn(fields, 'description') && notice.descriptionTruncated, requestId, previous?.version || 0]);
        written++;
      }
      return { mode: collectionMode, observedAt: site.observedAt, published: site.total, skipped: site.skipped, ambiguous: site.ambiguous.length + repeated.size,
        matched: matched.length, unmatched: site.notices.length - matched.length, written, unchanged };
    });
  }

  return Object.freeze({ effective, get, save, collect, collectionMode });
}

const STATUS = Object.freeze({ INVALID_INPUT: 400, C4G_ADMIN_REQUIRED: 403, RESOURCE_NOT_AVAILABLE: 404, STALE_REVISION: 409,
  IDEMPOTENCY_CONFLICT: 409, STATE_CONFLICT: 409, COLLECTION_NOT_CONFIGURED: 503, SOURCE_UNAVAILABLE: 503 });
function publicError(error) {
  const code = String(error?.code || '');
  return Object.hasOwn(STATUS, code) ? { status: STATUS[code], body: { code } } : { status: 503, body: { code: 'SERVICE_UNAVAILABLE' } };
}

// Admin C4G routes, mounted at /api/admin/opportunity-complements. The session,
// origin and CSRF checks are the application's; who is an administrator is
// confirmed by the service, in the database, on every request.
function createOpportunityComplementRouter({ express, service, authenticate }) {
  if (!express?.Router || typeof authenticate !== 'function' || ['get', 'save', 'collect'].some(method => typeof service?.[method] !== 'function')) {
    throw new TypeError('Opportunity complement HTTP composition is incomplete.');
  }
  const router = express.Router();
  router.use((request, response, next) => { response.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); return next(); }, authenticate);
  const handle = (status, work) => async (request, response) => {
    const correlationId = randomUUID();
    try {
      if (Object.keys(request.query || {}).length > 0) fail('INVALID_INPUT');
      return response.status(status).json(await work(request));
    } catch (error) {
      const failure = publicError(error);
      return response.status(failure.status).json({ error: failure.body, correlationId });
    }
  };
  router.post('/collections/portugal2030', handle(200, request => service.collect(request.body, request)));
  router.get('/:opportunityId', handle(200, request => service.get(request.params.opportunityId, request)));
  router.put('/:opportunityId', handle(200, request => service.save(request.params.opportunityId, request.body, request)));
  router.use((request, response) => response.status(405).json({ error: { code: 'OPERATION_NOT_AVAILABLE' }, correlationId: randomUUID() }));
  return router;
}

module.exports = { createOpportunityComplementService, createOpportunityComplementRouter, publicError, COLLECTION_MODES, SQL };
