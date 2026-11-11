'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { cloneData, deepFreeze, jsonbBytes } = require('../opportunities/v2/data');
const { contentDigestV2, compareSnapshotsV2, normalizers: n } = require('../opportunities/v2');
const { planPreviewDigest, adaptPlanRowV2 } = require('./planXlsxV2');
const { centralPreviewDigest } = require('./centralImport');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
const TRANSIENT = new Set(['40001', '40P01', '08006', 'ECONNRESET', '57P01']);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const hash = value => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
function fail(code = 'PT2030_CANDIDATE_INVALID') { throw Object.assign(new Error(code), { code }); }
function storageError(error) {
  if (typeof error?.code === 'string' && error.code.startsWith('PT2030_')) throw error;
  throw Object.assign(new Error('PT2030_ARCHIVE_UNAVAILABLE'), { code: TRANSIENT.has(error?.code) ? error.code : 'PT2030_ARCHIVE_UNAVAILABLE' });
}
function jsonbSize(value) {
  // JSONB adds one space per separator; all source numbers are retained as text.
  let extra = 0;
  function visit(item) {
    if (!item || typeof item !== 'object') return;
    const values = Object.values(item); extra += Math.max(0, values.length - 1) + (Array.isArray(item) ? 0 : values.length);
    values.forEach(visit);
  }
  visit(value); return Buffer.byteLength(JSON.stringify(value), 'utf8') + extra;
}
function checked(raw) {
  try {
    const input = cloneData(raw, { maxBytes: MAX_BUNDLE_BYTES + 16384 });
    if (!input || Object.keys(input).length !== 5 || !['userId', 'requestId', 'document', 'bundle', 'previewDigest'].every(key => Object.hasOwn(input, key))
      || !UUID.test(input.userId) || !UUID.test(input.requestId)) fail();
    const { document, bundle } = input;
    if (jsonbBytes(document) > 8192 || jsonbSize(bundle) > MAX_BUNDLE_BYTES
      || !Number.isSafeInteger(bundle.totalRows) || bundle.totalRows < 1
      || n.instant(bundle.observedAt) !== bundle.observedAt
      || planPreviewDigest(bundle) !== bundle.previewDigest
      || centralPreviewDigest(document, bundle) !== input.previewDigest) fail();
    const counts = new Map(), physicalRows = new Set();
    for (const row of bundle.rows) {
      if (!Number.isSafeInteger(row.physicalRow) || row.physicalRow <= bundle.headerRow || physicalRows.has(row.physicalRow)) fail();
      physicalRows.add(row.physicalRow);
      if (row.externalIdentifier !== null) counts.set(row.externalIdentifier, (counts.get(row.externalIdentifier) || 0) + 1);
    }
    let valid = 0;
    for (const row of bundle.rows) {
      let snapshot = null, externalIdentifier = null; const errors = [];
      try {
        if (row.sourceCells.A.value !== null) externalIdentifier = n.text(row.sourceCells.A.value, { maxLength: 128 });
        snapshot = adaptPlanRowV2(row.sourceCells, { physicalRow: row.physicalRow, sheetName: bundle.sheetName, filename: bundle.filename,
          observedAt: bundle.observedAt, documentModifiedAt: bundle.documentModifiedAt, fileDigest: bundle.fileDigest, dateSystem: bundle.dateSystem });
      } catch (error) { errors.push(error.code?.startsWith('PT2030_PLAN_') || error.code?.startsWith('OPPORTUNITY_V2_') ? error.code : 'PT2030_PLAN_ROW_INVALID'); }
      if (counts.get(externalIdentifier) > 1) { errors.push('PT2030_PLAN_DUPLICATE_ID'); snapshot = null; }
      if (externalIdentifier !== row.externalIdentifier || !isDeepStrictEqual(errors, row.errors) || !isDeepStrictEqual(snapshot, row.canonicalSnapshot)
        || jsonbBytes(row.sourceCells) > 262144 || jsonbBytes(row.errors) > 8192) fail();
      if (!errors.length) valid++;
    }
    if (valid !== bundle.validRows || bundle.totalRows - valid !== bundle.errorRows) fail();
    return deepFreeze(input);
  } catch { fail(); }
}
function intent(kind, input) { return hash({ kind, userId: input.userId, requestId: input.requestId, previewDigest: input.previewDigest }); }
function payloadDigest(input) { return hash({ document: input.document, bundle: input.bundle }); }
function previewResult(row, replayed) {
  return deepFreeze({ previewId: row.preview_id, requestId: row.request_id, previewDigest: row.preview_digest,
    totalRows: row.bundle.totalRows, validRows: row.bundle.validRows, errorRows: row.bundle.errorRows, replayed });
}
function verifyPreview(row) {
  try {
    if (!row || !UUID.test(row.preview_id)) fail();
    const input = checked({ userId: row.requested_by, requestId: row.request_id, document: row.document_binding, bundle: row.bundle, previewDigest: row.preview_digest });
    if (row.intent_digest !== intent('PREVIEW', input) || row.payload_digest !== payloadDigest(input)) fail();
    return input;
  } catch { fail('PT2030_PREVIEW_INVALID'); }
}
async function verifyReplay(client, row, input) {
  const result = cloneData(row.result, { maxBytes: 8192 });
  const fields = ['importId', 'previewId', 'previewDigest', 'requestId', 'totalRows', 'created', 'unchanged', 'changed', 'reviewRequired', 'rejected', 'replayed'];
  const counts = ['created', 'unchanged', 'changed', 'reviewRequired', 'rejected'];
  if (!result || Object.keys(result).length !== fields.length || fields.some(key => !Object.hasOwn(result, key))
    || !UUID.test(row.import_id) || !UUID.test(row.preview_id) || row.requested_by !== input.userId || row.request_id !== input.requestId
    || result.importId !== row.import_id || result.previewId !== row.preview_id || result.previewDigest !== row.preview_digest
    || result.requestId !== row.request_id || result.replayed !== false || result.totalRows !== input.bundle.totalRows
    || counts.some(key => !Number.isSafeInteger(result[key]) || result[key] < 0)
    || counts.reduce((sum, key) => sum + result[key], 0) !== result.totalRows || result.rejected !== input.bundle.errorRows) fail();
  const preview = (await client.query('SELECT * FROM opportunity_catalog.pt2030_plan_preview WHERE requested_by=$1 AND preview_id=$2', [input.userId, row.preview_id])).rows[0];
  const saved = verifyPreview(preview);
  if (saved.previewDigest !== input.previewDigest || !isDeepStrictEqual(saved.document, input.document)) fail();
  const observed = (await client.query('SELECT outcome,count(*)::int AS count FROM opportunity_catalog.pt2030_plan_observation WHERE import_id=$1 GROUP BY outcome', [row.import_id])).rows;
  const keys = { CREATED: 'created', UNCHANGED: 'unchanged', CANDIDATE_REVISION: 'changed', REVIEW_REQUIRED: 'reviewRequired', REJECTED: 'rejected' };
  const summary = Object.fromEntries(counts.map(key => [key, 0]));
  for (const item of observed) {
    if (!Object.hasOwn(keys, item.outcome) || !Number.isSafeInteger(item.count) || item.count < 1 || summary[keys[item.outcome]] !== 0) fail();
    summary[keys[item.outcome]] = item.count;
  }
  if (counts.some(key => result[key] !== summary[key])) fail();
  return deepFreeze({ ...result, replayed: true });
}

