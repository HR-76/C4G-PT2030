'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSource } = require('../src/fundingTenders/source');
const { validateSnapshotV2 } = require('../src/opportunities/v2');
const observedAt = '2026-10-30T22:45:39.461Z';
const raw = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../context/references/opportunity-v2/evidence/eu-11145.json'), 'utf8'));
function source(data = raw(), options = {}) {
  return createSource({ enrichmentEnabled: true, canonicalV2Enabled: true, clock: () => Date.parse(observedAt),
    fetchImpl: async (_url, request) => { assert.equal(request.body.has('displayFields'), false); return new Response(JSON.stringify(data)); }, ...options });
}

test('EU exact lookup integrates the normative v2 candidate independently of legacy fields', async () => {
  const batch = await source().lookup({ externalIdentifier: 'CASCADE:11145' });
  assert.equal(batch.outcome, 'FOUND');
  const snapshot = validateSnapshotV2(batch.canonicalSnapshot);
  assert.equal(snapshot.financing.allocations.value[0].money.amount, '120000');
  assert.equal(snapshot.financing.allocations.value[0].money.currency.state, 'NOT_FOUND');
  assert.equal(snapshot.financing.support.value[0].maximum, '1500');
  assert.equal(snapshot.relatedProject.acronym.value, 'SUSA');
  assert.equal(snapshot.relatedProject.grantAgreementNumber.value, '101190010');
  assert.equal(snapshot.parties.value[0].name, 'Gnomon Informatics SA');
  assert.equal(snapshot.schedule.deadlines.value.length, 7);
  assert.equal(snapshot.schedule.deadlines.value.at(-1).at.value, '2028-09-02T04:59:00.000Z');
  assert.ok(batch.evidence);
  assert.equal(batch.record.fields.canonicalSnapshot, undefined);
  assert.equal(Object.hasOwn(batch.record.fields, 'funderName'), false);
});

test('canonical ingestion is explicit and requires complete-detail enrichment mode', () => {
  assert.throws(() => createSource({ canonicalV2Enabled: true, fetchImpl: async () => {} }), TypeError);
  assert.throws(() => createSource({ canonicalV2Enabled: 'yes', enrichmentEnabled: true, fetchImpl: async () => {} }), TypeError);
});

test('discovery never turns a reduced search hit into a canonical snapshot', async () => {
  const port = source(raw(), { fetchImpl: async (_url, request) => {
    assert.equal(request.body.has('displayFields'), true); return new Response(JSON.stringify(raw()));
  } });
  const batch = await port.collect({ pageBudget: 1 });
  assert.equal(batch.canonicalSnapshot, undefined);
  assert.ok(batch.records.length);
  assert.ok(batch.records.every(record => record.canonicalSnapshot === undefined));
});

test('enriched lookup cannot authorize a missing status or a record outside the programme selection', async () => {
  const missing = raw(); delete missing.results[0].metadata.status;
  assert.equal((await source(missing).lookup({ externalIdentifier: 'CASCADE:11145' })).outcome, 'CONFLICT');
  assert.equal((await source().lookup({ externalIdentifier: 'CASCADE:11145', source: 'ERASMUS' })).outcome, 'ERROR');
});

test('conflicting money in full variants does not choose the first canonical candidate', async () => {
  const data = raw(); data.results.push(structuredClone(data.results[0])); data.totalResults = 2;
  data.results[1].metadata.budget = ['999999'];
  const batch = await source(data).lookup({ externalIdentifier: 'CASCADE:11145' });
  assert.equal(batch.outcome, 'CONFLICT');
  assert.deepEqual(batch.conflictReasons, ['CANONICAL_MAPPING_CONFLICT']);
  assert.equal(batch.record, undefined);
  assert.equal(batch.canonicalSnapshot, undefined);
  assert.ok(batch.evidence);
});

test('content and callTitle disagreement has a specific canonical cause', async () => {
  const data = raw(); data.results[0].metadata.callTitle = ['Different cascade title'];
  const batch = await source(data).lookup({ externalIdentifier: 'CASCADE:11145' });
  assert.equal(batch.outcome, 'CONFLICT');
  assert.deepEqual(batch.conflictReasons, ['CANONICAL_TITLE_CONFLICT']);
});

test('invalid or incomplete evidence cannot produce a canonical candidate', async () => {
  const missing = raw(); delete missing.results[0].metadata.DATASOURCE;
  const batch = await source(missing).lookup({ externalIdentifier: 'CASCADE:11145' });
  assert.equal(batch.outcome, 'ERROR');
  assert.equal(batch.record, undefined);
  assert.equal(batch.canonicalSnapshot, undefined);
});
