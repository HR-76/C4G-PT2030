'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createPlanCandidateArchive } = require('../src/portugal2030/candidateArchive');
const { inspectPlanXlsxV2, planPreviewDigest, sourceColumnsDigest, adaptPlanRowV2 } = require('../src/portugal2030/planXlsxV2');
const { contentDigestV2 } = require('../src/opportunities/v2');
const { centralPreviewDigest } = require('../src/portugal2030/centralImport');
const { createCentralPortugal2030CandidateComposition } = require('../src/portugal2030/composition');

const filename = 'PlanoAnualAvisos_download_140926-1.xlsx';
const observedAt = '2026-10-30T23:00:00.000Z';
let corpus;
async function input() {
  corpus ||= inspectPlanXlsxV2(fs.readFileSync(path.join(__dirname, 'fixtures/portugal2030', filename)), { sheetName: 'Sheet1', filename, observedAt });
  const bundle = structuredClone(await corpus);
  // The archive's unit fixture isolates one identity; the full corpus is covered
  // by the parser and composed pipeline tests, without reading Desktop in CI.
  bundle.rows = bundle.rows.slice(0, 1); bundle.totalRows = 1; bundle.validRows = 1; bundle.errorRows = 0;
  bundle.previewDigest = planPreviewDigest(bundle);
  const document = { authority: 'CENTRAL', organizationId: null, documentId: randomUUID(), documentVersionId: randomUUID(), filename,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sizeBytes: 65667, sha256: bundle.fileDigest };
  return { userId: randomUUID(), requestId: randomUUID(), document, bundle, previewDigest: centralPreviewDigest(document, bundle) };
}
function changed(original, amount = '510001') {
  const next = structuredClone(original), row = next.bundle.rows[0];
  next.requestId = randomUUID(); next.document.documentVersionId = randomUUID();
  row.sourceCells.H.value = amount; row.sourceCells.H.rawValue = amount;
  row.sourceColumnsDigest = sourceColumnsDigest(row.sourceCells, row.physicalRow);
  row.canonicalSnapshot = adaptPlanRowV2(row.sourceCells, { physicalRow: row.physicalRow, sheetName: next.bundle.sheetName, filename,
    observedAt: next.bundle.observedAt, fileDigest: next.bundle.fileDigest, documentModifiedAt: next.bundle.documentModifiedAt, dateSystem: next.bundle.dateSystem });
  row.contentDigest = contentDigestV2(row.canonicalSnapshot);
  next.bundle.previewDigest = planPreviewDigest(next.bundle); next.previewDigest = centralPreviewDigest(next.document, next.bundle);
  return next;
}
function fixture() {
  const state = { previews: [], imports: [], revisions: [], observations: [], identities: new Map(), audits: [], queries: [], stale: false };
  const client = { release() {}, async query(sql, p = []) {
    state.queries.push(sql);
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.startsWith('SET LOCAL')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM public.global_user') || sql.includes('FROM public.platform_admin_assignment')) return { rows: state.revoked ? [] : [{ id: p[0] }], rowCount: state.revoked ? 0 : 1 };
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('INSERT INTO opportunity_catalog.pt2030_plan_preview')) {
      if (state.previews.some(x => x.requested_by === p[1] && x.request_id === p[2])) return { rows: [], rowCount: 0 };
      const row = { preview_id: p[0], requested_by: p[1], request_id: p[2], preview_digest: p[3], intent_digest: p[4], document_binding: JSON.parse(p[5]), bundle: JSON.parse(p[6]), payload_digest: p[7] };
      state.previews.push(row); return { rows: [row], rowCount: 1 };
    }
    if (sql.startsWith('SELECT * FROM opportunity_catalog.pt2030_plan_preview')) return { rows: state.previews.filter(x => x.requested_by === p[0] && (sql.includes('request_id=$2') ? x.request_id === p[1] : sql.includes('preview_id=$2') ? x.preview_id === p[1] : x.preview_digest === p[1])).slice(-1), rowCount: 1 };
    if (sql.startsWith('SELECT * FROM opportunity_catalog.pt2030_plan_import')) return { rows: state.imports.filter(x => x.requested_by === p[0] && x.request_id === p[1]), rowCount: 1 };
    if (sql.startsWith('SELECT outcome,count(*)::int AS count')) { const counts = new Map(); for (const row of state.observations.filter(x => x[0] === p[0])) counts.set(row[6], (counts.get(row[6]) || 0) + 1); return { rows: [...counts].map(([outcome, count]) => ({ outcome, count })) }; }
    if (sql.startsWith('INSERT INTO opportunity_catalog.pt2030_plan_identity')) { if (!state.identities.has(p[0])) state.identities.set(p[0], { external_identifier: p[0], revision_number: 0, latest_revision_id: null }); return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('SELECT i.*,r.canonical_snapshot')) { const identity = state.identities.get(p[0]); const revision = state.revisions.find(x => x.revision_id === identity?.latest_revision_id); return { rows: identity ? [{ ...identity, canonical_snapshot: revision?.canonical_snapshot, content_digest: revision?.content_digest, head_revision_number: revision?.revision_number }] : [], rowCount: identity ? 1 : 0 }; }
    if (sql.startsWith('INSERT INTO opportunity_catalog.pt2030_plan_revision')) { state.revisions.push({ revision_id: p[0], external_identifier: p[1], revision_number: p[2], previous_revision_id: p[3], content_digest: p[4], canonical_snapshot: JSON.parse(p[5]), comparison: JSON.parse(p[6]), review_required: p[7] }); return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('UPDATE opportunity_catalog.pt2030_plan_identity')) { const row = state.identities.get(p[0]); if (state.stale || row.revision_number !== p[3]) return { rows: [], rowCount: 0 }; row.latest_revision_id = p[1]; row.revision_number = p[2]; return { rows: [row], rowCount: 1 }; }
    if (sql.startsWith('INSERT INTO opportunity_catalog.pt2030_plan_import')) { const row = { import_id: p[0], requested_by: p[1], request_id: p[2], preview_id: p[3], preview_digest: p[4], intent_digest: p[5], observed_at: p[6], result: JSON.parse(p[7]) }; state.imports.push(row); return { rows: [row], rowCount: 1 }; }
    if (sql.startsWith('INSERT INTO opportunity_catalog.pt2030_plan_observation')) { state.observations.push(p); return { rows: [], rowCount: 1 }; }
    throw new Error('Unexpected query: ' + sql);
  } };
  const archive = createPlanCandidateArchive({ audit: async (_client, event) => state.audits.push(event) });
  return { state, client, archive };
}

