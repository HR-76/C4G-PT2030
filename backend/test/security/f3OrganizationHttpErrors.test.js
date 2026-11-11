const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const { createErrorHandler } = require('../../src/app');
const { createOrganizationAuthController } = require('../../src/controllers/organizationAuthController');
const { createOrganizationContextMiddleware } = require('../../src/middlewares/organizationContext');
const { createOrganizationSessionService } = require('../../src/security/organizationSession');
const { PublicHttpError } = require('../../src/utils/publicHttpError');

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';
const CANARY = 'postgres://internal-user:secret@central.internal:5541/c4g SELECT * FROM organization_membership_secret sensitive-canary-7f31';
const PUBLIC_BODY = {
  error: {
    code: 'ORGANIZATION_CONTEXT_UNAVAILABLE',
    message: 'Organization context is temporarily unavailable.'
  }
};

function internalError(label = 'internal') {
  const error = new Error(`${label}: ${CANARY}`);
  error.code = 'SYNTHETIC_POSTGRES_CODE';
  return error;
}

function sessionContext() {
  return {
    organizationId: ORGANIZATION_ID,
    membershipId: '20000000-0000-4000-8000-000000000001',
    membershipVersion: 3,
    baseRoleCode: 'OPAQUE_ROLE',
    organization: { id: ORGANIZATION_ID, displayName: 'Synthetic Organization', slug: 'synthetic-organization' }
  };
}

