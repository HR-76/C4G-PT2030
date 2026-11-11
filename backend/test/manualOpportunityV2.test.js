'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { adaptManualOpportunityV2, createCentralManualAuthoringV2, manualEditorialId } = require('../src/opportunities/manualV2');
const { validateSnapshotV2, contentDigestV2, normalizers } = require('../src/opportunities/v2');
const present = value => ({ state: 'PRESENT', value, reason: null });
const declaration = () => ({ kind: 'CALL', fields: { '/description/title': present('  Candidatura manual  ') } });
const options = { editorialId: 'a'.repeat(64), observedAt: '2026-10-30T12:00:00.000Z' };

test('manual v2 produces an editorial candidate without invented official references or collection', () => {
  const input = declaration(), before = JSON.stringify(input), { snapshot, artifact } = adaptManualOpportunityV2(input, options);
  assert.deepEqual(validateSnapshotV2(snapshot), snapshot);
  assert.equal(snapshot.description.title.value, 'Candidatura manual');
  assert.equal(snapshot.sourceRecords[0].namespace, 'C4G_MANUAL');
  assert.equal(snapshot.sourceRecords[0].role, 'EDITORIAL');
  assert.equal(snapshot.sourceRecords[0].transport, 'MANUAL');
  assert.equal(snapshot.sourceRecords[0].url, null);
  assert.equal(snapshot.sourceRecords[0].externalId, 'EDITORIAL:' + options.editorialId);
  for (const fact of [snapshot.identity.references, snapshot.publication, snapshot.parties, snapshot.status.published, snapshot.financing.allocations]) {
    assert.equal(fact.state, 'NOT_COLLECTED'); assert.equal(fact.value, null);
  }
  assert.equal(snapshot.provenance.observations[0].coverage, 'EDITORIAL');
  assert.equal(snapshot.quality.issues.some(issue => issue.code === 'MANUAL_EDITORIAL_UNVERIFIED'), true);
  assert.equal(artifact.mediaType, 'application/json');
  assert.deepEqual(artifact.json, input);
  assert.equal(JSON.stringify(input), before); assert.equal(Object.isFrozen(snapshot), true);
});

test('manual v2 preserves plural facts, exact monetary strings, dates and phased cutoffs', () => {
  const input = declaration();
  input.fields['/programmes'] = present(['Programme A', 'Programme B'].map(label => ({ key: normalizers.conceptKey('MANUAL_PROGRAMME', label),
    sourceId: null, code: null, label, scheme: 'MANUAL_PROGRAMME', schemeVersion: null, mapping: 'UNMAPPED' })));
  input.fields['/financing/allocations'] = present([{ key: 'a', money: { amount: '120000.00', currency: present('EUR'), interpretation: 'PUBLISHED_AMOUNT' },
    scope: 'CALL_TOTAL', basis: 'CONFIRMED', programmeRefs: input.fields['/programmes'].value.map(x => x.key), fundRefs: [], period: null,
    sharedGroup: null, aggregation: 'STANDALONE', qualifiers: [] }]);
  input.fields['/schedule/opening'] = present({ precision: 'DATE', value: '2026-10-01' });
  input.fields['/schedule/deadlines'] = present([{ at: { precision: 'INSTANT', value: '2026-11-01T17:00:00+01:00', originalTimezone: '+01:00' }, phase: 'First' },
    { at: { precision: 'DATE', value: '2026-12-01' }, phase: 'Second' }]);
  const { snapshot, artifact } = adaptManualOpportunityV2(input, options);
  assert.equal(snapshot.financing.allocations.value[0].money.amount, '120000');
  assert.equal(snapshot.financing.allocations.value[0].money.currency.value, 'EUR');
  assert.equal(snapshot.programmes.value.length, 2);
  assert.deepEqual(snapshot.schedule.opening.value, { precision: 'DATE', value: '2026-10-01' });
  assert.equal(snapshot.schedule.deadlines.value[0].at.value, '2026-11-01T16:00:00.000Z');
  assert.equal(snapshot.schedule.deadlines.value.length, 2);
  for (const evidence of snapshot.provenance.evidence) {
    let value = artifact.json;
    for (const key of evidence.locator.slice(1).split('/')) value = value[key.replace(/~1/g, '/').replace(/~0/g, '~')];
    assert.notEqual(value, undefined, evidence.locator);
  }
});

test('manual v2 rejects provenance, authority, fake certification and unobserved source states', () => {
  for (const extra of [{ actor: {} }, { quality: {} }, { sourceRecords: [] }, { observedAt: options.observedAt }, { provenance: {} }]) {
    assert.throws(() => adaptManualOpportunityV2({ ...declaration(), ...extra }, options), { code: 'MANUAL_V2_INVALID_INPUT' });
  }
  for (const state of ['NOT_FOUND', 'CONFLICT', 'UNSUPPORTED']) {
    const input = declaration(); input.fields['/parties'] = { state, value: null, reason: 'CLAIM' };
    assert.throws(() => adaptManualOpportunityV2(input, options), { code: 'MANUAL_V2_INVALID_INPUT' });
  }
  const forged = declaration(); forged.fields['/programmes'] = present([{ key: 'P', sourceId: '1', code: 'P', label: 'Program', scheme: 'P', schemeVersion: '1', mapping: 'VERIFIED' }]);
  assert.throws(() => adaptManualOpportunityV2(forged, options), { code: 'MANUAL_V2_INVALID_INPUT' });
  const evidence = declaration(); evidence.fields['/description/title'].evidenceRefs = ['official'];
  assert.throws(() => adaptManualOpportunityV2(evidence, options), { code: 'MANUAL_V2_INVALID_INPUT' });
  const injected = declaration(); injected.fields['/quality/issues'] = present([]);
  assert.throws(() => adaptManualOpportunityV2(injected, options), { code: 'MANUAL_V2_INVALID_INPUT' });
});