test('PT central candidate archive requires a persisted preview and never a catalogue identity', async () => {
  const f = fixture(), value = await input();
  await assert.rejects(f.archive.stage(f.client, value), { code: 'PT2030_PREVIEW_REQUIRED' });
  await f.archive.savePreview(f.client, value);
  const result = await f.archive.stage(f.client, { ...value, requestId: randomUUID() });
  assert.equal(result.created, 1); assert.equal(result.totalRows, 1); assert.equal(f.state.observations.length, 1);
  assert.equal(f.state.revisions[0].canonical_snapshot.publication.value, 'PLANNED');
  assert.equal(f.state.queries.some(sql => /tenant|funding_identity|INSERT INTO opportunity_catalog\.opportunity\b|BEGIN|COMMIT/.test(sql)), false);
  assert.equal(f.state.audits.length, 2);
});

test('PT candidate replay is immutable and a new observation of the same content creates no revision', async () => {
  const f = fixture(), value = await input(); await f.archive.savePreview(f.client, value);
  const command = { ...value, requestId: randomUUID() };
  const first = await f.archive.stage(f.client, command), replay = await f.archive.stage(f.client, command);
  assert.equal(replay.replayed, true); assert.equal(replay.importId, first.importId); assert.equal(f.state.revisions.length, 1); assert.equal(f.state.observations.length, 1);
  const same = await f.archive.stage(f.client, { ...command, requestId: randomUUID() });
  assert.equal(same.unchanged, 1); assert.equal(f.state.revisions.length, 1); assert.equal(f.state.observations.length, 2);
  const other = changed(value); await f.archive.savePreview(f.client, other);
  await assert.rejects(f.archive.stage(f.client, { ...other, requestId: command.requestId }), { code: 'PT2030_IDEMPOTENCY_CONFLICT' });
});

