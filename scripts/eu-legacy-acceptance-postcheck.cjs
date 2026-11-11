'use strict';
// Read-only, resumable reconciliation of the 391 OIDC acceptance outcomes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Pool } = require('../backend/node_modules/pg');
const cfg = require('../backend/scripts/localPlatform/config');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function main(argv = process.argv.slice(2)) {
  assert.equal(argv.length, 1);
  assert.match(argv[0], /^[a-f0-9-]{36}$/);
  const packageId = argv[0];
  const plan = JSON.parse(fs.readFileSync(path.join(cfg.root, 'output',
    `eu-legacy-acceptance-${packageId}`, 'plan.json')));
  assert.equal(plan.packageId, packageId);
  const bytes = fs.readFileSync(path.join(cfg.root, plan.preview.path));
  assert.equal(sha(bytes), plan.preview.sha256);
  const preview = JSON.parse(bytes);
  const review = plan.kind === 'eu-review-acceptance-package-v1';
  assert(['eu-review-acceptance-package-v1', 'eu-legacy-acceptance-package-v1'].includes(plan.kind));
  assert.equal(preview.entries.length, review ? 137 : 398);
  const config = cfg.readConfig();
  const pool = new Pool({ ...cfg.connection(config, config.centralDatabase), max: 1,
    options: '-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=30000' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const control = (await client.query("SELECT state,fence FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS'")).rows[0];
    assert.equal(control.state, 'QUIESCED'); assert.equal(Number(control.fence), 7);
    const ids = preview.entries.map(e => e.externalIdentifier);
    const heads = (await client.query(`SELECT f.external_identifier,o.opportunity_id,o.current_revision_id,
      o.row_version,o.current_schema_version,o.content_digest,o.lifecycle_state,
      r.content_digest AS revision_digest,r.snapshot
      FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id)
      JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id
      WHERE f.external_identifier=ANY($1::text[])`, [ids])).rows;
    assert.equal(heads.length, review ? 137 : 398);
    const receipts = (await client.query(`SELECT a.opportunity_id,a.revision_id,a.mapping_digest,
      a.result,a.request_id
      FROM opportunity_catalog.accepted_receipt_v2 a
      WHERE a.opportunity_id=ANY($1::uuid[])`, [heads.map(h => h.opportunity_id)])).rows;
    const acceptedRevisionIds = heads.filter(h => h.current_schema_version === 2).map(h => h.current_revision_id);
    const allocations = (await client.query(`SELECT revision_id,allocation_key,payload,
      amount_canonical,currency_state,currency_code
      FROM opportunity_catalog.revision_allocation_v2 WHERE revision_id=ANY($1::uuid[])
      ORDER BY revision_id,allocation_key`, [acceptedRevisionIds])).rows;
    const deadlines = (await client.query(`SELECT revision_id,ordinal,payload
      FROM opportunity_catalog.revision_deadline_v2 WHERE revision_id=ANY($1::uuid[])
      ORDER BY revision_id,ordinal`, [acceptedRevisionIds])).rows;
    const planRows = (await client.query(`SELECT p.plan_id,p.source_code,p.archive_locator,p.expected,
      p.preview_digest,p.state,p.approved_by,d.decision,d.actor_id AS decision_actor
      FROM opportunity_catalog.activation_plan_v2 p
      LEFT JOIN opportunity_catalog.activation_decision_v2 d
        ON d.plan_id=p.plan_id AND d.decision='APPROVED'
      WHERE p.source_code='EU_FUNDING_TENDERS'
        AND p.archive_locator->>'runId'=ANY($1::text[])`,
    [preview.entries.filter(e => e.action === 'CHANGE_REQUIRES_APPROVAL').map(e => e.archive.runId)])).rows;
    const byId = new Map(heads.map(h => [h.external_identifier, h]));
    const byRevision = new Map();
    const allocationByRevision = new Map(), deadlineByRevision = new Map();
    for (const a of allocations) {
      if (!allocationByRevision.has(a.revision_id)) allocationByRevision.set(a.revision_id, []);
      allocationByRevision.get(a.revision_id).push(a);
    }
    for (const d of deadlines) {
      if (!deadlineByRevision.has(d.revision_id)) deadlineByRevision.set(d.revision_id, []);
      deadlineByRevision.get(d.revision_id).push(d);
    }
    const plansByIdentifier = new Map();
    for (const p of planRows) {
      const identifier = p.archive_locator?.externalIdentifier;
      if (!plansByIdentifier.has(identifier)) plansByIdentifier.set(identifier, []);
      plansByIdentifier.get(identifier).push(p);
    }
    for (const r of receipts) {
      const key = r.opportunity_id + ':' + r.revision_id;
      if (!byRevision.has(key)) byRevision.set(key, []);
      byRevision.get(key).push(r);
    }
    let accepted = 0, pending = 0, conflictsExcluded = 0;
    for (const item of preview.entries) {
      const h = byId.get(item.externalIdentifier);
      assert(h && h.opportunity_id === item.expected.opportunityId && h.lifecycle_state === 'ACTIVE');
      if (item.action === 'NO_CANDIDATE') {
        assert.equal(h.current_schema_version, 1);
        assert.equal(h.current_revision_id, item.expected.revisionId);
        assert.equal(Number(h.row_version), item.expected.rowVersion);
        conflictsExcluded++; continue;
      }
      if (h.current_schema_version === 1) {
        assert.equal(h.current_revision_id, item.expected.revisionId);
        assert.equal(Number(h.row_version), item.expected.rowVersion);
        pending++; continue;
      }
      assert.equal(h.current_schema_version, 2);
      assert.equal(h.content_digest, item.contentDigest);
      assert.equal(h.revision_digest, item.contentDigest);
      assert.equal(Number(h.row_version), item.expected.rowVersion + 1);
      const expectedAllocations = h.snapshot.financing.allocations.state === 'PRESENT'
        ? [...h.snapshot.financing.allocations.value].sort((a, b) => a.key.localeCompare(b.key)) : [];
      const storedAllocations = allocationByRevision.get(h.current_revision_id) || [];
      assert.equal(storedAllocations.length, expectedAllocations.length);
      for (let i = 0; i < expectedAllocations.length; i++) {
        const expected = expectedAllocations[i], stored = storedAllocations[i];
        assert.equal(stored.allocation_key, expected.key);
        assert.deepEqual(stored.payload, expected);
        assert.equal(String(stored.amount_canonical), String(expected.money.amount));
        assert.equal(stored.currency_state, expected.money.currency.state);
        assert.equal(stored.currency_code, expected.money.currency.value);
      }
      const expectedDeadlines = h.snapshot.schedule.deadlines.state === 'PRESENT'
        ? h.snapshot.schedule.deadlines.value : [];
      const storedDeadlines = deadlineByRevision.get(h.current_revision_id) || [];
      assert.equal(storedDeadlines.length, expectedDeadlines.length);
      assert.equal(expectedDeadlines.length, item.deadlineCount);
      for (let i = 0; i < expectedDeadlines.length; i++) {
        assert.equal(storedDeadlines[i].ordinal, i);
        assert.deepEqual(storedDeadlines[i].payload, expectedDeadlines[i]);
      }
      const matching = (byRevision.get(h.opportunity_id + ':' + h.current_revision_id) || [])
        .filter(r => r.mapping_digest === item.mappingDigest && r.result?.action === 'REVISION_CREATED'
          && r.result?.sourceVersion === 2 && r.result?.contentDigest === item.contentDigest);
      assert.equal(matching.length, 1);
      const plans = (plansByIdentifier.get(item.externalIdentifier) || []).filter(p =>
        p.archive_locator.runId === item.archive.runId
        && p.preview_digest === item.previewDigest
        && p.expected?.opportunityId === item.expected.opportunityId
        && p.expected?.revisionId === item.expected.revisionId
        && Number(p.expected?.rowVersion) === item.expected.rowVersion
        && p.state === 'APPROVED' && p.approved_by && p.decision === 'APPROVED'
        && p.decision_actor === p.approved_by);
      assert.equal(plans.length, 1);
      accepted++;
    }
    assert.equal(accepted + pending, review ? 137 : 391);
    assert.equal(conflictsExcluded, review ? 0 : 7);
    await client.query('ROLLBACK');
    const report = { status: 'PASS', packageId, checkedAt: new Date().toISOString(),
      profile: review ? 'EU_REVIEW_137' : 'EU_LEGACY_391',
      accepted, pending, conflictsExcluded, approvedPlansVerified: accepted,
      allocationsVerified: allocations.length, deadlinesVerified: deadlines.length, sourceState: control.state,
      sourceFence: Number(control.fence), databaseWrites: 0 };
    console.log(JSON.stringify(report));
    return report;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); await pool.end(); }
}
if (require.main === module) main().catch(error => {
  console.error(/^[A-Z0-9_]{3,100}$/.test(error?.code || '') ? error.code : 'EU_LEGACY_ACCEPTANCE_POSTCHECK_FAILED');
  process.exitCode = 1;
});
module.exports = { main };
