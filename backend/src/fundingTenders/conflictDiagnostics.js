'use strict';

const REASONS = Object.freeze([
  'LOOKUP_TRUNCATED',
  'SOURCE_VARIANTS_DIVERGE',
  'STATUS_UNRECOGNIZED',
  'CANONICAL_TITLE_CONFLICT',
  'CANONICAL_MAPPING_CONFLICT',
  'PROTECTED_RESOLUTION_CHANGED',
  'UNCLASSIFIED_SOURCE_CONFLICT'
]);
function invalid() { throw Object.assign(new Error('FUNDING_CHECKPOINT_INVALID'), { code: 'FUNDING_CHECKPOINT_INVALID' }); }
function validate(outcome, raw) {
  if (outcome !== 'CONFLICT') {
    if (raw !== undefined) invalid();
    return null;
  }
  const reasons = raw === undefined ? ['UNCLASSIFIED_SOURCE_CONFLICT'] : raw;
  if (!Array.isArray(reasons) || reasons.length < 1 || reasons.length > REASONS.length
    || reasons.some(reason => typeof reason !== 'string' || !REASONS.includes(reason))
    || new Set(reasons).size !== reasons.length
    || reasons.includes('UNCLASSIFIED_SOURCE_CONFLICT') && reasons.length !== 1) invalid();
  return REASONS.filter(reason => reasons.includes(reason));
}
module.exports = { REASONS, validate };
