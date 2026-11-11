'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createOpportunityInterestRouter } = require('../src/routes/opportunityInterestRoutes');

test('interest routes preserve public errors and correlation when observation fails', async t => {
  const state = { error: null, observed: null, fallbackCalls: 0 };
  const pass = (_req, _res, next) => next();
  const app = express();
  app.use(express.json(), createOpportunityInterestRouter({
    express, authenticate: pass,
    organizationMiddleware: { requireServerSession: pass, resolveOrganizationContext: pass, requireOrganizationContext: pass },
    service: { async execute() { throw state.error; } },
    onFailure(error, correlationId) { state.observed = { error, correlationId }; throw new Error('private observer failure'); },
  }));
  app.use((_error, _req, res, _next) => { state.fallbackCalls++; res.status(500).json({ error: { code: 'GLOBAL_FALLBACK' } }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`, id = '00000000-0000-4000-8000-000000000001';
  const routes = [['GET', '/context'], ['GET', '/units'], ['GET', '/summaries'], ['GET', '/'], ['POST', '/'],
    ['GET', `/${id}/history`], ['POST', `/${id}/archive`], ['GET', `/${id}`], ['PUT', `/${id}`]];
  for (const [method, path] of routes) {
    await t.test(`${method} ${path}`, async () => {
      for (const [code, status, publicCode] of [['AUTHORITY_DENIED', 404, 'RESOURCE_NOT_AVAILABLE'], ['STALE_REVISION', 409, 'STALE_REVISION'], ['private_storage_failure', 503, 'SERVICE_UNAVAILABLE']]) {
        state.error = Object.assign(new Error('private database message'), { code });
        const response = await fetch(base + path, { method, ...(method !== 'GET' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}) });
        assert.equal(response.status, status);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const body = await response.json();
        assert.match(body.correlationId, /^[0-9a-f-]{36}$/);
        assert.deepEqual(body, { error: { code: publicCode }, correlationId: state.observed.correlationId });
        assert.equal(state.observed.error, state.error);
      }
    });
  }
  assert.equal(state.fallbackCalls, 0);
});
