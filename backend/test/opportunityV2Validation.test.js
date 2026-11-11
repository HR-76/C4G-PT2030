'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateSnapshotV2 } = require('../src/opportunities/v2/validation');
const { cloneData, jsonbBytes } = require('../src/opportunities/v2/data');
const corpus = path.resolve(__dirname, '../../context/references/opportunity-v2');
const fixture = (name = 'eu-11145') => JSON.parse(fs.readFileSync(path.join(corpus, 'examples', name + '.json'), 'utf8'));
function invalid(change, code) { const value = fixture(); change(value); assert.throws(() => validateSnapshotV2(value), code ? { code } : undefined); }

test('v2 validates all six normative snapshots and freezes independent copies', () => {
  for (const name of ['eu-11145', 'pt2030-8485', 'pt2030-8514', 'pt2030-8583', 'pt2030-8614', 'pt2030-8664']) {
    const input = fixture(name), out = validateSnapshotV2(input);
    assert.deepEqual(out, input); assert.notEqual(out, input);
    assert.ok(Object.isFrozen(out.financing.allocations.value));
    assert.throws(() => { out.description.title.value = 'changed'; });
  }
  assert.deepEqual(fs.readFileSync(path.resolve(__dirname, '../src/opportunities/v2/opportunity-v2.schema.json')), fs.readFileSync(path.join(corpus, 'opportunity-v2.schema.json')));
});

test('v2 schema rejects unknown keys, invalid facts and lossy numeric values', () => {
  invalid(v => { v.unexpected = 1; });
  invalid(v => { delete v.relatedProject; });
  invalid(v => { v.description.title.value = null; });
  invalid(v => { v.description.title.value = ' '; });
  invalid(v => { v.relatedProject.acronym.value = ' SUSA '; });
  invalid(v => { v.funds.value = []; });
  invalid(v => { v.programmes.value = []; });
  invalid(v => { v.financing.allocations.value[0].money.amount = 120000; });
  for (const amount of ['120 000,00', '1e5', '-1', '0.123456789', '1000000000000000000000000', '1.0']) invalid(v => { v.financing.allocations.value[0].money.amount = amount; });
  invalid(v => { v.relatedProject.grantAgreementNumber.value = 101190010; });
  invalid(v => { v.schedule.opening.value.value = '2026-02-30T00:00:00.000Z'; });
  invalid(v => { v.sourceRecords[0].url = 'https://user:password@ec.europa.eu/'; });
});

test('v2 provenance and financial references must resolve without collisions', () => {
  invalid(v => { v.description.title.evidenceRefs = ['missing']; }, 'OPPORTUNITY_V2_REFERENCE_INVALID');
  invalid(v => { v.provenance.evidence[0].observationId = 'missing'; }, 'OPPORTUNITY_V2_REFERENCE_INVALID');
  invalid(v => { v.provenance.observations[0].sourceRecordKey = 'missing'; }, 'OPPORTUNITY_V2_REFERENCE_INVALID');
  invalid(v => { v.provenance.evidence.push({ ...v.provenance.evidence[0], locator: '/different' }); }, 'OPPORTUNITY_V2_DUPLICATE_KEY');
  invalid(v => { v.financing.allocations.value[0].programmeRefs = ['missing']; }, 'OPPORTUNITY_V2_REFERENCE_INVALID');
  invalid(v => { v.programmes.value.push({ ...v.programmes.value[0], code: 'DIFFERENT' }); }, 'OPPORTUNITY_V2_DUPLICATE_KEY');
  invalid(v => { v.quality.issues[0].field = '/missing'; }, 'OPPORTUNITY_V2_REFERENCE_INVALID');
});

test('v2 money bounds and zero semantics are enforced beyond JSON Schema', () => {
  invalid(v => { v.financing.allocations.value[0].money.amount = '0'; }, 'OPPORTUNITY_V2_MONEY_INVALID');
  invalid(v => { v.financing.allocations.value[0].money.interpretation = 'ZERO_UNEXPLAINED'; }, 'OPPORTUNITY_V2_MONEY_INVALID');
  invalid(v => { v.financing.support.value[0].minimum = '1501'; }, 'OPPORTUNITY_V2_MONEY_INVALID');
  invalid(v => { v.financing.support.value[0].maximum = null; }, 'OPPORTUNITY_V2_MONEY_INVALID');
  invalid(v => { v.financing.rates = { state: 'PRESENT', value: [{ minimumPercent: null, maximumPercent: '100.00000001', scope: 'CALL', conditions: null }], evidenceRefs: ['budget'], reason: null }; }, 'OPPORTUNITY_V2_MONEY_INVALID');
});

