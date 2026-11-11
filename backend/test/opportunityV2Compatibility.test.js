'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readOpportunitySnapshot } = require('../src/opportunities/v2/compatibility');
const eu = require('../../context/references/opportunity-v2/examples/eu-11145.json');
const pt = require('../../context/references/opportunity-v2/examples/pt2030-8614.json');

const ENRICHMENT_FIELDS = ['programme', 'instrument', 'budget', 'support', 'rate', 'territories', 'beneficiaries', 'consortium', 'conditions', 'documents', 'submission'];
function legacy(extra = {}) {
  return {
    schemaVersion: 1, title: 'Legacy opportunity', funderName: 'Legacy publisher or funder',
    provenanceId: '01900000-0000-7000-8000-000000000001', lifecycleState: 'ACTIVE',
    validationState: 'PENDING_REVIEW', normalizationVersion: 'opportunity-normalization-v1',
    qualityRuleVersion: 'opportunity-quality-v1', ...extra,
  };
}
function item(value) {
  return { value, evidence: { url: 'https://ec.europa.eu/call', locator: 'budget', excerpt: 'Published value', observedAt: '2026-10-30T00:00:00.000Z' } };
}
function enrichment(overrides = {}) {
  return {
    schemaVersion: 1, mappingVersion: 'legacy-mapping', observedAt: '2026-10-30T00:00:00.000Z',
    fields: Object.fromEntries(ENRICHMENT_FIELDS.map(name => [name, overrides[name] || { status: 'NOT_FOUND', items: [], truncated: false }])),
  };
}
const budget = (amount, scope = 'CALL') => ({ amount, currency: 'EUR', period: null, scope, group: null, action: null });

test('v2 reader preserves original factual snapshot and returns a frozen shared availability envelope', () => {
  const input = structuredClone(eu);
  const result = readOpportunitySnapshot(input);
  assert.equal(result.sourceVersion, 2);
  assert.deepEqual(result.snapshot, input);
  assert.equal(result.projection.description.title.value, 'Gnomon Internships Offer');
  assert.equal(result.projection.financing.allocations.value[0].money.amount, '120000');
  assert.equal(result.projection.financing.allocations.representation, 'v2');
  assert.equal(result.projection.schedule.deadlines.value.length, 7);
  assert.equal(result.projection.relatedProject.grantAgreementNumber.value, '101190010');
  assert.equal(result.projection.financing.allocations.complete, true);
  assert.ok(Object.isFrozen(result.snapshot.provenance.evidence));
  assert.ok(Object.isFrozen(result.projection.financing.allocations.value[0]));
  assert.equal(Object.isFrozen(input), false);
  input.description.title.value = 'Caller mutation';
  assert.equal(result.snapshot.description.title.value, 'Gnomon Internships Offer');
});

test('v2 reader keeps multiple programmes and planned dates without making a legacy singular alias', () => {
  const result = readOpportunitySnapshot(structuredClone(pt));
  assert.equal(result.projection.programmes.value.length, 3);
  assert.equal(result.projection.publication.value, 'PLANNED');
  assert.equal(result.projection.schedule.opening.value, null);
  assert.equal(result.projection.schedule.plannedOpening.value.precision, 'DATE');
  assert.equal(result.projection.legacy.funderName.state, 'NOT_COLLECTED');
});

test('legacy original survives validation normalization and has no fabricated v2 identity or party role', () => {
  const input = legacy({ title: '  Historical title  ', programmeName: 'Programme', officialUrl: 'HTTPS://EXAMPLE.INVALID:443/call#fragment' });
  const result = readOpportunitySnapshot(input);
  assert.equal(result.sourceVersion, 1);
  assert.deepEqual(result.snapshot, input);
  assert.equal(result.snapshot.title, '  Historical title  ');
  assert.equal(result.snapshot.officialUrl, input.officialUrl);
  assert.equal(result.projection.description.title.value, input.title);
  assert.deepEqual(result.projection.programmes.value, ['Programme']);
  assert.equal(result.projection.programmes.representation, 'v1-core');
  assert.equal(result.projection.parties.state, 'NOT_COLLECTED');
  assert.equal(result.projection.legacy.funderName.value, input.funderName);
  assert.equal(result.projection.publication.state, 'NOT_COLLECTED');
  assert.equal(result.projection.funds.state, 'NOT_COLLECTED');
  assert.equal(result.snapshot.identity, undefined);
  assert.ok(result.warnings.some(w => w.code === 'LEGACY_PARTY_ROLE_UNCLASSIFIED'));
});

