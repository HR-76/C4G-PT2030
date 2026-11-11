'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { parse } = require('../src/applications/partners');
const { createApplicationSliceRouter } = require('../src/routes/applicationSliceRoutes');

// Real HTTP/router and partner input parser; synthetic service and middleware.
// This does not prove OIDC, membership, X-C4G-Organization binding, RLS or SQL.
const next = (req, res, done) => done();
const organizationMiddleware = {
  requireServerSession: next, resolveOrganizationContext: next, requireOrganizationContext: next
};
const organizationId = '10000000-0000-4000-8000-000000000001';
const empty = { items: [], total: 0, page: 1, nextCursor: null, previousCursor: null, countries: [] };
const canary = 'synthetic-private-sql-and-provider-details';

async function withServer(work) {
  const calls = [], observations = [], state = { response: empty, error: null, parsedCalls: 0 };
  const router = createApplicationSliceRouter({ express, authenticate: next, organizationMiddleware,
    service: { async execute(method, raw, id, request) {
      calls.push({ method, raw, id, organizationHeader: request.headers['x-c4g-organization'] });
      assert.equal(method, 'partnersBrowse');
      const input = parse(method, raw);
      calls.at(-1).input = input; state.parsedCalls++;
      if (state.error) throw state.error;
      return state.response;
    } }, onFailure: observation => observations.push(observation)
  });
  const app = express(); app.use(express.json()); app.use('/api/applications', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const url = `http://127.0.0.1:${server.address().port}/api/applications/partners`;
  try { await work({ url, state, calls, observations }); }
  finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}

function request(url, { query = '', method = 'GET', body, headers = {} } = {}) {
  const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    let deadline;
    const fail = error => { clearTimeout(deadline); reject(error); };
    const req = http.request(url + (query ? `?${query}` : ''), { method,
      headers: { Connection: 'close', ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}), ...headers }
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk)); res.on('error', fail);
      res.on('end', () => {
        clearTimeout(deadline);
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { fail(error); }
      });
    });
    req.on('error', fail);
    deadline = setTimeout(() => req.destroy(new Error('Partner HTTP fixture exceeded its 5 second deadline')), 5000);
    req.end(bytes);
  });
}

function assertError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(Object.keys(response.body).sort(), ['correlationId', 'error']);
  assert.deepEqual(response.body.error, { code });
  assert.match(response.body.correlationId, /^[a-f0-9-]{36}$/i);
}

test('partner browse HTTP preserves the complete page envelope and empty 200 without pageSize', async () => {
  await withServer(async ({ url, state, calls }) => {
    const populated = { items: [{ id: '20000000-0000-4000-8000-000000000001', entity_name: 'Instituto de Ciência',
      country: 'Portugal', research_area_interest: 'Saúde', responsible_person: '', contact: '', email: '', people: [],
      createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z',
      application_id: '30000000-0000-4000-8000-000000000001', application_title: 'Candidatura',
      application_status: 'PREPARATION', opportunity_title: null }], total: 26, page: 2,
      nextCursor: null, previousCursor: 'synthetic-previous-cursor', countries: ['Brasil', 'Portugal'] };
    for (const page of [empty, populated]) {
      state.response = page;
      const response = await request(url);
      assert.equal(response.status, 200); assert.equal(response.headers['cache-control'], 'no-store');
      assert.match(response.headers['content-type'], /^application\/json/);
      assert.deepEqual(response.body, page);
      assert.deepEqual(Object.keys(response.body).sort(), ['countries', 'items', 'nextCursor', 'page', 'previousCursor', 'total']);
      assert.deepEqual(calls.at(-1).input, { q: '', country: '', person_role: '', cursor: null });
      assert.equal(calls.at(-1).id, undefined);
    }
  });
});

test('partner browse HTTP uses the real parser and delegates opaque cursors and organization header unchanged', async () => {
  await withServer(async ({ url, calls }) => {
    const opaque = 'synthetic.opaque.cursor';
    for (const person_role of ['', 'RESPONSAVEL', 'INVESTIGADOR', 'OUTRO']) {
      const response = await request(url, { query: new URLSearchParams({ q: '  Ana %_\\  ', country: 'Portugal', person_role, cursor: opaque }).toString(),
        headers: { 'X-C4G-Organization': organizationId } });
      assert.equal(response.status, 200);
      assert.deepEqual(calls.at(-1).input, { q: 'Ana %_\\', country: 'Portugal', person_role, cursor: opaque });
      // Forwarding is observable here; authority/header binding lives in the real composition.
      assert.equal(calls.at(-1).organizationHeader, organizationId);
    }
    const response = await request(url, { query: new URLSearchParams({ q: ` ${'q'.repeat(200)} `, country: 'c'.repeat(100), cursor: 'x'.repeat(4096) }).toString() });
    assert.equal(response.status, 200);
    assert.equal(calls.at(-1).input.q.length, 200);
    assert.equal(calls.at(-1).input.country.length, 100);
    assert.equal(calls.at(-1).input.cursor.length, 4096);
    const astral = await request(url, { query: new URLSearchParams({ q: '😀'.repeat(100) }).toString() });
    assert.equal(astral.status, 200);
    assert.equal(calls.at(-1).input.q.length, 200, 'the existing boundary counts UTF-16 units');
    await request(url, { query: 'q=&country=&person_role=&cursor=' });
    assert.deepEqual(calls.at(-1).input, { q: '', country: '', person_role: '', cursor: null });
  });
});

