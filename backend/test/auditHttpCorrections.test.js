'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createErrorHandler } = require('../src/app');
const { createPlatformDirectoryRouter } = require('../src/routes/platformDirectoryRoutes');
const { createPrivateOpportunityRouter } = require('../src/routes/privateOpportunityRoutes');
const { createApplicationSliceRouter } = require('../src/routes/applicationSliceRoutes');
const { CODES } = require('../src/opportunities/errors');

const next = (req, res, done) => done();
const organizationMiddleware = {
  requireServerSession: next, resolveOrganizationContext: next, requireOrganizationContext: next
};
const canary = 'internal-query-and-credential-canary';
async function withServer(router, work) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await work(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
function responseDouble() {
  return {
    statusCode: null, body: null, headers: {},
    status(value) { this.statusCode = value; return this; },
    json(value) { assert.equal(this.body, null, 'response must be written once'); this.body = value; return this; },
    setHeader(key, value) { this.headers[key] = value; }
  };
}

test('registration PUT rejects unexpected query with 400 before authorization or mutation', async () => {
  let reads = 0, writes = 0;
  const router = createPlatformDirectoryRouter({ express, authenticate: next,
    service: { async entity() { reads++; } },
    registration: { async saveForPlatform() { writes++; return { revision: 1 }; } }
  });
  await withServer(router, async base => {
    const response = await fetch(base + '/entities/entity/registration?unexpected=1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    assert.equal(response.status, 400);
    const errorBody = await response.json();
    assert.deepEqual(errorBody.error, { code: 'INVALID_INPUT' });
    assert.match(errorBody.correlationId, /^[0-9a-f-]{36}$/);
    assert.equal(reads, 0); assert.equal(writes, 0);
    const valid = await fetch(base + '/entities/entity/registration', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { revision: 1 });
    assert.equal(reads, 1); assert.equal(writes, 1);
  });
});

test('private opportunities close unknown codes while retaining every existing domain status', async () => {
  let current;
  const observed = [];
  const router = createPrivateOpportunityRouter({ express, authenticate: next, organizationMiddleware,
    service: { async list() { throw current; } }, onFailure: event => observed.push(event)
  });
  await withServer(router, async base => {
    for (const code of ['23505', 'INTERNAL_INVALID_CONFIGURATION', canary]) {
      current = Object.assign(new Error(canary), { code, detail: canary });
      const response = await fetch(base);
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.error.code, 'OPPORTUNITY_UNAVAILABLE');
      assert.equal(JSON.stringify(body).includes(code), false);
      assert.equal(JSON.stringify(body).includes(canary), false);
    }
    assert.equal(observed.length, 3);
    assert.equal(JSON.stringify(observed).includes(canary), false);
    assert.ok(observed.every(event => event.code === 'OPPORTUNITY_UNAVAILABLE'));
    for (const code of CODES) {
      current = Object.assign(new Error(canary), { code });
      const expected = code === 'OPPORTUNITY_AUTHORIZATION_REQUIRED' ? 401 : code === 'OPPORTUNITY_NOT_FOUND' ? 404 :
        /STALE|CONFLICT|DIGEST/.test(code) ? 409 : /INVALID|UNKNOWN_FIELD|LIMIT|CURSOR/.test(code) ? 400 : 503;
      const response = await fetch(base);
      assert.equal(response.status, expected, code);
      assert.equal((await response.json()).error.code, code);
    }
  });
});

test('private opportunity observer failure cannot replace the sanitized response', async () => {
  let calls = 0;
  const router = createPrivateOpportunityRouter({ express, authenticate: next, organizationMiddleware,
    service: { async list() { throw new Error(canary); } }, onFailure() { calls++; throw Error(canary); }
  });
  await withServer(router, async base => {
    const response = await fetch(base);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'OPPORTUNITY_UNAVAILABLE');
    assert.equal(calls, 1);
  });
});

