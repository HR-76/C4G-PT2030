'use strict';

// Offline evaluator only: no filesystem, SQL, infrastructure or application
// imports. Samples must be measured (not warmups), with one before/after pair
// per scenario/repetition. Repetitions are an even count >= 2; pair IDs start at
// 1 and alternate AB then BA. candidates counts active rows in this tenant,
// before authorization. responseDigest is SHA-256 of the compared response;
// it may be null for a refused operation. Every field is mandatory.
// RSS/heap must be positive measurements; zero is a missing-data placeholder,
// not an additional memory budget. PostgreSQL temporary bytes may be zero.
//
// PASS applies only to this declared experiment and the existing runtime
// budgets. Heap/RSS and p95 have no newly invented product thresholds. Missing
// or malformed evidence is INCOMPLETE, even if other observed failures exist;
// all failures are retained. No production capacity approval is issued.
const LIMITS = Object.freeze({ operationMs: 10000, admissionMs: 5000, responseBytes: 1048576, candidates: 10000 });
const VARIANTS = ['before', 'after'];
const METRICS = ['operationMs', 'admissionMs', 'responseBytes', 'queryCount', 'authorizationCalls', 'rowsRead',
  'nodeRssPeakBytes', 'nodeHeapPeakBytes', 'postgresTempBytes', 'cleanupMs', 'afterSuccessQueries'];
const COUNTS = new Set(METRICS.filter(field => !['operationMs', 'admissionMs', 'cleanupMs'].includes(field)));
const REQUIRED = ['scenarioId', 'variant', 'pair', 'order', 'candidates', 'success', 'expectedErrorCode', 'errorCode', 'responseDigest', ...METRICS];
const safeCount = value => Number.isSafeInteger(value) && value >= 0;
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const scenarioId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,95}$/i.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nullableCode = value => value === null || typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(value);

function stats(rows, field) {
  const values = rows.map(row => row[field]).sort((a, b) => a - b);
  return { samples: values.length, mean: values.length ? values.reduce((sum, value) => sum + value / values.length, 0) : null,
    p95: values.length ? values[Math.ceil(values.length * 0.95) - 1] : null, max: values.length ? values.at(-1) : null };
}
function delta(before, after) {
  if (before === null || after === null) return { absolute: null, percent: null };
  const absolute = after - before, percent = before === 0 ? null : absolute * 100 / before;
  return { absolute, percent: Number.isFinite(percent) ? percent : null };
}

