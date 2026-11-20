'use strict';

const { createEmailTemplateRepository } = require('./repository');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const PAGE_SIZE = 50;
const RETENTION_MS = 90 * 86400000;
const TYPES = ['', 'member-invitation', 'password-reset'];
const STATES = ['', 'ACCEPTED', 'UNCONFIRMED', 'NOT_CONFIGURED'];
const fail = code => { throw Object.assign(new Error(code), { code }); };

function query(input = {}, now = Date.now()) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype
      || Object.keys(input).some(key => !['type', 'status', 'cursor'].includes(key))) fail('INVALID_INPUT');
  const { type = '', status = '', cursor = '' } = input;
  if (!TYPES.includes(type) || !STATES.includes(status) || typeof cursor !== 'string' || cursor.length > 300) fail('INVALID_INPUT');
  let before = now + 1, id = MAX_ID, source = 'KEYCLOAK';
  if (cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (!Array.isArray(parsed) || parsed.length !== 5 || parsed[3] !== type || parsed[4] !== status) fail('INVALID_INPUT');
      [before, id, source] = parsed;
      if (!Number.isSafeInteger(before) || before < 1 || before > now + 1 || !UUID.test(id)
          || !['APPLICATION', 'KEYCLOAK'].includes(source)) fail('INVALID_INPUT');
    } catch { fail('INVALID_INPUT'); }
  }
  return { type, status, before, id, source };
}

// Descending (instant, ID, source); both origins use the same millisecond precision.
function compare(a, b) {
  return b.occurredAt - a.occurredAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
    || (a.source < b.source ? 1 : a.source > b.source ? -1 : 0);
}

function createDeliveryHistory({ pool, keycloak, repository = createEmailTemplateRepository(), clock = Date.now }) {
  let recordingFailures = 0;
  async function authorized(request) {
    const actor = request?.user?.id, session = request?.authContext?.sessionId;
    if (!UUID.test(actor || '') || !session || session !== request.sessionID) fail('C4G_ADMIN_REQUIRED');
    if (!(await repository.isPlatformAdmin(pool, session, actor))) fail('C4G_ADMIN_REQUIRED');
    return { actor, session };
  }
  async function list(input, request) {
    const { actor, session } = await authorized(request);
    const p = query(input, clock());
    // Read one extra row from both origins; filter the complete tuple below.
    // Including equality here handles UUID collisions across the two sources.
    const rows = [];
    if (p.type !== 'password-reset') {
      const result = await pool.query('SELECT d.*,o.display_name AS organization_name FROM public.email_delivery_list($1,$2,$3,$4,$5) d LEFT JOIN public.organization o ON o.id=d.organization_id ORDER BY d.occurred_at DESC,d.id DESC',
        [session, actor, new Date(p.before), p.id, p.status]);
      rows.push(...result.rows.map(row => ({ id: row.id, type: 'member-invitation', source: 'APPLICATION',
        organizationId: row.organization_id, organizationName: row.organization_name || null, recipient: row.recipient, occurredAt: new Date(row.occurred_at).getTime(),
        status: row.result, test: row.is_test })));
    }
    if (p.type !== 'member-invitation' && p.status !== 'NOT_CONFIGURED') {
      if (!keycloak?.history) fail('EMAIL_HISTORY_UNAVAILABLE');
      const result = await keycloak.history({ before: p.before, id: p.id, status: p.status });
      rows.push(...result.items.map(row => ({ ...row, type: 'password-reset', source: 'KEYCLOAK', organizationId: null, organizationName: null, test: false })));
    }
    await authorized(request); // A revoked admin cannot receive a completed remote read.
    const boundary = { id: p.id, source: p.source, occurredAt: p.before };
    const merged = rows.filter(row => compare(row, boundary) > 0).sort(compare);
    const page = merged.slice(0, PAGE_SIZE).map(row => ({ ...row,
      recipient: row.occurredAt <= clock() - RETENTION_MS ? null : row.recipient,
      occurredAt: new Date(row.occurredAt).toISOString() }));
    const last = merged[PAGE_SIZE - 1];
    return { items: page, recordingFailures, nextCursor: merged.length > PAGE_SIZE
      ? Buffer.from(JSON.stringify([last.occurredAt, last.id, last.source, p.type, p.status])).toString('base64url') : null };
  }
  async function begin({ id, organizationId = null, recipient, test = false }) {
    return (await pool.query('SELECT public.email_delivery_begin($1,$2,$3,$4) AS status', [id, organizationId, recipient, test])).rows[0]?.status;
  }
  async function finish(id, status) {
    await pool.query('SELECT public.email_delivery_finish($1,$2)', [id, STATES.includes(status) && status ? status : 'UNCONFIRMED']);
  }
  async function retention({central=true}={}) {
    if(central)await pool.query('SELECT public.email_delivery_retention()');
    if (!keycloak?.retention) fail('EMAIL_HISTORY_UNAVAILABLE');
    await keycloak.retention();
  }
  async function deliver(metadata, send) {
    const prior = await begin(metadata); // No unrecorded send if storage is unavailable before the attempt.
    if (prior === 'ACCEPTED') return { status: 'ACCEPTED' };
    let result;
    try { result = await send(); } catch { result = { status: 'UNCONFIRMED' }; }
    try { await finish(metadata.id, result?.status); } catch {
      // An accepted message must not be retried because its receipt write failed.
      // The persisted initial row remains UNCONFIRMED and the UI reports degraded collection.
      recordingFailures++;
    }
    return result;
  }
  return Object.freeze({ list, begin, finish, retention, deliver });
}

module.exports = { createDeliveryHistory, query, compare, PAGE_SIZE, RETENTION_MS };
