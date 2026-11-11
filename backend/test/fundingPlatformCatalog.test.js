'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const express = require('express');
const { createFundingRouters } = require('../src/fundingTenders/http');
const adminId = '00000000-0000-4000-8000-000000000001';
const memberId = '00000000-0000-4000-8000-000000000002';
const opportunityId = '00000000-0000-4000-8000-000000000003';
const snapshot = {schemaVersion:1,title:'Public',funderName:'Commission',provenanceId:opportunityId,lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1'};

test('platform catalog checks live authority and preserves the client membership boundary', async t => {
  const state = { assigned: true, active: true, context: 'VALID', queries: [] };
  const client = {
    release() {},
    async query(sql, values = []) {
      state.queries.push(sql);
      if (sql.startsWith('SELECT id FROM public.global_user')) return { rows: state.active ? [{ id: values[0] }] : [] };
      if (sql.startsWith('SELECT id FROM public.platform_admin_assignment')) return { rows: state.assigned && values[0] === adminId ? [{ id: adminId }] : [] };
      if (sql.startsWith('SELECT DISTINCT')) return { rows: [{ name: 'Horizon' }] };
      if (sql.includes('SELECT o.opportunity_id')) return { rows: [{ opportunityId, revisionId:opportunityId, title: 'Public', snapshot, temporalSnapshot:snapshot }] };
      if (/^(BEGIN READ ONLY|SET LOCAL|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      throw Error('Unexpected SQL');
    },
  };
  const organizationMiddleware = {
    requireServerSession(req, res, next) { if (req.headers['x-no-session']) return res.sendStatus(401); req.sessionID = 'session'; next(); },
    resolveOrganizationContext(req, res, next) { if (req.user.id !== memberId) return res.sendStatus(409); next(); },
  };
  const routers = createFundingRouters({ express, pool: { connect: async () => client }, catalogReader:require('../src/fundingTenders/repository').createFundingRepository({pool:{connect:async()=>client}}), sourceMode: 'live-local', organizationMiddleware,
    authenticate(req, res, next) { const id = req.headers['x-test-user']; if (!id) return res.sendStatus(401); req.user = { id }; next(); },
    sessionRegistry: { resolveOrganizationContext: async () => ({ state: state.context }) },
  });
  const app = express(); app.use('/platform', routers.platformCatalog); app.use('/client', routers.catalog);
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const get = (route, id = adminId, options = {}) => fetch(`http://127.0.0.1:${server.address().port}${route}`, { ...options, headers: { ...(id ? { 'x-test-user': id } : {}), ...options.headers } });
  await t.test('platform list/detail work without a tenant and in read-only transactions', async () => {
    for (const route of ['/platform?programme=Horizon', `/platform/${opportunityId}`]) {
      state.queries = []; const response = await get(route); assert.equal(response.status, 200);
      assert.equal((await response.json()).sourceMode, 'live-local');
      assert.equal(state.queries[0], 'BEGIN READ ONLY');
      assert.ok(state.queries.findIndex(sql => sql.includes('platform_admin_assignment')) < state.queries.findIndex(sql => sql.includes('opportunity_catalog')));
      assert.ok(!state.queries.some(sql => /INSERT|UPDATE|DELETE/.test(sql)));
    }
  });
  await t.test('members cannot impersonate platform administration', async () => {
    state.queries = []; assert.equal((await get('/platform', memberId, { headers: { 'x-c4g-organization': adminId, 'x-platform-role': 'C4G_ADMIN' } })).status, 403);
    assert.ok(!state.queries.some(sql => sql.includes('opportunity_catalog')));
  });
  await t.test('revoked platform assignment and disabled identity deny fresh reads', async () => {
    state.assigned = false; assert.equal((await get('/platform')).status, 403); state.assigned = true;
    state.active = false; assert.equal((await get(`/platform/${opportunityId}`)).status, 403); state.active = true;
  });
  await t.test('authentication/session remain required and creation requires fresh assurance', async () => {
    assert.equal((await get('/platform', null)).status, 401);
    assert.equal((await get('/platform', adminId, { headers: { 'x-no-session': '1' } })).status, 401);
    state.queries = []; assert.equal((await get('/platform', adminId, { method: 'POST' })).status, 403); assert.deepEqual(state.queries, []);
    assert.equal((await get('/platform?organizationId=other')).status, 400);
  });
  await t.test('client reads still require valid membership, even for platform administrators', async () => {
    assert.equal((await get('/client')).status, 409);
    assert.equal((await get('/client', memberId)).status, 200);
    state.context = 'REVOKED'; assert.equal((await get('/client', memberId)).status, 404);
  });
});
