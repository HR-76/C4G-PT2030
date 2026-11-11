'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { types: { isProxy } } = require('node:util');
const { cloneData, deepFreeze } = require('../opportunities/v2/data');
const { canonical } = require('../async/envelope');

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const DOCUMENT_KEYS = ['authority', 'organizationId', 'documentId', 'documentVersionId', 'filename', 'mime', 'sizeBytes', 'sha256'];
const hash = value => createHash('sha256').update(value).digest('hex');
function fail(code) { throw Object.assign(new Error(code), { code }); }
function exact(value, allowed, required = allowed) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key));
}
function filename(value) {
  return typeof value === 'string' && value.length <= 255 && value.length > 5
    && !/[\\/:\u0000-\u001f\u007f]/.test(value) && !/^\.+$/.test(value) && /\.xlsx$/i.test(value);
}
function documentDescriptor(input) {
  try {
    const value = cloneData(input, { maxBytes: 8192 });
    if (!exact(value, DOCUMENT_KEYS) || value.authority !== 'CENTRAL' || value.organizationId !== null
      || !UUID.test(value.documentId) || !UUID.test(value.documentVersionId) || !filename(value.filename)
      || value.mime !== MIME || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 4 || value.sizeBytes > MAX_FILE_BYTES
      || !SHA256.test(value.sha256)) throw Error();
    return deepFreeze(value);
  } catch { fail('PT2030_DOCUMENT_INVALID'); }
}
function inputArguments(input, stage) {
  try {
    const value = cloneData(input, { maxBytes: 8192 });
    const required = ['userId', 'documentId', 'documentVersionId', 'sheetName'];
    const allowed = [...required, 'requestId', ...(stage ? ['previewDigest'] : [])];
    if (stage) required.push('requestId', 'previewDigest');
    if (!exact(value, allowed, required) || !['userId', 'documentId', 'documentVersionId'].every(key => UUID.test(value[key]))
      || typeof value.sheetName !== 'string' || !value.sheetName.trim() || value.sheetName.length > 31 || /[\u0000-\u001f]/.test(value.sheetName)
      || Object.hasOwn(value, 'requestId') && !UUID.test(value.requestId)
      || stage && !SHA256.test(value.previewDigest)) throw Error();
    return deepFreeze({ ...value, userId: value.userId.toLowerCase(), documentId: value.documentId.toLowerCase(),
      documentVersionId: value.documentVersionId.toLowerCase(), requestId: value.requestId?.toLowerCase() || randomUUID() });
  } catch { fail('PT2030_IMPORT_INPUT_INVALID'); }
}

// This port result is trusted infrastructure, never a body supplied by an HTTP
// caller. Still reject active objects and verify the returned bytes and binding.
function verifiedDocument(input, expected) {
  try {
    if (!input || isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype) throw Error();
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = [...DOCUMENT_KEYS, 'state', 'scanState', 'buffer'];
    if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key =>
      !descriptors[key] || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) throw Error();
    const value = Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
    const document = documentDescriptor(Object.fromEntries(DOCUMENT_KEYS.map(key => [key, value[key]])));
    if (document.documentId !== expected.documentId || document.documentVersionId !== expected.documentVersionId
      || value.state !== 'AVAILABLE' || value.scanState !== 'CLEAN' || isProxy(value.buffer) || !Buffer.isBuffer(value.buffer)
      || value.buffer.length !== document.sizeBytes) throw Error();
    const buffer = Buffer.from(value.buffer);
    if (hash(buffer) !== document.sha256) throw Error();
    return { document, buffer };
  } catch { fail('PT2030_DOCUMENT_INVALID'); }
}
function jsonbSize(value) {
  if (Array.isArray(value)) return 2 + Math.max(0, value.length - 1) * 2 + value.reduce((total, item) => total + jsonbSize(item), 0);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return 2 + Math.max(0, entries.length - 1) * 2 + entries.reduce((total, [key, item]) => total + Buffer.byteLength(JSON.stringify(key)) + 2 + jsonbSize(item), 0);
  }
  return Buffer.byteLength(JSON.stringify(value));
}
function checkedBundle(input, document, sheetName = null) {
  try {
    const value = cloneData(input, { maxBytes: MAX_BUNDLE_BYTES });
    if (jsonbSize(value) > MAX_BUNDLE_BYTES || value.sourceNamespace !== 'PORTUGAL2030_PLAN'
      || typeof value.mappingVersion !== 'string' || !value.mappingVersion.length || value.mappingVersion.length > 100
      || !SHA256.test(value.mappingDigest) || !SHA256.test(value.previewDigest)
      || value.fileDigest !== document.sha256 || value.filename !== document.filename
      || typeof value.sheetName !== 'string' || !value.sheetName.length || value.sheetName.length > 31 || sheetName !== null && value.sheetName !== sheetName
      || ![value.totalRows, value.validRows, value.errorRows].every(number => Number.isSafeInteger(number) && number >= 0)
      || value.totalRows > 5000 || value.totalRows !== value.validRows + value.errorRows
      || !Array.isArray(value.rows) || value.rows.length !== value.totalRows) throw Error();
    return deepFreeze(value);
  } catch { fail('PT2030_BUNDLE_INVALID'); }
}

