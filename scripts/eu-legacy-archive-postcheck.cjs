'use strict';
// Read-only habitual reconciliation after the 391-item candidate archive.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Pool } = require('../backend/node_modules/pg');
const cfg = require('../backend/scripts/localPlatform/config');
const { createEuLegacyArchiveBatchExecutor } = require('../backend/src/opportunities/v2/euLegacyArchiveBatchExecutor');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function main(argv = process.argv.slice(2)) {
  assert(argv.length === 1 && path.isAbsolute(argv[0]));
  const bytes = fs.readFileSync(argv[0]);
  assert.equal(sha(bytes), '141d242c4804ea75a0ba3cae9cb83e2e122061e8f455ed8315930f254ac94b6e');
  const exportValue = JSON.parse(bytes);
  const plan = JSON.parse(fs.readFileSync(path.join(cfg.root, 'output',
    `eu-legacy-preapproval-${exportValue.packageId}`, 'plan.json')));
  const previewBytes = fs.readFileSync(path.join(cfg.root, plan.preview.path));
  assert.equal(sha(previewBytes), plan.preview.sha256);
  const preview = JSON.parse(previewBytes);
  const config = cfg.readConfig();
  const pool = new Pool({ ...cfg.connection(config, config.centralDatabase), max: 1,
    options: '-c default_transaction_read_only=on -c statement_timeout=30000' });
  try {
    const preflight = await createEuLegacyArchiveBatchExecutor({ pool, workspaceRoot: cfg.root,
      executor: { executeOne() { throw Error('READ_ONLY'); } } })
      .preflight(exportValue, { requireSqlGate: true });
    const ids = preview.entries.map(item => item.externalIdentifier);
    const heads = (await pool.query(`SELECT f.external_identifier,o.opportunity_id,o.current_revision_id,
      o.row_version,o.current_schema_version,o.lifecycle_state
      FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id)
      WHERE f.external_identifier=ANY($1::text[])`, [ids])).rows;
    assert.equal(heads.length, 398);
    const byId = new Map(heads.map(row => [row.external_identifier, row]));
    for (const item of preview.entries) {
      const row = byId.get(item.externalIdentifier);
      assert(row);
      assert.equal(row.opportunity_id, item.expected.opportunityId);
      assert.equal(row.current_revision_id, item.expected.revisionId);
      assert.equal(Number(row.row_version), item.expected.rowVersion);
      assert.equal(row.current_schema_version, 1);
      assert.equal(row.lifecycle_state, 'ACTIVE');
    }
    const events = exportValue.receipts.map(receipt => receipt.eventId);
    const archived = (await pool.query(`SELECT c.run_id,c.external_identifier,c.content_digest,c.payload_digest,
      p.event_id,p.content_digest AS permit_content,p.payload_digest AS permit_payload,
      r.status,r.error_code
      FROM opportunity_catalog.funding_candidate_v2 c
      JOIN opportunity_catalog.eu_legacy_prearchive_use_v1 p
        ON p.run_id=c.run_id AND p.external_identifier=c.external_identifier
      JOIN opportunity_catalog.funding_run r ON r.run_id=c.run_id
      WHERE c.run_id=ANY($1::uuid[])`, [events])).rows;
    assert.equal(archived.length, 391);
    const seen = new Map();
    for (const row of archived) {
      assert.equal(row.run_id, row.event_id);
      assert.equal(row.content_digest, row.permit_content);
      assert.equal(row.payload_digest, row.permit_payload);
      assert.equal(row.status, 'ERROR');
      assert.equal(row.error_code, 'EU_LEGACY_PREARCHIVE_STAGING');
      assert(!seen.has(row.external_identifier));
      seen.set(row.external_identifier, row);
    }
    for (const item of preview.entries) {
      if (item.action === 'CHANGE_REQUIRES_APPROVAL') assert.equal(seen.get(item.externalIdentifier)?.content_digest, item.contentDigest);
      else assert(!seen.has(item.externalIdentifier));
    }
    const version = (await pool.query('SELECT version FROM public.c4g_schema_migration ORDER BY version DESC LIMIT 1')).rows[0].version;
    assert.equal(version, '045_opportunity_eu_legacy_prearchive');
    console.log(JSON.stringify({ status: 'PASS', checkedAt: new Date().toISOString(),
      packageId: exportValue.packageId, receiptSha256: sha(bytes), migration: version,
      headsPreserved: heads.length, candidates: seen.size, permits: archived.length,
      conflictsExcluded: preview.entries.length - seen.size, sourceFence: preflight.sourceFence,
      sourceState: 'QUIESCED', databaseWrites: 0 }));
  } finally { await pool.end(); }
}
if (require.main === module) main().catch(error => {
  console.error(/^[A-Z0-9_]{3,100}$/.test(error?.code || '') ? error.code : 'EU_LEGACY_ARCHIVE_POSTCHECK_FAILED');
  process.exitCode = 1;
});
module.exports = { main };