test('v2 shared allocation preserves an unknown group identifier', () => {
  const input = fixture();
  input.financing.allocations.value[0].aggregation = 'SHARED';
  input.financing.allocations.value[0].sharedGroup = null;
  const result = validateSnapshotV2(input);
  assert.equal(result.financing.allocations.value[0].aggregation, 'SHARED');
  assert.equal(result.financing.allocations.value[0].sharedGroup, null);
});

test('v2 rejects contradictory dates and cascade identity confusion', () => {
  invalid(v => { v.schedule.opening.value.value = '2029-01-01T00:00:00.000Z'; }, 'OPPORTUNITY_V2_TEMPORAL_INVALID');
  invalid(v => { v.sourceRecords[0].externalId = 'CASCADE:46214053'; }, 'OPPORTUNITY_V2_IDENTITY_INVALID');
  invalid(v => { v.sourceRecords[0].url = v.sourceRecords[0].url.replace('11145', '46214053'); }, 'OPPORTUNITY_V2_IDENTITY_INVALID');
  const p = fixture('pt2030-8485'); p.schedule.plannedClosing.value.value = '2020-01-01';
  assert.throws(() => validateSnapshotV2(p), { code: 'OPPORTUNITY_V2_TEMPORAL_INVALID' });
});

test('v2 preserves a planning period with only one published bound', () => {
  for (const bounds of [{ start: '2026-09-01', end: null }, { start: null, end: '2027-08-31' }]) {
    const input = fixture('pt2030-8485');
    Object.assign(input.schedule.planningPeriod.value, bounds);
    const result = validateSnapshotV2(input);
    assert.equal(result.schedule.planningPeriod.value.start, bounds.start);
    assert.equal(result.schedule.planningPeriod.value.end, bounds.end);
  }
});

test('v2 plan identities cannot masquerade as cascade calls', () => {
  const input = fixture('pt2030-8485'); input.identity.kind = 'CASCADE_CALL';
  assert.throws(() => validateSnapshotV2(input), { code: 'OPPORTUNITY_V2_IDENTITY_INVALID' });
});

test('v2 rejects active objects without invoking attacker code', () => {
  let calls = 0;
  const accessor = fixture(); Object.defineProperty(accessor, 'schemaVersion', { get() { calls++; return 2; }, enumerable: true });
  assert.throws(() => validateSnapshotV2(accessor)); assert.equal(calls, 0);
  const proxy = new Proxy({}, { get() { calls++; } }); assert.throws(() => validateSnapshotV2(proxy)); assert.equal(calls, 0);
  const cycle = {}; cycle.self = cycle; assert.throws(() => cloneData(cycle));
  const sparse = []; sparse.length = 5; assert.throws(() => cloneData(sparse));
  const decorated = []; decorated.foo = 1; assert.throws(() => cloneData(decorated));
  assert.throws(() => cloneData(JSON.parse('{"__proto__":{"bad":true}}')));
  assert.throws(() => cloneData({ fn() {} })); assert.throws(() => cloneData({ amount: BigInt(1) }));
});

test('v2 enforces serialized and persisted JSON byte budgets without truncation', () => {
  assert.throws(() => cloneData({ text: 'a'.repeat(262144) }), { code: 'OPPORTUNITY_V2_LIMIT_EXCEEDED' });
  assert.ok(jsonbBytes({ a: 'b', c: 'd' }) > Buffer.byteLength(JSON.stringify({ a: 'b', c: 'd' })));
  const input = fixture();
  while (jsonbBytes(input) < 262144 && input.provenance.evidence.length < 512) input.provenance.evidence.push({ ...input.provenance.evidence[0], id: 'extra-' + input.provenance.evidence.length, excerpt: 'z'.repeat(2048) });
  assert.ok(Buffer.byteLength(JSON.stringify(input)) <= 262144, 'compact JSON fits');
  assert.ok(jsonbBytes(input) > 262144, 'persisted JSON representation exceeds the limit');
  const before = JSON.stringify(input);
  assert.throws(() => validateSnapshotV2(input), { code: 'OPPORTUNITY_V2_LIMIT_EXCEEDED' });
  assert.equal(JSON.stringify(input), before);
});