test('closed global error branches observe unexpected failures once and preserve parser errors', () => {
  const paths = ['/api/imports', '/api/admin/directory/entities', '/api/admin/billing/cycles',
    '/api/admissions/mine', '/api/organization-directory/access/users',
    '/api/organizational-profile/pq1-publication/context', '/api/organizational-profile/pq1-activation/context',
    '/api/organization-profile/editorial-ui/context', '/api/opportunities/opportunity/criteria'];
  for (const path of paths) {
    const observed = [], error = new Error(canary), res = responseDouble();
    createErrorHandler({ nodeEnv: 'production', reportError: (cause, context) => observed.push({ cause, context }) })(
      error, { method: 'GET', originalUrl: path + '?private=' + canary }, res, () => assert.fail('unexpected delegation'));
    assert.equal(res.statusCode, 503, path);
    assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
    assert.equal(observed.length, 1, path);
    assert.deepEqual(observed[0].cause, { code: 'SERVICE_UNAVAILABLE' });
    assert.equal(JSON.stringify(observed).includes(canary), false);
    assert.equal(observed[0].context.path, path);
    assert.equal(JSON.stringify(res.body).includes(canary), false);
    for (const [type, status] of [['entity.parse.failed', 400], ['entity.too.large', 413]]) {
      const invalid = responseDouble();
      createErrorHandler({ nodeEnv: 'production', reportError: () => assert.fail('expected parser error') })(
        { type }, { method: 'POST', originalUrl: path }, invalid, () => assert.fail('unexpected delegation'));
      assert.equal(invalid.statusCode, status);
      assert.equal(invalid.body.error.code, 'INVALID_INPUT');
    }
    const reportingFailure = responseDouble();
    createErrorHandler({ nodeEnv: 'production', reportError() { throw Error(canary); } })(
      error, { method: 'GET', originalUrl: path }, reportingFailure, () => assert.fail('unexpected delegation'));
    assert.equal(reportingFailure.statusCode, 503);
  }
});

test('application HTTP failures produce one safe correlated event while expected errors remain quiet', async () => {
  let current = Object.assign(new Error(canary), { code: 'INTERNAL_INVALID_CONFIGURATION', detail: canary });
  const observed = [];
  const router = createApplicationSliceRouter({ express, authenticate: next, organizationMiddleware,
    service: { async execute() { throw current; } }, onFailure: event => observed.push(event)
  });
  await withServer(router, async base => {
    const response = await fetch(base + '/browse'), body = await response.json();
    assert.equal(response.status, 503); assert.equal(body.error.code, 'SERVICE_UNAVAILABLE');
    assert.equal(observed.length, 1);
    assert.equal(observed[0].correlationId, body.correlationId);
    assert.equal(JSON.stringify(observed).includes(canary), false);
    current = Object.assign(new Error(canary), { code: 'INVALID_INPUT' });
    const invalid = await fetch(base + '/browse');
    assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error.code, 'INVALID_INPUT');
    assert.equal(observed.length, 1);
  });
});

test('application observer errors do not turn a 503 into a second response or internal body', async () => {
  let calls = 0;
  const router = createApplicationSliceRouter({ express, authenticate: next, organizationMiddleware,
    service: { async execute() { throw Error(canary); } }, onFailure() { calls++; throw Error(canary); }
  });
  await withServer(router, async base => {
    const response = await fetch(base + '/browse');
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'SERVICE_UNAVAILABLE');
    assert.equal(calls, 1);
  });
});

test('closed global HTTP errors correlate the public response with the existing operational context', () => {
  const { createContext, runWithContext } = require('../src/observability/context');
  const context = createContext({ service: 'c4g-api', component: 'http', operation: 'http.request' });
  for (const path of ['/api/admin/billing/cycles', '/api/organizational-profile/pq1-publication/context']) {
    const observed = [], res = responseDouble();
    runWithContext(context, () => createErrorHandler({ nodeEnv: 'production', reportError: (error, metadata) => observed.push(metadata) })(
      new Error(canary), { method: 'GET', originalUrl: path }, res, () => assert.fail('unexpected delegation')));
    assert.equal(res.body.correlationId, context.correlationId);
    assert.equal(observed[0].correlationId, context.correlationId);
  }
});
