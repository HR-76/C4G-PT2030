const { types: { isProxy } } = require('node:util');

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !isProxy(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function normalize(value, depth = 0) {
  if (depth > 12) throw new TypeError('Canonical JSON exceeds maximum depth.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.normalize('NFC');
    if (normalized !== value || /[\uD800-\uDFFF]/u.test(value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/gu, ''))) throw new TypeError('Canonical strings must already be valid NFC Unicode.');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('Canonical numbers must be safe integers.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(item => normalize(item, depth + 1));
  if (!plain(value)) throw new TypeError('Canonical JSON accepts only plain JSON objects.');
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (key.normalize('NFC') !== key) throw new TypeError('Canonical property names must already be NFC.');
    out[key] = normalize(value[key], depth + 1);
  }
  return out;
}

function canonicalizeJcs1(value) { return JSON.stringify(normalize(value)); }
module.exports = { canonicalizeJcs1, normalize, plain };