test('PT material changes append candidate revisions and preserve all prior source evidence', async () => {
  const f = fixture(), first = await input(); await f.archive.savePreview(f.client, first); await f.archive.stage(f.client, { ...first, requestId: randomUUID() });
  const next = changed(first); await f.archive.savePreview(f.client, next);
  const result = await f.archive.stage(f.client, { ...next, requestId: randomUUID() });
  assert.equal(result.changed, 1); assert.equal(f.state.revisions.length, 2);
  assert.equal(f.state.revisions[1].previous_revision_id, f.state.revisions[0].revision_id);
  assert.equal(f.state.revisions[0].canonical_snapshot.financing.allocations.value[0].money.amount, '510000');
  assert.equal(f.state.revisions[1].canonical_snapshot.financing.allocations.value[0].money.amount, '510001');
});

test('PT loss of a previously observed amount is a review candidate, never an accepted overwrite', async () => {
  const f = fixture(), first = await input(); await f.archive.savePreview(f.client, first); await f.archive.stage(f.client, { ...first, requestId: randomUUID() });
  const next = changed(first, null); await f.archive.savePreview(f.client, next);
  const result = await f.archive.stage(f.client, { ...next, requestId: randomUUID() });
  assert.equal(result.reviewRequired, 1); assert.equal(result.changed, 0);
  assert.equal(f.state.revisions[1].review_required, true);
  assert.equal(f.state.revisions[0].canonical_snapshot.financing.allocations.value[0].money.amount, '510000');
  assert.equal(f.state.revisions[1].comparison.canReplaceAccepted, false);
});

test('PT invalid rows remain fully accounted for without creating a candidate identity', async () => {
  const f = fixture(), value = await input(), row = value.bundle.rows[0];
  row.sourceCells.D.value = ''; row.sourceCells.D.rawValue = '';
  row.sourceColumnsDigest = sourceColumnsDigest(row.sourceCells, row.physicalRow);
  row.canonicalSnapshot = null; row.contentDigest = null; row.errors = ['PT2030_PLAN_ID_TITLE_REQUIRED'];
  value.bundle.validRows = 0; value.bundle.errorRows = 1;
  value.bundle.previewDigest = planPreviewDigest(value.bundle); value.previewDigest = centralPreviewDigest(value.document, value.bundle);
  await f.archive.savePreview(f.client, value);
  const result = await f.archive.stage(f.client, { ...value, requestId: randomUUID() });
  assert.equal(result.rejected, 1); assert.equal(result.totalRows, 1);
  assert.equal(f.state.identities.size, 0); assert.equal(f.state.revisions.length, 0);
  assert.equal(f.state.observations[0][6], 'REJECTED');
  assert.deepEqual(JSON.parse(f.state.observations[0][4]), row.sourceCells);
});

test('PT archived previews, snapshots, row hashes and document bindings are revalidated', async () => {
  for (const mode of ['snapshot', 'hash', 'document', 'stored', 'raw', 'style', 'observation']) {
    const f = fixture(), value = await input(); await f.archive.savePreview(f.client, value);
    if (mode === 'snapshot') { value.bundle.rows[0].canonicalSnapshot.description.title.value = 'Forged title'; value.bundle.rows[0].contentDigest = contentDigestV2(value.bundle.rows[0].canonicalSnapshot); value.bundle.previewDigest = planPreviewDigest(value.bundle); value.previewDigest = centralPreviewDigest(value.document, value.bundle); }
    if (mode === 'hash') value.bundle.rows[0].sourceColumnsDigest = 'f'.repeat(64);
    if (mode === 'document') value.document.organizationId = randomUUID();
    if (mode === 'stored') f.state.previews[0].bundle.rows[0].canonicalSnapshot.description.title.value = 'Stored tamper';
    if (mode === 'raw') f.state.previews[0].bundle.rows[0].sourceCells.H.rawValue = '999999';
    if (mode === 'style') f.state.previews[0].bundle.rows[0].sourceCells.H.styleIndex = 0;
    if (mode === 'observation') { const saved = f.state.previews[0].bundle; saved.observedAt = '2026-10-31T01:00:00.000Z'; saved.rows[0].canonicalSnapshot.provenance.observations[0].observedAt = saved.observedAt; }
    await assert.rejects(f.archive.stage(f.client, { ...value, requestId: randomUUID() }), error => ['PT2030_CANDIDATE_INVALID', 'PT2030_PREVIEW_INVALID'].includes(error.code), mode);
    assert.equal(f.state.revisions.length, 0, mode);
  }
});

