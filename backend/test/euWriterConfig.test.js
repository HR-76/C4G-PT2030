'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { euWriterEnabled, configuredEuWriter, assertEuWriterCapability } = require('../src/fundingTenders/euWriterConfig');

test('EU writer defaults disabled; unsupported and partially configured selections fail closed', () => {
  assert.equal(euWriterEnabled({}), false);
  assert.equal(configuredEuWriter({}), null);
  for (const env of [{ OPPORTUNITY_EU_WRITER: true }, { OPPORTUNITY_EU_WRITER: 'v2' },
    { OPPORTUNITY_EU_WRITER: 'canonical-v2' },
    { OPPORTUNITY_EU_WRITER: 'canonical-v2', OPPORTUNITY_ACTIVATION_RUNTIME: 'authenticated-v2' },
    { OPPORTUNITY_EU_WRITER: 'canonical-v2', OPPORTUNITY_ACTIVATION_RUNTIME: 'authenticated-v2', FUNDING_TENDERS_COVERAGE: 'durable-v1' }]) {
    assert.throws(() => euWriterEnabled(env), /EU_WRITER_CONFIGURATION_INVALID/);
  }
});
test('EU writer selection requires the separate central worker and verified enriched coverage', () => {
  const env = { OPPORTUNITY_EU_WRITER: 'canonical-v2', OPPORTUNITY_ACTIVATION_RUNTIME: 'authenticated-v2',
    FUNDING_TENDERS_RUNTIME: 'central', FUNDING_TENDERS_COVERAGE: 'durable-v1', FUNDING_TENDERS_ENRICHMENT: 'verified-v1' };
  assert.equal(euWriterEnabled(env), true);
  assert.deepEqual(configuredEuWriter(env), require('../src/fundingTenders/euWriter').euWriterConfiguration());
  for (const key of ['FUNDING_TENDERS_RUNTIME', 'FUNDING_TENDERS_COVERAGE', 'FUNDING_TENDERS_ENRICHMENT']) {
    assert.throws(() => euWriterEnabled({ ...env, [key]: 'disabled' }), /EU_WRITER_CONFIGURATION_INVALID/);
  }
});
test('configured writer requires the registered043 database capability without accepting042', async () => {
  let called = 0;
  const pool = { async query() { called++; return { rows: [{ ready: true }] }; } };
  await assert.rejects(assertEuWriterCapability(pool, '042_opportunity_eu_source_control_v2'), /EU_WRITER_SCHEMA_REQUIRED/);
  assert.equal(called, 0);
  assert.equal(await assertEuWriterCapability(pool, '043_opportunity_eu_writer_v2'), true);
  await assert.rejects(assertEuWriterCapability({ query: async () => ({ rows: [{ ready: false }] }) }, '043_opportunity_eu_writer_v2'), /EU_WRITER_SCHEMA_REQUIRED/);
});
