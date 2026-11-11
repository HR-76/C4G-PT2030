'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { request: httpRequest } = require('node:http');
const express = require('express');
const cors = require('cors');
const { createPlatformBillingRouter, publicError } = require('../src/platformBilling/http');
const { createApp, billingEndpointCatalog } = require('../src/app');

const organizationId = '11111111-1111-4111-8111-111111111111';
const cycleId = '22222222-2222-4222-8222-222222222222';
const documentId = '33333333-3333-4333-8333-333333333333';
const paymentId = '44444444-4444-4444-8444-444444444444';

function serviceFixture(overrides = {}) {
  const calls = [];
  const result = method => async (...args) => {
    calls.push({ method, args });
    return { method };
  };
  const service = {};
  for (const method of [
    'summary', 'cycles', 'cycleDetail', 'accountDetail', 'accountWrite', 'cycleCreate',
    'cycleEdit', 'cycleTransition', 'documentRecord', 'documentTransition',
    'paymentRecord', 'paymentReverse'
  ]) service[method] = overrides[method] || result(method);
  return { calls, service };
}

async function listen(router, { parser = express.json({ limit: '64kb' }), errorHandler = null } = {}) {
  const app = express();
  app.use('/api/admin/billing', parser, router);
  if (errorHandler) app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return {
    root: `http://127.0.0.1:${server.address().port}/api/admin/billing`,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

function request(root, path, { method = 'GET', body, headers = {} } = {}) {
  return fetch(`${root}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) })
  });
}

function getWithBody(root, path, body) {
  const payload = JSON.stringify(body), target = new URL(`${root}${path}`);
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(target, { method: 'GET', headers: {
      'content-type': 'application/json', 'content-length': Buffer.byteLength(payload)
    } }, response => {
      response.resume();
      response.once('end', () => resolve(response));
    });
    outgoing.once('error', reject);
    outgoing.end(payload);
  });
}

test('administrative billing router exposes the closed route contract and server-owned resource identity', async t => {
  const fixture = serviceFixture();
  const router = createPlatformBillingRouter({ express, service: fixture.service,
    authenticate(requestValue, response, next) { requestValue.user = { id: randomUUID() }; next(); } });
  const server = await listen(router); t.after(server.close);
  const cases = [
    ['GET', '/summary?currency=EUR', undefined, 200],
    ['GET', '/cycles?page=2', undefined, 200],
    ['GET', `/cycles/${cycleId}`, undefined, 200],
    ['GET', `/organizations/${organizationId}/account`, undefined, 200],
    ['PUT', `/organizations/${organizationId}/account`, {}, 200],
    ['POST', '/cycles', {}, 201],
    ['PUT', `/cycles/${cycleId}`, {}, 200],
    ['POST', `/cycles/${cycleId}/transitions`, {}, 200],
    ['POST', `/cycles/${cycleId}/documents`, {}, 201],
    ['POST', `/documents/${documentId}/transitions`, {}, 200],
    ['POST', `/documents/${documentId}/payments`, {}, 201],
    ['POST', `/payments/${paymentId}/reversals`, {}, 201]
  ];
  for (const [method, path, body, status] of cases) {
    const response = await request(server.root, path, { method, body });
    assert.equal(response.status, status, `${method} ${path}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.deepEqual(fixture.calls.map(call => call.method), [
    'summary', 'cycles', 'cycleDetail', 'accountDetail', 'accountWrite', 'cycleCreate',
    'cycleEdit', 'cycleTransition', 'documentRecord', 'documentTransition',
    'paymentRecord', 'paymentReverse'
  ]);
  assert.equal(fixture.calls.find(call => call.method === 'cycleEdit').args[0], cycleId);
  assert.equal(fixture.calls.find(call => call.method === 'documentTransition').args[0], documentId);
  assert.equal(fixture.calls.find(call => call.method === 'paymentReverse').args[0], paymentId);
  assert.equal((await request(server.root, '/cycles', { method: 'DELETE' })).status, 405);
});

test('billing HTTP errors are closed, stable and never expose internal messages', async t => {
  const failures = {
    auth: Object.assign(new Error('session internals'), { code: 'C4G_ADMIN_REQUIRED' }),
    missing: Object.assign(new Error('known id'), { code: 'BILLING_CYCLE_NOT_FOUND' }),
    stale: Object.assign(new Error('revision details'), { code: 'STALE_REVISION' }),
    duplicate: Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'billing_fiscal_document_source_key' }),
    unavailable: new Error('database hostname and secret')
  };
  const fixture = serviceFixture({ cycles: async query => { throw failures[query.q]; } });
  const router = createPlatformBillingRouter({ express, service: fixture.service,
    authenticate(requestValue, response, next) { next(); } });
  const server = await listen(router); t.after(server.close);
  for (const [value, expectedStatus, expectedCode] of [
    ['auth', 403, 'C4G_ADMIN_REQUIRED'], ['missing', 404, 'RESOURCE_NOT_AVAILABLE'],
    ['stale', 409, 'STALE_REVISION'], ['duplicate', 409, 'BILLING_DOCUMENT_DUPLICATE'],
    ['unavailable', 503, 'SERVICE_UNAVAILABLE']
  ]) {
    const response = await request(server.root, `/cycles?q=${value}`);
    const payload = await response.json();
    assert.equal(response.status, expectedStatus);
    assert.equal(payload.error.code, expectedCode);
    assert.match(payload.correlationId, /^[a-f0-9-]{36}$/);
    assert.equal(JSON.stringify(payload).includes(failures[value].message), false);
  }
  assert.deepEqual(publicError({ code: '23514', message: 'BILLING_PAYMENT_EXCEEDS_BALANCE' }),
    { code: 'BILLING_PAYMENT_EXCEEDS_BALANCE', status: 409 });
  assert.deepEqual(publicError({ code: 'CYCLE_TRANSITION_NOT_ALLOWED' }),
    { code: 'CYCLE_TRANSITION_NOT_ALLOWED', status: 409 });
  assert.deepEqual(publicError({ code: 'DOCUMENT_TRANSITION_NOT_ALLOWED' }),
    { code: 'DOCUMENT_TRANSITION_NOT_ALLOWED', status: 409 });
  assert.deepEqual(publicError({ code: '23514', message: 'BILLING_DEBIT_CANCELLATION_EXCEEDS_BALANCE' }),
    { code: 'BILLING_DEBIT_CANCELLATION_EXCEEDS_BALANCE', status: 409 });
});

