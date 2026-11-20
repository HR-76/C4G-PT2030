'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const snapshot = require('../../context/references/opportunity-v2/examples/pt2030-8614.json');
const asOf = '2026-11-01T12:00:00.000Z';

// Reloads the read model and its temporal projection with the snapshot validator counted.
function withCountedValidation(work) {
  const paths = ['../src/opportunities/v2/validation', '../src/opportunities/v2/temporal', '../src/opportunities/v2/readModel'].map(name => require.resolve(name));
  const validation = require(paths[0]), original = validation.validateSnapshotV2, held = paths.slice(1).map(path => require.cache[path]);
  let calls = 0;
  validation.validateSnapshotV2 = input => { calls++; return original(input); };
  for (const path of paths.slice(1)) delete require.cache[path];
  try { return work(require(paths[2]), require(paths[1]), () => calls); }
  finally {
    validation.validateSnapshotV2 = original;
    paths.slice(1).forEach((path, index) => { delete require.cache[path]; if (held[index]) require.cache[path] = held[index]; });
  }
}

test('a read model built from an already validated snapshot does not validate it again', () => {
  const { prepareOpportunitySnapshot } = require('../src/opportunities/v2/readModel');
  const prepared = prepareOpportunitySnapshot(snapshot);
  withCountedValidation((readModel, temporal, calls) => {
    const model = readModel.createOpportunityReadModel(snapshot, { revisionId: null, asOf, prepared });
    assert.equal(calls(), 0);
    // Exactly the temporal facts the validating projection gives for the same snapshot and instant.
    assert.deepEqual(model.temporal, { ...temporal.projectTemporalV2(snapshot, { asOf }) });
    assert.equal(calls(), 1);
  });
});

test('the read model is the same with and without a prepared snapshot, at several instants', () => {
  const { createOpportunityReadModel, prepareOpportunitySnapshot } = require('../src/opportunities/v2/readModel');
  const prepared = prepareOpportunitySnapshot(snapshot);
  for (const instant of ['2020-01-01T00:00:00.000Z', asOf, '2035-06-30T23:59:59.000Z'])
    assert.deepEqual(createOpportunityReadModel(snapshot, { asOf: instant, prepared }), createOpportunityReadModel(snapshot, { asOf: instant }));
});

test('a prepared value that is not the frozen result of the validator is validated before use', () => {
  const { prepareOpportunitySnapshot } = require('../src/opportunities/v2/readModel');
  const prepared = prepareOpportunitySnapshot(snapshot);
  withCountedValidation((readModel, temporal, calls) => {
    const loose = { ...prepared, snapshot: structuredClone(prepared.snapshot) };
    readModel.createOpportunityReadModel(snapshot, { asOf, prepared: loose });
    assert.equal(calls(), 1);
    const broken = { ...prepared, snapshot: { ...structuredClone(prepared.snapshot), schemaVersion: 3 } };
    assert.throws(() => readModel.createOpportunityReadModel(snapshot, { asOf, prepared: broken }));
  });
});
