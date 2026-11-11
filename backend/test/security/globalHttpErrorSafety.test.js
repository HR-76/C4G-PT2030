'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createErrorHandler } = require('../../src/app');
const { PublicHttpError } = require('../../src/utils/publicHttpError');

async function withServer(error, options, work) {
  const app = express();
  app.get('/api/example', (_req, _res, next) => next(error));
  app.use(createErrorHandler(options));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    await work(`http://127.0.0.1:${server.address().port}/api/example`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

for (const nodeEnv of ['development', 'test', 'production']) {
  test(`unexpected HTTP errors remain private in ${nodeEnv}`, async () => {
    const canary = 'synthetic-private-query-and-credential';
    const error = Object.assign(new Error(canary), { code: canary, detail: canary });
    const observed = [];
    await withServer(error, { nodeEnv, reportError: (cause, context) => observed.push({ cause, context }) }, async base => {
      const response = await fetch(`${base}?token=synthetic-query-canary`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { message: 'Erro interno do servidor.' });
      assert.equal(response.headers.get('cache-control'), 'no-store');
    });
    assert.equal(observed.length, 1);
    assert.equal(observed[0].cause, error);
    assert.deepEqual(observed[0].context, { method: 'GET', path: '/api/example' });
  });
}

test('invalid exception statuses cannot trigger a second Express error response', async () => {
  for (const status of [200, 302, 399, 600, 999, 'private-status', NaN, 400.5]) {
    const error = Object.assign(new Error('synthetic-private-error'), { status });
    await withServer(error, { nodeEnv: 'development' }, async base => {
      const response = await fetch(base);
      assert.equal(response.status, 500, `status ${status}`);
      assert.deepEqual(await response.json(), { message: 'Erro interno do servidor.' });
    });
  }
});

test('safe HTTP statuses and explicitly public errors preserve their contracts', async () => {
  for (const status of [400, 413, 429, 503]) {
    await withServer(Object.assign(new Error('private'), { status }), { nodeEnv: 'development' }, async base => {
      const response = await fetch(base);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { message: 'Erro interno do servidor.' });
    });
  }
  await withServer(new PublicHttpError({ statusCode: 503, code: 'ORGANIZATION_CONTEXT_UNAVAILABLE', publicMessage: 'Organization context is temporarily unavailable.', cause: new Error('private') }), {}, async base => {
    const response = await fetch(base);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: 'ORGANIZATION_CONTEXT_UNAVAILABLE', message: 'Organization context is temporarily unavailable.' } });
  });
});

test('observer failure cannot expose its own error or replace the original status', async () => {
  await withServer(Object.assign(new Error('private'), { status: 429 }), { nodeEnv: 'development', reportError() { throw new Error('private-observer'); } }, async base => {
    const response = await fetch(base);
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { message: 'Erro interno do servidor.' });
  });
});
