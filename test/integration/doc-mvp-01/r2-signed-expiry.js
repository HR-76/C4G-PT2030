'use strict';

const assert = require('node:assert/strict');

const AMZ_DATE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
const PRECISION_MS = 1000;

function parseAmzDate(value) {
  const matched = AMZ_DATE.exec(value || '');
  if (!matched) throw new Error('R2_SIGNED_DATE_INVALID');
  const [, year, month, day, hour, minute, second] = matched;
  const result = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  if (!Number.isFinite(result) || new Date(result).toISOString().replace(/[-:]/g, '').replace('.000', '') !== value) {
    throw new Error('R2_SIGNED_DATE_INVALID');
  }
  return result;
}

function inspectSignedCapability({ capability, issuanceStartedAt, issuedAt, maximumTtlSeconds }) {
  if (capability?.kind !== 'R2_SIGNED_DOWNLOAD' || !Number.isSafeInteger(maximumTtlSeconds) || maximumTtlSeconds < 1) {
    throw new Error('R2_SIGNED_CAPABILITY_INVALID');
  }
  const startedMs = Date.parse(issuanceStartedAt), issuedMs = Date.parse(issuedAt), expiresMs = Date.parse(capability.expiresAt);
  if (![startedMs, issuedMs, expiresMs].every(Number.isFinite) || issuedMs < startedMs) throw new Error('R2_SIGNED_TIMING_INVALID');
  const signed = new URL(capability.url);
  if (signed.searchParams.get('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256'
    || !signed.searchParams.get('X-Amz-Credential') || !signed.searchParams.get('X-Amz-SignedHeaders')
    || !signed.searchParams.get('X-Amz-Signature')) throw new Error('R2_SIGNED_PARAMETERS_INVALID');
  const durationText = signed.searchParams.get('X-Amz-Expires');
  if (!/^[1-9][0-9]*$/.test(durationText || '')) throw new Error('R2_SIGNED_DURATION_INVALID');
  const signedDurationSeconds = Number(durationText);
  if (!Number.isSafeInteger(signedDurationSeconds) || signedDurationSeconds > maximumTtlSeconds) {
    throw new Error('R2_SIGNED_DURATION_EXCEEDS_CONTRACT');
  }
  const signedAtMs = parseAmzDate(signed.searchParams.get('X-Amz-Date'));
  if (signedAtMs < startedMs - PRECISION_MS || signedAtMs > issuedMs) throw new Error('R2_SIGNED_ISSUANCE_OUTSIDE_INTERVAL');
  const contractMs = maximumTtlSeconds * 1000;
  if (expiresMs < startedMs + contractMs || expiresMs > issuedMs + contractMs) {
    throw new Error('R2_EXPIRES_AT_OUTSIDE_ISSUANCE_INTERVAL');
  }
  const signedExpiresMs = signedAtMs + signedDurationSeconds * 1000;
  const maximumCoherenceSkewMs = issuedMs - startedMs + PRECISION_MS;
  const coherenceSkewMs = signedExpiresMs - expiresMs;
  if (Math.abs(coherenceSkewMs) > maximumCoherenceSkewMs) throw new Error('R2_SIGNED_EXPIRY_INCOHERENT');
  assert.equal(Object.hasOwn(capability, 'url'), true);
  return Object.freeze({ issuanceStartedAt: new Date(startedMs).toISOString(), issuedAt: new Date(issuedMs).toISOString(),
    signedAt: new Date(signedAtMs).toISOString(), signedDurationSeconds,
    signedExpiresAt: new Date(signedExpiresMs).toISOString(), expiresAt: new Date(expiresMs).toISOString(),
    timestampPrecisionMs: PRECISION_MS, coherenceSkewMs, maximumTtlSeconds });
}

module.exports = { inspectSignedCapability, parseAmzDate, PRECISION_MS };