// The archive independently validates/recomputes the adapter's preview digest.
// This outer digest adds the protected document/version and immutable bytes.
// Observation timestamps intentionally do not change a confirmed import intent.
function centralPreviewDigest(documentInput, bundleInput) {
  const document = documentDescriptor(documentInput), bundle = checkedBundle(bundleInput, document);
  return hash('C4G:PORTUGAL2030:CENTRAL:PREVIEW:v2\0' + canonical({ document, sourceNamespace: bundle.sourceNamespace,
    mappingVersion: bundle.mappingVersion, mappingDigest: bundle.mappingDigest, sheetName: bundle.sheetName, previewDigest: bundle.previewDigest }));
}

function createCentralPortugal2030Import({ transactions, authority, documents, archive,
  adapter = (buffer, options) => require('./planXlsxV2').inspectPlanXlsxV2(buffer, options), clock = () => new Date() } = {}) {
  for (const [port, methods] of [[transactions, ['run']], [authority, ['assertAdministrator']],
    [documents, ['readVerifiedCentral', 'assertCurrent']], [archive, ['savePreview', 'stage']]]) {
    if (!port || methods.some(method => typeof port[method] !== 'function')) throw new TypeError('Central Portugal2030 import requires explicit trusted ports.');
  }
  if (typeof adapter !== 'function' || typeof clock !== 'function') throw new TypeError('Central Portugal2030 adapter and clock are required.');

  async function prepare(input, stage) {
    const args = inputArguments(input, stage);
    await transactions.run(client => authority.assertAdministrator(client, args.userId, { lock: false }));
    let source;
    try { source = await documents.readVerifiedCentral({ userId: args.userId, documentId: args.documentId, documentVersionId: args.documentVersionId }); }
    catch { fail('PT2030_DOCUMENT_UNAVAILABLE'); }
    const { document, buffer } = verifiedDocument(source, args);
    let observedAt;
    try { observedAt = Date.prototype.toISOString.call(clock()); } catch { fail('PT2030_IMPORT_CLOCK_INVALID'); }
    const bundle = checkedBundle(await adapter(buffer, { sheetName: args.sheetName, filename: document.filename, observedAt }), document, args.sheetName);
    const previewDigest = centralPreviewDigest(document, bundle);
    if (stage && previewDigest !== args.previewDigest) fail('PT2030_PREVIEW_DIGEST_MISMATCH');
    return { args, document, bundle, previewDigest };
  }
  async function write(prepared, operation) {
    const { args, document, bundle, previewDigest } = prepared;
    return transactions.run(async client => {
      await authority.assertAdministrator(client, args.userId, { lock: true });
      try { await documents.assertCurrent(client, { userId: args.userId, documentId: document.documentId,
        documentVersionId: document.documentVersionId, sha256: document.sha256, sizeBytes: document.sizeBytes }); }
      catch { fail('PT2030_DOCUMENT_CHANGED'); }
      return archive[operation](client, { userId: args.userId, requestId: args.requestId, document, bundle, previewDigest });
    });
  }
  return Object.freeze({
    async preview(input) {
      const prepared = await prepare(input, false), receipt = await write(prepared, 'savePreview');
      return deepFreeze({ ...receipt, previewDigest: prepared.previewDigest, sheetName: prepared.bundle.sheetName,
        mappingVersion: prepared.bundle.mappingVersion, totalRows: prepared.bundle.totalRows,
        validRows: prepared.bundle.validRows, errorRows: prepared.bundle.errorRows, rows: prepared.bundle.rows });
    },
    async stage(input) { return deepFreeze(await write(await prepare(input, true), 'stage')); }
  });
}

module.exports = { createCentralPortugal2030Import, centralPreviewDigest, MAX_FILE_BYTES, MAX_BUNDLE_BYTES };
