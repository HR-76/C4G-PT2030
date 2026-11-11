'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectTemporalV2 } = require('../src/opportunities/v2/temporal');
const eu = require('../../context/references/opportunity-v2/examples/eu-11145.json');
const pt = require('../../context/references/opportunity-v2/examples/pt2030-8485.json');
const copy = value => JSON.parse(JSON.stringify(value));
const now = '2026-10-30T12:00:00.000Z';
const absent = () => ({ state: 'NOT_COLLECTED', value: null, evidenceRefs: [], reason: 'NOT_REQUESTED_IN_MAPPING' });
const date = value => ({ precision: 'DATE', value });
const instant = value => ({ precision: 'INSTANT', value, originalTimezone: '+00:00' });
function calendar(values) {
  const out = copy(eu);
  out.schedule.deadlines.value = values.map(at => ({ at, phase: null }));
  return out;
}

test('v2 temporal: 11145 keeps next and final distinct and the observed status intact', () => {
  const before = JSON.stringify(eu);
  const result = projectTemporalV2(eu, { asOf: now });
  assert.equal(result.effectiveState, 'OPEN');
  assert.equal(result.nextDeadline.at.value, '2027-01-03T04:59:00.000Z');
  assert.equal(result.finalDeadline.at.value, '2028-09-02T04:59:00.000Z');
  assert.equal(result.publishedState, 'OPEN');
  assert.equal(result.precision, 'EXACT');
  assert.equal(JSON.stringify(eu), before);
  assert.ok(Object.isFrozen(result.nextDeadline.at));
});

test('v2 temporal: equality expires one cutoff, then the final cutoff closes the observed calendar', () => {
  const first = projectTemporalV2(eu, { asOf: '2027-01-03T04:59:00.000Z' });
  assert.equal(first.nextDeadline.at.value, '2027-09-02T04:59:00.000Z');
  assert.equal(first.effectiveState, 'OPEN');
  const last = projectTemporalV2(eu, { asOf: '2028-09-02T04:59:00.000Z' });
  assert.equal(last.effectiveState, 'CLOSED');
  assert.equal(last.nextDeadline, null);
  assert.equal(last.finalDeadline.at.value, '2028-09-02T04:59:00.000Z');
  assert.equal(last.publishedState, 'OPEN');
});

test('v2 temporal: a PT annual-plan opportunity remains planned after both civil dates', () => {
  for (const asOf of [now, '2028-12-31T12:00:00.000Z']) {
    const value = projectTemporalV2(pt, { asOf });
    assert.equal(value.effectiveState, 'PLANNED');
    assert.equal(value.nextDeadline, null);
    assert.equal(value.finalDeadline, null);
    assert.deepEqual(value.nextDeadlineCandidates, []);
  }
});

test('v2 temporal: the deadline day without an hour is uncertain even with source OPEN', () => {
  const result = projectTemporalV2(calendar([date('2026-10-30')]), { asOf: now });
  assert.equal(result.effectiveState, 'UNKNOWN');
  assert.equal(result.nextDeadline, null);
  assert.equal(result.nextDeadlineCandidates[0].at.value, '2026-10-30');
  assert.equal(result.finalDeadline.at.precision, 'DATE');
  assert.ok(result.reasonCodes.includes('DEADLINE_TIME_NOT_PUBLISHED'));
});

test('v2 temporal: future and past civil deadlines retain their precision without invented hours', () => {
  const future = projectTemporalV2(calendar([date('2026-10-31')]), { asOf: now });
  assert.equal(future.effectiveState, 'OPEN');
  assert.equal(future.nextDeadline.at.value, '2026-10-31');
  assert.equal(future.nextDeadline.at.precision, 'DATE');
  assert.equal(projectTemporalV2(calendar([date('2026-10-29')]), { asOf: now }).effectiveState, 'CLOSED');
});

test('v2 temporal: overlapping mixed precision returns complete candidates and no false singular maximum', () => {
  const input = calendar([date('2026-11-01'), instant('2026-11-01T14:00:00.000Z')]);
  const result = projectTemporalV2(input, { asOf: now });
  assert.equal(result.nextDeadline, null);
  assert.equal(result.finalDeadline, null);
  assert.equal(result.nextDeadlineCandidates.length, 2);
  assert.equal(result.finalDeadlineCandidates.length, 2);
  assert.equal(result.precision, 'MIXED');
  assert.ok(result.reasonCodes.includes('AMBIGUOUS_DEADLINE_PRECISION'));
});

