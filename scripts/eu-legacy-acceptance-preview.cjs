'use strict';
// Read-only preview of the 391 archived EU candidates and seven exclusions.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { Pool } = require('../backend/node_modules/pg');
const cfg = require('../backend/scripts/localPlatform/config');
const { createCandidateArchiveV2 } = require('../backend/src/fundingTenders/candidateRepositoryV2');
const { previewReconciliation } = require('../backend/src/opportunities/v2/reconciliation');
const { implementationDigest, hash } = require('../backend/src/opportunities/v2/activationArchive');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = file => path.relative(cfg.root, file).replaceAll('\\', '/');
async function main(argv = process.argv.slice(2)) {
  assert(argv.length === 1 && path.isAbsolute(argv[0]));
  const bytes = fs.readFileSync(argv[0]);
  assert.equal(sha(bytes), '141d242c4804ea75a0ba3cae9cb83e2e122061e8f455ed8315930f254ac94b6e');
  const receipts = JSON.parse(bytes.toString('utf8'));
  assert.equal(receipts.receipts.length, 391);
  const plan = JSON.parse(fs.readFileSync(path.join(cfg.root, 'output', `eu-legacy-preapproval-${receipts.packageId}`, 'plan.json')));
  const previewBytes = fs.readFileSync(path.join(cfg.root, plan.preview.path));
  assert.equal(sha(previewBytes), plan.preview.sha256);
  const previous = JSON.parse(previewBytes);
  const config = cfg.readConfig();
  const pool = new Pool({ ...cfg.connection(config, config.centralDatabase), max: 1,
    options: '-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=30000' });
  const client = await pool.connect();
  let report;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const state = (await client.query("SELECT state,fence,eu_writer_mode FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS'")).rows[0];
    assert.equal(state.state, 'QUIESCED'); assert.equal(Number(state.fence), 7);
    const ids = previous.entries.map(entry => entry.externalIdentifier);
    const heads = (await client.query(`SELECT f.external_identifier,f.corrections,f.conflicts,
      o.opportunity_id,o.current_revision_id,o.row_version,o.current_schema_version,o.lifecycle_state,r.snapshot,
      (SELECT count(*)::int FROM opportunity_catalog.funding_resolution d WHERE d.opportunity_id=o.opportunity_id) resolution_count
      FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id)
      JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id
      WHERE f.external_identifier=ANY($1::text[])`, [ids])).rows;
    assert.equal(heads.length, 398);
    const byId = new Map(heads.map(row => [row.external_identifier, row]));
    const archive = createCandidateArchiveV2({ workspaceRoot: cfg.root });
    const receiptById = new Map(receipts.receipts.map(receipt => [receipt.externalIdentifier, receipt]));
    assert.equal(receiptById.size, 391);
    const entries = [];
    for (const prior of previous.entries) {
      const head = byId.get(prior.externalIdentifier);
      assert(head && head.opportunity_id === prior.expected.opportunityId
        && head.current_revision_id === prior.expected.revisionId
        && Number(head.row_version) === prior.expected.rowVersion
        && head.current_schema_version === 1 && head.lifecycle_state === 'ACTIVE');
      const receipt = receiptById.get(prior.externalIdentifier);
      if (!receipt) {
        assert.equal(prior.action, 'NO_CANDIDATE');
        entries.push({ externalIdentifier: prior.externalIdentifier, action: 'NO_CANDIDATE',
          reasonCodes: prior.reasonCodes, expected: prior.expected });
        continue;
      }
      assert.equal(prior.action, 'CHANGE_REQUIRES_APPROVAL');
      const run = (await client.query('SELECT * FROM opportunity_catalog.funding_run WHERE run_id=$1', [receipt.eventId])).rows[0];
      assert(run && run.status === 'ERROR' && run.error_code === 'EU_LEGACY_PREARCHIVE_STAGING');
      const stored = await archive.verify(client, { run, externalIdentifier: prior.externalIdentifier, required: true });
      assert.equal(stored.contentDigest, prior.contentDigest);
      const locator = { kind: 'FUNDING', runId: receipt.eventId, externalIdentifier: prior.externalIdentifier };
      const mappingDigest = implementationDigest('EU_FUNDING_TENDERS', stored.canonicalSnapshot.provenance.mappingVersion);
      const accepted = { opportunityId: head.opportunity_id, revisionId: head.current_revision_id,
        rowVersion: Number(head.row_version), snapshot: head.snapshot,
        identities: [{ namespace: 'EU_FUNDING_TENDERS', externalId: prior.externalIdentifier }],
        mappingDigest: null, corrections: head.corrections || {},
        resolutions: head.resolution_count ? [{ count: head.resolution_count }] : [], privateReferences: [] };
      const candidateId = 'funding:' + hash(locator);
      const comparison = previewReconciliation({ accepted: [accepted], candidates: [{ candidateId,
        snapshot: stored.canonicalSnapshot, mappingDigest }] });
      const decision = comparison.items[0];
      assert.equal(decision.action, 'CHANGE_REQUIRES_APPROVAL');
      entries.push({ externalIdentifier: prior.externalIdentifier, action: decision.action,
        reasonCodes: decision.reasonCodes, expected: prior.expected, archive: locator,
        candidateId, contentDigest: stored.contentDigest, payloadDigest: stored.payloadDigest,
        mappingDigest, previewDigest: comparison.previewDigest, itemDigest: decision.itemDigest,
        title: prior.title, amount: prior.amount, deadlineCount: prior.deadlineCount,
        status: prior.status, programmeCodes: prior.programmeCodes });
    }
    assert.equal(entries.filter(entry => entry.action === 'CHANGE_REQUIRES_APPROVAL').length, 391);
    assert.equal(entries.filter(entry => entry.action === 'NO_CANDIDATE').length, 7);
    report = { kind: 'eu-legacy-acceptance-preview-v1', generatedAt: new Date().toISOString(),
      status: 'REVIEW_ONLY', readOnly: true, databaseWrites: 0,
      sourceControl: state, receiptSha256: sha(bytes), priorPreview: { path: plan.preview.path, sha256: plan.preview.sha256 },
      scope: { heads: 398, candidates: 391, conflictsExcluded: 7 }, entries };
    await client.query('ROLLBACK');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); await pool.end(); }
  const file = path.join(cfg.root, 'output', `eu-legacy-acceptance-preview-${randomUUID()}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, file: relative(file), ...report.scope,
    source: report.sourceControl.state, fence: report.sourceControl.fence, databaseWrites: 0 }));
}
if (require.main === module) main().catch(error => {
  console.error(/^[A-Z0-9_]{3,100}$/.test(error?.code || '') ? error.code : 'EU_LEGACY_ACCEPTANCE_PREVIEW_FAILED');
  process.exitCode = 1;
});
module.exports = { main };