async function withHttpApp({ mount, setupRequest = null, nodeEnv = 'production' }, operation) {
  const reported = [];
  const app = express();
  app.use(express.json());
  if (setupRequest) app.use(setupRequest);
  mount(app);
  app.use(createErrorHandler({ nodeEnv, reportError: error => reported.push(error) }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await operation({ base: `http://127.0.0.1:${server.address().port}`, reported });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function authenticatedSession(effects = {}) {
  return (req, res, next) => {
    req.user = { id: 'user-1', name: 'Synthetic User' };
    req.sessionID = 'sid-old';
    req.session = {
      auth: {
        user: req.user,
        revocationVersion: 1,
        absoluteExpiresAt: Date.now() + 60_000,
        organizationContext: effects.expressContext || null
      },
      regenerate(callback) { effects.regenerated = true; req.sessionID = 'sid-new'; callback(); },
      save(callback) { effects.saved = true; callback(effects.saveError); },
      destroy(callback) { effects.destroyed = true; callback(effects.destroyError); }
    };
    next();
  };
}

async function expectUnavailable({ mount, setupRequest, request, expectedCause, assertEffects = () => {} }) {
  await withHttpApp({ mount, setupRequest }, async ({ base, reported }) => {
    const response = await fetch(`${base}${request.path}`, {
      method: request.method || 'GET',
      headers: request.headers,
      body: request.body
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.deepEqual(body, PUBLIC_BODY);
    const publicMaterial = `${JSON.stringify(body)} ${JSON.stringify([...response.headers])}`;
    for (const forbidden of ['internal-user', 'secret', 'central.internal', '5541', 'SELECT',
      'organization_membership_secret', 'sensitive-canary-7f31', 'SYNTHETIC_POSTGRES_CODE', 'stack']) {
      assert.equal(publicMaterial.includes(forbidden), false, `public response leaked ${forbidden}`);
    }
    assert.equal(Object.hasOwn(body, 'success'), false);
    assert.equal(reported.length, 1);
    assert.equal(reported[0] instanceof PublicHttpError, true);
    assert.equal(reported[0].cause, expectedCause);
    assertEffects();
  });
}

test('HTTP list failure returns the stable sanitized organization error', async () => {
  const cause = internalError('list');
  const controller = createOrganizationAuthController({
    organizationSession: { organizations: async () => { throw cause; } }, generateCsrfToken: () => 'unused'
  });
  await expectUnavailable({
    mount: app => app.get('/api/auth/organizations', controller.list),
    setupRequest: authenticatedSession(),
    request: { path: '/api/auth/organizations' },
    expectedCause: cause
  });
});

test('HTTP repository selection failure is sanitized without rotating the session', async () => {
  const cause = internalError('selection repository');
  const effects = {};
  const controller = createOrganizationAuthController({
    organizationSession: { select: async () => { throw cause; } }, generateCsrfToken: () => 'must-not-run'
  });
  await expectUnavailable({
    mount: app => app.post('/api/auth/organization', controller.select),
    setupRequest: authenticatedSession(effects),
    request: { path: '/api/auth/organization', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationId: ORGANIZATION_ID }) },
    expectedCause: cause,
    assertEffects: () => assert.equal(effects.regenerated, undefined)
  });
});

for (const scenario of ['registry', 'store']) {
  test(`HTTP ${scenario} persistence failure is sanitized and compensated`, async () => {
    const cause = internalError(`${scenario} persistence`);
    const effects = scenario === 'store' ? { saveError: cause } : {};
    const service = createOrganizationSessionService({
      membershipRepository: { resolveEligible: async () => sessionContext() },
      sessionRegistry: { rotateSession: async () => { effects.registryCalled = true; if (scenario === 'registry') throw cause; } }
    });
    const controller = createOrganizationAuthController({ organizationSession: service, generateCsrfToken: () => 'must-not-run' });
    await expectUnavailable({
      mount: app => app.post('/api/auth/organization', controller.select),
      setupRequest: authenticatedSession(effects),
      request: { path: '/api/auth/organization', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationId: ORGANIZATION_ID }) },
      expectedCause: cause,
      assertEffects: () => {
        assert.equal(effects.destroyed, true);
        assert.equal(effects.registryCalled, scenario === 'registry' ? true : undefined);
      }
    });
  });
}

test('HTTP context resolution failure is sanitized', async () => {
  const cause = internalError('resolve');
  const middleware = createOrganizationContextMiddleware({ organizationSession: { resolve: async () => { throw cause; } } });
  await expectUnavailable({
    mount: app => app.get('/api/auth/session', middleware.resolveOrganizationContext, (req, res) => res.json({ success: true })),
    setupRequest: authenticatedSession(),
    request: { path: '/api/auth/session' },
    expectedCause: cause
  });
});

test('HTTP revoked-context cleanup failure is sanitized after compensation', async () => {
  const cause = internalError('cleanup registry');
  const effects = { expressContext: sessionContext() };
  const service = createOrganizationSessionService({
    membershipRepository: {},
    sessionRegistry: {
      resolveOrganizationContext: async () => ({ state: 'INVALID' }),
      rotateSession: async () => { throw cause; }
    }
  });
  const middleware = createOrganizationContextMiddleware({ organizationSession: service });
  await expectUnavailable({
    mount: app => app.get('/api/auth/session', middleware.resolveOrganizationContext, (req, res) => res.json({ success: true })),
    setupRequest: authenticatedSession(effects),
    request: { path: '/api/auth/session' },
    expectedCause: cause,
    assertEffects: () => assert.equal(effects.destroyed, true)
  });
});

test('HTTP compensation failure preserves the AggregateError internally and exposes no cause', async () => {
  const primary = internalError('primary registry');
  const cleanup = internalError('cleanup store');
  const effects = { destroyError: cleanup };
  const service = createOrganizationSessionService({
    membershipRepository: { resolveEligible: async () => sessionContext() },
    sessionRegistry: { rotateSession: async () => { throw primary; } }
  });
  const controller = createOrganizationAuthController({ organizationSession: service, generateCsrfToken: () => 'must-not-run' });
  await withHttpApp({
    setupRequest: authenticatedSession(effects),
    mount: app => app.post('/api/auth/organization', controller.select)
  }, async ({ base, reported }) => {
    const response = await fetch(`${base}/api/auth/organization`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationId: ORGANIZATION_ID })
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), PUBLIC_BODY);
    assert.equal(reported[0].cause instanceof AggregateError, true);
    assert.deepEqual(reported[0].cause.errors, [primary, cleanup]);
    assert.equal(reported[0].cause.cause, primary);
    assert.equal(effects.destroyed, true);
  });
});