test('PT compare-and-swap failures and unavailable SQL fail closed with bounded errors', async () => {
  const f = fixture(), value = await input(); await f.archive.savePreview(f.client, value); f.state.stale = true;
  await assert.rejects(f.archive.stage(f.client, value), { code: 'PT2030_CANDIDATE_CONCURRENT_CHANGE' });
  const failing = { query: async () => { throw Object.assign(new Error('private connection details'), { code: '42501' }); } };
  await assert.rejects(f.archive.savePreview(failing, value), error => error.code === 'PT2030_ARCHIVE_UNAVAILABLE' && !error.message.includes('private'));
});

test('PT durable receipt counts and candidate head numbers cannot drift on replay or update', async () => {
  for (const mode of ['receipt', 'observations', 'head']) {
    const f = fixture(), value = await input(); await f.archive.savePreview(f.client, value);
    const command = { ...value, requestId: randomUUID() }; await f.archive.stage(f.client, command);
    if (mode === 'receipt') f.state.imports[0].result.created = 999;
    if (mode === 'observations') f.state.observations.length = 0;
    if (mode === 'head') {
      f.state.identities.get('8485').revision_number = 9;
      const next = changed(value); await f.archive.savePreview(f.client, next);
      await assert.rejects(f.archive.stage(f.client, { ...next, requestId: randomUUID() }), { code: 'PT2030_CANDIDATE_INVALID' });
    } else await assert.rejects(f.archive.stage(f.client, command), { code: 'PT2030_CANDIDATE_INVALID' });
  }
});

test('PT archive is unavailable without an audit port and its SQL is a separate append-only candidate', () => {
  assert.throws(() => createPlanCandidateArchive(), TypeError);
  const sql = fs.readFileSync(path.join(__dirname, '../database/central/candidates/pt2030_plan_v2.up.sql'), 'utf8');
  assert.match(sql, /pt2030_plan_observation_no_truncate/); assert.match(sql, /pt2030_plan_revision_immutable/);
  assert.doesNotMatch(sql, /REFERENCES opportunity_catalog\.(opportunity|funding_identity)\(/);
});

test('PT composed central authority, verified workbook, preview and archive preserve all 177 candidates', async () => {
  const f = fixture(), original = await input();
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures/portugal2030', filename));
  let documentChecks = 0, instant = observedAt;
  const workflow = createCentralPortugal2030CandidateComposition({ pool: { connect: async () => f.client },
    documents: { async readVerifiedCentral() { return { ...original.document, state: 'AVAILABLE', scanState: 'CLEAN', buffer }; },
      async assertCurrent(_client, binding) { assert.equal(binding.sha256, original.document.sha256); documentChecks++; } },
    audit: async (_client, event) => f.state.audits.push(event), clock: () => new Date(instant) });
  const args = { userId: original.userId, documentId: original.document.documentId, documentVersionId: original.document.documentVersionId, sheetName: 'Sheet1', requestId: randomUUID() };
  const preview = await workflow.preview(args);
  assert.equal(preview.totalRows, 177); assert.equal(preview.errorRows, 0); assert.equal(f.state.revisions.length, 0);
  instant = '2026-10-31T00:00:00.000Z';
  const command = { ...args, requestId: randomUUID(), previewDigest: preview.previewDigest };
  const staged = await workflow.stage(command);
  assert.equal(staged.created, 177); assert.equal(staged.totalRows, 177); assert.equal(f.state.observations.length, 177);
  assert.equal(f.state.revisions.length, 177); assert.equal(documentChecks, 2);
  assert.equal(f.state.revisions.find(row => row.external_identifier === '8664').canonical_snapshot.financing.allocations.value[0].money.amount, '0');
  assert.equal((await workflow.stage(command)).replayed, true); assert.equal(f.state.revisions.length, 177);
  f.state.revoked = true;
  await assert.rejects(workflow.stage(command), { code: 'FUNDING_FORBIDDEN' });
  assert.equal(f.state.queries.some(sql => /tenant|INSERT INTO opportunity_catalog\.opportunity\b/.test(sql)), false);
});
