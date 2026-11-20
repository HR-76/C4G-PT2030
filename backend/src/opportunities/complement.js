'use strict';
// Opportunity complement: descriptive data kept beside the canonical revision,
// never inside it. Two layers per opportunity: what a public source publishes
// (COLLECTED) and what a C4G administrator wrote (EDITORIAL). Pure functions
// only; storage and authority live elsewhere.
const { createHash } = require('node:crypto');

const TEXT_FIELDS = Object.freeze({ description: 8000, noticeCode: 64 });
const LIST_FIELDS = Object.freeze(['priorities', 'actionTypologies', 'interventionTypologies', 'operationTypologies']);
const FIELDS = Object.freeze([...Object.keys(TEXT_FIELDS), 'officialUrl', ...LIST_FIELDS, 'cofinancingRate']);
const LIST_LIMIT = 20, ITEM_LIMIT = 300, URL_LIMIT = 2000;

function fail(code = 'COMPLEMENT_INVALID_INPUT') { throw Object.assign(new TypeError(code), { code }); }
function text(value, maximum, multiline = false) {
  if (typeof value !== 'string') fail();
  const clean = value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  // Line breaks carry the structure of a description; every other control character is refused.
  if (!clean || [...clean].length > maximum || (multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(clean)) fail();
  return clean;
}
function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > URL_LIMIT) fail();
  let url;
  try { url = new URL(value); } catch { fail(); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) fail();
  return url.href;
}
function field(key, value) {
  if (Object.hasOwn(TEXT_FIELDS, key)) return text(value, TEXT_FIELDS[key], key === 'description');
  if (key === 'officialUrl') return httpsUrl(value);
  if (key === 'cofinancingRate') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100 || Math.round(value * 100) !== value * 100) fail();
    return value;
  }
  if (!Array.isArray(value) || !value.length || value.length > LIST_LIMIT) fail();
  const items = value.map(item => text(item, ITEM_LIMIT));
  if (new Set(items).size !== items.length) fail();
  return items;
}

// A layer holds only the fields it states. A field left out says nothing about
// it; null is not a value. Unknown keys are refused, never dropped silently.
function complementLayer(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) fail();
  const layer = {};
  for (const key of Object.keys(input)) if (!FIELDS.includes(key)) fail('COMPLEMENT_UNKNOWN_FIELD');
  for (const key of FIELDS) if (Object.hasOwn(input, key)) layer[key] = field(key, input[key]);
  return Object.freeze(layer);
}
const canonical = layer => JSON.stringify(FIELDS.filter(key => Object.hasOwn(layer, key)).map(key => [key, layer[key]]));
const complementDigest = layer => createHash('sha256').update('C4G:OPPORTUNITY:COMPLEMENT:v1\0' + canonical(complementLayer(layer))).digest('hex');

// What a reader sees: the administrator's value wins field by field, and every
// field says where it came from.
function effectiveComplement({ collected = null, editorial = null } = {}) {
  const fields = {};
  for (const key of FIELDS) {
    const origin = editorial && Object.hasOwn(editorial.fields, key) ? 'EDITORIAL' : collected && Object.hasOwn(collected.fields, key) ? 'COLLECTED' : null;
    if (!origin) continue;
    const layer = origin === 'EDITORIAL' ? editorial : collected;
    fields[key] = { value: layer.fields[key], origin,
      ...(origin === 'COLLECTED' ? { sourceUrl: collected.sourceUrl, observedAt: collected.observedAt,
        ...(key === 'description' && collected.descriptionTruncated ? { truncated: true } : {}) } : {}) };
  }
  return Object.keys(fields).length ? { fields } : null;
}

module.exports = { FIELDS, complementLayer, complementDigest, effectiveComplement };