test('an already sanitized aggregate error is not wrapped twice', async () => {
  const causes = [internalError('aggregate one'), internalError('aggregate two')];
  const aggregate = new AggregateError(causes, CANARY, { cause: causes[0] });
  const { organizationContextUnavailable } = require('../../src/utils/publicHttpError');
  const sanitized = organizationContextUnavailable(aggregate);
  const controller = createOrganizationAuthController({
    organizationSession: { organizations: async () => { throw sanitized; } }, generateCsrfToken: () => 'unused'
  });
  await expectUnavailable({
    mount: app => app.get('/api/auth/organizations', controller.list),
    setupRequest: authenticatedSession(),
    request: { path: '/api/auth/organizations' },
    expectedCause: aggregate
  });
});

test('HTTP functional organization errors remain distinct as 400, 401, 403 and 409', async () => {
  const unavailable = { organizations: async () => [], select: async () => null };
  const controller = createOrganizationAuthController({ organizationSession: unavailable, generateCsrfToken: () => 'unused' });
  const middleware = createOrganizationContextMiddleware({ organizationSession: unavailable });
  await withHttpApp({
    setupRequest: authenticatedSession(),
    mount(app) {
      app.post('/api/auth/organization', controller.select);
      app.get('/api/auth/organizations', (req, res, next) => {
        delete req.session.auth;
        middleware.requireServerSession(req, res, next);
      }, controller.list);
      app.get('/tenant', middleware.requireOrganizationContext, (req, res) => res.json({ success: true }));
    }
  }, async ({ base }) => {
    const malformed = await fetch(`${base}/api/auth/organization`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{'
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, 'ORGANIZATION_SELECTION_INVALID');
    const unauthenticated = await fetch(`${base}/api/auth/organizations`);
    assert.equal(unauthenticated.status, 401);
    assert.equal((await unauthenticated.json()).code, 'SESSION_REQUIRED');
    const forbidden = await fetch(`${base}/api/auth/organization`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationId: ORGANIZATION_ID })
    });
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json()).error.code, 'ORGANIZATION_NOT_SELECTABLE');
    const required = await fetch(`${base}/tenant`);
    assert.equal(required.status, 409);
    assert.equal((await required.json()).error.code, 'ORGANIZATION_SELECTION_REQUIRED');
  });
});

test('unknown production errors use a generic non-sensitive 500 response', async () => {
  const cause = internalError('unknown');
  await withHttpApp({ mount: app => app.get('/unknown', (req, res, next) => next(cause)) }, async ({ base, reported }) => {
    const response = await fetch(`${base}/unknown`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { message: 'Erro interno do servidor.' });
    assert.equal(reported[0], cause);
  });
});

test('a failing internal reporter neither changes nor duplicates the public response', async () => {
  const cause = internalError('reporter');
  const app = express();
  app.get('/failure', (req, res, next) => next(cause));
  app.use(createErrorHandler({ nodeEnv: 'production', reportError: () => { throw internalError('logger'); } }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/failure`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { message: 'Erro interno do servidor.' });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('an error after response start is reported once and delegated without a second response', () => {
  const cause = internalError('late response');
  const reported = [];
  let delegated = null;
  const response = {
    headersSent: true,
    status() { assert.fail('must not create a second response'); },
    json() { assert.fail('must not create a second response'); }
  };
  createErrorHandler({ nodeEnv: 'production', reportError: (error, context) => reported.push({ error, context }) })(
    cause, { method: 'GET', originalUrl: '/api/applications/synthetic/documents/download?secret=redacted' },
    response, error => { delegated = error; }
  );
  assert.equal(delegated, cause);
  assert.deepEqual(reported, [{ error: cause, context: {
    method: 'GET', path: '/api/applications/synthetic/documents/download', responseStarted: true
  } }]);
});
