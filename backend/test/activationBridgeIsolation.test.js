'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createActivationHttp } = require('../src/platformOnboarding/activationHttp');

test('one address cannot exhaust the shared activation context table', async () => {
  const app = express();
  const activation = createActivationHttp({ express, service: {}, oidc: {}, origin: 'http://localhost',
    identityOrigin: 'https://identity.test', bridgeSecret: 'synthetic-bridge-secret-for-test', maxContextsPerAddress: 2 });
  let address = '203.0.113.1';
  app.use((req, _res, next) => { Object.defineProperty(req, 'ip', { value: address }); next(); });
  app.use('/api/activation', activation.router);
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  try {
    const open = async () => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api/activation`); await r.text(); return r; };
    assert.equal((await open()).status, 200);
    assert.equal((await open()).status, 200);
    const refused = await open();
    assert.equal(refused.status, 429);
    assert.equal(refused.headers.get('retry-after'), '600');
    assert.equal(refused.headers.get('set-cookie'), null);
    address = '203.0.113.2';
    assert.equal((await open()).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('activation bridge refuses missing and wrong secrets before invoking the isolated identity port', async () => {
  const calls = [];
  const app = express();
  const activation = createActivationHttp({
    express,
    service: {},
    oidc: { async bridge(ticket, subject) { calls.push({ ticket, subject }); return { subject }; } },
    origin: 'http://localhost',
    identityOrigin: 'https://identity.test',
    bridgeSecret: 'synthetic-bridge-secret-for-test'
  });
  app.use('/bridge', activation.bridge);
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/bridge/check`;
    const post = secret => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-C4G-Activation': secret } : {}) },
      body: JSON.stringify({ ticket: 'synthetic-ticket', subject: 'synthetic-subject' })
    });
    assert.equal((await post()).status, 403);
    assert.equal((await post('wrong-synthetic-secret')).status, 403);
    assert.deepEqual(calls, []);
    const accepted = await post('synthetic-bridge-secret-for-test');
    assert.equal(accepted.status, 200);
    assert.equal(await accepted.text(), 'synthetic-subject');
    assert.equal(calls.length, 1);
    assert.equal((await fetch(url)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
