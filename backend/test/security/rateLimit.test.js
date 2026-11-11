const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cors = require('cors');
const { createApp } = require('../../src/app');
const { createRateLimiter, loadRateLimitConfig } = require('../../src/security/rateLimit');

function response() {
  return { headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; } };
}

test('limiter refuses an address past its window limit and recovers afterwards', () => {
  let instant = 1000;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => instant });
  const hit = ip => { const res = response(); let passed = false; limiter({ ip }, res, () => { passed = true; }); return { passed, res }; };
  assert.equal(hit('a').passed, true);
  assert.equal(hit('a').passed, true);
  const refused = hit('a');
  assert.equal(refused.passed, false);
  assert.equal(refused.res.statusCode, 429);
  assert.deepEqual(refused.res.body, { error: { code: 'RATE_LIMITED' } });
  assert.equal(refused.res.headers['Retry-After'], '1');
  assert.equal(refused.res.headers['Cache-Control'], 'no-store');
  assert.equal(hit('b').passed, true);
  instant += 1000;
  assert.equal(hit('a').passed, true);
});

test('limiter memory stays bounded under a flood of distinct addresses', () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 2, now: () => 0 });
  const passed = ip => { let ok = false; limiter({ ip }, response(), () => { ok = true; }); return ok; };
  assert.equal(passed('a'), true);
  assert.equal(passed('b'), true);
  assert.equal(passed('c'), true);
  assert.equal(passed('b'), false);
  // The oldest window was evicted to admit the third address.
  assert.equal(passed('a'), true);
});

test('rate limit configuration has defaults and rejects invalid values', () => {
  assert.deepEqual(loadRateLimitConfig({}), { authPerMinute: 60, apiPerMinute: 3000 });
  assert.deepEqual(loadRateLimitConfig({ RATE_LIMIT_AUTH_PER_MINUTE: '5', RATE_LIMIT_API_PER_MINUTE: '9' }),
    { authPerMinute: 5, apiPerMinute: 9 });
  for (const value of ['0', '-1', '1.5', 'many']) {
    assert.throws(() => loadRateLimitConfig({ RATE_LIMIT_AUTH_PER_MINUTE: value }), /RATE_LIMIT_AUTH_PER_MINUTE/);
  }
});

test('the API refuses excess login attempts before the session store is reached', async t => {
  let sessionLoads = 0, logins = 0;
  const router = express.Router();
  router.get('/oidc/login', (_req, res) => { logins++; res.json({ ok: true }); });
  router.get('/session', (_req, res) => res.json({ ok: true }));
  const next = (_req, _res, done) => done();
  const app = createApp({ express, cors, config: { nodeEnv: 'test', rateLimit: { authPerMinute: 2, apiPerMinute: 4 } },
    pool: {}, routes: { oidcAuth: router },
    security: { nodeEnv: 'test', allowedDevelopmentOrigins: [], sessionMiddleware: (_req, _res, done) => { sessionLoads++; done(); },
      credentialGuard: next, originProtection: next, csrfProtection: next } });
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const status = async path => { const r = await fetch(base + path); await r.text(); return r.status; };
  assert.equal(await status('/api/auth/oidc/login'), 200);
  assert.equal(await status('/api/auth/oidc/login'), 200);
  assert.equal(await status('/api/auth/oidc/login'), 429);
  assert.equal(logins, 2);
  assert.equal(sessionLoads, 2);
  // Other API routes share the wider per-address budget; health probes are outside it.
  assert.equal(await status('/api/auth/session'), 200);
  assert.equal(await status('/api/auth/session'), 200);
  assert.equal(await status('/api/auth/session'), 429);
  assert.equal(await status('/health/live'), 200);
});
