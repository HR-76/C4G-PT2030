'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { projectPersistenceV2 } = require('../src/opportunities/v2');
const { validateCreateCommand } = require('../src/opportunities/contracts');

const root = path.resolve(__dirname, '../../context/references/opportunity-v2');
const fixture = name => JSON.parse(fs.readFileSync(path.join(root, 'examples', `${name}.json`), 'utf8'));
const envelope = { opportunityId: '019a0b00-0000-7000-8000-000000000001', revisionId: '019a0b00-0000-7000-8000-000000000002', revisionNumber: 2, rowVersion: 3 };

test('S1 persistence projection preserves exact allocation, unknown currency and all seven deadlines', () => {
  const input = fixture('eu-11145');
  const output = projectPersistenceV2(input, envelope);
  assert.equal(output.revision.schemaVersion, 2);
  assert.deepEqual(output.revision.snapshot, input);
  assert.equal(output.allocations.length, 1);
  assert.equal(output.allocations[0].amount, '120000');
  assert.equal(output.allocations[0].currencyCode, null);
  assert.equal(output.allocations[0].currencyState, 'NOT_FOUND');
  assert.equal(output.support[0].maximum, '1500');
  assert.equal(output.support[0].currency.value, 'EUR');
  assert.equal(output.deadlines.length, 7);
  assert.equal(output.deadlines[0].at.value, '2025-09-02T04:59:00.000Z');
  assert.equal(output.deadlines[6].at.value, '2028-09-02T04:59:00.000Z');
  assert.equal(output.sourceIdentities[0].externalId, 'CASCADE:11145');
  for (const row of [...output.allocations, ...output.support, ...output.deadlines, ...output.sourceIdentities]) {
    assert.equal(row.revisionId, envelope.revisionId);
    assert.equal(row.opportunityId, envelope.opportunityId);
  }
  assert.match(output.revision.contentDigest, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(output.revision.snapshot.financing.allocations.value), true);
  assert.equal(Object.isFrozen(input), false);
});

test('S1 planned multi-programme funding remains one amount and never becomes a confirmed calendar', () => {
  const output = projectPersistenceV2(fixture('pt2030-8514'), envelope);
  assert.equal(output.allocations.length, 1);
  assert.equal(output.allocations[0].programmeRefs.length, 6);
  assert.equal(output.allocations[0].amount, '40000000');
  assert.equal(output.allocations[0].basis, 'PLANNED');
  assert.equal(output.allocations[0].aggregation, 'UNKNOWN');
  assert.deepEqual(output.deadlines, []);
  assert.equal(output.calendar.plannedOpening.value.precision, 'DATE');
  assert.equal(output.calendar.opening.state, 'NOT_FOUND');
});

test('S1 monetary projection preserves zero and fractional digits without Number coercion', () => {
  const zero = projectPersistenceV2(fixture('pt2030-8664'), envelope);
  const decimal = projectPersistenceV2(fixture('pt2030-8583'), envelope);
  assert.equal(zero.allocations[0].amount, '0');
  assert.equal(zero.allocations[0].interpretation, 'ZERO_UNEXPLAINED');
  assert.equal(decimal.allocations[0].amount, '18181527.09');
});

test('S1 requires an exact server revision envelope and rejects reuse or unsafe revision numbers', () => {
  for (const bad of [
    { ...envelope, tenant: 'another-organization' },
    { ...envelope, revisionId: envelope.opportunityId },
    { ...envelope, rowVersion: 0 },
    { ...envelope, revisionNumber: Number.MAX_SAFE_INTEGER + 1 },
    { ...envelope, opportunityId: '11145' }
  ]) assert.throws(() => projectPersistenceV2(fixture('eu-11145'), bad));
  let invoked = false;
  const bad = { ...envelope };
  Object.defineProperty(bad, 'rowVersion', { enumerable: true, get() { invoked = true; return 1; } });
  assert.throws(() => projectPersistenceV2(fixture('eu-11145'), bad));
  assert.equal(invoked, false);
});

test('S1 runtime schema is byte-identical to the S0 normative schema', () => {
  assert.deepEqual(fs.readFileSync(path.join(root, 'opportunity-v2.schema.json')),
    fs.readFileSync(path.resolve(__dirname, '../src/opportunities/v2/opportunity-v2.schema.json')));
});

test('existing v1 writer continues to reject a v2 snapshot before any persistence', () => {
  assert.throws(() => validateCreateCommand({ schemaVersion: 1, requestId: 's1-no-activation', snapshot: fixture('eu-11145'), provenance: {} }));
});
