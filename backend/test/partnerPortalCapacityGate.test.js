'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateCapacity } = require('../../test/integration/partner-portal/capacity');

const digest = 'a'.repeat(64);
const options = { expectedScenarioIds: ['partners-101'], expectedRepetitions: 2 };
function series(repetitions = 2) {
  return Array.from({ length: repetitions }, (_, index) => ['before', 'after'].map(variant => ({
    scenarioId: 'partners-101', variant, pair: index + 1,
    order: (index % 2 === 0 ? variant === 'before' : variant === 'after') ? 1 : 2,
    candidates: 101, success: true, expectedErrorCode: null, errorCode: null,
    operationMs: variant === 'before' ? 100 : 120, admissionMs: 10, responseBytes: 1000,
    queryCount: variant === 'before' ? 3 : 5, authorizationCalls: 202, rowsRead: 101,
    nodeRssPeakBytes: variant === 'before' ? 100000000 : 110000000,
    nodeHeapPeakBytes: variant === 'before' ? 50000000 : 55000000,
    postgresTempBytes: 0, cleanupMs: 2, afterSuccessQueries: 0, responseDigest: digest
  }))).flat();
}
function hasCode(result, code) { return result.failures.some(item => item.code === code); }

test('partner capacity: complete balanced series reports metrics without approving production capacity', () => {
  const result = evaluateCapacity(series(), options);
  assert.equal(result.status, 'PASS'); assert.deepEqual(result.failures, []);
  assert.equal(result.productionCapacityApproved, false);
  const scenario = result.scenarios[0];
  assert.equal(scenario.variants.before.operationMs.p95, 100);
  assert.equal(scenario.variants.after.operationMs.max, 120);
  assert.deepEqual(scenario.deltas.queryCount, { absolute: 2, percent: 200 / 3 });
  assert.deepEqual(scenario.deltas.operationMs, { absolute: 20, percent: 20 });
  assert.deepEqual(scenario.deltas.nodeRssPeakBytes, { absolute: 10000000, percent: 10 });
});

test('partner capacity: p95 uses nearest rank of all measured samples without premature rounding', () => {
  const samples = series(20);
  for (const sample of samples) sample.operationMs = sample.pair * (sample.variant === 'before' ? 10 : 12) + 0.001;
  const result = evaluateCapacity(samples, { ...options, expectedRepetitions: 20 });
  assert.equal(result.status, 'PASS');
  assert.equal(result.scenarios[0].variants.before.operationMs.p95, 190.001);
  assert.equal(result.scenarios[0].variants.after.operationMs.max, 240.001);
});

test('partner capacity: existing runtime limits are inclusive and never replaced by the C6 SLO', () => {
  const samples = series();
  for (const sample of samples) { sample.operationMs = 10000; sample.admissionMs = 5000; sample.responseBytes = 1048576; }
  assert.equal(evaluateCapacity(samples, options).status, 'PASS');
});

for (const [field, value, code] of [['operationMs', 10000.001, 'OPERATION_BUDGET_EXCEEDED'],
  ['admissionMs', 5000.001, 'ADMISSION_BUDGET_EXCEEDED'], ['responseBytes', 1048577, 'RESPONSE_BUDGET_EXCEEDED']]) {
  test(`partner capacity: ${field} cannot exceed its runtime budget`, () => {
    const samples = series(); samples[0][field] = value;
    const result = evaluateCapacity(samples, options);
    assert.equal(result.status, 'FAIL'); assert.ok(hasCode(result, code));
  });
}

test('partner capacity: bounded overflow is an expected refusal in both variants', () => {
  const samples = series();
  for (const sample of samples) Object.assign(sample, { candidates: 10001, rowsRead: 10001, success: false,
    expectedErrorCode: 'LIMIT_EXCEEDED', errorCode: 'LIMIT_EXCEEDED', responseBytes: 0, responseDigest: null,
    authorizationCalls: 20000, queryCount: sample.variant === 'before' ? 102 : 104 });
  const result = evaluateCapacity(samples, options);
  assert.equal(result.status, 'PASS'); assert.equal(result.scenarios[0].deltas.queryCount.absolute, 2);
});

test('partner capacity: authority or timeout failure cannot be accepted as an expected capacity error', () => {
  for (const expectedErrorCode of [null, 'SERVICE_UNAVAILABLE', 'LEASE_TIMEOUT']) {
    const samples = series();
    for (const sample of samples) Object.assign(sample, { success: false, expectedErrorCode,
      errorCode: expectedErrorCode || 'SERVICE_UNAVAILABLE', responseDigest: null });
    const result = evaluateCapacity(samples, options);
    assert.equal(result.status, 'FAIL'); assert.ok(hasCode(result, 'UNEXPECTED_OUTCOME'));
  }
});

test('partner capacity: success above the raw limit is a contract failure even with matching variants', () => {
  const samples = series();
  for (const sample of samples) Object.assign(sample, { candidates: 10001, rowsRead: 10001 });
  const result = evaluateCapacity(samples, options);
  assert.equal(result.status, 'FAIL'); assert.ok(hasCode(result, 'UNEXPECTED_OUTCOME'));
});