test('manual title must be present and nonempty even though other uncollected facts are valid', () => {
  for (const title of [present('   '), { state: 'NOT_COLLECTED', value: null, reason: 'MANUAL_NOT_PROVIDED' },
    { state: 'NOT_APPLICABLE', value: null, reason: 'EDITORIAL_DECLARATION' }]) {
    assert.throws(() => adaptManualOpportunityV2({ kind: 'CALL', fields: { '/description/title': title } }, options), { code: 'MANUAL_V2_INVALID_INPUT' });
  }
  assert.throws(() => adaptManualOpportunityV2({ kind: 'CALL', fields: {} }, options), { code: 'MANUAL_V2_INVALID_INPUT' });
});

test('manual v2 rejects active objects, oversized inputs and imprecise numbers without executing them', () => {
  let invoked = false; const input = declaration();
  Object.defineProperty(input.fields, '/description/title', { enumerable: true, get() { invoked = true; return present('x'); } });
  assert.throws(() => adaptManualOpportunityV2(input, options), { code: 'MANUAL_V2_INVALID_INPUT' }); assert.equal(invoked, false);
  assert.throws(() => adaptManualOpportunityV2(new Proxy(declaration(), { ownKeys() { invoked = true; return []; } }), options), { code: 'MANUAL_V2_INVALID_INPUT' });
  assert.equal(invoked, false);
  const huge = declaration(); huge.fields['/description/summary'] = present('a'.repeat(300000));
  assert.throws(() => adaptManualOpportunityV2(huge, options), { code: 'MANUAL_V2_INVALID_INPUT' });
  const number = declaration(); number.fields['/financing/rates'] = present([{ minimumPercent: null, maximumPercent: 85, scope: 'CALL', conditions: null }]);
  assert.throws(() => adaptManualOpportunityV2(number, options), { code: 'MANUAL_V2_INVALID_INPUT' });
});

test('manual editorial id is scoped to administrator and request while semantic content excludes clock', () => {
  const user = randomUUID(), request = randomUUID(), id = manualEditorialId(user, request);
  assert.equal(id, manualEditorialId(user.toUpperCase(), request.toUpperCase()));
  assert.notEqual(id, manualEditorialId(randomUUID(), request));
  assert.notEqual(id, manualEditorialId(user, randomUUID()));
  const first = adaptManualOpportunityV2(declaration(), options), next = adaptManualOpportunityV2(declaration(), { ...options, observedAt: '2026-10-31T12:00:00.000Z' });
  assert.equal(contentDigestV2(first.snapshot), contentDigestV2(next.snapshot)); assert.equal(first.artifact.sha256, next.artifact.sha256);
  assert.equal(first.artifact.sha256.length, 64);
});

test('manual service checks current central authority before adaptation and again under lock', async () => {
  const userId = randomUUID(), input = { requestId: randomUUID(), ...declaration() }, calls = [], client = {};
  const transactions = { async run(work) { calls.push('begin'); try { const result = await work(client); calls.push('commit'); return result; } catch (error) { calls.push('rollback'); throw error; } } };
  let revoked = false, received;
  const authority = { async assertAdministrator(actual, user, { lock }) { assert.equal(actual, client); assert.equal(user, userId); calls.push(lock ? 'admin:lock' : 'admin:read'); if (revoked) throw Object.assign(Error('forbidden'), { code: 'FUNDING_FORBIDDEN' }); } };
  const archive = { async stage(actual, args) { assert.equal(actual, client); calls.push('stage'); received = args; return { candidateId: randomUUID(), reviewRequired: true }; } };
  const service = createCentralManualAuthoringV2({ transactions, authority, archive, clock: () => new Date(options.observedAt) });
  assert.equal((await service.create({ userId, input })).reviewRequired, true);
  assert.deepEqual(calls, ['begin', 'admin:read', 'commit', 'begin', 'admin:lock', 'stage', 'commit']);
  assert.equal(received.editorialId, manualEditorialId(userId, input.requestId)); assert.equal(received.observedAt, options.observedAt);
  revoked = true; calls.length = 0;
  await assert.rejects(service.create({ userId, input }), { code: 'FUNDING_FORBIDDEN' });
  assert.deepEqual(calls, ['begin', 'admin:read', 'rollback']);
  await assert.rejects(service.create({ userId, input, organizationId: null }), { code: 'MANUAL_V2_INVALID_INPUT' });
});
