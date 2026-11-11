'use strict';
// Read-only operational preview. No source transition or candidate write.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('../backend/node_modules/pg');
const cfg = require('../backend/scripts/localPlatform/config');
const { workerHealth } = require('../backend/src/fundingTenders/workerHealth');
const { euWriterConfiguration } = require('../backend/src/fundingTenders/euWriter');
const { sourceState } = require('../backend/src/opportunities/v2/euSourceControl');

async function main(argv = process.argv.slice(2)) {
  assert.deepEqual(argv, []);
  const runtime = JSON.parse(fs.readFileSync(path.join(cfg.folder, 'runtime.json')));
  let heartbeat;
  try { heartbeat = JSON.parse(fs.readFileSync(path.join(cfg.folder, 'funding-worker-heartbeat.json'))); }
  catch { heartbeat = null; }
  const health = workerHealth(heartbeat, { installationId: runtime.installationId });
  const expected = euWriterConfiguration();
  const cfgValue = cfg.readConfig();
  const pool = new Pool({ ...cfg.connection(cfgValue, cfgValue.centralDatabase), max: 2,
    options: '-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=30000' });
  const client = await pool.connect();
  let report;
  try {
    const preflight = await require('../backend/src/security/centralMigrationPreflight').preflightCentral(pool);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const source = await sourceState(client, { mode: 'CANONICAL_V2', ...expected }, health.ready);
    const versions = (await client.query(`SELECT o.current_schema_version,count(*)::int AS count
      FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id)
      WHERE f.external_identifier !~ '^(POCTEP|INTERREG_EUROPE):'
      GROUP BY o.current_schema_version ORDER BY o.current_schema_version`)).rows;
    const legacy = (await client.query(`SELECT f.external_identifier FROM opportunity_catalog.funding_identity f
      JOIN opportunity_catalog.opportunity o USING(opportunity_id)
      WHERE o.current_schema_version=1 AND f.external_identifier !~ '^(POCTEP|INTERREG_EUROPE):'
      ORDER BY f.external_identifier`)).rows.map(r => r.external_identifier);
    await client.query('ROLLBACK');
    const capabilityMatch = health.euWriterSupported === true
      && health.euWriterPolicyVersion === expected.policyVersion
      && health.euWriterMappingDigest === expected.mappingDigest;
    report = { kind: 'eu-resume-readiness-v1', checkedAt: new Date().toISOString(), readOnly: true,
      databaseWrites: 0, centralVersion: preflight.currentVersion,
      source: { state: source.state, fence: source.fence, writerMode: source.writerMode,
        canResume: source.canResume, pendingRuns: source.pendingRuns,
        activeLeases: source.activeLeases, expiredPendingRuns: source.expiredPendingRuns,
        unrecoverablePendingRuns: source.unrecoverablePendingRuns },
      worker: { state: health.state, ready: health.ready, capabilityMatch,
        coverageSupported: health.coverageSupported, refreshSupported: health.refreshSupported,
        resolutionSupported: health.resolutionSupported, enrichmentSupported: health.enrichmentSupported,
        discoveryDetailSupported: health.discoveryDetailSupported },
      inventory: { versions, legacy } };
    report.status = preflight.currentVersion === '045_opportunity_eu_legacy_prearchive'
      && source.state === 'QUIESCED' && source.canResume && source.fence === 7
      && capabilityMatch && versions.some(v => v.current_schema_version === 2 && v.count === 529)
      && legacy.length === 7 ? 'READY_FOR_AUTHENTICATED_CONTROLLED_CYCLE' : 'HOLD';
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); await pool.end(); }
  const file = path.join(cfg.root, 'output', 'eu-resume-readiness-' + randomUUID() + '.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, report: path.relative(cfg.root, file).replaceAll('\\', '/'),
    source: report.source, worker: report.worker, inventory: report.inventory.versions, legacyCount: report.inventory.legacy.length }));
  return report;
}
if (require.main === module) main().catch(error => {
  console.error(/^[A-Z0-9_]{3,100}$/.test(error?.code || '') ? error.code : 'EU_RESUME_READINESS_FAILED');
  process.exitCode = 1;
});
module.exports = { main };