test('v2 temporal: disjoint mixed precision has an unambiguous next and last', () => {
  const result = projectTemporalV2(calendar([date('2026-11-01'), instant('2026-11-02T14:00:00.000Z')]), { asOf: now });
  assert.equal(result.nextDeadline.at.value, '2026-11-01');
  assert.equal(result.finalDeadline.at.value, '2026-11-02T14:00:00.000Z');
});

test('v2 temporal: a deadline period currently in progress cannot certify availability', () => {
  const period = { precision: 'PERIOD', start: '2026-10-01', end: '2026-11-30', label: 'Autumn', periodKind: 'RANGE' };
  const result = projectTemporalV2(calendar([period]), { asOf: now });
  assert.equal(result.effectiveState, 'UNKNOWN');
  assert.equal(result.nextDeadline, null);
  assert.equal(result.finalDeadline.at.precision, 'PERIOD');
  assert.ok(result.reasonCodes.includes('DEADLINE_PERIOD_IN_PROGRESS'));
});

test('v2 temporal: explicit CLOSED and CANCELLED override calculated availability', () => {
  for (const status of ['CLOSED', 'CANCELLED']) {
    const input = calendar([date('2026-10-30')]);
    input.status.published.value = status;
    input.status.publishedCode = absent();
    assert.equal(projectTemporalV2(input, { asOf: now }).effectiveState, status);
  }
});

test('v2 temporal: an unresolved temporal conflict wins over a published OPEN', () => {
  const input = copy(eu);
  input.schedule.deadlines = { state: 'CONFLICT', value: null, evidenceRefs: ['deadlines', 'unused-closing'], reason: 'CONTRADICTORY_CALENDARS' };
  const result = projectTemporalV2(input, { asOf: now });
  assert.equal(result.effectiveState, 'UNKNOWN');
  assert.ok(result.reasonCodes.includes('TEMPORAL_CONFLICT'));
});

test('v2 temporal: opening plus future deadline can prove OPEN without a source state', () => {
  const input = copy(eu);
  input.status.published = absent();
  input.status.publishedCode = absent();
  assert.equal(projectTemporalV2(input, { asOf: now }).effectiveState, 'OPEN');
  input.schedule.opening = absent();
  assert.equal(projectTemporalV2(input, { asOf: now }).effectiveState, 'UNKNOWN');
});

test('v2 temporal: future opening yields UPCOMING; a civil opening today needs source evidence', () => {
  const input = calendar([instant('2027-11-01T14:00:00.000Z')]);
  input.schedule.opening.value = instant('2027-01-01T00:00:00.000Z');
  assert.equal(projectTemporalV2(input, { asOf: now }).effectiveState, 'UPCOMING');
  input.schedule.opening.value = date('2026-10-30');
  input.status.published = absent();
  input.status.publishedCode = absent();
  assert.equal(projectTemporalV2(input, { asOf: now }).effectiveState, 'UNKNOWN');
});

test('v2 temporal: continuous calls do not close on an old optional cutoff', () => {
  const input = calendar([instant('2026-10-01T14:00:00.000Z')]);
  input.schedule.deadlineModel.value = 'CONTINUOUS';
  assert.equal(projectTemporalV2(input, { asOf: now }).effectiveState, 'OPEN');
});

test('v2 temporal: same-time different phases remain distinct candidates', () => {
  const input = calendar([instant('2027-01-03T04:59:00.000Z')]);
  input.schedule.deadlines.value = [{ ...input.schedule.deadlines.value[0], phase: 'A' }, { ...copy(input.schedule.deadlines.value[0]), phase: 'B' }];
  const result = projectTemporalV2(input, { asOf: now });
  assert.equal(result.nextDeadlineCandidates.length, 2);
  assert.equal(result.nextDeadline, null);
  assert.equal(result.effectiveState, 'OPEN');
});

test('v2 temporal: callers must provide a valid canonical reference instant', () => {
  for (const asOf of [undefined, '2026-02-30T12:00:00.000Z', '2026-10-30', '2026-10-30T12:00:00Z', '2026-10-30T13:00:00.000+01:00']) {
    assert.throws(() => projectTemporalV2(eu, { asOf }));
  }
});
