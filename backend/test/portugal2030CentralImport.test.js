'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { createCentralPortugal2030Import, centralPreviewDigest } = require('../src/portugal2030/centralImport');

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const sha = value => createHash('sha256').update(value).digest('hex');
function fixture() {
  const userId = randomUUID(), documentId = randomUUID(), documentVersionId = randomUUID();
  const buffer = Buffer.from('PK\x03\x04test workbook bytes');
  const document = { authority: 'CENTRAL', organizationId: null, documentId, documentVersionId,
    filename: 'Plano.xlsx', mime: MIME, sizeBytes: buffer.length, sha256: sha(buffer), state: 'AVAILABLE', scanState: 'CLEAN', buffer };
  const calls = [], state = { document, revoked: false, changed: false, mapping: 'a'.repeat(64), time: '2026-10-30T12:00:00.000Z', saved: [], staged: [] };
  const client = Object.freeze({ central: true });
  const transactions = { async run(work) { calls.push('begin'); const result = await work(client); calls.push('commit'); return result; } };
  const authority = { async assertAdministrator(actualClient, actualUser, { lock }) {
    assert.equal(actualClient, client); assert.equal(actualUser, userId); calls.push(lock ? 'authorize:lock' : 'authorize:read');
    if (state.revoked) throw Object.assign(new Error('FUNDING_FORBIDDEN'), { code: 'FUNDING_FORBIDDEN' });
  } };
  const documents = { async readVerifiedCentral(input) { calls.push('document:read'); assert.deepEqual(input, { userId, documentId, documentVersionId }); return state.document; },
    async assertCurrent(actualClient, input) { calls.push('document:current'); assert.equal(actualClient, client); assert.equal(input.sha256, state.document.sha256); if (state.changed) throw Error('Changed private storage details must not escape'); } };
  const adapter = async (bytes, options) => {
    calls.push('adapt'); assert.equal(bytes.equals(buffer), true); assert.equal(options.filename, 'Plano.xlsx');
    return { sourceNamespace: 'PORTUGAL2030_PLAN', mappingVersion: 'pt2030-plan-xlsx-v2.0', mappingDigest: state.mapping,
      fileDigest: sha(bytes), filename: options.filename, sheetName: options.sheetName, totalRows: 177, validRows: 177, errorRows: 0,
      previewDigest: sha(state.mapping), rows: Array.from({ length: 177 }, (_, index) => ({ physicalRow: index + 3, observedAt: options.observedAt })) };
  };
  const archive = { async savePreview(actualClient, input) { assert.equal(actualClient, client); calls.push('archive:preview'); state.saved.push(input); return { previewId: randomUUID(), previewDigest: input.previewDigest, requestId: input.requestId }; },
    async stage(actualClient, input) { assert.equal(actualClient, client); calls.push('archive:stage'); state.staged.push(input); return { importId: randomUUID(), totalRows: 177, created: 177, unchanged: 0, changed: 0, reviewRequired: 0, rejected: 0, replayed: false }; } };
  const service = createCentralPortugal2030Import({ transactions, authority, documents, archive, adapter, clock: () => new Date(state.time) });
  const input = { userId, documentId, documentVersionId, sheetName: 'Sheet1' };
  return { userId, documentId, documentVersionId, document, buffer, calls, state, transactions, authority, documents, archive, adapter, service, input };
}

test('central preview verifies the original before adapting all rows and persists only through central ports', async () => {
  const f = fixture(), preview = await f.service.preview(f.input);
  assert.equal(preview.totalRows, 177); assert.equal(preview.rows.length, 177); assert.equal(f.state.saved.length, 1);
  assert.deepEqual(f.calls, ['begin', 'authorize:read', 'commit', 'document:read', 'adapt', 'begin', 'authorize:lock', 'document:current', 'archive:preview', 'commit']);
  assert.equal(f.state.saved[0].document.authority, 'CENTRAL'); assert.equal(f.state.saved[0].document.organizationId, null);
  assert.equal(Object.hasOwn(f.state.saved[0].document, 'buffer'), false);
  assert.equal(Object.isFrozen(preview), true); assert.equal(Object.isFrozen(preview.rows), true);
});

test('stage rereads and rederives the confirmed intent while observation time does not invalidate it', async () => {
  const f = fixture(), preview = await f.service.preview(f.input); f.state.time = '2026-10-31T12:00:00.000Z';
  const result = await f.service.stage({ ...f.input, requestId: randomUUID(), previewDigest: preview.previewDigest });
  assert.equal(result.created, 177); assert.equal(f.state.staged.length, 1);
  assert.equal(f.state.staged[0].bundle.rows[0].observedAt, f.state.time);
  assert.equal(f.state.staged[0].previewDigest, preview.previewDigest);
  assert.equal(f.calls.filter(value => value === 'document:read').length, 2);
});