function evaluateCapacity(samples, options) {
  const failures = [], scenarios = [];
  let incomplete = false;
  function problem(code, location = {}, evidence = false) {
    if (evidence) incomplete = true;
    failures.push({ code, ...location });
  }
  const ids = options?.expectedScenarioIds, repetitions = options?.expectedRepetitions;
  if (!Array.isArray(ids) || !ids.length || !ids.every(scenarioId) || new Set(ids).size !== ids.length
    || !Number.isSafeInteger(repetitions) || repetitions < 2 || repetitions % 2) {
    problem('INVALID_COVERAGE_POLICY', {}, true);
    return { status: 'INCOMPLETE', failures, scenarios, limits: LIMITS, productionCapacityApproved: false };
  }
  if (!Array.isArray(samples)) {
    problem('MISSING_SAMPLES', {}, true); samples = [];
  }
  const groups = new Map(ids.map(id => [id, new Map()]));
  for (const [index, sample] of samples.entries()) {
    if (!sample || typeof sample !== 'object' || Array.isArray(sample) || REQUIRED.some(field => !Object.hasOwn(sample, field))) {
      problem('MISSING_SAMPLE_FIELD', { index }, true); continue;
    }
    if (!groups.has(sample.scenarioId) || !VARIANTS.includes(sample.variant) || !Number.isSafeInteger(sample.pair)
      || sample.pair < 1 || sample.pair > repetitions || ![1, 2].includes(sample.order)
      || !safeCount(sample.candidates) || typeof sample.success !== 'boolean'
      || !nullableCode(sample.expectedErrorCode) || !nullableCode(sample.errorCode)
      || !(digest(sample.responseDigest) || !sample.success && sample.responseDigest === null)) {
      problem('INVALID_SAMPLE_IDENTITY_OR_OUTCOME', { index }, true); continue;
    }
    const location = { scenarioId: sample.scenarioId, pair: sample.pair, variant: sample.variant };
    const invalidMetrics = METRICS.filter(field => !(COUNTS.has(field) ? safeCount(sample[field]) : finite(sample[field]))
      || ['nodeRssPeakBytes', 'nodeHeapPeakBytes'].includes(field) && sample[field] === 0);
    if (invalidMetrics.length) {
      for (const field of invalidMetrics) problem('INVALID_METRIC', { ...location, field }, true);
      continue;
    }
    const key = `${sample.pair}:${sample.variant}`, group = groups.get(sample.scenarioId);
    if (group.has(key)) { problem('DUPLICATE_SAMPLE', location, true); continue; }
    group.set(key, sample);
    const expectedOrder = (sample.pair % 2 === 1 ? sample.variant === 'before' : sample.variant === 'after') ? 1 : 2;
    if (sample.order !== expectedOrder) problem('PAIR_ORDER_DRIFT', location, true);
    const expectedError = sample.candidates > LIMITS.candidates ? 'LIMIT_EXCEEDED' : null;
    if (sample.expectedErrorCode !== expectedError || sample.errorCode !== expectedError || sample.success !== (expectedError === null)) {
      problem('UNEXPECTED_OUTCOME', location);
    }
    for (const [field, code] of [['operationMs', 'OPERATION_BUDGET_EXCEEDED'], ['admissionMs', 'ADMISSION_BUDGET_EXCEEDED'],
      ['responseBytes', 'RESPONSE_BUDGET_EXCEEDED']]) {
      if (sample[field] > LIMITS[field]) problem(code, location);
    }
    if (sample.rowsRead !== Math.min(sample.candidates, LIMITS.candidates + 1)) problem('CANDIDATE_COUNT_MISMATCH', location);
    if (sample.success && sample.afterSuccessQueries !== 0) problem('QUERY_AFTER_SUCCESS', location);
  }
  for (const id of ids) {
    const group = groups.get(id), rows = [...group.values()];
    for (let pair = 1; pair <= repetitions; pair++) {
      const before = group.get(`${pair}:before`), after = group.get(`${pair}:after`);
      if (!before || !after) { problem('MISSING_PAIRED_SAMPLE', { scenarioId: id, pair }, true); continue; }
      if (before.candidates !== after.candidates || before.expectedErrorCode !== after.expectedErrorCode) problem('PAIRED_INPUT_MISMATCH', { scenarioId: id, pair });
      if (before.responseDigest !== after.responseDigest || before.responseBytes !== after.responseBytes
        || before.success !== after.success || before.errorCode !== after.errorCode) problem('RESPONSE_MISMATCH', { scenarioId: id, pair });
      if (before.authorizationCalls !== after.authorizationCalls) problem('AUTHORITY_MISMATCH', { scenarioId: id, pair });
    }
    const variants = Object.fromEntries(VARIANTS.map(variant => {
      const selected = rows.filter(row => row.variant === variant);
      return [variant, Object.fromEntries(METRICS.map(field => [field, stats(selected, field)]))];
    }));
    // Deltas compare arithmetic means of the paired population; quantiles above
    // remain raw nearest-rank values. Zero baseline has no relative percentage.
    const deltas = Object.fromEntries(['queryCount', 'operationMs', 'admissionMs', 'nodeRssPeakBytes', 'nodeHeapPeakBytes', 'postgresTempBytes', 'cleanupMs']
      .map(field => [field, delta(variants.before[field].mean, variants.after[field].mean)]));
    scenarios.push({ scenarioId: id, pairsExpected: repetitions, measuredSamples: rows.length, variants, deltas });
  }
  return { status: incomplete ? 'INCOMPLETE' : failures.length ? 'FAIL' : 'PASS', failures, scenarios,
    limits: LIMITS, productionCapacityApproved: false };
}

module.exports = { evaluateCapacity };
