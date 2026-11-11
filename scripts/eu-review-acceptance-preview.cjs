'use strict';
// Read-only preview of the older 137 EU REVIEW candidates. No catalog write.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { Pool } = require('../backend/node_modules/pg');
const cfg = require('../backend/scripts/localPlatform/config');
const { createCandidateArchiveV2 } = require('../backend/src/fundingTenders/candidateRepositoryV2');
const { previewReconciliation } = require('../backend/src/opportunities/v2/reconciliation');
const { implementationDigest, hash } = require('../backend/src/opportunities/v2/activationArchive');
const CYCLE = '7266ad6b-8880-4ec1-9399-4751187831c5';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = file => path.relative(cfg.root, file).replaceAll('\\', '/');

async function main() {
  const config = cfg.readConfig();
  const pool = new Pool({ ...cfg.connection(config, config.centralDatabase), max: 1,
    options: '-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=30000' });
  const client = await pool.connect();
  let report;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const control = (await client.query("SELECT state,fence,eu_writer_mode FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS'")).rows[0];
    assert.equal(control?.state, 'QUIESCED'); assert.equal(Number(control.fence), 7);
    assert.equal(control.eu_writer_mode, 'CANONICAL_V2');
    const rows = (await client.query(`SELECT d.run_id,d.external_identifier,d.decision,d.reason_codes,
      d.payload_digest,r.status AS run_status,r.source_code,r.limited,r.canonical_v2_required,
      r.observed_at,f.opportunity_id,f.corrections,f.conflicts,
      o.current_revision_id,o.row_version,o.current_schema_version,o.lifecycle_state,h.snapshot,
      (SELECT count(*)::int FROM opportunity_catalog.funding_resolution x WHERE x.opportunity_id=o.opportunity_id) AS resolution_count
      FROM opportunity_catalog.eu_writer_decision_v2 d
      JOIN opportunity_catalog.funding_batch b USING(run_id)
      JOIN opportunity_catalog.funding_run r USING(run_id)
      JOIN opportunity_catalog.funding_identity f USING(external_identifier)
      JOIN opportunity_catalog.opportunity o ON o.opportunity_id=f.opportunity_id
      JOIN opportunity_catalog.revision h ON h.revision_id=o.current_revision_id
      WHERE b.cycle_id=$1 AND d.decision='REVIEW' ORDER BY d.external_identifier`, [CYCLE])).rows;
    assert.equal(rows.length, 137);
    assert.equal(new Set(rows.map(r => r.external_identifier)).size, 137);
    const archive = createCandidateArchiveV2({ workspaceRoot: cfg.root });
    const entries = [];
    for (const row of rows) {
      assert.equal(row.run_status, 'SUCCESS'); assert.equal(row.limited, false);
      assert.equal(row.canonical_v2_required, true);
      assert.equal(row.source_code, 'EU_FUNDING_TENDERS');
      assert.equal(row.current_schema_version, 1); assert.equal(row.lifecycle_state, 'ACTIVE');
      assert.deepEqual(row.reason_codes, ['LEGACY_MIGRATION_REQUIRES_REVIEW', 'MAPPING_BASELINE_UNAVAILABLE']);
      const run = { run_id: row.run_id, source_code: row.source_code, observed_at: row.observed_at };
      const stored = await archive.verify(client, { run, externalIdentifier: row.external_identifier, required: true });
      assert.equal(stored.payloadDigest, row.payload_digest);
      const locator = { kind: 'FUNDING', runId: row.run_id, externalIdentifier: row.external_identifier };
      const mappingDigest = implementationDigest(row.source_code, stored.canonicalSnapshot.provenance.mappingVersion);
      const candidateId = 'funding:' + hash(locator);
      const accepted = { opportunityId: row.opportunity_id, revisionId: row.current_revision_id,
        rowVersion: Number(row.row_version), snapshot: row.snapshot,
        identities: [{ namespace: 'EU_FUNDING_TENDERS', externalId: row.external_identifier }],
        mappingDigest: null, corrections: row.corrections || {},
        resolutions: row.resolution_count ? [{ count: row.resolution_count }] : [], privateReferences: [] };
      const comparison = previewReconciliation({ accepted: [accepted], candidates: [{ candidateId,
        snapshot: stored.canonicalSnapshot, mappingDigest }] });
      const decision = comparison.items[0];
      assert.equal(decision.action, 'CHANGE_REQUIRES_APPROVAL');
      const snapshot = stored.canonicalSnapshot;
      entries.push({ externalIdentifier: row.external_identifier, action: decision.action,
        reasonCodes: decision.reasonCodes, expected: { opportunityId: row.opportunity_id,
          revisionId: row.current_revision_id, rowVersion: Number(row.row_version) },
        archive: locator, candidateId, contentDigest: stored.contentDigest,
        payloadDigest: stored.payloadDigest, mappingDigest,
        previewDigest: comparison.previewDigest, itemDigest: decision.itemDigest,
        title: snapshot.description.title.value,
        amount: (snapshot.financing.allocations.value || []).map(a => ({ amount: a.money.amount,
          currencyState: a.money.currency.state, scope: a.scope })),
        deadlineCount: snapshot.schedule.deadlines.value?.length || 0,
        status: snapshot.status.published.value,
        programmeCodes: snapshot.programmes.value?.map(p => p.code) || [] });
    }
    assert.equal(new Set(entries.map(e => e.itemDigest)).size, 137);
    report = { kind: 'eu-review-acceptance-preview-v1', generatedAt: new Date().toISOString(),
      status: 'REVIEW_ONLY', readOnly: true, databaseWrites: 0, cycleId: CYCLE,
      sourceControl: control, scope: { heads: 137, candidates: 137, conflictsExcluded: 7 }, entries };
    await client.query('ROLLBACK');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); await pool.end(); }
  const file = path.join(cfg.root, 'output', `eu-review-acceptance-preview-${randomUUID()}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, file: relative(file), ...report.scope,
    source: report.sourceControl.state, fence: Number(report.sourceControl.fence), databaseWrites: 0 }));
  return report;
}
if (require.main === module) main().catch(error => {
  console.error(/^[A-Z0-9_]{3,100}$/.test(error?.code || '') ? error.code : 'EU_REVIEW_ACCEPTANCE_PREVIEW_FAILED');
  process.exitCode = 1;
});
module.exports = { main };