// These methods run inside the parent's transaction and live C4G-authority lock.
// The validated document port and parser are the only producers of these bundles.
// No tenant pool, accepted catalog writer or document download exists here.
function createPlanCandidateArchive({ audit } = {}) {
  if (typeof audit !== 'function') throw new TypeError('Central candidate audit port is required.');
  return Object.freeze({
    async savePreview(client, raw) {
      const input = checked(raw), digest = intent('PREVIEW', input);
      try {
        const inserted = await client.query('INSERT INTO opportunity_catalog.pt2030_plan_preview(preview_id,requested_by,request_id,preview_digest,intent_digest,document_binding,bundle,payload_digest) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) ON CONFLICT(requested_by,request_id) DO NOTHING RETURNING *',
          [randomUUID(), input.userId, input.requestId, input.previewDigest, digest, JSON.stringify(input.document), JSON.stringify(input.bundle), payloadDigest(input)]);
        const row = inserted.rows[0] || (await client.query('SELECT * FROM opportunity_catalog.pt2030_plan_preview WHERE requested_by=$1 AND request_id=$2', [input.userId, input.requestId])).rows[0];
        if (!row || row.intent_digest !== digest) fail('PT2030_IDEMPOTENCY_CONFLICT');
        verifyPreview(row);
        if (inserted.rowCount === 1) await audit(client, { actor: { type: 'HUMAN', id: input.userId }, eventCode: 'OPPORTUNITY_IMPORT_UPLOADED', requestId: `pt2030:preview:${input.userId}:${input.requestId}`, detailCode: 'PT2030_PREVIEW_ARCHIVED' });
        return previewResult(row, inserted.rowCount !== 1);
      } catch (error) { storageError(error); }
    },

    async stage(client, raw) {
      const input = checked(raw), digest = intent('STAGE', input), { userId, requestId, bundle } = input;
      try {
        // Bound concurrency before checking replay or advancing any candidate head.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('PT2030_PLAN_CANDIDATES',150003))");
        const replay = (await client.query('SELECT * FROM opportunity_catalog.pt2030_plan_import WHERE requested_by=$1 AND request_id=$2', [userId, requestId])).rows[0];
        if (replay) {
          if (replay.intent_digest !== digest || replay.preview_digest !== input.previewDigest) fail('PT2030_IDEMPOTENCY_CONFLICT');
          return await verifyReplay(client, replay, input);
        }
        const preview = (await client.query('SELECT * FROM opportunity_catalog.pt2030_plan_preview WHERE requested_by=$1 AND preview_digest=$2 ORDER BY recorded_at DESC,preview_id DESC LIMIT 1', [userId, input.previewDigest])).rows[0];
        if (!preview) fail('PT2030_PREVIEW_REQUIRED');
        const saved = verifyPreview(preview);
        if (saved.previewDigest !== input.previewDigest || !isDeepStrictEqual(saved.document, input.document) || saved.bundle.previewDigest !== bundle.previewDigest) fail('PT2030_PREVIEW_INVALID');

        const importId = randomUUID(), outcomes = [];
        const result = { importId, previewId: preview.preview_id, previewDigest: input.previewDigest, requestId,
          totalRows: bundle.totalRows, created: 0, unchanged: 0, changed: 0, reviewRequired: 0, rejected: 0, replayed: false };
        for (const row of bundle.rows) {
          let outcome = 'REJECTED', revisionId = null;
          if (row.errors.length) result.rejected++;
          else {
            await client.query('INSERT INTO opportunity_catalog.pt2030_plan_identity(external_identifier) VALUES($1) ON CONFLICT DO NOTHING', [row.externalIdentifier]);
            const head = (await client.query('SELECT i.*,r.canonical_snapshot,r.content_digest,r.revision_number AS head_revision_number FROM opportunity_catalog.pt2030_plan_identity i LEFT JOIN opportunity_catalog.pt2030_plan_revision r ON r.revision_id=i.latest_revision_id AND r.external_identifier=i.external_identifier WHERE i.external_identifier=$1 FOR UPDATE OF i', [row.externalIdentifier])).rows[0];
            if (!head || !Number.isSafeInteger(head.revision_number) || head.revision_number < 0) fail();
            let comparison = { action: 'CREATED', changedFields: [], reasonCodes: [] };
            if (head.latest_revision_id) {
              if (head.head_revision_number !== head.revision_number || contentDigestV2(head.canonical_snapshot) !== head.content_digest) fail();
              const diff = compareSnapshotsV2(head.canonical_snapshot, row.canonicalSnapshot);
              if (!diff.sameIdentity) fail();
              const { acceptedSnapshot, candidateSnapshot, ...details } = diff; comparison = details;
            } else if (head.revision_number !== 0) fail();
            if (comparison.action === 'UNCHANGED') { revisionId = head.latest_revision_id; outcome = 'UNCHANGED'; result.unchanged++; }
            else {
              outcome = comparison.action; revisionId = randomUUID();
              const nextNumber = head.revision_number + 1;
              if (!Number.isSafeInteger(nextNumber) || nextNumber > 2147483647 || jsonbBytes(comparison) > 65536) fail();
              await client.query('INSERT INTO opportunity_catalog.pt2030_plan_revision(revision_id,external_identifier,revision_number,previous_revision_id,content_digest,canonical_snapshot,comparison,review_required,observed_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)',
                [revisionId, row.externalIdentifier, nextNumber, head.latest_revision_id, row.contentDigest, JSON.stringify(row.canonicalSnapshot), JSON.stringify(comparison), outcome === 'REVIEW_REQUIRED', bundle.observedAt]);
              const advanced = await client.query('UPDATE opportunity_catalog.pt2030_plan_identity SET latest_revision_id=$2,revision_number=$3 WHERE external_identifier=$1 AND revision_number=$4 RETURNING external_identifier', [row.externalIdentifier, revisionId, nextNumber, head.revision_number]);
              if (advanced.rowCount !== 1) fail('PT2030_CANDIDATE_CONCURRENT_CHANGE');
              if (outcome === 'CREATED') result.created++;
              else if (outcome === 'REVIEW_REQUIRED') result.reviewRequired++;
              else result.changed++;
            }
          }
          outcomes.push({ row, outcome, revisionId });
        }
        if (result.created + result.unchanged + result.changed + result.reviewRequired + result.rejected !== result.totalRows) fail();
        await client.query('INSERT INTO opportunity_catalog.pt2030_plan_import(import_id,requested_by,request_id,preview_id,preview_digest,intent_digest,observed_at,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
          [importId, userId, requestId, preview.preview_id, input.previewDigest, digest, bundle.observedAt, JSON.stringify(result)]);
        for (const { row, outcome, revisionId } of outcomes) await client.query('INSERT INTO opportunity_catalog.pt2030_plan_observation(import_id,physical_row,external_identifier,source_columns_digest,source_cells,candidate_revision_id,outcome,errors) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb)',
          [importId, row.physicalRow, row.externalIdentifier, row.sourceColumnsDigest, JSON.stringify(row.sourceCells), revisionId, outcome, JSON.stringify(row.errors)]);
        await audit(client, { actor: { type: 'HUMAN', id: userId }, eventCode: 'OPPORTUNITY_IMPORT_CONFIRMED', requestId: `pt2030:stage:${userId}:${requestId}`, detailCode: 'PT2030_CANDIDATES_STAGED' });
        return deepFreeze(result);
      } catch (error) { storageError(error); }
    }
  });
}

module.exports = { createPlanCandidateArchive, MAX_BUNDLE_BYTES };
