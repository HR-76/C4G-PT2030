'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateTarget, loadApplicationComposition, createEnvironment } = require('../../test/integration/partner-portal/environment');
const { runAuthorityGate, authorityCaseIds, assertRevocationRefusal } = require('../../test/integration/partner-portal/authorityProbe');

test('partner gate environment accepts only an explicit owned-loopback target shape', () => {
  const run = 'a'.repeat(32), url = 'postgresql://partner_gate_admin:synthetic@127.0.0.1:55591/postgres';
  assert.equal(validateTarget(url, run).hostname, '127.0.0.1');
  for (const target of [url.replace('127.0.0.1', 'localhost'), url.replace('55591', '5432'), url.replace('/postgres', '/dev'),
    url + '?options=-csearch_path=public', url.replace('partner_gate_admin', 'c4g_f12_admin'), 'not a url']) {
    assert.throws(() => validateTarget(target, run));
  }
  assert.throws(() => validateTarget(url, '../unsafe'));
});

test('partner gate refuses invalid environment before constructing database resources', async () => {
  await assert.rejects(createEnvironment({ adminUrl: 'postgresql://user:pass@remote.invalid:55591/postgres', runId: 'a'.repeat(32) }));
});

test('private candidate composition does not replace the active require cache or source', () => {
  const activePath = require.resolve('../src/applications/composition');
  const partnerPath = require.resolve('../src/applications/partners');
  const active = require(activePath), partners = require(partnerPath);
  const before = fs.readFileSync(activePath);
  for (const variant of ['baseline', 'candidate']) {
    const loaded = loadApplicationComposition(variant);
    assert.equal(typeof loaded.createApplicationComposition, 'function');
    assert.notEqual(loaded, active);
    assert.equal(require.cache[activePath].exports, active);
    assert.equal(require.cache[partnerPath].exports, partners);
  }
  assert.deepEqual(fs.readFileSync(activePath), before);
  assert.throws(() => loadApplicationComposition('arbitrary'));
});

test('authority gate declares real writer, cache, team and audit cases without marking offline evidence PASS', () => {
  assert.equal(typeof runAuthorityGate, 'function');
  for (const id of ['membership-authority-first', 'membership-guard-first', 'policy-authority-first', 'policy-guard-first',
    'session-revoked', 'team-before-read', 'team-during-unseen-resource', 'team-cache-hit', 'audit-failure']) assert.ok(authorityCaseIds.includes(id));
});

test('authority gate requires a prepared real environment rather than accepting doubles as proof', async () => {
  await assert.rejects(runAuthorityGate({}), /PARTNER_GATE_ENVIRONMENT_REQUIRED/);
});

test('revocation evidence accepts only the actual authority refusal and rejects incidental infrastructure failures', () => {
  for (const [kind, code, authorityFailure] of [
    ['membership', 'AUTHORITY_REQUIRED', 'MEMBERSHIP_INVALID'],
    ['session', 'AUTHORITY_REQUIRED', 'SESSION_INVALID'],
    ['policy', 'AUTHORITY_UNAVAILABLE', null]
  ]) {
    assert.deepEqual(assertRevocationRefusal(kind, { code, authorityFailure }), { refusalCode: code, authorityFailure });
    for (const error of [null, { code: 'ECONNRESET' }, { code: 'SERVICE_UNAVAILABLE' },
      { code: 'AUTHORITY_REQUIRED', authorityFailure: 'UNRELATED' }]) assert.throws(() => assertRevocationRefusal(kind, error));
  }
});

test('new gate modules never import local Dev configuration or auto-run on import', () => {
  for (const file of ['environment.js', 'authorityProbe.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../../test/integration/partner-portal', file), 'utf8');
    assert.doesNotMatch(source, /localPlatform\/config|process\.env|require\.cache\s*\[/);
  }
});
