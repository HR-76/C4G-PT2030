'use strict';

const { types: { isProxy } } = require('node:util');

const MAX_CANONICAL_BYTES = 256 * 1024;

function canonicalize(value) {
  return encodeBounded(value, MAX_CANONICAL_BYTES);
}

// Transport envelopes wrap already validated material plus pagination/current
// observations. This is the existing 1 MiB operation envelope, not a larger
// material limit. Material digests/clones continue to use canonicalize above.
function canonicalizeEnvelope(value) {
  return encodeBounded(value, 1048576);
}

function encodeBounded(value, maxBytes) {
  let encoded;
  try {
    encoded = encodeCanonical(value);
  } catch {
    throw new TypeError('F13 canonical value is invalid.');
  }
  if (Buffer.byteLength(encoded, 'utf8') > maxBytes) {
    throw new TypeError('F13 canonical value exceeds the structural limit.');
  }
  return encoded;
}

function encodeCanonical(value, depth = 0) {
  if (depth > 12) throw new TypeError('F13 canonical value exceeds maximum depth.');
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    assertCanonicalString(value);
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('F13 canonical number is invalid.');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (Array.isArray(value)) {
    return encodeCanonicalArray(value, depth);
  }
  if (value === null || typeof value !== 'object' || isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('F13 canonical value type is invalid.');
  }
  const properties = [];
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = typeof key === 'string' ? Object.getOwnPropertyDescriptor(value, key) : null;
    if (typeof key !== 'string' || !descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('F13 canonical property is invalid.');
    }
    assertCanonicalString(key);
    properties.push([key, descriptor.value]);
  }
  properties.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${properties.map(([key, propertyValue]) => `${JSON.stringify(key)}:${encodeCanonical(propertyValue, depth + 1)}`).join(',')}}`;
}

function encodeCanonicalArray(value, depth) {
  if (isProxy(value)) throw new TypeError('F13 canonical arrays cannot be proxies.');
  const keys = Reflect.ownKeys(value);
  const keySet = new Set(keys);
  if (keys.length !== value.length + 1 || !keySet.has('length')) {
    throw new TypeError('F13 canonical array properties are invalid.');
  }
  const items = [];
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    if (!keySet.has(key)) throw new TypeError('F13 canonical arrays cannot be sparse.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('F13 canonical array item is invalid.');
    }
    items.push(encodeCanonical(descriptor.value, depth + 1));
  }
  return `[${items.join(',')}]`;
}

function assertCanonicalString(value) {
  const normalized = value.normalize('NFC');
  const withoutPairs = value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/gu, '');
  if (normalized !== value || /[\uD800-\uDFFF]/u.test(withoutPairs)) {
    throw new TypeError('F13 canonical string is invalid.');
  }
}

function canonicalClone(value) {
  return deepFreeze(JSON.parse(canonicalize(value)));
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value);
  }
  return value;
}

module.exports = { MAX_CANONICAL_BYTES, canonicalClone, canonicalize, canonicalizeEnvelope };
