'use strict';

const assert = require('node:assert/strict');
const { inspectSignedCapability, parseAmzDate } = require('./r2-signed-expiry');

function capability({ signedAt = '20261024T120001Z', duration = 300, expiresAt = '2026-10-24T12:05:00.975Z' } = {}) {
  const url = new URL('https://example.invalid/object');
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  url.searchParams.set('X-Amz-Credential', 'synthetic/20261024/auto/s3/aws4_request');
  url.searchParams.set('X-Amz-Date', signedAt);
  url.searchParams.set('X-Amz-Expires', String(duration));
  url.searchParams.set('X-Amz-SignedHeaders', 'host');
  url.searchParams.set('X-Amz-Signature', 'a'.repeat(64));
  return Object.freeze({ kind: 'R2_SIGNED_DOWNLOAD', expiresAt, url: url.toString(), headers: Object.freeze({}) });
}

const tests = [];
const test = (name, callback) => tests.push({ name, callback });

test('accepts issuance across a second boundary using the signed one-second precision', () => {
  const result = inspectSignedCapability({ capability: capability(), issuanceStartedAt: '2026-10-24T12:00:00.950Z',
    issuedAt: '2026-10-24T12:00:01.150Z', maximumTtlSeconds: 300 });
  assert.equal(result.signedDurationSeconds, 300);
  assert.equal(result.signedAt, '2026-10-24T12:00:01.000Z');
  assert.equal(result.timestampPrecisionMs, 1000);
  assert.equal(Object.hasOwn(result, 'url'), false);
  assert.equal(Object.hasOwn(result, 'signature'), false);
});

test('accepts emission latency while preserving expiresAt and signed-expiry coherence', () => {
  const result = inspectSignedCapability({ capability: capability({ signedAt: '20261024T120002Z', duration: 298,
    expiresAt: '2026-10-24T12:05:00.100Z' }), issuanceStartedAt: '2026-10-24T12:00:00.000Z',
    issuedAt: '2026-10-24T12:00:02.500Z', maximumTtlSeconds: 300 });
  assert.equal(result.signedExpiresAt, '2026-10-24T12:05:00.000Z');
  assert.equal(result.coherenceSkewMs, -100);
});

test('rejects a signed duration above the 300-second contract', () => {
  assert.throws(() => inspectSignedCapability({ capability: capability({ duration: 301,
    expiresAt: '2026-10-24T12:05:00.100Z' }), issuanceStartedAt: '2026-10-24T12:00:00.000Z',
    issuedAt: '2026-10-24T12:00:00.200Z', maximumTtlSeconds: 300 }), /R2_SIGNED_DURATION_EXCEEDS_CONTRACT/);
});

test('rejects expiresAt outside the real issuance interval', () => {
  assert.throws(() => inspectSignedCapability({ capability: capability({ signedAt: '20261024T120000Z',
    expiresAt: '2026-10-24T12:05:02.000Z' }),
    issuanceStartedAt: '2026-10-24T12:00:00.000Z', issuedAt: '2026-10-24T12:00:00.500Z', maximumTtlSeconds: 300 }),
  /R2_EXPIRES_AT_OUTSIDE_ISSUANCE_INTERVAL/);
});

test('rejects malformed or impossible second-precision signing timestamps', () => {
  assert.throws(() => parseAmzDate('20260230T120000Z'), /R2_SIGNED_DATE_INVALID/);
  assert.throws(() => parseAmzDate('2026-10-24T12:00:00Z'), /R2_SIGNED_DATE_INVALID/);
});

(async () => {
  let passed = 0;
  for (const item of tests) {
    try { await item.callback(); passed += 1; process.stdout.write(`ok ${passed} - ${item.name}\n`); }
    catch (error) { process.stderr.write(`not ok ${passed + 1} - ${item.name}\n${error.stack}\n`); process.exitCode = 1; return; }
  }
  process.stdout.write(`1..${tests.length}\n`);
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