test('billing HTTP boundary rejects query/body injection and sanitizes malformed JSON', async t => {
  const fixture = serviceFixture();
  const router = createPlatformBillingRouter({ express, service: fixture.service,
    authenticate(requestValue, response, next) { next(); } });
  const server = await listen(router, { errorHandler: require('../src/app').createErrorHandler({ nodeEnv: 'development' }) });
  t.after(server.close);
  assert.equal((await request(server.root, '/cycles?unexpected=value', { method: 'POST', body: {} })).status, 400);
  assert.equal((await getWithBody(server.root, '/summary', { organizationId })).statusCode, 400);
  const malformed = await request(server.root, '/cycles', { method: 'POST', body: '{"private":"secret"' });
  const payload = await malformed.json();
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get('cache-control'), 'no-store');
  assert.equal(payload.error.code, 'INVALID_INPUT');
  assert.equal(JSON.stringify(payload).includes('secret'), false);
  assert.match(payload.correlationId, /^[a-f0-9-]{36}$/);
  assert.equal(fixture.calls.length, 0);
});

test('application composition mounts billing after global security and publishes its endpoint catalog', async t => {
  const fixture = serviceFixture();
  let csrfCalls = 0;
  const empty = () => express.Router();
  const routes = {
    oidcAuth: empty(), platformBilling: createPlatformBillingRouter({ express, service: fixture.service,
      authenticate(requestValue, response, next) { next(); } }),
    opportunities: empty(), applications: empty(), imports: empty(),
    organizationDirectory: empty(), notifications: empty()
  };
  const app = createApp({ express, cors, config: { corsOrigin: '', nodeEnv: 'test' }, pool: { query() {} }, routes,
    security: { nodeEnv: 'test', allowedDevelopmentOrigins: [], sessionMiddleware: (q, s, n) => n(),
      credentialGuard: (q, s, n) => n(), originProtection: (q, s, n) => n(),
      csrfProtection: (q, s, n) => { csrfCalls += 1; n(); } } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await request(root, '/api/admin/billing/cycles', { method: 'POST', body: {} })).status, 201);
  assert.equal(csrfCalls, 1);
  const catalog = await (await request(root, '/')).json();
  assert.deepEqual(catalog.endpoints.platform_billing, billingEndpointCatalog());
});