test('partner capacity: every metric and outcome field is required', () => {
  const required = ['scenarioId', 'variant', 'pair', 'order', 'candidates', 'success', 'expectedErrorCode', 'errorCode',
    'operationMs', 'admissionMs', 'responseBytes', 'queryCount', 'authorizationCalls', 'rowsRead',
    'nodeRssPeakBytes', 'nodeHeapPeakBytes', 'postgresTempBytes', 'cleanupMs', 'afterSuccessQueries', 'responseDigest'];
  for (const field of required) {
    const samples = series(); delete samples[0][field];
    const result = evaluateCapacity(samples, options);
    assert.equal(result.status, 'INCOMPLETE', field); assert.ok(result.failures.length > 0, field);
  }
});

test('partner capacity: absent, nonfinite, negative and fractional count evidence is incomplete', () => {
  for (const [field, value] of [['operationMs', NaN], ['cleanupMs', Infinity], ['admissionMs', -1],
    ['nodeRssPeakBytes', null], ['responseBytes', 0.5], ['queryCount', '3'], ['rowsRead', -1]]) {
    const samples = series(); samples[0][field] = value;
    assert.equal(evaluateCapacity(samples, options).status, 'INCOMPLETE', field);
  }
  assert.equal(evaluateCapacity(null, options).status, 'INCOMPLETE');
  assert.equal(evaluateCapacity([], options).status, 'INCOMPLETE');
});

test('partner capacity: zero RSS or heap is missing process measurement, not valid evidence', () => {
  for (const field of ['nodeRssPeakBytes', 'nodeHeapPeakBytes']) {
    const samples = series(); samples[0][field] = 0;
    const result = evaluateCapacity(samples, options);
    assert.equal(result.status, 'INCOMPLETE');
    assert.ok(result.failures.some(item => item.code === 'INVALID_METRIC' && item.field === field));
  }
});

test('partner capacity: duplicates, missing variants and undeclared scenarios never pass', () => {
  const duplicate = series(); duplicate.push({ ...duplicate[0] });
  assert.equal(evaluateCapacity(duplicate, options).status, 'INCOMPLETE');
  const missing = series(); missing.pop();
  assert.equal(evaluateCapacity(missing, options).status, 'INCOMPLETE');
  const unknown = series(); unknown[0].scenarioId = 'undeclared';
  assert.equal(evaluateCapacity(unknown, options).status, 'INCOMPLETE');
});

test('partner capacity: pairs require complementary orders and balanced alternating AB/BA', () => {
  const repeated = series(); repeated[2].order = 1; repeated[3].order = 2;
  assert.equal(evaluateCapacity(repeated, options).status, 'INCOMPLETE');
  const sameOrder = series(); sameOrder[1].order = sameOrder[0].order;
  assert.equal(evaluateCapacity(sameOrder, options).status, 'INCOMPLETE');
  const badPair = series(); badPair[0].pair = 0;
  assert.equal(evaluateCapacity(badPair, options).status, 'INCOMPLETE');
});

for (const [field, value, code] of [['responseDigest', 'b'.repeat(64), 'RESPONSE_MISMATCH'],
  ['responseBytes', 1001, 'RESPONSE_MISMATCH'], ['authorizationCalls', 201, 'AUTHORITY_MISMATCH']]) {
  test(`partner capacity: paired ${field} equivalence is required`, () => {
    const samples = series(); samples[1][field] = value;
    const result = evaluateCapacity(samples, options);
    assert.equal(result.status, 'FAIL'); assert.ok(hasCode(result, code));
  });
}

test('partner capacity: each variant must examine the declared bounded candidate population', () => {
  const samples = series(); samples[1].rowsRead = 100;
  const result = evaluateCapacity(samples, options);
  assert.equal(result.status, 'FAIL'); assert.ok(hasCode(result, 'CANDIDATE_COUNT_MISMATCH'));
});

test('partner capacity: different candidate populations cannot be compared as a pair', () => {
  const samples = series(); samples[1].candidates = 100; samples[1].rowsRead = 100;
  const result = evaluateCapacity(samples, options);
  assert.equal(result.status, 'FAIL'); assert.ok(hasCode(result, 'PAIRED_INPUT_MISMATCH'));
});

test('partner capacity: completed queries after success fail the gate', () => {
  const samples = series(); samples[0].afterSuccessQueries = 1;
  const result = evaluateCapacity(samples, options);
  assert.equal(result.status, 'FAIL'); assert.ok(hasCode(result, 'QUERY_AFTER_SUCCESS'));
});

test('partner capacity: undefined or unbalanced coverage policy cannot yield PASS', () => {
  for (const policy of [undefined, {}, { ...options, expectedScenarioIds: [] },
    { ...options, expectedScenarioIds: ['partners-101', 'partners-101'] },
    { ...options, expectedRepetitions: 0 }, { ...options, expectedRepetitions: 1 }, { ...options, expectedRepetitions: 3 }]) {
    assert.equal(evaluateCapacity(series(), policy).status, 'INCOMPLETE');
  }
});

test('partner capacity: zero baseline produces a null relative delta and raw samples stay unchanged', () => {
  const samples = series();
  for (const sample of samples) sample.operationMs = sample.variant === 'before' ? 0 : 1;
  const before = JSON.stringify(samples);
  const result = evaluateCapacity(samples, options);
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.scenarios[0].deltas.operationMs, { absolute: 1, percent: null });
  assert.equal(JSON.stringify(samples), before);
});
