'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEvidence, verifyEvidence } = require('../src/fundingTenders/sourceEvidence');
const { createSource, formData, normalizeRecord, SOURCE } = require('../src/fundingTenders/source');
const { decisions } = require('../src/fundingTenders/resolutionPack');
const { temporalState } = require('../src/opportunities/temporal');
const clone = value => JSON.parse(JSON.stringify(value));
const makeSource = data => createSource({ clock: () => Date.parse('2026-10-28T12:00:00Z'), fetchImpl: async () => new Response(JSON.stringify(data)) });

test('all six documentary decisions bind both original variants and preserve the established final instants', () => {
  assert.equal(decisions.length, 6);
  assert.equal(new Set(decisions.map(d => d.externalIdentifier)).size, 6);
  for (const decision of decisions) {
    assert.equal(verifyEvidence(decision.evidence), true);
    assert.equal(decision.evidence.variants.length, 2);
    assert.equal(decision.expectedFingerprint, decision.evidence.fingerprint);
    assert.deepEqual(Object.keys(decision.fields).sort(), ['closingDate', 'sourceTemporal']);
    assert.ok(decision.sources.length >= 2);
    assert.equal(temporalState(decision.fields, '2026-10-28T12:00:00Z').state, 'CLOSED');
    const schedule = decision.fields.sourceTemporal.deadlines;
    if (decision.externalIdentifier.startsWith('CEF-')) {
      assert.equal(schedule.length, 5);
      assert.equal(schedule.at(-1), '2023-11-07T17:00:00+01:00');
      assert.equal(schedule[1], '2022-06-07T17:00:00+02:00');
    } else if (decision.externalIdentifier.startsWith('ERASMUS-')) {
      assert.equal(decision.fields.sourceTemporal.status, 'OPEN');
      assert.equal(schedule.at(-1), '2026-03-24T17:00:00+01:00');
      assert.equal(schedule[0], '2022-05-03');
      assert.ok(schedule.every(d => !d.startsWith('2027-')));
    } else {
      assert.equal(schedule.at(-1), '2026-09-22T17:00:00+02:00');
      assert.match(decision.note, /certifica/i);
    }
    assert.ok(decision.fields.sourceTemporal.openings.every(d => d.length === 10));
  }
});

test('semantic fingerprint ignores item order, schedule ordering, JSON object order and index ingestion metadata', () => {
  const original = decisions[0].evidence, variants = clone(original.variants).reverse();
  for (const item of variants) {
    item.metadata.deadlineDate.reverse();
    item.metadata.startDate.reverse();
    item.metadata.esDA_IngestDate = ['2099-01-01'];
    item.metadata.esDA_QueueDate = ['2099-01-02'];
    item.metadata['corporate-search-version'] = ['999'];
    item.weight = 999;
    if (item.metadata.actions) item.metadata.actions = item.metadata.actions.map(value => {
      const actions = JSON.parse(value);
      for (const action of actions) action.deadlineDates.reverse();
      return JSON.stringify(actions, null, 2);
    });
  }
  assert.equal(buildEvidence(original.externalIdentifier, variants).fingerprint, original.fingerprint);
});

test('changes in status, identity, schedules, full content or conditions invalidate the old fingerprint', () => {
  const original = decisions[0].evidence;
  for (const mutate of [
    r => { r[0].metadata.status = ['CLOSED']; },
    r => { r[0].metadata.callccm2Id = ['123456789']; },
    r => { r[0].metadata.deadlineDate.push('2030-01-01'); },
    r => { r[0].content += ' updated'; },
    r => { r[0].metadata.topicConditions = ['Updated eligibility']; },
    r => { r.push(clone(r[0])); }
  ]) {
    const changed = clone(original.variants); mutate(changed);
    assert.notEqual(buildEvidence(original.externalIdentifier, changed).fingerprint, original.fingerprint);
    assert.equal(verifyEvidence({ ...original, variants: changed }), false);
  }
});

