'use strict';

const { canonicalize } = require('../organizationalProfile/canonicalization');
const FIELDS = Object.freeze(['title', 'funderName', 'programmeName', 'callReference', 'officialUrl', 'openingDate', 'closingDate', 'summary', 'sourceTemporal', 'sourceEnrichment']);
const same = (a, b) => canonicalize(a ?? null) === canonicalize(b ?? null);
function boundedSourceFields(fields) {
  const { jsonbBytes, fitEnrichment, MAX_BYTES } = require('../opportunities/sourceEnrichment');
  if (jsonbBytes(fields) <= 32768) return fields;
  if (!fields.sourceEnrichment) throw Object.assign(new Error('OPPORTUNITY_LIMIT_EXCEEDED'), { code: 'OPPORTUNITY_LIMIT_EXCEEDED' });
  const available = Math.min(MAX_BYTES, jsonbBytes(fields.sourceEnrichment) - (jsonbBytes(fields) - 32768));
  if (available < 1500) throw Object.assign(new Error('OPPORTUNITY_LIMIT_EXCEEDED'), { code: 'OPPORTUNITY_LIMIT_EXCEEDED' });
  return { ...fields, sourceEnrichment: fitEnrichment(fields.sourceEnrichment, available) };
}
// Corrections include explicit removal (null). A coincident subsequent source value
// does not silently relinquish manual authority over the field.
function mergeSource({ previousSource = null, current = null, incoming, corrections = {} }) {
  for (const value of [incoming, corrections]) if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !FIELDS.includes(key))) throw new TypeError('Funding field set is invalid.');
  // Absence means detail was not consulted, not that earlier published facts
  // disappeared. Preserve the source baseline independently from manual edits.
  const sourceFields = { ...incoming };
  if (incoming.sourceEnrichment !== undefined || previousSource?.sourceEnrichment !== undefined) {
    sourceFields.sourceEnrichment = require('../opportunities/sourceEnrichment').retainEnrichmentObservation(previousSource?.sourceEnrichment, incoming.sourceEnrichment);
  }
  const manual = { ...corrections };
  if (previousSource && current) {
    for (const key of FIELDS) {
      const expected = Object.hasOwn(manual, key) ? manual[key] : previousSource[key];
      if (!same(current[key], expected)) manual[key] = current[key] ?? null;
    }
  }
  const fields = { ...sourceFields }; const conflicts = [];
  for (const [key, value] of Object.entries(manual)) {
    if (!same(value, sourceFields[key])) conflicts.push(key);
    if (value === null) delete fields[key]; else fields[key] = value;
  }
  return { fields, sourceFields, corrections: manual, conflicts: conflicts.sort(), sourceChanged: !same(previousSource, sourceFields), effectiveChanged: !same(current, fields) };
}
module.exports = { FIELDS, mergeSource, boundedSourceFields };
