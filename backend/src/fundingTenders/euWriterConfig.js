'use strict';
function euWriterEnabled(env = {}) {
  const selection = env.OPPORTUNITY_EU_WRITER ?? 'disabled';
  if (!['disabled', 'canonical-v2'].includes(selection)) throw Error('EU_WRITER_CONFIGURATION_INVALID');
  if (selection === 'disabled') return false;
  if (env.OPPORTUNITY_ACTIVATION_RUNTIME !== 'authenticated-v2' || env.FUNDING_TENDERS_RUNTIME !== 'central'
      || env.FUNDING_TENDERS_COVERAGE !== 'durable-v1' || env.FUNDING_TENDERS_ENRICHMENT !== 'verified-v1') {
    throw Error('EU_WRITER_CONFIGURATION_INVALID');
  }
  return true;
}
function configuredEuWriter(env) {
  return euWriterEnabled(env) ? require('./euWriter').euWriterConfiguration() : null;
}
async function assertEuWriterCapability(pool, currentVersion) {
  if (!['043_opportunity_eu_writer_v2','044_opportunity_eu_expired_reconciliation',
    '045_opportunity_eu_legacy_prearchive'].includes(currentVersion)) throw Error('EU_WRITER_SCHEMA_REQUIRED');
  const row = (await pool.query(`SELECT to_regclass('opportunity_catalog.eu_writer_decision_v2') IS NOT NULL
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='opportunity_catalog'
      AND table_name='funding_run' AND column_name='eu_writer_mode') AS ready`)).rows[0];
  if (row?.ready !== true) throw Error('EU_WRITER_SCHEMA_REQUIRED');
  return true;
}
module.exports = { euWriterEnabled, configuredEuWriter, assertEuWriterCapability };
