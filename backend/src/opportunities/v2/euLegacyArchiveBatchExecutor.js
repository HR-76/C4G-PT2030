'use strict';
// Closed, sequential 391-item archive. The database candidate is the durable checkpoint.
const { createEuLegacyArchiveExecutor } = require('./euLegacyArchiveExecutor');
const { loadPackage } = require('./euLegacyPreapproval');
const { validateReceiptExport } = require('../../../../scripts/eu-legacy-receipts-check.cjs');
const { receiptMatchesEvent } = require('../../../../scripts/eu-legacy-ledger-reconcile.cjs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../../..');

function fail(code = 'EU_LEGACY_ARCHIVE_BATCH_REFUSED') {
  throw Object.assign(new Error(code), { code });
}
function createEuLegacyArchiveBatchExecutor({ pool, workspaceRoot = ROOT, executor,
  validate = validateReceiptExport, load = loadPackage, matches = receiptMatchesEvent } = {}) {
  if (!pool?.query || !path.isAbsolute(workspaceRoot) || typeof validate !== 'function' || typeof load !== 'function'
    || typeof matches !== 'function') throw new TypeError('Legacy batch executor dependencies invalid.');
  const archive = executor || createEuLegacyArchiveExecutor({ pool, workspaceRoot });
  if (typeof archive.executeOne !== 'function') throw new TypeError('Legacy identity executor invalid.');

  async function assertSource(fence) {
    const source = (await pool.query("SELECT state,fence,eu_writer_mode FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS'")).rows[0];
    if (source?.state !== 'QUIESCED' || Number(source.fence) !== fence
      || source.eu_writer_mode !== 'CANONICAL_V2') fail('EU_LEGACY_ARCHIVE_SOURCE_CHANGED');
  }
  async function preflight(receiptExport, { requireSqlGate = false } = {}) {
    const checked = validate(receiptExport, { root: workspaceRoot, allowPartial: false });
    if (checked.eligible !== 391 || checked.receipts !== 391 || checked.missing !== 0
      || checked.expired || checked.ledgerVerified !== false) fail();
    const receipts = receiptExport.receipts;
    if (!Array.isArray(receipts) || receipts.length !== 391
      || new Set(receipts.map(item => item.externalIdentifier)).size !== 391
      || new Set(receipts.map(item => item.eventId)).size !== 391) fail();
    const loaded = receipts.map(receipt => load(workspaceRoot, receipt.packageId, receipt.itemDigest));
    if (new Set(loaded.map(item => item.binding.sourceFence)).size !== 1
      || new Set(loaded.map(item => item.plan.packageId)).size !== 1
      || loaded[0].plan.packageId !== receiptExport.packageId) fail();
    const fence = loaded[0].binding.sourceFence;
    await assertSource(fence);
    if (requireSqlGate) {
      const gate = (await pool.query("SELECT to_regprocedure('opportunity_catalog.authorize_eu_legacy_prearchive_v1(uuid,text,uuid,uuid,text,text,text,text,uuid,uuid,integer,integer,timestamptz,timestamptz,text,text)') IS NOT NULL AS installed")).rows[0];
      if (gate?.installed !== true) fail('EU_LEGACY_ARCHIVE_SQL_045_MISSING');
    }
    const events = (await pool.query(`SELECT event_id,event_hash,actor_type,actor_id,organization_id,tenant_id,
      ledger_location,stream_id,stream_type,event_code,audit_class,event_data,accepted_at
      FROM audit.event WHERE event_id=ANY($1::uuid[])`, [receipts.map(receipt => receipt.eventId)])).rows;
    if (events.length !== 391) fail('EU_LEGACY_ARCHIVE_LEDGER_MISMATCH');
    const byId = new Map(events.map(event => [event.event_id, event]));
    if (byId.size !== 391 || receipts.some((receipt, index) =>
      !matches(receipt, loaded[index], byId.get(receipt.eventId)))) fail('EU_LEGACY_ARCHIVE_LEDGER_MISMATCH');
    return Object.freeze({ packageId: receiptExport.packageId, receipts: 391,
      matchedEvents: 391, sourceFence: fence, requireSqlGate });
  }
  async function execute(receiptExport) {
    const prepared = await preflight(receiptExport, { requireSqlGate: true });
    const receipts = receiptExport.receipts;
    const fence = prepared.sourceFence;
    const completed = [];
    for (const receipt of receipts) {
      await assertSource(fence);
      const result = await archive.executeOne(receipt);
      if (!['ARCHIVED', 'ALREADY_ARCHIVED'].includes(result.status)
        || result.runId !== receipt.eventId || result.externalIdentifier !== receipt.externalIdentifier)
        fail('EU_LEGACY_ARCHIVE_CHECKPOINT_MISMATCH');
      completed.push(result);
    }
    const rows = (await pool.query(`SELECT c.run_id,c.external_identifier,c.content_digest,c.payload_digest,
      p.event_id,p.content_digest AS permitted_content,p.payload_digest AS permitted_payload
      FROM opportunity_catalog.funding_candidate_v2 c
      JOIN opportunity_catalog.eu_legacy_prearchive_use_v1 p
        ON p.run_id=c.run_id AND p.external_identifier=c.external_identifier
      WHERE c.run_id=ANY($1::uuid[])`, [receipts.map(receipt => receipt.eventId)])).rows;
    const persisted = new Map(rows.map(row => [row.run_id, row]));
    if (rows.length !== 391 || persisted.size !== 391
      || completed.some(result => {
        const row = persisted.get(result.runId);
        return !row || row.event_id !== result.runId
          || row.external_identifier !== result.externalIdentifier
          || row.content_digest !== result.contentDigest || row.payload_digest !== result.payloadDigest
          || row.permitted_content !== result.contentDigest || row.permitted_payload !== result.payloadDigest;
      })) fail('EU_LEGACY_ARCHIVE_CHECKPOINT_MISMATCH');
    await assertSource(fence);
    return Object.freeze({ status: 'ARCHIVED_AND_RECONCILED', packageId: receiptExport.packageId,
      archived: completed.filter(result => result.status === 'ARCHIVED').length,
      alreadyArchived: completed.filter(result => result.status === 'ALREADY_ARCHIVED').length,
      candidates: persisted.size, sourceFence: fence });
  }
  return Object.freeze({ preflight, execute });
}
module.exports = { createEuLegacyArchiveBatchExecutor };
