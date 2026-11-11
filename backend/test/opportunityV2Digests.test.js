'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { semanticSnapshotV2, contentDigestV2, compareSnapshotsV2 } = require('../src/opportunities/v2/digests');
const eu = require('../../context/references/opportunity-v2/examples/eu-11145.json');
const pt = require('../../context/references/opportunity-v2/examples/pt2030-8514.json');
const copy = value => JSON.parse(JSON.stringify(value));
function renameObservationIds(input) {
  const out = copy(input);
  const sourceKey = out.sourceRecords[0].key;
  out.sourceRecords[0].key = 'renamed-source';
  const observations = new Map(out.provenance.observations.map((o, i) => [o.id, `new-observation-${i}`]));
  const evidence = new Map(out.provenance.evidence.map((e, i) => [e.id, `new-evidence-${i}`]));
  for (const o of out.provenance.observations) {
    o.id = observations.get(o.id);
    if (o.sourceRecordKey === sourceKey) o.sourceRecordKey = 'renamed-source';
    o.observedAt = '2026-11-01T00:00:00.000Z';
    o.sourceModifiedAt = '2026-10-31T00:00:00.000Z';
    o.artifactSha256 = 'f'.repeat(64);
    if (o.document) o.document.sha256 = 'e'.repeat(64);
  }
  for (const e of out.provenance.evidence) {
    e.id = evidence.get(e.id);
    e.observationId = observations.get(e.observationId);
  }
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.evidenceRefs)) value.evidenceRefs = value.evidenceRefs.map(id => evidence.get(id));
    for (const x of Object.values(value)) walk(x);
  }
  walk(out);
  return out;
}

test('v2 digest: operational observation ids, clocks and byte hashes do not revise known facts', () => {
  const incoming = renameObservationIds(eu);
  assert.equal(contentDigestV2(eu), contentDigestV2(incoming));
  const result = compareSnapshotsV2(eu, incoming);
  assert.equal(result.action, 'UNCHANGED');
  assert.deepEqual(result.changedFields, []);
  assert.deepEqual(result.acceptedSnapshot, eu);
});

test('v2 digest: set order of programmes, evidence, refs and unphased cutoffs is irrelevant', () => {
  const incoming = copy(pt);
  incoming.programmes.value.reverse();
  incoming.financing.allocations.value[0].programmeRefs.reverse();
  incoming.provenance.evidence.reverse();
  incoming.identity.references.value.reverse();
  assert.equal(contentDigestV2(pt), contentDigestV2(incoming));
  const calls = copy(eu);
  calls.schedule.deadlines.value.reverse();
  assert.equal(contentDigestV2(eu), contentDigestV2(calls));
});

test('v2 digest: changing physical XLSX locations alone does not change unchanged field values', () => {
  const incoming = copy(pt);
  for (const e of incoming.provenance.evidence) if (e.locatorType === 'CELL') e.locator = e.locator.replace('111', '112');
  assert.equal(contentDigestV2(pt), contentDigestV2(incoming));
});

test('v2 digest: amount, mapping, availability and source URL are semantic changes', () => {
  const variants = [
    d => { d.financing.allocations.value[0].money.amount = '120001'; },
    d => { d.provenance.mappingVersion = 'eu-funding-type8-v2.1'; },
    d => { d.funds.state = 'NOT_COLLECTED'; d.funds.reason = 'NOT_REQUESTED_IN_MAPPING'; },
  ];
  for (const mutate of variants) {
    const incoming = copy(eu); mutate(incoming);
    assert.notEqual(contentDigestV2(eu), contentDigestV2(incoming));
  }
  const withUrl = copy(pt);
  withUrl.sourceRecords[0].url = 'https://portugal2030.pt/plano-anual-de-avisos/';
  assert.notEqual(contentDigestV2(pt), contentDigestV2(withUrl));
});

test('v2 digest: source identity does not silently merge different calls', () => {
  const incoming = copy(pt);
  incoming.sourceRecords[0].externalId = '9999';
  incoming.identity.references.value[0].value = '9999';
  const result = compareSnapshotsV2(pt, incoming);
  assert.equal(result.action, 'REVIEW_REQUIRED');
  assert.equal(result.sameIdentity, false);
  assert.ok(result.reasonCodes.includes('SOURCE_IDENTITY_CHANGED'));
  assert.deepEqual(result.acceptedSnapshot, pt);
});

test('v2 digest: a missing collection never erases the last accepted financing facts', () => {
  const incoming = copy(eu);
  incoming.financing.allocations = { state: 'NOT_COLLECTED', value: null, reason: 'SOURCE_READ_FAILED', evidenceRefs: [] };
  incoming.quality.issues = incoming.quality.issues.filter(issue => !issue.field.startsWith('/financing/allocations/value/'));
  const result = compareSnapshotsV2(eu, incoming);
  assert.equal(result.action, 'REVIEW_REQUIRED');
  assert.ok(result.retainedFields.includes('/financing/allocations'));
  assert.equal(result.acceptedSnapshot.financing.allocations.value[0].money.amount, '120000');
  assert.equal(result.candidateSnapshot.financing.allocations.state, 'NOT_COLLECTED');
});

