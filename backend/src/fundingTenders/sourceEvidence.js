'use strict';

const { createHash } = require('node:crypto');
const { types: { isProxy } } = require('node:util');
const { externalIdentity } = require('./identity');
const { date } = require('../opportunities/normalization');
const VERSION = 1;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_VARIANTS = 25;
function invalid() { throw new TypeError('Invalid funding source evidence'); }

// Public responses may include non-integral relevance scores. Preserve the raw
// JSON separately from the semantic projection, without getters or custom types.
function canonical(value, depth = 0) {
  if (depth > 32) invalid();
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || typeof value !== 'object' || isProxy(value)) invalid();
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const keys = Reflect.ownKeys(value).filter(key => !array || key !== 'length');
  if (keys.some(key => typeof key !== 'string')) invalid();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
  }
  if (array) {
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) invalid();
    return `[${value.map(child => canonical(child, depth + 1)).join(',')}]`;
  }
  return `{${keys.sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
}
function boundedClone(value) {
  const encoded = canonical(value);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_BYTES) invalid();
  return JSON.parse(encoded);
}
function scalar(metadata, field, required = true) {
  const values = metadata[field];
  if (!required && values === undefined) return undefined;
  if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'string' || !values[0] || values[0].length > 256) invalid();
  return values[0];
}
function parseActions(value) {
  if (!Array.isArray(value) || !value.length) invalid();
  const actions = value.flatMap(entry => typeof entry === 'string' ? JSON.parse(entry) : entry);
  if (!actions.length || actions.some(action => !action || Array.isArray(action) || typeof action !== 'object')) invalid();
  return actions;
}
function sortSchedules(value) {
  if (Array.isArray(value)) return value.map(sortSchedules);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    ['deadlineDates', 'deadlineDate', 'startDate'].includes(key) && Array.isArray(child)
      ? child.map(sortSchedules).sort((a, b) => { const left = canonical(a), right = canonical(b); return left < right ? -1 : left > right ? 1 : 0; })
      : sortSchedules(child)]));
}
function semanticVariant(item) {
  const metadata = Object.fromEntries(Object.entries(item.metadata).filter(([key]) =>
    !/^es(?:[A-Z_])/.test(key) && !['corporate-search-version', 'sortStatus'].includes(key)));
  if (metadata.actions !== undefined) metadata.actions = parseActions(metadata.actions);
  return sortSchedules({
    ...Object.fromEntries(['url', 'content', 'summary', 'language', 'contentType', 'accessRestriction', 'children']
      .filter(key => Object.hasOwn(item, key)).map(key => [key, item[key]])),
    metadata
  });
}
function buildEvidence(identifier, rawItems) {
  if (typeof identifier !== 'string' || !identifier.length || identifier.length > 128 || /[\u0000-\u001f]/.test(identifier)) invalid();
  if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > MAX_VARIANTS) invalid();
  const variants = boundedClone(rawItems);
  let ccmIdentity;
  for (const item of variants) {
    if (!item || Array.isArray(item) || !item.metadata || Array.isArray(item.metadata)) invalid();
    const m = item.metadata, type = scalar(m, 'type'), topic = scalar(m, 'identifier');
    // External action calls (2) publish no ccm ids; their call identifier binds the variants.
    if (!['1', '2', '8'].includes(type) || externalIdentity(type, topic, type === '2' ? undefined : scalar(m, 'callccm2Id')) !== identifier) invalid();
    const language = scalar(m, 'language');
    if (language !== 'en' || (item.language !== undefined && item.language !== language)) invalid();
    scalar(m, 'DATASOURCE');
    const ccm = scalar(m, type === '2' ? 'callIdentifier' : 'ccm2Id');
    if (ccmIdentity !== undefined && ccmIdentity !== ccm) invalid();
    ccmIdentity = ccm;
  }
  const semantic = variants.map(item => canonical(semanticVariant(item))).sort();
  const fingerprint = createHash('sha256').update(canonical({ version: VERSION, externalIdentifier: identifier, variants: semantic })).digest('hex');
  // Include the envelope in the same cap as the stored evidence.
  return boundedClone({ version: VERSION, externalIdentifier: identifier, fingerprint, variants });
}
function verifyEvidence(evidence) {
  try {
    const checked = boundedClone(evidence);
    if (!checked || checked.version !== VERSION || !/^[0-9a-f]{64}$/.test(checked.fingerprint)
      || Object.keys(checked).sort().join(',') !== 'externalIdentifier,fingerprint,variants,version') return false;
    return buildEvidence(checked.externalIdentifier, checked.variants).fingerprint === checked.fingerprint;
  } catch { return false; }
}

// Midnight in the search index is only a civil-date encoding when the complete
// structured action calendar independently confirms those same civil dates.
// Non-midnight instants and unconfirmed/malformed calendars retain their precision.
function confirmedCivilSchedule(metadata, indexField, actionField) {
  const indexed = Array.isArray(metadata[indexField]) ? metadata[indexField] : [];
  try {
    const actions = parseActions(metadata.actions);
    const calendars = actions.map(action => actionField === 'plannedOpeningDate' ? [action[actionField]] : action[actionField]);
    if (calendars.some(calendar => !Array.isArray(calendar) || !calendar.length)) return indexed;
    const civil = [...new Set(calendars.flat())].sort();
    for (const value of civil) {
      if (typeof value !== 'string' || value.length !== 10) return indexed;
      date(value);
    }
    const indexedDates = [...new Set(indexed.map(value => typeof value === 'string' ? value.slice(0, 10) : null))].sort();
    if (canonical(civil) !== canonical(indexedDates)) return indexed;
    return indexed.map(value => /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0{1,3})?(?:Z|\+00:?00)$/.test(value) ? value.slice(0, 10) : value);
  } catch { return indexed; }
}
function sourceDeadlines(metadata) { return confirmedCivilSchedule(metadata, 'deadlineDate', 'deadlineDates'); }
function sourceOpenings(metadata) { return confirmedCivilSchedule(metadata, 'startDate', 'plannedOpeningDate'); }

module.exports = { VERSION, MAX_BYTES, MAX_VARIANTS, buildEvidence, verifyEvidence, sourceDeadlines, sourceOpenings };
