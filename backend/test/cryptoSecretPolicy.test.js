'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {randomBytes, randomUUID} = require('node:crypto');
const {isSecretHex, requireProductionSecret} = require('../src/security/secretFormat');
const {editorialUiConfiguration} = require('../src/config/editorialUi');
const {createPq1UiTokens} = require('../src/organizationalProfile/pq1UiTokens');
const {createPreviewTokens} = require('../src/prequalification/tokens');

test('production secret format accepts generated keys and rejects malformed values', () => {
  const key = randomBytes(32).toString('hex');
  assert.equal(isSecretHex(key), true);
  for (const value of [undefined, '', 'a'.repeat(63), 'z'.repeat(64), 'password'.repeat(8)]) {
    assert.equal(isSecretHex(value), false);
    assert.throws(() => requireProductionSecret({NODE_ENV:'production', KEY:value}, 'KEY'), /KEY/);
  }
  assert.doesNotThrow(() => requireProductionSecret({NODE_ENV:'production', KEY:key}, 'KEY'));
});

test('production editorial ring validates every key without disclosing it', () => {
  const key = randomBytes(32).toString('hex');
  const env = {NODE_ENV:'production', PROFILE_EDITORIAL_UI_KEY_ID:'new', PROFILE_EDITORIAL_UI_KEYS_JSON:JSON.stringify({new:key})};
  assert.equal(editorialUiConfiguration(env).tokenKeyId, 'new');
  assert.throws(() => editorialUiConfiguration({...env, PROFILE_EDITORIAL_UI_KEYS_JSON:JSON.stringify({new:key,old:'invalid-secret'})}), {code:'EDITORIAL_UI_KEY_NOT_CONFIGURED'});
});

for (const [name, create, operation] of [['PQ1', createPq1UiTokens, 'APPROVE'], ['preview', createPreviewTokens, 'ACTIVATE']]) {
  test(`${name} key rotation retains old tokens only during overlap`, () => {
    const old = randomBytes(32).toString('hex'), next = randomBytes(32).toString('hex');
    const binding = {subjectId:randomUUID(), organizationId:randomUUID(), resourceId:randomUUID(), operation, expectedDigest:randomBytes(32).toString('hex'), ...(operation==='ACTIVATE'?{sessionDigest:randomBytes(32).toString('hex')}:{})};
    const first = create({keys:{old},currentKeyId:'old'}).issue(binding).concurrencyToken;
    const overlap = create({keys:{old,next},currentKeyId:'next'});
    overlap.verify(first,binding);
    const second = overlap.issue(binding).concurrencyToken;
    const rotated = create({keys:{next},currentKeyId:'next'});
    rotated.verify(second,binding);
    assert.throws(() => rotated.verify(first,binding), {code:'CONCURRENCY_TOKEN_INVALID'});
  });
}
