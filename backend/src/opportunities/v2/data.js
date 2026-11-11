'use strict';
const { types: { isProxy } } = require('node:util');
const { fail } = require('./errors');

const MAX_SNAPSHOT_BYTES = 256 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Inspect descriptors before reading properties. JSON.stringify alone can invoke
// getters/toJSON and silently erase undefined, sparse elements or non-finite data.
function cloneData(input, { maxBytes = MAX_SNAPSHOT_BYTES, maxDepth = 32 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxDepth) || maxDepth < 1) fail();
  let bytes = 0;
  const ancestors = new WeakSet();
  function charge(size) {
    bytes += size;
    if (bytes > maxBytes) fail('OPPORTUNITY_V2_LIMIT_EXCEEDED');
  }
  function string(value) {
    if (!value.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail();
    charge(Buffer.byteLength(JSON.stringify(value), 'utf8'));
    return value;
  }
  function visit(value, depth) {
    if (depth > maxDepth || isProxy(value)) fail();
    if (value === null || typeof value === 'boolean') { charge(value === null ? 4 : value ? 4 : 5); return value; }
    if (typeof value === 'string') return string(value);
    if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) { charge(String(value).length); return value; }
    if (!value || typeof value !== 'object' || ancestors.has(value)) fail();
    const array = Array.isArray(value);
    if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) fail();
    ancestors.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors).filter(key => !(array && key === 'length'));
    if (array && (keys.length !== value.length || keys.some((key, index) => key !== String(index)))) fail();
    const result = array ? [] : {};
    charge(2 + Math.max(0, keys.length - 1));
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
      if (!array) { string(key); charge(1); }
      result[key] = visit(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
    return result;
  }
  return visit(input, 0);
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function jsonbBytes(input) {
  const value = cloneData(input, { maxBytes: 2 * 1024 * 1024 });
  function encode(item) {
    if (Array.isArray(item)) return '[' + item.map(encode).join(', ') + ']';
    if (item && typeof item === 'object') return '{' + Object.entries(item).map(([key, child]) => JSON.stringify(key) + ': ' + encode(child)).join(', ') + '}';
    return JSON.stringify(item);
  }
  return Buffer.byteLength(encode(value), 'utf8');
}

module.exports = { MAX_SNAPSHOT_BYTES, cloneData, deepFreeze, jsonbBytes };