test('evidence rejects mismatched or ambiguous identities, tampered digest and size/count violations', () => {
  const original = decisions[0].evidence;
  assert.equal(verifyEvidence({ ...original, fingerprint: '0'.repeat(64) }), false);
  assert.throws(() => buildEvidence(original.externalIdentifier, []));
  assert.throws(() => buildEvidence(original.externalIdentifier, Array.from({length:26}, () => original.variants[0])));
  assert.throws(() => buildEvidence(original.externalIdentifier, [{ ...original.variants[0], content: 'x'.repeat(2 * 1024 * 1024) }]));
  for (const field of ['identifier', 'type', 'language', 'ccm2Id']) {
    const changed = clone(original.variants); changed[0].metadata[field].push('different');
    assert.throws(() => buildEvidence(original.externalIdentifier, changed));
  }
  const changed = clone(original.variants); changed[0].metadata.ccm2Id = ['123456'];
  assert.throws(() => buildEvidence(original.externalIdentifier, changed));
  assert.throws(() => buildEvidence('DIFFERENT', original.variants));
});

test('exact lookup retains full bounded evidence for conflicts but never for absent, invalid or truncated responses', async () => {
  const original = decisions[0].evidence;
  assert.equal(formData(SOURCE, original.externalIdentifier).has('displayFields'), false);
  assert.equal(formData(SOURCE).has('displayFields'), true);
  assert.ok(JSON.parse(await formData(SOURCE).get('displayFields').text()).includes('actions'));
  for (const decision of decisions) {
    const pair = decision.evidence;
    const result = await makeSource({ totalResults: 2, results: pair.variants }).lookup({externalIdentifier: pair.externalIdentifier});
    assert.equal(result.outcome, 'CONFLICT', pair.externalIdentifier);
    assert.equal(result.evidence.fingerprint, pair.fingerprint);
    assert.deepEqual(result.evidence.variants, pair.variants);
  }
  const absent = await makeSource({totalResults: 0, results: []}).lookup({externalIdentifier: original.externalIdentifier});
  assert.equal(absent.evidence, undefined);
  const invalid = await makeSource({totalResults: 3, results: [...original.variants, {metadata:{}}]}).lookup({externalIdentifier: original.externalIdentifier});
  assert.equal(invalid.evidence, undefined);
  const truncated = await makeSource({totalResults: 26, results: Array.from({length:25}, () => original.variants[0])}).lookup({externalIdentifier: original.externalIdentifier});
  assert.equal(truncated.evidence, undefined);
  const contradictoryTotal = await makeSource({totalResults: 1, results: original.variants}).lookup({externalIdentifier: original.externalIdentifier});
  assert.equal(contradictoryTotal.evidence, undefined);
  const mixedIdentity = clone(original.variants); mixedIdentity[0].metadata.ccm2Id = ['123456'];
  const mixed = await makeSource({totalResults: 2, results: mixedIdentity}).lookup({externalIdentifier: original.externalIdentifier});
  assert.equal(mixed.evidence, undefined);
});

test('indexed midnight becomes DATE only when actions confirm the entire civil calendar', () => {
  const full = clone(decisions[0].evidence.variants.find(r => r.metadata.DATASOURCE[0] === 'SEDIA'));
  const normalized = normalizeRecord(full, {known:true});
  assert.ok(normalized.fields.sourceTemporal.deadlines.every(d => d.length === 10));
  assert.deepEqual(normalized.fields.sourceTemporal.openings, ['2021-09-16']);
  const genuine = clone(full); genuine.metadata.deadlineDate[0] = '2022-01-19T17:00:00.000+0000';
  assert.ok(normalizeRecord(genuine, {known:true}).fields.sourceTemporal.deadlines.includes('2022-01-19T17:00:00.000+0000'));
  const missing = clone(full); delete missing.metadata.actions;
  assert.ok(normalizeRecord(missing, {known:true}).fields.sourceTemporal.deadlines.every(d => d.length > 10));
  assert.ok(normalizeRecord(missing, {known:true}).fields.sourceTemporal.openings[0].length > 10);
  const openingInstant = clone(full); openingInstant.metadata.startDate = ['2021-09-16T12:00:00Z'];
  assert.deepEqual(normalizeRecord(openingInstant, {known:true}).fields.sourceTemporal.openings, ['2021-09-16T12:00:00Z']);
  for (const value of ['invalid JSON', '[{"deadlineDates":["2099-01-01"]}]', '[{"deadlineDates":["2022-01-19T00:00:00Z"]}]']) {
    const mismatched = clone(full); mismatched.metadata.actions = [value];
    assert.ok(normalizeRecord(mismatched, {known:true}).fields.sourceTemporal.deadlines.every(d => d.length > 10));
  }
});
