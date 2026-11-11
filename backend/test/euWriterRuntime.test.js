'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { euWriterRuntimeEnvironment } = require('../scripts/localPlatform/euWriterRuntime');
const { workerHealth } = require('../src/fundingTenders/workerHealth');
test('EU local selection stays disabled without a descriptor and rejects incomplete or accessor descriptors', () => {
  assert.deepEqual(euWriterRuntimeEnvironment({}, {}), { OPPORTUNITY_EU_WRITER: 'disabled' });
  for (const descriptor of [null, {}, true, 'canonical-v2', { packageId: 'opportunity-eu-writer-v2' }]) {
    assert.throws(() => euWriterRuntimeEnvironment({ opportunityEuWriter: descriptor }, {}), /LOCAL_EU_WRITER_CONFIGURATION_INVALID/);
  }
  const state = {}; let touched = false;
  Object.defineProperty(state, 'opportunityEuWriter', { get() { touched = true; return {}; } });
  assert.throws(() => euWriterRuntimeEnvironment(state, {}), /LOCAL_EU_WRITER_CONFIGURATION_INVALID/);
  assert.equal(touched, false);
});
test('heartbeat publishes the complete bounded writer capability, never a partial or unrelated installation proof', () => {
  const now = Date.now(), options = { now, installationId: 'synthetic' }, heartbeat = { at: now, installationId: 'synthetic',
    mode: 'PROCESSING', lastPollAt: now, consecutiveFailures: 0, euWriterSupported: true,
    euWriterPolicyVersion: 'eu-existing-v2.0', euWriterMappingDigest: 'a'.repeat(64) };
  const actual = workerHealth(heartbeat, options);
  assert.equal(actual.ready, true); assert.equal(actual.euWriterSupported, true);
  assert.equal(actual.euWriterMappingDigest, heartbeat.euWriterMappingDigest);
  for (const mutation of [{ installationId: 'other' }, { euWriterMappingDigest: 'untrusted' }, { euWriterPolicyVersion: 'other' }, { euWriterSupported: 'true' }]) {
    assert.equal(workerHealth({ ...heartbeat, ...mutation }, options).euWriterSupported, undefined);
  }
  assert.equal(workerHealth({ ...heartbeat, at: now - 11000 }, options).ready, false);
});
test('local writer opt-in binds the actual mapping and requires prior authenticated activation and durable funding', () => {
  const capability = require('../src/fundingTenders/euWriter').euWriterConfiguration();
  const state = { opportunityEuWriter: { packageId: 'opportunity-eu-writer-v2', ...capability },
    funding: { source: 'live-local', coverage: 'durable-v1' } };
  const activation = { OPPORTUNITY_ACTIVATION_RUNTIME: 'authenticated-v2' }, before = structuredClone(state);
  assert.deepEqual(euWriterRuntimeEnvironment(state, activation), { OPPORTUNITY_EU_WRITER: 'canonical-v2', FUNDING_TENDERS_ENRICHMENT: 'verified-v1' });
  assert.deepEqual(state, before);
  for (const mutate of [s => { s.opportunityEuWriter.mappingDigest = 'f'.repeat(64); }, s => { s.opportunityEuWriter.policyVersion = 'other'; },
    s => { s.opportunityEuWriter.extra = true; }, s => { s.funding.coverage = 'disabled'; }, s => { delete s.funding; }]) {
    const changed = structuredClone(state); mutate(changed);
    assert.throws(() => euWriterRuntimeEnvironment(changed, activation), /LOCAL_EU_WRITER_CONFIGURATION_INVALID/);
  }
  assert.throws(() => euWriterRuntimeEnvironment(state, {}), /LOCAL_EU_WRITER_CONFIGURATION_INVALID/);
});