test('legacy decimals outside v2 precision remain readable and never become a call total', () => {
  const large = '1234567890123456789012345678901234567890.12345678901234567890';
  const input = legacy({ fundingAmountMin: '0.00', fundingAmountMax: large, currencyCode: 'EUR' });
  const result = readOpportunitySnapshot(input);
  assert.equal(result.snapshot.fundingAmountMin, '0.00');
  assert.equal(result.snapshot.fundingAmountMax, large);
  assert.deepEqual(result.projection.legacy.fundingRange.value, { minimum: '0.00', maximum: large, currency: 'EUR' });
  assert.equal(result.projection.financing.allocations.state, 'NOT_COLLECTED');
  assert.equal(result.projection.financing.support.state, 'NOT_COLLECTED');
  assert.ok(result.warnings.some(w => w.code === 'LEGACY_FUNDING_SCOPE_UNCLASSIFIED'));
});

test('legacy enrichment PUBLISHED becomes PRESENT without selecting, adding or multiplying values', () => {
  const values = [budget('120000'), budget('300000', 'TOPIC_OR_SHARED')];
  const input = legacy({ sourceEnrichment: enrichment({ budget: { status: 'PUBLISHED', items: values.map(item), truncated: false } }) });
  const result = readOpportunitySnapshot(input);
  const field = result.projection.financing.allocations;
  assert.equal(field.state, 'PRESENT');
  assert.equal(field.complete, true);
  assert.equal(field.representation, 'v1-enrichment:budget');
  assert.deepEqual(field.value, values);
  assert.deepEqual(field.sourcePaths, ['/sourceEnrichment/fields/budget']);
  assert.deepEqual(result.snapshot.sourceEnrichment, input.sourceEnrichment);
});

test('legacy field NOT_FOUND is distinct from enrichment not collected', () => {
  const missing = readOpportunitySnapshot(legacy());
  const inspected = readOpportunitySnapshot(legacy({ sourceEnrichment: enrichment() }));
  assert.equal(missing.projection.financing.allocations.state, 'NOT_COLLECTED');
  assert.equal(missing.projection.financing.allocations.complete, false);
  assert.equal(inspected.projection.financing.allocations.state, 'NOT_FOUND');
  assert.equal(inspected.projection.financing.allocations.complete, true);
  assert.equal(inspected.projection.financing.allocations.value, null);
});

test('legacy CONFLICT and UNSUPPORTED preserve candidates and observations without a false scalar value', () => {
  for (const status of ['CONFLICT', 'UNSUPPORTED']) {
    const original = enrichment({ budget: { status, items: [item(budget('120000')), item(budget('125000'))], truncated: false } });
    const result = readOpportunitySnapshot(legacy({ sourceEnrichment: original }));
    const field = result.projection.financing.allocations;
    assert.equal(field.state, status);
    assert.equal(field.value, null);
    assert.equal(field.complete, false);
    assert.deepEqual(field.candidates, original.fields.budget.items);
    assert.deepEqual(result.projection.legacy.enrichment.value, original);
    assert.ok(Object.isFrozen(field.candidates[0].evidence));
  }
});

test('legacy truncated PUBLISHED retains known items while making incompleteness explicit', () => {
  const source = enrichment({ budget: { status: 'PUBLISHED', items: [item(budget('120000'))], truncated: true } });
  const result = readOpportunitySnapshot(legacy({ sourceEnrichment: source }));
  const field = result.projection.financing.allocations;
  assert.equal(field.state, 'PRESENT');
  assert.equal(field.complete, false);
  assert.equal(field.reason, 'LEGACY_TRUNCATED');
  assert.equal(field.value[0].amount, '120000');
  assert.equal(result.snapshot.sourceEnrichment.fields.budget.truncated, true);
  assert.ok(result.warnings.some(w => w.code === 'LEGACY_TRUNCATED' && w.path === '/sourceEnrichment/fields/budget'));
});

