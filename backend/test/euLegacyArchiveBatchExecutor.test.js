'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEuLegacyArchiveBatchExecutor } = require('../src/opportunities/v2/euLegacyArchiveBatchExecutor');

const id = index => `EU-${String(index).padStart(3, '0')}`;
const uuid = index => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
function fixture({ stopAt = -1, missingEvent = false, expired = false } = {}) {
  const receipts = Array.from({ length: 391 }, (_, index) => ({
    packageId: uuid(500), externalIdentifier: id(index), itemDigest: String(index).padStart(64, 'a'),
    eventId: uuid(index) }));
  const receiptExport = { packageId: uuid(500), receipts };
  const committed = new Map();
  let calls = 0;
  const pool = { async query(sql) {
    if (sql.includes('eu_source_control_v2')) return { rows: [{ state: 'QUIESCED', fence: 7, eu_writer_mode: 'CANONICAL_V2' }] };
    if (sql.includes('to_regprocedure')) return { rows: [{ installed: true }] };
    if (sql.includes('FROM audit.event')) return { rows: receipts.slice(0, missingEvent ? 390 : 391).map(r => ({ event_id: r.eventId })) };
    if (sql.includes('FROM opportunity_catalog.funding_candidate_v2 c')) return { rows: [...committed.values()] };
    throw Error('Unexpected query');
  } };
  const executor = { async executeOne(receipt) {
    calls++;
    if (calls - 1 === stopAt) throw Object.assign(Error('STOP'), { code: 'STOP' });
    const previous = committed.has(receipt.eventId);
    const result = { status: previous ? 'ALREADY_ARCHIVED' : 'ARCHIVED',
      runId: receipt.eventId, externalIdentifier: receipt.externalIdentifier,
      contentDigest: 'c'.repeat(64), payloadDigest: 'd'.repeat(64) };
    committed.set(receipt.eventId, { run_id: receipt.eventId, event_id: receipt.eventId,
      external_identifier: receipt.externalIdentifier, content_digest: result.contentDigest,
      payload_digest: result.payloadDigest, permitted_content: result.contentDigest,
      permitted_payload: result.payloadDigest });
    return result;
  } };
  const batch = createEuLegacyArchiveBatchExecutor({ pool, executor,
    validate: () => ({ eligible: 391, receipts: 391, missing: 0, expired, ledgerVerified: false }),
    load: (_, packageId) => ({ plan: { packageId }, binding: { sourceFence: 7 } }),
    matches: (receipt, _, event) => receipt.eventId === event?.event_id });
  return { batch, receiptExport, committed, calls: () => calls };
}

test('closed batch reconciles exactly 391 candidates and permits', async () => {
  const f = fixture();
  assert.deepEqual(await f.batch.preflight(f.receiptExport), { packageId: f.receiptExport.packageId,
    receipts: 391, matchedEvents: 391, sourceFence: 7, requireSqlGate: false });
  assert.equal(f.calls(), 0);
  assert.deepEqual(await f.batch.execute(f.receiptExport), { status: 'ARCHIVED_AND_RECONCILED',
    packageId: f.receiptExport.packageId, archived: 391, alreadyArchived: 0,
    candidates: 391, sourceFence: 7 });
  assert.equal(f.committed.size, 391);
  assert.equal((await f.batch.execute(f.receiptExport)).alreadyArchived, 391);
});

test('a partial failure stops and the same receipts resume from durable identity checkpoints', async () => {
  const f = fixture({ stopAt: 139 });
  await assert.rejects(f.batch.execute(f.receiptExport), { code: 'STOP' });
  assert.equal(f.committed.size, 139);
  const result = await f.batch.execute(f.receiptExport);
  assert.equal(result.alreadyArchived, 139);
  assert.equal(result.archived, 252);
  assert.equal(f.committed.size, 391);
});

test('missing ledger event or expired package refuses before an archive', async () => {
  for (const options of [{ missingEvent: true }, { expired: true }]) {
    const f = fixture(options);
    await assert.rejects(f.batch.execute(f.receiptExport));
    assert.equal(f.calls(), 0);
  }
});
