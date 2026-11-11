'use strict';
const assert = require('node:assert/strict');
const { createPartnersPortalRepository } = require('../../prototypes/partnerSqlPortal');
const { parse } = require('../../src/applications/partners');
const { createPq1UiTokens } = require('../../src/organizationalProfile/pq1UiTokens');
const { ORGANIZATION, SUBJECT } = require('./partnerBrowseContract');

const START = Date.UTC(2026, 9, 27, 12);
const error = code => Object.assign(new Error(code), { code });

// An independent portal protocol double, not a PostgreSQL or RLS proof. Rows
// already contain joined source fields. Capturing them at DECLARE models the
// proposed temporal contract; it cannot demonstrate server snapshot semantics.
function createPortalHarness(options = {}) {
  const organizationId = options.organizationId || ORGANIZATION;
  const subjectId = options.subjectId || SUBJECT;
  const state = options.state || {
    rows: structuredClone(options.rows || []), now: START, schemaReady: options.schemaReady !== false,
    protectError: options.protectError || null, denied: new Set(options.denied || []), failures: new Map(options.failures || [])
  };
  const trace = [], queries = [], portals = new Map();
  const stats = { candidateRows: 0, authorizationCalls: 0, openedPortals: 0, closedPortals: 0, outerRollbacks: 0 };
  const tokens = createPq1UiTokens({ keys: { contract: 'synthetic-partner-contract-key-0000000000000000' },
    currentKeyId: 'contract', clock: () => state.now });
  const key = (operation, id) => `${operation}:${id}`;
  const observedScope = resource => ({ resourceType: resource.resourceType, scopeType: resource.scopeType, scopeId: resource.scopeId });
  const client = { async query(sql, values) {
    queries.push({ sql, values: structuredClone(values) });
    const text = sql.replace(/\s+/g, ' ').trim().replace(/;$/, '');
    if (text === "SELECT to_regclass('opportunity_catalog.application_partner') AS relation") {
      trace.push(['schema']); return { rows: [{ relation: state.schemaReady ? 'application_partner' : null }] };
    }
    const declaration = /^DECLARE (c4g_partner_browse_[a-f0-9]{32}) NO SCROLL CURSOR WITHOUT HOLD FOR SELECT p\.\*/.exec(text);
    if (declaration) {
      const name = declaration[1];
      assert.ok(Buffer.byteLength(name) < 63); assert.ok(!portals.has(name));
      // Do not silently tenant-scope a malformed candidate query in the double.
      assert.match(text, /FROM opportunity_catalog\.application_partner p JOIN opportunity_catalog\.application a USING\s*\(organization_id,\s*application_id\)/);
      assert.match(text, /LEFT JOIN opportunity_catalog\.opportunity o ON o\.organization_id\s*=\s*a\.organization_id AND o\.opportunity_id\s*=\s*a\.opportunity_id/);
      assert.match(text, /a\.title AS application_title,\s*a\.status AS application_status,\s*a\.opportunity_id,\s*a\.evaluation_id,/);
      assert.match(text, /COALESCE\(a\.central_snapshot->>'title',\s*o\.title\) AS opportunity_title/);
      assert.match(text, /WHERE p\.organization_id\s*=\s*\$1 AND p\.active ORDER BY p\.partner_id LIMIT 10001$/);
      assert.deepEqual(values, [organizationId]); assert.ok(!text.includes('$2'));
      const rows = state.rows.filter(row => row.organization_id === organizationId && row.active && row.application_organization_id === organizationId)
        .sort((a, b) => a.partner_id < b.partner_id ? -1 : a.partner_id > b.partner_id ? 1 : 0).slice(0, 10001);
      portals.set(name, { rows: structuredClone(rows), offset: 0 }); stats.openedPortals++;
      return { rows: [] };
    }
    const fetch = /^FETCH FORWARD (100|1) FROM (c4g_partner_browse_[a-f0-9]{32})$/.exec(text);
    if (fetch) {
      assert.ok(values === undefined || values.length === 0);
      const portal = portals.get(fetch[2]); assert.ok(portal, 'FETCH requires an open portal');
      const count = Number(fetch[1]);
      assert.equal(count, portal.offset === 10000 ? 1 : 100, 'overflow probe is one row after 10000 candidates');
      const rows = portal.rows.slice(portal.offset, portal.offset + count); portal.offset += rows.length;
      stats.candidateRows += rows.length; return { rows: structuredClone(rows) };
    }
    const close = /^CLOSE (c4g_partner_browse_[a-f0-9]{32})$/.exec(text);
    if (close) {
      assert.ok(values === undefined || values.length === 0);
      assert.ok(portals.delete(close[1]), 'CLOSE requires the same open portal'); stats.closedPortals++;
      return { rows: [] };
    }
    assert.fail('Unexpected query in partner portal protocol double');
  } };
  const repository = createPartnersPortalRepository({ organizationId, actor: { id: subjectId }, cursor: tokens,
    protect: async ({ operationCode, resource }) => {
      trace.push(['protect', operationCode, resource.id, resource.organizationId, observedScope(resource)]);
      if (state.protectError) throw error(state.protectError);
    }, authorize: async (operation, resource) => {
      stats.authorizationCalls++; trace.push(['authorize', operation, resource.id, resource.organizationId, observedScope(resource)]);
      if (state.failures.has(key(operation, resource.id))) throw error(state.failures.get(key(operation, resource.id)));
      return !state.denied.has(key(operation, resource.id));
    }, audit: async () => assert.fail('partnersBrowse must not call its mutation audit port')
  });
  const context = (filters = {}, override = {}) => ({ organizationId, subjectId, route: 'partners-browse',
    q: '', country: '', person_role: '', ...filters, ...override });
  return {
    organizationId, subjectId, trace, queries, stats,
    async browse(raw) {
      const input = parse('partnersBrowse', raw || {});
      try { return await repository.partnersBrowse(client, null, input); }
      catch (failure) {
        // Model the existing outer transaction owner, not prototype cleanup.
        // This is neither a ROLLBACK command nor evidence of server cleanup.
        stats.outerRollbacks++; portals.clear(); throw failure;
      }
    },
    issue: (position, filters = {}, override = {}) => tokens.cursor(position, context(filters, override)),
    decode: token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')),
    advance: milliseconds => { state.now += milliseconds; },
    deny: (operation, id) => state.denied.add(key(operation, id)),
    allow: (operation, id) => state.denied.delete(key(operation, id)),
    failAuthorization: (operation, id, code = 'SERVICE_UNAVAILABLE') => state.failures.set(key(operation, id), code),
    mutate: (id, change) => { const row = state.rows.find(candidate => candidate.partner_id === id); assert.ok(row); change(row); },
    add: row => state.rows.push(structuredClone(row)),
    rows: () => structuredClone(state.rows),
    clearTrace: () => { trace.length = 0; queries.length = 0; for (const key of Object.keys(stats)) stats[key] = 0; },
    async close() { assert.equal(portals.size, 0, 'no portal after candidate success or simulated outer rollback'); }
  };
}
module.exports = { createPortalHarness };
