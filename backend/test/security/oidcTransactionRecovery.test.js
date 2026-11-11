'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const { createSessionSecurity } = require('../../src/security/sessionSecurity');
const { coordinateSessionStore } = require('../../src/security/coordinatedSessionStore');
const { InMemorySessionRegistry } = require('../../src/security/sessionRegistry');
const { createOidcAuthController } = require('../../src/controllers/oidcAuthController');

async function fixture(t) {
  let instant = Date.now(), attempt = 0, validated = 0;
  const settings = { sessionCookieName: 'synthetic_oidc', sessionSecret: 'synthetic-test-secret-at-least-32-characters',
    secureCookie: false, sessionIdleMs: 1800000, sessionAbsoluteMs: 28800000, oidcTransactionMs: 600000,
    publicOrigin: new URL('http://localhost'), nodeEnv: 'test', allowedDevelopmentOrigins: [],
    policyVersion: 'test-v1', privilegedRoleNames: [] };
  const coordinator = { sessionKey: sid => sid, write: (_keys, work) => work(), withAuthority: work => work() };
  const store = coordinateSessionStore(new session.MemoryStore(), {
    coordinator, idleMs: settings.sessionIdleMs, now: () => instant, validateSession: async () => true
  });
  const security = createSessionSecurity({ config: settings, pool: {}, sessionStore: store });
  const registry = new InMemorySessionRegistry();
  const controller = createOidcAuthController({ config: settings, now: () => instant, sessionRegistry: registry,
    identityRepository: { resolve: async () => ({ id: 'synthetic-user', platformRoles: [], sessionRevocationVersion: 1 }) },
    oidcClient: {
      begin: async ({ returnPath }) => ({ redirectUrl: 'https://identity.invalid/login',
        transaction: { state: `attempt-${++attempt}`, nonce: 'synthetic-nonce', codeVerifier: 'synthetic-verifier', createdAt: instant, returnPath } }),
      callback: async () => { validated++; return { claims: { iss: 'https://identity.invalid', sub: 'synthetic', auth_time: Math.floor(instant / 1000) } }; }
    }
  });
  const app = express();
  app.use(security.sessionMiddleware);
  app.get('/api/auth/oidc/login', controller.login);
  app.get('/api/auth/oidc/callback', controller.callback);
  app.use((error, _req, res, _next) => res.status(500).json({ code: 'TEST_FAILURE' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { settings, advance: ms => { instant += ms; }, validated: () => validated,
    request: (path, headers = {}) => fetch(base + path, { redirect: 'manual', headers }) };
}
const cookieOf = response => response.headers.get('set-cookie')?.split(';')[0];

test('HTTP: a new login in an old anonymous session survives its former storage deadline', async t => {
  const f = await fixture(t);
  const first = await f.request('/api/auth/oidc/login?returnTo=%2Fdashboard');
  assert.equal(first.status, 302);
  const cookie = cookieOf(first);
  assert.ok(cookie);
  f.advance(f.settings.sessionIdleMs - 1000);
  const retry = await f.request('/api/auth/oidc/login?returnTo=%2Fdashboard', { cookie });
  assert.equal(retry.status, 302);
  f.advance(2000);
  const callback = await f.request('/api/auth/oidc/callback?code=synthetic&state=attempt-2', { cookie: cookieOf(retry) || cookie });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/dashboard');
  assert.equal(f.validated(), 1);
  const replay = await f.request('/api/auth/oidc/callback?code=synthetic&state=attempt-2', { cookie });
  assert.equal(replay.status, 400);
  assert.equal(f.validated(), 1);
});

test('HTTP: a missing callback session offers a fixed uncached HTML recovery without validation', async t => {
  const f = await fixture(t);
  const response = await f.request('/api/auth/oidc/callback?code=private&state=private&returnTo=https://outside.invalid', {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/login?authentication=expired');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(f.validated(), 0);
});

test('HTTP: expired OIDC navigation offers recovery and never validates the code', async t => {
  const f = await fixture(t);
  const login = await f.request('/api/auth/oidc/login');
  f.advance(f.settings.oidcTransactionMs);
  const response = await f.request('/api/auth/oidc/callback?code=synthetic&state=attempt-1', { cookie: cookieOf(login), accept: 'text/html' });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/login?authentication=expired');
  assert.equal(f.validated(), 0);
});

test('HTTP: JSON, wildcard and explicitly refused HTML retain the 400 error contract', async t => {
  const f = await fixture(t);
  for (const accept of ['application/json', '*/*', 'text/html;q=0,application/json']) {
    const response = await f.request('/api/auth/oidc/callback?code=private&state=private', { accept });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'OIDC_TRANSACTION_INVALID');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(f.validated(), 0);
});

test('invalid or future transaction timestamps are rejected before consuming or exchanging a code', async () => {
  const instant = 2000000000000;
  for (const createdAt of [undefined, null, 'invalid', String(instant), NaN, Infinity, instant + 1, instant - 600000]) {
    let consumed = false, validated = false;
    const controller = createOidcAuthController({ config: { oidcTransactionMs: 600000 }, now: () => instant,
      sessionRegistry: { consumeOidcTransaction: async () => { consumed = true; return false; } },
      oidcClient: { callback: async () => { validated = true; } } });
    const req = { session: { oidcTransaction: { state: 'synthetic', createdAt } }, query: { state: 'synthetic' } };
    const res = { statusCode: 200, set() { return this; }, status(value) { this.statusCode = value; return this; }, json(body) { this.body = body; return this; } };
    await controller.callback(req, res, error => { throw error; });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'OIDC_TRANSACTION_INVALID');
    assert.equal(consumed, false);
    assert.equal(validated, false);
  }
});
