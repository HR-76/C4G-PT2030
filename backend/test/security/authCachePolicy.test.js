const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cors = require('cors');
const { createApp } = require('../../src/app');

test('auth responses are uncached including early refusals and invalid JSON', async t => {
  const router = express.Router();
  router.get('/session', (_req, res) => res.json({ user: { id: 'fixture' } }));
  router.get('/csrf', (_req, res) => res.json({ csrfToken: 'fixture' }));
  const next = (_req, _res, done) => done();
  const app = createApp({ express, cors, config: { nodeEnv: 'test' }, pool: {}, routes: { oidcAuth: router },
    security: { nodeEnv: 'test', allowedDevelopmentOrigins: [], sessionMiddleware: next,
      credentialGuard: (req, res, done) => req.headers.authorization ? res.status(400).end() : done(),
      originProtection: next, csrfProtection: next } });
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;
  for (const [path, options, status] of [
    ['/session', {}, 200], ['/csrf', {}, 200], ['/session', { headers: { authorization: 'fixture' } }, 400],
    ['/organization', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }, 400],
    ['/missing', {}, 404]
  ]) {
    const response = await fetch(base + path, options);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await response.text();
  }
});
