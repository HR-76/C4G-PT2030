'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { labelFunder, labelledEuSource, FIXTURE_FUNDER, STAGING_FUNDER } = require('../src/fundingTenders/funderLabel');

const record = fields => ({ externalIdentifier: 'EXAMPLE-1', fields });
const source = { collect: async () => ({ received: 2, records: [record({ title: 'A' }), record({ title: 'B', funderName: 'Financiador real' })] }),
  lookup: async ({ id }) => id ? { record: record({ title: 'A' }) } : { record: null } };

// Regression: the Funding & Tenders API gives no funder and the v1 contract requires one, so every real record failed with
// OPPORTUNITY_INVALID_INPUT. The label must add a funder without ever replacing one the source supplied.
test('the label fills a missing funder and never replaces one the source supplied', async () => {
  const labelled = labelFunder(source, STAGING_FUNDER);
  const batch = await labelled.collect({});
  assert.equal(batch.received, 2);
  assert.equal(batch.records[0].fields.funderName, STAGING_FUNDER);
  assert.equal(batch.records[1].fields.funderName, 'Financiador real');
  assert.equal((await labelled.lookup({ id: 1 })).record.fields.funderName, STAGING_FUNDER);
  assert.equal((await labelled.lookup({ id: 0 })).record, null);
});

test('only the fixture rehearsal and the staging test environment label the source', () => {
  const pick = (mode, live, canonicalWriter = false) => labelledEuSource({ source, mode, live, canonicalWriter });
  assert.notEqual(pick('fixture', false), source);
  assert.notEqual(pick('live-staging', true), source);
  for (const mode of ['live-local', 'live-demo', 'live-rehearsal']) assert.equal(pick(mode, true), source, mode);
  // The canonical v2 writer takes the record as the source gave it.
  assert.equal(pick('live-staging', true, true), source);
});

test('the labels say where they come from', async () => {
  assert.match(FIXTURE_FUNDER, /sintético/);
  assert.match(STAGING_FUNDER, /não indicado pela fonte/);
});