test('v2 digest: conflict candidates are retained and changed raw evidence remains detectable', () => {
  const incoming = copy(eu);
  incoming.financing.allocations = { state: 'CONFLICT', value: null, reason: 'CONFLICTING_AMOUNTS', evidenceRefs: ['budget', 'monthly-support'] };
  incoming.quality.issues = incoming.quality.issues.filter(issue => !issue.field.startsWith('/financing/allocations/value/'));
  const result = compareSnapshotsV2(eu, incoming);
  assert.equal(result.action, 'REVIEW_REQUIRED');
  assert.ok(result.conflictFields.includes('/financing/allocations'));
  assert.equal(result.acceptedSnapshot.financing.allocations.value[0].money.amount, '120000');
  const changedEvidence = copy(incoming);
  changedEvidence.provenance.observations[0].artifactSha256 = 'a'.repeat(64);
  assert.notEqual(contentDigestV2(incoming), contentDigestV2(changedEvidence));
  const changedCandidate = copy(incoming);
  changedCandidate.provenance.evidence.find(item => item.id === 'budget').excerpt = '130000';
  assert.notEqual(contentDigestV2(incoming), contentDigestV2(changedCandidate));
  const renamed = renameObservationIds(incoming);
  renamed.provenance.observations[0].artifactSha256 = incoming.provenance.observations[0].artifactSha256;
  assert.equal(contentDigestV2(incoming), contentDigestV2(renamed));
});

test('v2 digest: a known nested currency is retained when a later payload does not collect it', () => {
  const previous = copy(eu);
  previous.financing.allocations.value[0].money.currency = { state: 'PRESENT', value: 'EUR', evidenceRefs: ['support-currency'], reason: null };
  const incoming = copy(previous);
  incoming.financing.allocations.value[0].money.currency = { state: 'NOT_COLLECTED', value: null, evidenceRefs: [], reason: 'SOURCE_READ_FAILED' };
  const result = compareSnapshotsV2(previous, incoming);
  assert.equal(result.action, 'REVIEW_REQUIRED');
  assert.ok(result.retainedFields.includes('/financing/allocations/value/0/money/currency'));
  assert.equal(result.acceptedSnapshot.financing.allocations.value[0].money.currency.value, 'EUR');
});

test('v2 digest: a material revision is a proposal only, never an automatic overwrite', () => {
  const incoming = copy(eu);
  incoming.financing.allocations.value[0].money.amount = '130000';
  const result = compareSnapshotsV2(eu, incoming);
  assert.equal(result.action, 'CANDIDATE_REVISION');
  assert.ok(result.changedFields.includes('/financing/allocations'));
  assert.equal(result.canReplaceAccepted, false);
  assert.equal(result.acceptedSnapshot.financing.allocations.value[0].money.amount, '120000');
  assert.ok(Object.isFrozen(result.acceptedSnapshot));
});

test('v2 digest: phase labels and their published order remain material', () => {
  const previous = copy(eu);
  previous.schedule.deadlines.value[0].phase = 'First stage';
  previous.schedule.deadlines.value[1].phase = 'Second stage';
  const incoming = copy(previous);
  incoming.schedule.deadlines.value.reverse();
  assert.notEqual(contentDigestV2(previous), contentDigestV2(incoming));
});

test('v2 digest: semantic output is immutable and never mutates supplied snapshots', () => {
  const before = JSON.stringify(eu);
  const semantic = semanticSnapshotV2(eu);
  assert.ok(Object.isFrozen(semantic.financing));
  assert.equal(JSON.stringify(eu), before);
});

test('v2 digest: a new conflict in a previously uncollected field requires review', () => {
  const incoming = copy(eu);
  incoming.financing.rates = { state: 'CONFLICT', value: null, reason: 'CONTRADICTORY_RATES', evidenceRefs: ['budget', 'monthly-support'] };
  const result = compareSnapshotsV2(eu, incoming);
  assert.equal(result.action, 'REVIEW_REQUIRED');
  assert.ok(result.conflictFields.includes('/financing/rates'));
});

test('v2 digest: removal of published collection members requires review without erasing the accepted set', () => {
  const incoming = copy(eu);
  incoming.schedule.deadlines.value.pop();
  const result = compareSnapshotsV2(eu, incoming);
  assert.equal(result.action, 'REVIEW_REQUIRED');
  assert.ok(result.reasonCodes.includes('COLLECTION_ITEMS_REMOVED'));
  assert.equal(result.acceptedSnapshot.schedule.deadlines.value.length, 7);
});

test('v2 digest: separate allocation rows preserve multiplicity even with equal financial values', () => {
  const twoRows = copy(eu);
  const second = copy(twoRows.financing.allocations.value[0]);
  second.key = 'allocation-2';
  twoRows.financing.allocations.value.push(second);
  assert.notEqual(contentDigestV2(eu), contentDigestV2(twoRows));
  const reversed = copy(twoRows);
  reversed.financing.allocations.value.reverse();
  assert.equal(contentDigestV2(twoRows), contentDigestV2(reversed));
  assert.equal(semanticSnapshotV2(twoRows).financing.allocations.value.length, 2);
});

test('v2 digest: changing an allocation key cannot hide loss of its previously known currency', () => {
  const previous = copy(eu);
  previous.financing.allocations.value[0].money.currency = { state: 'PRESENT', value: 'EUR', evidenceRefs: ['support-currency'], reason: null };
  const incoming = copy(previous);
  incoming.financing.allocations.value[0].key = 'replacement-allocation';
  incoming.financing.allocations.value[0].money.currency = { state: 'NOT_COLLECTED', value: null, evidenceRefs: [], reason: 'SOURCE_READ_FAILED' };
  const result = compareSnapshotsV2(previous, incoming);
  assert.equal(result.action, 'REVIEW_REQUIRED');
  assert.ok(result.reasonCodes.includes('COLLECTION_IDENTITY_UNCERTAIN'));
  assert.equal(result.acceptedSnapshot.financing.allocations.value[0].money.currency.value, 'EUR');
});
