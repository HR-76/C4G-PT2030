'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { createEditorialUiTokens } = require('../src/organizationalProfile/editorialUiTokens');
test('editorial UI concurrency tokens bind exact immutable decision without disclosing digest', () => {
  let time = 1800000000000;
  const tokens = createEditorialUiTokens({ keys: { test: randomBytes(32).toString('hex') }, currentKeyId: 'test', clock: () => time });
  const binding = { subjectId: randomUUID(), organizationId: randomUUID(), resourceId: randomUUID(), operation: 'APPROVE', expectedDigest: randomBytes(32).toString('hex') };
  const first = tokens.issue(binding).concurrencyToken;
  assert(!first.includes(binding.expectedDigest));
  tokens.verify(first, binding);
  for (const key of ['subjectId', 'organizationId', 'resourceId', 'expectedDigest', 'operation']) {
    const value = key === 'operation' ? 'PUBLISH' : key === 'expectedDigest' ? randomBytes(32).toString('hex') : randomUUID();
    assert.throws(() => tokens.verify(first, { ...binding, [key]: value }), { code: 'CONCURRENCY_TOKEN_INVALID' });
  }
  assert.throws(() => tokens.verify(first.slice(0, -2) + 'xx', binding), { code: 'CONCURRENCY_TOKEN_INVALID' });
  time += 299999; tokens.verify(first, binding);
  time += 1; assert.throws(() => tokens.verify(first, binding), { code: 'CONCURRENCY_TOKEN_EXPIRED' });
  tokens.verify(tokens.issue(binding).concurrencyToken, binding);
  time = NaN; assert.throws(() => tokens.issue(binding), { code: 'SERVICE_UNAVAILABLE' });
});
test('cursor is time limited and cannot cross tenant, user, route or filters', () => {
  let time = 1800000000000;
  const tokens = createEditorialUiTokens({ keys: { test: randomBytes(32).toString('hex') }, currentKeyId: 'test', clock: () => time });
  const context = { subjectId: randomUUID(), organizationId: randomUUID(), route: 'drafts', locale: 'pt-PT' };
  const position = randomUUID(), cursor = tokens.cursor(position, context);
  assert.equal(tokens.openCursor(cursor, context), position);
  for (const key of Object.keys(context)) assert.throws(() => tokens.openCursor(cursor, { ...context, [key]: 'different' }), { code: 'INVALID_CURSOR' });
  time += 600000; assert.throws(() => tokens.openCursor(cursor, context), { code: 'INVALID_CURSOR' });
});
test('missing dedicated key fails closed without echoing configuration', () => {
  assert.throws(() => createEditorialUiTokens({ keys: {}, currentKeyId: 'missing' }), { code: 'EDITORIAL_UI_KEY_NOT_CONFIGURED' });
});
test('rotation accepts old tokens only while the old key remains in the ring', () => {
  const old = randomBytes(32).toString('hex'), next = randomBytes(32).toString('hex');
  const binding = { subjectId: randomUUID(), organizationId: randomUUID(), resourceId: randomUUID(), operation: 'APPROVE', expectedDigest: randomBytes(32).toString('hex') };
  const before = createEditorialUiTokens({ keys: { old }, currentKeyId: 'old' });
  const token = before.issue(binding).concurrencyToken;
  const during = createEditorialUiTokens({ keys: { old, next }, currentKeyId: 'next' });
  during.verify(token, binding);
  const replacement = during.issue(binding).concurrencyToken;
  const after = createEditorialUiTokens({ keys: { next }, currentKeyId: 'next' });
  after.verify(replacement, binding);
  assert.throws(() => after.verify(token, binding), { code: 'CONCURRENCY_TOKEN_INVALID' });
  assert.throws(() => createEditorialUiTokens({ keys: { next: 'short' }, currentKeyId: 'next' }), { code: 'EDITORIAL_UI_KEY_NOT_CONFIGURED' });
});
