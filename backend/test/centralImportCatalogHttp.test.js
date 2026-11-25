'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), express = require('express'), multer = require('multer');
const { randomUUID } = require('node:crypto');
const { createCentralImportRouter } = require('../src/portugal2030/uploadHttp');

const SHA = 'a'.repeat(64), JSON_HEADERS = { 'content-type': 'application/json' };
async function fixture(t, overrides = {}) {
  const calls = [], userId = randomUUID(), uploadId = randomUUID(), importId = randomUUID(); let allowed = true;
  const record = name => async input => { calls.push([name, input]); if (overrides[name]) throw Object.assign(Error(overrides[name]), { code: overrides[name] }); return { ok: name }; };
  const runtime = { availability: async () => ({ available: true, mode: 'STAGE_AND_ACCEPT' }), stage: record('stage'), review: record('review'), accept: record('accept') };
  const app = express(); app.use(express.json()); app.use((req, res, next) => { req.user = { id: userId }; req.authContext = { sessionId: 'session-token-0001' }; next(); });
  app.use(createCentralImportRouter({ express, multer, runtime, authorize: async () => { if (!allowed) throw Object.assign(Error(), { code: 'C4G_ADMIN_REQUIRED' }); } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, userId, uploadId, importId, revoke: () => { allowed = false; } };
}
const post = (url, body) => fetch(url, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });

test('stage, review and accept bind the actor and session from the server, never from the body', async t => {
  const f = await fixture(t);
  const staged = await post(`${f.url}/${f.uploadId}/stage`, { requestId: randomUUID(), sheetName: 'Sheet1', previewDigest: SHA });
  assert.equal(staged.status, 201);
  assert.equal((await fetch(`${f.url}/staged/${f.importId}`)).status, 200);
  const accepted = await post(`${f.url}/staged/${f.importId}/accept`, { batchDigest: SHA });
  assert.equal(accepted.status, 200);
  assert.deepEqual(f.calls.map(([name]) => name), ['stage', 'review', 'accept']);
  for (const [, input] of f.calls) { assert.equal(input.userId, f.userId); assert.equal(input.sessionId, 'session-token-0001'); }
  assert.equal(f.calls[2][1].importId, f.importId); assert.equal(f.calls[2][1].batchDigest, SHA);
});

test('forged or malformed input is refused before the runtime is called', async t => {
  const f = await fixture(t), id = randomUUID();
  for (const [url, body] of [
    [`${f.url}/${f.uploadId}/stage`, { requestId: id, sheetName: 'Sheet1' }],
    [`${f.url}/${f.uploadId}/stage`, { requestId: id, sheetName: 'Sheet1', previewDigest: 'short' }],
    [`${f.url}/${f.uploadId}/stage`, { requestId: id, sheetName: 'Sheet1', previewDigest: SHA, userId: randomUUID() }],
    [`${f.url}/${f.uploadId}/stage`, { requestId: 'x', sheetName: 'Sheet1', previewDigest: SHA }],
    [`${f.url}/staged/${f.importId}/accept`, { batchDigest: 'nope' }],
    [`${f.url}/staged/${f.importId}/accept`, { batchDigest: SHA, userId: randomUUID() }],
    [`${f.url}/staged/not-a-uuid/accept`, { batchDigest: SHA }]
  ]) assert.equal((await post(url, body)).status, 400, url);
  assert.equal((await fetch(`${f.url}/staged/not-a-uuid`)).status, 400);
  assert.equal((await fetch(`${f.url}/staged/${f.importId}?x=1`)).status, 400);
  assert.equal(f.calls.length, 0);
});

test('a revoked administrator reaches none of them', async t => {
  const f = await fixture(t); f.revoke();
  assert.equal((await post(`${f.url}/${f.uploadId}/stage`, { requestId: randomUUID(), sheetName: 'S', previewDigest: SHA })).status, 403);
  assert.equal((await fetch(`${f.url}/staged/${f.importId}`)).status, 403);
  assert.equal((await post(`${f.url}/staged/${f.importId}/accept`, { batchDigest: SHA })).status, 403);
  assert.equal(f.calls.length, 0);
});

test('failures are mapped to public codes and never leak provider detail', async t => {
  const cases = [
    ['PT2030_BATCH_STALE', 409, 'PT2030_BATCH_STALE'], ['PT2030_IMPORT_BUSY', 409, 'PT2030_IMPORT_BUSY'],
    ['OPPORTUNITY_V2_AUTHORITY_DENIED', 403, 'PT2030_RECENT_AUTHENTICATION_REQUIRED'], ['PT2030_IMPORT_NOT_FOUND', 404, 'PT2030_IMPORT_NOT_FOUND'],
    ['PT2030_PREVIEW_DIGEST_MISMATCH', 409, 'PT2030_PREVIEW_DIGEST_MISMATCH'], ['password=hunter2 host=db.internal', 503, 'CENTRAL_IMPORT_UNAVAILABLE']
  ];
  for (const [raised, status, code] of cases) {
    const f = await fixture(t, { accept: raised });
    const response = await post(`${f.url}/staged/${f.importId}/accept`, { batchDigest: SHA }), text = await response.text();
    assert.equal(response.status, status, raised); assert.deepEqual(JSON.parse(text), { error: { code } });
    assert.ok(!text.includes('hunter2'));
  }
});
