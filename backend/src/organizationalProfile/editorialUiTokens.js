'use strict';

const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { canonicalize } = require('./canonicalization');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function createEditorialUiTokens({ keys, currentKeyId, clock = () => Date.now() }) {
  if (!keys || !/^[a-zA-Z0-9_-]{1,32}$/.test(currentKeyId || '') || !Object.hasOwn(keys, currentKeyId)
    || Object.entries(keys).some(([id, key]) => !/^[a-zA-Z0-9_-]{1,32}$/.test(id) || typeof key !== 'string' || Buffer.byteLength(key) < 32)) {
    fail('EDITORIAL_UI_KEY_NOT_CONFIGURED');
  }
  const ring = Object.freeze({ ...keys });
  const now = () => { const value = clock(); if (!Number.isFinite(value)) fail('SERVICE_UNAVAILABLE'); return Math.floor(value / 1000); };
  function binding(value) {
    if (!value || Object.keys(value).sort().join(',') !== 'expectedDigest,operation,organizationId,resourceId,subjectId'
      || !['subjectId', 'organizationId', 'resourceId'].every(k => UUID.test(value[k]))
      || !['APPROVE', 'PUBLISH'].includes(value.operation) || !/^[a-f0-9]{64}$/.test(value.expectedDigest)) fail('CONCURRENCY_TOKEN_INVALID');
    return value;
  }
  function mac(kid, value) { return createHmac('sha256', ring[kid]).update(canonicalize(value)).digest('base64url'); }
  function equal(a, b) { const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
  return Object.freeze({
    issue(value) {
      binding(value);
      const iat = now(), exp = iat + 300, nonce = randomBytes(16).toString('base64url'), kid = currentKeyId;
      const signature = mac(kid, { purpose: 'F13_EDITORIAL_UI_CONCURRENCY_V1', kid, iat, exp, nonce, ...value });
      return { concurrencyToken: `v1.${kid}.${iat}.${exp}.${nonce}.${signature}`, expiresAt: new Date(exp * 1000).toISOString() };
    },
    verify(token, value) {
      binding(value);
      const match = typeof token === 'string' && /^v1\.([a-zA-Z0-9_-]{1,32})\.([0-9]{1,12})\.([0-9]{1,12})\.([a-zA-Z0-9_-]{22})\.([a-zA-Z0-9_-]{43})$/.exec(token);
      if (!match || !Object.hasOwn(ring, match[1])) fail('CONCURRENCY_TOKEN_INVALID');
      const [, kid, start, end, nonce, signature] = match, iat = Number(start), exp = Number(end);
      if (String(iat) !== start || String(exp) !== end || exp !== iat + 300 || !equal(signature,
        mac(kid, { purpose: 'F13_EDITORIAL_UI_CONCURRENCY_V1', kid, iat, exp, nonce, ...value }))) fail('CONCURRENCY_TOKEN_INVALID');
      const instant = now();
      if (instant < iat) fail('CONCURRENCY_TOKEN_INVALID');
      if (instant >= exp) fail('CONCURRENCY_TOKEN_EXPIRED');
    },
    cursor(position, context) {
      const payload = Buffer.from(canonicalize({ position, context, exp: now() + 600 })).toString('base64url');
      return `${currentKeyId}.${payload}.${mac(currentKeyId, { purpose: 'F13_EDITORIAL_UI_CURSOR_V1', payload })}`;
    },
    openCursor(token, context) {
      try {
        if (typeof token !== 'string' || token.length > 4096) fail('INVALID_CURSOR');
        const parts = token.split('.');
        if (parts.length !== 3 || !Object.hasOwn(ring, parts[0]) || !equal(parts[2], mac(parts[0], { purpose: 'F13_EDITORIAL_UI_CURSOR_V1', payload: parts[1] }))) fail('INVALID_CURSOR');
        const value = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (!Number.isSafeInteger(value.exp) || value.exp <= now() || canonicalize(value.context) !== canonicalize(context)) fail('INVALID_CURSOR');
        return value.position;
      } catch { fail('INVALID_CURSOR'); }
    }
  });
}
module.exports = { createEditorialUiTokens };