test('observed programme conflict is not silently overridden by a legacy programmeName alias', () => {
  const source = enrichment({ programme: { status: 'CONFLICT', items: [item({ id: '1', code: 'A', label: 'One' }), item({ id: '2', code: 'B', label: 'Two' })], truncated: false } });
  const result = readOpportunitySnapshot(legacy({ programmeName: 'Fallback', sourceEnrichment: source }));
  assert.equal(result.projection.programmes.state, 'CONFLICT');
  assert.equal(result.projection.programmes.value, null);
  assert.equal(result.projection.programmes.candidates.length, 2);
  assert.equal(result.snapshot.programmeName, 'Fallback');
});

test('legacy typed source calendar retains all published precisions and has no inferred publication', () => {
  const sourceTemporal = { status: 'OPEN', statusCode: '31094502', openings: ['2025-06-30'], deadlines: ['2026-10-30', '2027-01-03T05:59:00.000+0100'] };
  const result = readOpportunitySnapshot(legacy({ openingDate: '2025-06-30', closingDate: '2026-10-30', sourceTemporal }));
  assert.deepEqual(result.projection.schedule.deadlines.value, sourceTemporal.deadlines);
  assert.equal(result.projection.schedule.deadlines.representation, 'v1-sourceTemporal');
  assert.equal(result.projection.status.published.value, 'OPEN');
  assert.equal(result.projection.publication.state, 'NOT_COLLECTED');
  assert.deepEqual(result.snapshot.sourceTemporal, sourceTemporal);
});

test('legacy flat dates and an empty source calendar do not fabricate confirmed or planned deadlines', () => {
  for (const temporal of [undefined, { status: 'UNKNOWN', openings: [], deadlines: [] }]) {
    const input = legacy({ openingDate: '2026-09-01', closingDate: '2027-12-31', ...(temporal && { sourceTemporal: temporal }) });
    const result = readOpportunitySnapshot(input);
    assert.equal(result.projection.schedule.deadlines.state, 'NOT_COLLECTED');
    assert.equal(result.projection.schedule.plannedClosing.state, 'NOT_COLLECTED');
    assert.equal(result.projection.legacy.closingDate.value, '2027-12-31');
    assert.ok(result.warnings.some(w => w.code === 'LEGACY_DATE_NATURE_UNCLASSIFIED'));
  }
});

test('legacy textual rates and conditions are preserved without extracting a fabricated numeric rate', () => {
  const source = enrichment({ rate: { status: 'PUBLISHED', items: [item({ text: 'Up to 85%, subject to conditions' })], truncated: false } });
  const result = readOpportunitySnapshot(legacy({ sourceEnrichment: source }));
  assert.deepEqual(result.projection.financing.rates.value, [{ text: 'Up to 85%, subject to conditions' }]);
  assert.equal(result.projection.financing.rates.representation, 'v1-enrichment:rate');
});

test('unsupported versions and mixed version properties are rejected before a partial read', () => {
  for (const value of [null, [], {}, legacy({ schemaVersion: '1' }), legacy({ schemaVersion: 3 }), legacy({ contractVersion: 'opportunity-v2.0' }), { ...structuredClone(eu), funderName: 'Injected' }]) {
    assert.throws(() => readOpportunitySnapshot(value));
  }
});

test('version dispatch does not invoke getters, proxies, toJSON or accept cyclic input', () => {
  let calls = 0;
  const getter = legacy();
  Object.defineProperty(getter, 'schemaVersion', { enumerable: true, get() { calls++; return 1; } });
  const toJSON = legacy({ toJSON() { calls++; return legacy(); } });
  const proxy = new Proxy(legacy(), { get() { calls++; return 1; } });
  const cycle = legacy(); cycle.cycle = cycle;
  for (const value of [getter, toJSON, proxy, cycle]) assert.throws(() => readOpportunitySnapshot(value));
  assert.equal(calls, 0);
});

test('reader deeply freezes historical values without mutating caller input', () => {
  const input = legacy({ sourceEnrichment: enrichment({ budget: { status: 'PUBLISHED', items: [item(budget('120000'))], truncated: false } }) });
  const result = readOpportunitySnapshot(input);
  assert.equal(Object.isFrozen(input.sourceEnrichment), false);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.projection.legacy.enrichment.value.fields.budget.items));
  input.sourceEnrichment.fields.budget.items[0].value.amount = '9';
  assert.equal(result.projection.financing.allocations.value[0].amount, '120000');
});
