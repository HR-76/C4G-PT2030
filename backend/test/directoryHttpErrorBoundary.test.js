'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createDirectoryRouter } = require('../src/routes/organizationDirectoryRoutes');

test('directory failures retain their public response when the error observer throws', async t => {
  const state = { error: null, observed: [], fallbackCalls: 0 };
  const pass = (_req, _res, next) => next();
  const fail = async () => { throw state.error; };
  const app = express();
  app.use(express.json(), createDirectoryRouter({
    express, authenticate: pass,
    organizationMiddleware: { requireServerSession: pass, resolveOrganizationContext: pass, requireOrganizationContext: pass },
    membershipAccess: { list: fail, changeProfile: fail, change: fail }, matching: { execute: fail },
    onFailure(error) { state.observed.push(error); throw new Error('private observer implementation'); },
  }));
  app.use((_error, _req, res, _next) => { state.fallbackCalls++; res.status(500).json({ error: { code: 'GLOBAL_FALLBACK' } }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const id = '00000000-0000-4000-8000-000000000001';
  const routes = [['GET', '/access'], ['PUT', `/memberships/${id}/profile`], ['PUT', `/memberships/${id}/status`], ['GET', '/matching']];
  for (const [method, path] of routes) {
    await t.test(`${method} ${path}`, async () => {
      for (const [code, status, expected] of [['RESOURCE_NOT_AVAILABLE', 404, 'RESOURCE_NOT_AVAILABLE'], ['private_database_detail', 503, 'SERVICE_UNAVAILABLE']]) {
        state.error = Object.assign(new Error('private database message'), { code });
        const response = await fetch(base + path, { method, ...(method === 'PUT' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}) });
        assert.equal(response.status, status);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await response.json(), { error: { code: expected } });
        assert.equal(state.observed.at(-1), state.error);
      }
    });
  }
  assert.equal(state.fallbackCalls, 0);
});
