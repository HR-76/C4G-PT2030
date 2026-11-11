const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const cors = require('cors');
const { createApp, parseTrustProxyHops } = require('../../src/app');
const { createActivationHttp } = require('../../src/platformOnboarding/activationHttp');

async function listen(t, app) {
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return server.address().port;
}

function request(port, { method = 'GET', path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject); req.end(body);
  });
}

test('production hides the route catalog and version and sends transport security headers', async t => {
  const production = await listen(t, createApp({ express, cors, config: { nodeEnv: 'production' }, pool: {}, routes: {} }));
  const response = await request(production, { path: '/' });
  assert.deepEqual(JSON.parse(response.text), { app: 'GCNI_C4G', status: 'running' });
  assert.equal(response.headers['strict-transport-security'], 'max-age=31536000');
  assert.equal(response.headers['x-xss-protection'], '0');

  const development = await listen(t, createApp({ express, cors, config: { nodeEnv: 'test' }, pool: {}, routes: {} }));
  const local = await request(development, { path: '/' });
  assert.ok(JSON.parse(local.text).endpoints);
  assert.equal(local.headers['strict-transport-security'], undefined);
  assert.equal(local.headers['x-xss-protection'], '0');
});

test('trusted proxy hop count is validated and applied', () => {
  assert.equal(parseTrustProxyHops(undefined), 1);
  assert.equal(parseTrustProxyHops(''), 1);
  assert.equal(parseTrustProxyHops('0'), 0);
  assert.equal(parseTrustProxyHops('2'), 2);
  for (const value of ['-1', '11', '1.5', 'true']) assert.throws(() => parseTrustProxyHops(value), /TRUST_PROXY_HOPS/);
  const next = (_req, _res, done) => done();
  const security = { nodeEnv: 'test', allowedDevelopmentOrigins: [], sessionMiddleware: next, credentialGuard: next,
    originProtection: next, csrfProtection: next };
  const hops = config => createApp({ express, cors, config, pool: {}, routes: {}, security }).get('trust proxy');
  assert.equal(hops({ nodeEnv: 'test' }), 1);
  assert.equal(hops({ nodeEnv: 'test', trustProxyHops: 2 }), 2);
});

test('activation begin accepts only the issued anti-forgery value', async t => {
  const begun = [];
  const app = express();
  const activation = createActivationHttp({ express, origin: 'http://localhost', identityOrigin: 'https://identity.test',
    bridgeSecret: 'synthetic-bridge-secret-for-test',
    service: { async beginActivation(invitation) { begun.push(invitation); return { exchange: 'synthetic-exchange' }; } },
    oidc: { async begin() { return 'https://identity.test/continue'; } } });
  app.use('/api/activation', activation.router);
  const port = await listen(t, app);
  const open = async () => {
    const page = await request(port, { path: '/api/activation' });
    return { cookie: page.headers['set-cookie'][0].split(';')[0], csrf: /name="csrf" type="hidden" value="([a-f0-9]{64})"/.exec(page.text)[1] };
  };
  const begin = (cookie, form) => request(port, { method: 'POST', path: '/api/activation/begin', body: form,
    headers: { Cookie: cookie, Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) } });
  const invitation = 'a'.repeat(64);
  const first = await open();
  for (const csrf of ['', 'b'.repeat(64), first.csrf.slice(0, 63)]) {
    assert.equal((await begin(first.cookie, `csrf=${csrf}&invitation=${invitation}`)).status, 403);
  }
  assert.equal((await begin(first.cookie, `invitation=${invitation}`)).status, 403);
  assert.deepEqual(begun, []);
  const accepted = await begin(first.cookie, `csrf=${first.csrf}&invitation=${invitation}`);
  assert.equal(accepted.status, 303);
  assert.equal(accepted.headers.location, 'https://identity.test/continue');
  assert.deepEqual(begun, [invitation]);
  // The value is single use.
  assert.equal((await begin(first.cookie, `csrf=${first.csrf}&invitation=${invitation}`)).status, 403);
});
