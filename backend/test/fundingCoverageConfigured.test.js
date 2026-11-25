'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { configuredCoverage } = require('../src/fundingTenders/coverageConfig');

const central = Object.freeze({ FUNDING_TENDERS_RUNTIME: 'central', FUNDING_TENDERS_COVERAGE: 'durable-v1' });
const at = currentVersion => async () => ({ currentVersion });

// Regression: the production entry point never gave the funding routes a coverage configuration, so an
// administrative request could only collect one page even with FUNDING_TENDERS_COVERAGE=durable-v1.
test('coverage is read from the Central ledger only when the central funding runtime and a mode are configured', async () => {
  const never = async () => { throw new Error('the ledger must not be read'); };
  assert.equal(await configuredCoverage({ env: {}, pool: {}, preflight: never }), undefined);
  assert.equal(await configuredCoverage({ env: { FUNDING_TENDERS_RUNTIME: 'disabled', FUNDING_TENDERS_COVERAGE: 'durable-v1' }, pool: {}, preflight: never }), undefined);
  assert.equal(await configuredCoverage({ env: { FUNDING_TENDERS_RUNTIME: 'central' }, pool: {}, preflight: never }), undefined);
});

test('durable-v1 coverage is enabled with the abilities the Central version supports', async () => {
  const coverage = await configuredCoverage({ env: central, pool: {}, preflight: at('050_billing_private_documents') });
  assert.equal(coverage.supported, true);
  assert.equal(coverage.enabled, true);
  assert.equal(coverage.temporalSupported, true);
  assert.equal(coverage.resolutionSupported, true);
  const disabled = await configuredCoverage({ env: { ...central, FUNDING_TENDERS_COVERAGE: 'disabled' }, pool: {}, preflight: at('050_billing_private_documents') });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.supported, true);
});

// Regression (staging, 14/11/2026): with the Central at 052 the API and the collection worker refused to start with
// durable coverage, because 052 lives in its own chain and the version comparison only looked at the chain ending at 051.
test('a Central at 052 supports everything the earlier versions introduced', async () => {
  const { supportsCentralVersion } = require('../src/security/centralMigrationManifest');
  for (const introduced of ['015_funding_tenders_central', '018_official_programme_sources', '033_funding_coverage', '035_funding_source_resolution',
    '049_pt2030_document_upload', '051_email_templates', '052_central_runtime_read']) {
    assert.equal(supportsCentralVersion('052_central_runtime_read', introduced), true, introduced);
  }
  assert.equal(supportsCentralVersion('051_email_templates', '052_central_runtime_read'), false);
  const coverage = await configuredCoverage({ env: central, pool: {}, preflight: at('052_central_runtime_read') });
  assert.deepEqual(coverage, { supported: true, enabled: true, temporalSupported: true, resolutionSupported: true });
});

test('coverage that the Central cannot support or that is misconfigured is refused', async () => {
  await assert.rejects(() => configuredCoverage({ env: central, pool: {}, preflight: at('032_single_organization_membership') }), /FUNDING_COVERAGE_SCHEMA_REQUIRED/);
  await assert.rejects(() => configuredCoverage({ env: { ...central, FUNDING_TENDERS_COVERAGE: 'always' }, pool: {}, preflight: at('050_billing_private_documents') }), /FUNDING_COVERAGE_CONFIG_INVALID/);
  await assert.rejects(() => configuredCoverage({ env: { ...central, FUNDING_TENDERS_COVERAGE: 'disabled', FUNDING_TENDERS_ENRICHMENT: 'verified-v1' }, pool: {}, preflight: at('050_billing_private_documents') }),
    /FUNDING_ENRICHMENT_REQUIRES_COVERAGE_AND_RESOLUTION/);
  await assert.rejects(() => configuredCoverage({ env: central, pool: {}, preflight: async () => { throw new Error('PREFLIGHT_FAILED'); } }), /PREFLIGHT_FAILED/);
});
