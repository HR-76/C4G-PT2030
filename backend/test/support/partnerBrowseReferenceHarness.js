'use strict';
const assert = require('node:assert/strict');
const { createPartnersRepository, parse } = require('../../src/applications/partners');
const { createPq1UiTokens } = require('../../src/organizationalProfile/pq1UiTokens');

const ORGANIZATION = '10000000-0000-4000-8000-000000000001';
const SUBJECT = '20000000-0000-4000-8000-000000000001';
const START = Date.UTC(2026, 9, 27, 12);
const error = code => Object.assign(new Error(code), { code });

// This adapter executes the current repository against a bounded in-memory SQL
// double. It does not execute PostgreSQL, prove RLS, or model transaction locks.
// Future SQL adapters implement this harness interface with their own fixtures;
// the reusable scenarios do not inspect query text or require these batches.
function createReferenceHarness(options = {}) {
  const organizationId = options.organizationId || ORGANIZATION;
  const subjectId = options.subjectId || SUBJECT;
  const state = options.state || {
    rows: structuredClone(options.rows || []), now: START, schemaReady: options.schemaReady !== false,
    protectError: options.protectError || null, denied: new Set(options.denied || []), failures: new Map(options.failures || [])
  };
  const trace = [], queries = [];
  const stats = { candidateRows: 0, authorizationCalls: 0 };
  const tokens = createPq1UiTokens({ keys: { contract: 'synthetic-partner-contract-key-0000000000000000' },
    currentKeyId: 'contract', clock: () => state.now });
  const key = (operation, id) => `${operation}:${id}`;
  const observedScope = resource => ({ resourceType: resource.resourceType, scopeType: resource.scopeType, scopeId: resource.scopeId });
  const client = { async query(sql, values) {
    queries.push({ sql, values: structuredClone(values) });
    if (sql.includes('to_regclass')) {
      trace.push(['schema']); return { rows: [{ relation: state.schemaReady ? 'application_partner' : null }] };
    }
    // A double that silently scoped rows regardless of SQL would hide leakage.
    assert.match(sql, /WHERE p\.organization_id=\$1 AND p\.active/);
    assert.match(sql, /JOIN opportunity_catalog\.application a USING\(organization_id,application_id\)/);
    assert.match(sql, /o\.organization_id=a\.organization_id AND o\.opportunity_id=a\.opportunity_id/);
    assert.match(sql, /p\.partner_id>\$2/);
    assert.match(sql, /ORDER BY p\.partner_id LIMIT (100|1)\s*$/);
    assert.equal(values.length, 2); assert.equal(values[0], organizationId);
    assert.ok(values[1] === null || /^[a-f0-9-]{36}$/.test(values[1]));
    const limit = Number(/LIMIT (\d+)\s*$/.exec(sql)[1]);
    const rows = state.rows.filter(row => row.organization_id === organizationId && row.active &&
      row.application_organization_id === organizationId && (values[1] === null || row.partner_id > values[1]))
      .sort((left, right) => left.partner_id < right.partner_id ? -1 : left.partner_id > right.partner_id ? 1 : 0)
      .slice(0, limit);
    stats.candidateRows += rows.length;
    return { rows: structuredClone(rows) };
  } };
  const repository = createPartnersRepository({ organizationId, actor: { id: subjectId }, cursor: tokens,
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
    browse: raw => repository.partnersBrowse(client, null, parse('partnersBrowse', raw || {})),
    issue: (position, filters = {}, override = {}) => tokens.cursor(position, context(filters, override)),
    decode: token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')),
    advance: milliseconds => { state.now += milliseconds; },
    deny: (operation, id) => state.denied.add(key(operation, id)),
    allow: (operation, id) => state.denied.delete(key(operation, id)),
    failAuthorization: (operation, id, code = 'SERVICE_UNAVAILABLE') => state.failures.set(key(operation, id), code),
    mutate: (id, change) => { const row = state.rows.find(candidate => candidate.partner_id === id); assert.ok(row); change(row); },
    add: row => state.rows.push(structuredClone(row)),
    rows: () => structuredClone(state.rows),
    clearTrace: () => { trace.length = 0; queries.length = 0; stats.candidateRows = 0; stats.authorizationCalls = 0; },
    async close() {}
  };
}
module.exports = { createReferenceHarness };