test('changed mapping or document identity requires a new preview before any stage write', async () => {
  const f = fixture(), preview = await f.service.preview(f.input); f.state.mapping = 'b'.repeat(64);
  await assert.rejects(f.service.stage({ ...f.input, requestId: randomUUID(), previewDigest: preview.previewDigest }), { code: 'PT2030_PREVIEW_DIGEST_MISMATCH' });
  assert.equal(f.state.staged.length, 0);
  const saved = f.state.saved[0];
  assert.notEqual(centralPreviewDigest({ ...saved.document, documentVersionId: randomUUID() }, saved.bundle), preview.previewDigest);
});

test('authority is checked before reading and again after asynchronous adaptation', async () => {
  const denied = fixture(); denied.state.revoked = true;
  await assert.rejects(denied.service.preview(denied.input), { code: 'FUNDING_FORBIDDEN' });
  assert.equal(denied.calls.includes('document:read'), false);
  const f = fixture(); const adapter = async (...args) => { const result = await f.adapter(...args); f.state.revoked = true; return result; };
  const service = createCentralPortugal2030Import({ transactions: f.transactions, authority: f.authority, documents: f.documents, archive: f.archive, adapter });
  await assert.rejects(service.preview(f.input), { code: 'FUNDING_FORBIDDEN' }); assert.equal(f.state.saved.length, 0);
});

test('a tenant, unclean, changed or unverified document never reaches the parser', async () => {
  for (const patch of [{ authority: 'TENANT' }, { organizationId: randomUUID() }, { scanState: 'PENDING' }, { state: 'SCANNING' },
    { documentId: randomUUID() }, { documentVersionId: randomUUID() }, { sha256: 'f'.repeat(64) }, { sizeBytes: 1 }, { mime: 'text/plain' }, { filename: '../Plano.xlsx' }]) {
    const f = fixture(); Object.assign(f.state.document, patch);
    await assert.rejects(f.service.preview(f.input), { code: 'PT2030_DOCUMENT_INVALID' }); assert.equal(f.calls.includes('adapt'), false);
  }
});

test('current document state is rechecked inside the write transaction and provider errors are bounded', async () => {
  const f = fixture(); f.state.changed = true;
  await assert.rejects(f.service.preview(f.input), error => error.code === 'PT2030_DOCUMENT_CHANGED' && error.message === error.code);
  assert.equal(f.state.saved.length, 0);
  const unavailable = fixture(); unavailable.documents.readVerifiedCentral = async () => { throw Error('private storage details'); };
  await assert.rejects(unavailable.service.preview(unavailable.input), error => error.code === 'PT2030_DOCUMENT_UNAVAILABLE' && error.message === error.code);
});

test('closed input refuses caller-supplied snapshots, scan claims and active objects without invoking them', async () => {
  const f = fixture();
  for (const patch of [{ scanState: 'CLEAN' }, { canonicalSnapshot: {} }, { organizationId: null }, { requestId: 'invalid' }]) {
    await assert.rejects(f.service.preview({ ...f.input, ...patch }), { code: 'PT2030_IMPORT_INPUT_INVALID' });
  }
  let invoked = false;
  const input = { ...f.input }; Object.defineProperty(input, 'sheetName', { enumerable: true, get() { invoked = true; return 'Sheet1'; } });
  await assert.rejects(f.service.preview(input), { code: 'PT2030_IMPORT_INPUT_INVALID' }); assert.equal(invoked, false);
  assert.equal(f.calls.length, 0);
});

test('central composition requires concrete trusted ports and rejects a mismatched adapter result', async () => {
  assert.throws(() => createCentralPortugal2030Import({}), TypeError);
  const f = fixture();
  const service = createCentralPortugal2030Import({ transactions: f.transactions, authority: f.authority, documents: f.documents, archive: f.archive,
    adapter: async (...args) => ({ ...await f.adapter(...args), fileDigest: '0'.repeat(64) }) });
  await assert.rejects(service.preview(f.input), { code: 'PT2030_BUNDLE_INVALID' }); assert.equal(f.state.saved.length, 0);
});

test('the real normative workbook crosses the central default adapter with all 177 candidate rows', async () => {
  const fs = require('node:fs'), path = require('node:path'), f = fixture();
  const filename = 'PlanoAnualAvisos_download_140926-1.xlsx';
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures/portugal2030', filename));
  Object.assign(f.state.document, { filename, buffer, sha256: sha(buffer), sizeBytes: buffer.length });
  const service = createCentralPortugal2030Import({ transactions: f.transactions, authority: f.authority, documents: f.documents, archive: f.archive,
    clock: () => new Date(f.state.time) });
  const preview = await service.preview(f.input);
  assert.equal(preview.totalRows, 177); assert.equal(preview.validRows, 177); assert.equal(preview.errorRows, 0);
  assert.equal(preview.rows.every(row => row.canonicalSnapshot.schemaVersion === 2 && Object.keys(row.sourceCells).length === 13), true);
  assert.equal(preview.rows.find(row => row.externalIdentifier === '8664').canonicalSnapshot.financing.allocations.value[0].money.amount, '0');
  f.state.time = '2026-11-01T01:00:00.000Z';
  await service.stage({ ...f.input, requestId: randomUUID(), previewDigest: preview.previewDigest });
  assert.equal(f.state.staged[0].bundle.rows.length, 177);
  assert.equal(f.state.staged[0].bundle.observedAt, f.state.time);
});
