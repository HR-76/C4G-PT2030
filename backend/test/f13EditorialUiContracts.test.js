'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { validate, receipt, completion } = require('../src/organizationalProfile/editorialUiContracts');
test('UI contracts reject caller authority, digests and unbounded pagination', () => {
  const command = { draftId: randomUUID(), items: [], idempotencyKey: randomUUID() };
  assert.deepEqual(validate('create', command), command);
  for (const key of ['scopeId', 'organizationId', 'actor', 'expectedDigest', 'policy']) assert.throws(() => validate('create', { ...command, [key]: 'caller-controlled' }));
  for (const limit of ['0', '-1', '101', 'NaN', 'Infinity']) assert.throws(() => validate('drafts', { limit }));
  assert.deepEqual(validate('drafts', {}), { limit: 20 });
  assert.throws(() => validate('approve', { expectedCandidateDigest: 'a'.repeat(64), idempotencyKey: randomUUID() }, randomUUID()));
  assert.throws(() => validate('catalog', { domain: 'COMPETENCY' }));
});
test('receipts and completion remove all internal evidence by allowlist', () => {
  const value = { candidateId: randomUUID(), sourceRevision: 2, candidateDigest: 'a'.repeat(64), authors: ['restricted'],
    completion: { result: 'COMPLETE', policyRef: { digest: 'secret' }, editorialDigest: 'restricted', references: ['restricted'],
      findings: [{ slot: 'strategicPriorities', code: 'UNKNOWN_EXPLICIT', severity: 'INFO', itemId: null, evidence: 'restricted' }] } };
  const projected = receipt('submit', value);
  assert.equal(projected.completion.findings[0].domain, 'STRATEGIC_PRIORITY');
  assert(!/digest|authors|references|restricted|evidence/i.test(JSON.stringify(projected)));
  assert.throws(() => completion({ result: 'COMPLETE', findings: [{ code: 'UNRECOGNIZED_INTERNAL', severity: 'INFO' }] }), { code: 'SERVICE_UNAVAILABLE' });
});
test('lookup requires operation-specific revision and no caller guard ID', () => {
  const base = { operation: 'SUBMIT', resourceId: randomUUID(), idempotencyKey: randomUUID() };
  assert.throws(() => validate('lookup', base));
  assert.deepEqual(validate('lookup', { ...base, expectedRevision: 1 }), { ...base, expectedRevision: 1 });
  assert.throws(() => validate('lookup', { ...base, expectedRevision: 1, guardId: randomUUID() }));
});
test('Express GET query objects are adapted without relaxing closed contracts', async () => {
  const express = require('express'), app = express(); app.use(express.json());
  const pass = (req, res, next) => next();
  app.use(require('../src/routes/editorialUiRoutes').createEditorialUiRouter({ express,
    service: { async execute(method, input) { return { method, input }; } }, authenticate: pass,
    organizationMiddleware: { requireServerSession: pass, resolveOrganizationContext: pass, requireOrganizationContext: pass } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const root = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(root + '/drafts?limit=1');
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { method: 'drafts', input: { limit: 1 } });
    assert.equal((await fetch(root + '/drafts?organizationId=foreign')).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