test('partner browse HTTP refuses query arrays, unknown scope, invalid roles and string boundaries', async () => {
  await withServer(async ({ url, state }) => {
    const invalid = [
      'q=one&q=two', 'country=Portugal&country=Brasil',
      ...['limit', 'sort', 'direction', 'organizationId', 'membershipId', 'unknown'].map(key => `${key}=value`),
      ...[{ q: 'q'.repeat(201) }, { q: '😀'.repeat(101) }, { country: 'c'.repeat(101) }, { cursor: 'x'.repeat(4097) },
        { person_role: 'ADMIN' }, { person_role: 'outro' }, { q: 'before\0after' }, { country: 'before\0after' },
        { country: ' Portugal' }, { country: 'Portugal ' }].map(value => new URLSearchParams(value).toString())
    ];
    for (const query of invalid) {
      assertError(await request(url, { query }), 400, 'INVALID_INPUT');
      assert.equal(state.parsedCalls, 0, 'invalid input must never reach domain work');
    }
  });
});

test('partner browse GET rejects a nonempty body before execute while an empty object remains accepted', async () => {
  await withServer(async ({ url, calls }) => {
    assertError(await request(url, { body: { q: 'body cannot supply filters' } }), 400, 'INVALID_INPUT');
    assert.equal(calls.length, 0);
    const response = await request(url, { body: {} });
    assert.equal(response.status, 200); assert.deepEqual(response.body, empty);
    assert.equal(calls.length, 1);
  });
});

test('partner browse unsupported POST, PATCH and DELETE return 405 without service execution', async () => {
  await withServer(async ({ url, calls }) => {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const response = await request(url, { method });
      assert.equal(response.status, 405); assert.equal(response.headers['cache-control'], 'no-store');
      assert.deepEqual(response.body, { error: { code: 'OPERATION_NOT_AVAILABLE' } });
    }
    assert.equal(calls.length, 0);
  });
});

test('partner browse HTTP preserves cursor, schema, authority and availability errors without internal details', async () => {
  await withServer(async ({ url, state, observations }) => {
    const cases = [
      ['INVALID_CURSOR', 400, 'INVALID_CURSOR'], ['SCHEMA_UPGRADE_REQUIRED', 409, 'SCHEMA_UPGRADE_REQUIRED'],
      ['LIMIT_EXCEEDED', 409, 'LIMIT_EXCEEDED'], ['SESSION_REQUIRED', 401, 'SESSION_REQUIRED'],
      ['NOT_AUTHORIZED', 403, 'NOT_AUTHORIZED'], ['RESOURCE_NOT_AVAILABLE', 404, 'RESOURCE_NOT_AVAILABLE'],
      ['AUTHORITY_REQUIRED', 401, 'SESSION_REQUIRED', 'SESSION_INVALID'],
      ['AUTHORITY_REQUIRED', 403, 'NOT_AUTHORIZED', 'MEMBERSHIP_INVALID'],
      ['AUTHORITY_REQUIRED', 503, 'SERVICE_UNAVAILABLE'], ['AUTHORITY_DENIED', 404, 'RESOURCE_NOT_AVAILABLE'],
      ['AUTHORIZATION_DENIED', 404, 'RESOURCE_NOT_AVAILABLE'], ['SERVICE_UNAVAILABLE', 503, 'SERVICE_UNAVAILABLE'],
      ['23505', 503, 'SERVICE_UNAVAILABLE'], [canary, 503, 'SERVICE_UNAVAILABLE']
    ];
    let expectedObservations = 0;
    for (const [code, status, publicCode, authorityFailure] of cases) {
      state.error = Object.assign(new Error(canary), { code, authorityFailure, detail: canary, cause: new Error(canary) });
      const response = await request(url);
      assertError(response, status, publicCode);
      assert.equal(JSON.stringify(response.body).includes(canary), false);
      if (status >= 500) {
        expectedObservations++;
        assert.deepEqual(observations.at(-1), { code: publicCode, component: 'APPLICATION_HTTP', correlationId: response.body.correlationId });
      }
      assert.equal(observations.length, expectedObservations);
      assert.equal(JSON.stringify(observations).includes(canary), false);
    }
  });
});
