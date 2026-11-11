'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { deflateRawSync, crc32 } = require('node:zlib');
const { createOoxmlStructuralInspector, DEFAULT_LIMITS } = require('../src/documents/ooxmlStructuralInspector');
const { createScanService } = require('../src/documents/scanService');

const OBJECT = '33333333-3333-4333-8333-333333333333';
const ORGANIZATION = '11111111-1111-4111-8111-111111111111';
const FORMATS = Object.freeze({
  docx: Object.freeze({
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    main: 'word/document.xml',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    root: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>A &amp; &#65;</w:t></w:r></w:p></w:body></w:document>'
  }),
  xlsx: Object.freeze({
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    main: 'xl/workbook.xml',
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    root: '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>'
  }),
  pptx: Object.freeze({
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    main: 'ppt/presentation.xml',
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
    root: '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst/></p:presentation>'
  })
});

const hash = value => createHash('sha256').update(value).digest('hex');
const word = (buffer, offset, value) => buffer.writeUInt16LE(value, offset);
const dword = (buffer, offset, value) => buffer.writeUInt32LE(value >>> 0, offset);

function createZip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const source of entries) {
    const name = Buffer.from(source.name, 'utf8');
    const data = Buffer.isBuffer(source.data) ? source.data : Buffer.from(source.data || '', 'utf8');
    const method = source.deflate ? 8 : 0;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const checksum = crc32(data) >>> 0;
    const flags = 0x800 | (source.encrypted ? 1 : 0);
    const localHeader = Buffer.alloc(30);
    dword(localHeader, 0, 0x04034b50); word(localHeader, 4, 20); word(localHeader, 6, flags); word(localHeader, 8, method);
    dword(localHeader, 14, source.badCrc ? (checksum + 1) >>> 0 : checksum);
    dword(localHeader, 18, compressed.length); dword(localHeader, 22, data.length); word(localHeader, 26, name.length);
    local.push(localHeader, name, compressed);
    const centralHeader = Buffer.alloc(46);
    dword(centralHeader, 0, 0x02014b50); word(centralHeader, 4, 20); word(centralHeader, 6, 20);
    word(centralHeader, 8, flags); word(centralHeader, 10, method); dword(centralHeader, 16, source.badCrc ? (checksum + 1) >>> 0 : checksum);
    dword(centralHeader, 20, compressed.length); dword(centralHeader, 24, source.declaredSize ?? data.length);
    word(centralHeader, 28, name.length); dword(centralHeader, 42, offset);
    central.push(centralHeader, name);
    offset += localHeader.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  dword(end, 0, 0x06054b50); word(end, 8, entries.length); word(end, 10, entries.length);
  dword(end, 12, directory.length); dword(end, 16, offset);
  return Buffer.concat([...local, directory, end]);
}

function packageEntries(extension, overrides = {}) {
  const format = FORMATS[extension];
  const contentTypes = overrides.contentTypes || `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${format.main}" ContentType="${format.type}"/></Types>`;
  const relationships = overrides.relationships || `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${format.main}"/></Relationships>`;
  return [
    { name: '[Content_Types].xml', data: contentTypes, deflate: true },
    { name: '_rels/.rels', data: relationships, deflate: true },
    { name: format.main, data: overrides.main || format.root, deflate: true },
    ...(overrides.extra || [])
  ];
}

function storageFor(bytes, options = {}) {
  const state = { reads: 0, destroyed: 0 };
  return Object.assign({
    state,
    async head() { return { size: bytes.length, sha256: hash(bytes), etag: 'fixture-etag' }; },
    async readRange({ start, end, signal }) {
      state.reads += 1;
      if (options.stall) {
        const source = new Readable({ read() {} });
        source.once('close', () => { state.destroyed += 1; });
        signal?.addEventListener('abort', () => source.destroy(), { once: true });
        return source;
      }
      const source = Readable.from([bytes.subarray(start, end + 1)]);
      source.once('close', () => { state.destroyed += 1; });
      return source;
    }
  }, options.methods || {});
}

function recordFor(bytes, extension, overrides = {}) {
  const format = FORMATS[extension];
  return { organizationId: ORGANIZATION, versionId: OBJECT, objectId: OBJECT, lockVersion: 0,
    observedSize: bytes.length, sha256: hash(bytes), expectedFileClass: 'OOXML', declaredMime: format.mime,
    displayFilename: `evidence.${extension}`, ...overrides };
}

async function inspect(extension, entries = packageEntries(extension), options = {}) {
  const bytes = createZip(entries);
  const storage = storageFor(bytes, options.storage);
  const inspector = createOoxmlStructuralInspector(options.inspector);
  const result = await inspector.inspect({ record: recordFor(bytes, extension, options.record), storage, signal: options.signal });
  return { bytes, storage, result };
}

test('DOCX, XLSX and PPTX minimal packages are approved and bound to exact content', async () => {
  for (const extension of Object.keys(FORMATS)) {
    const { bytes, result } = await inspect(extension);
    assert.deepEqual({ status: result.status, code: result.code, format: result.format, contentSha256: result.contentSha256 },
      { status: 'APPROVED', code: 'OOXML_STRUCTURAL_APPROVED', format: extension, contentSha256: hash(bytes) });
  }
});

test('declared MIME, extension, inner format and exact stored digest must agree', async () => {
  const bytes = createZip(packageEntries('docx'));
  const inspector = createOoxmlStructuralInspector();
  const storage = storageFor(bytes);
  assert.equal((await inspector.inspect({ record: recordFor(bytes, 'docx', { displayFilename: 'evidence.xlsx' }), storage })).code, 'OOXML_DECLARATION_MISMATCH');
  assert.equal((await inspector.inspect({ record: recordFor(bytes, 'docx', { declaredMime: FORMATS.xlsx.mime }), storage })).code, 'OOXML_DECLARATION_MISMATCH');
  assert.equal((await inspector.inspect({ record: recordFor(bytes, 'docx', { sha256: '0'.repeat(64) }), storage })).code, 'OOXML_BINDING_INVALID');
});

test('required package parts, active content, external relationships and missing targets are rejected', async () => {
  assert.equal((await inspect('docx', packageEntries('docx').slice(1))).result.code, 'OOXML_CONTENT_TYPES_INVALID');
  assert.equal((await inspect('docx', packageEntries('docx', { extra: [{ name: 'word/vbaProject.bin', data: 'macro' }] }))).result.code, 'OOXML_ACTIVE_CONTENT_FORBIDDEN');
  const external = packageEntries('docx', { extra: [{ name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid" TargetMode="External"/></Relationships>' }] });
  assert.equal((await inspect('docx', external)).result.code, 'OOXML_EXTERNAL_RELATIONSHIP_FORBIDDEN');
  const missing = packageEntries('docx', { extra: [{ name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/missing.png"/></Relationships>' }] });
  assert.equal((await inspect('docx', missing)).result.code, 'OOXML_RELATIONSHIP_TARGET_MISSING');
  assert.equal((await inspect('docx', packageEntries('docx', { extra: [{ name: 'word/media/payload.exe', data: 'MZ' }] }))).result.code, 'OOXML_ACTIVE_CONTENT_FORBIDDEN');
});

test('ordinary embedded images with an internal relationship remain supported', async () => {
  const format = FORMATS.docx;
  const contentTypes = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/${format.main}" ContentType="${format.type}"/></Types>`;
  const imageRelationship = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>';
  const entries = packageEntries('docx', { contentTypes, extra: [
    { name: 'word/_rels/document.xml.rels', data: imageRelationship },
    { name: 'word/media/image1.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]) }
  ] });
  assert.equal((await inspect('docx', entries)).result.status, 'APPROVED');
});

test('unsafe, Unicode-ambiguous, case-duplicate and over-deep ZIP paths are rejected', async () => {
  const cases = [
    [...packageEntries('docx'), { name: '../escape.xml', data: '<x/>' }],
    [...packageEntries('docx'), { name: 'word/%2e%2e/escape.xml', data: '<x/>' }],
    [...packageEntries('docx'), { name: 'word/e\u0301.xml', data: '<x/>' }],
    [...packageEntries('docx'), { name: 'WORD/DOCUMENT.XML', data: '<x/>' }],
    [...packageEntries('docx'), { name: `${Array.from({ length: 33 }, () => 'a').join('/')}.xml`, data: '<x/>' }]
  ];
  for (const entries of cases) assert.match((await inspect('docx', entries)).result.code, /^OOXML_(?:PATH_INVALID|PATH_AMBIGUOUS|ARCHIVE_INVALID)$/);
});

test('XML forbids DTD and custom entities while accepting predefined escapes and numeric references', async () => {
  const valid = await inspect('docx');
  assert.equal(valid.result.status, 'APPROVED');
  const doctype = packageEntries('docx', { main: '<?xml version="1.0"?><!DOCTYPE w:document [<!ENTITY x "boom">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>&x;</w:p></w:body></w:document>' });
  assert.equal((await inspect('docx', doctype)).result.code, 'OOXML_XML_DTD_FORBIDDEN');
  const malformed = packageEntries('docx', { main: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body></w:document>' });
  assert.equal((await inspect('docx', malformed)).result.code, 'OOXML_XML_INVALID');
});

test('encrypted, CRC-invalid and inconsistent-size archives fail closed', async () => {
  for (const mutation of [{ encrypted: true }, { badCrc: true }, { declaredSize: 1 }]) {
    const entries = packageEntries('docx'); entries[2] = { ...entries[2], ...mutation };
    assert.match((await inspect('docx', entries)).result.code, /^OOXML_(?:ARCHIVE_UNSUPPORTED|ARCHIVE_CORRUPT|ARCHIVE_INVALID)$/);
  }
});

test('entry count, XML bytes, total expansion and path depth limits apply to processed content', async () => {
  assert.equal((await inspect('docx', packageEntries('docx'), { inspector: { limits: { maxEntries: 2 } } })).result.code, 'OOXML_ENTRY_LIMIT_EXCEEDED');
  assert.equal((await inspect('docx', packageEntries('docx'), { inspector: { limits: { maxXmlBytes: 128 } } })).result.code, 'OOXML_ENTRY_LIMIT_EXCEEDED');
  assert.equal((await inspect('docx', packageEntries('docx'), { inspector: { limits: { maxExpandedBytes: 256 } } })).result.code, 'OOXML_EXPANSION_LIMIT_EXCEEDED');
  assert.equal((await inspect('docx', [...packageEntries('docx'), { name: 'a/b/c.xml', data: '<x/>' }], { inspector: { limits: { maxPathSegments: 2 } } })).result.code, 'OOXML_PATH_INVALID');
  assert.deepEqual(DEFAULT_LIMITS, { maxEntries: 4096, maxEntryBytes: 100 * 1024 * 1024, maxXmlBytes: 16 * 1024 * 1024,
    maxExpandedBytes: 200 * 1024 * 1024, maxExpansionRatio: 4, maxPathSegments: 32, maxPathBytes: 1024,
    maxProcessingMs: 30000, processingChunkBytes: 64 * 1024 });
});

test('abort and timeout stop range streams and remain retryable', async () => {
  const bytes = createZip(packageEntries('docx'));
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(createOoxmlStructuralInspector().inspect({ record: recordFor(bytes, 'docx'), storage: storageFor(bytes), signal: aborted.signal }), /OOXML_INSPECTION_ABORTED/);
  const storage = storageFor(bytes, { stall: true });
  await assert.rejects(createOoxmlStructuralInspector({ limits: { maxProcessingMs: 10 } }).inspect({ record: recordFor(bytes, 'docx'), storage }), /OOXML_INSPECTION_TIMEOUT/);
  assert.ok(storage.state.destroyed > 0);
});

test('large XML parsing yields to cancellation instead of monopolizing the event loop', async () => {
  const entries = packageEntries('docx', { main: `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${'x'.repeat(1024 * 1024)}</w:t></w:r></w:p></w:body></w:document>` });
  entries[2] = { ...entries[2], deflate: false };
  const bytes = createZip(entries), storage = storageFor(bytes), controller = new AbortController();
  setImmediate(() => controller.abort());
  await assert.rejects(createOoxmlStructuralInspector({ limits: { processingChunkBytes: 1024 } }).inspect({
    record: recordFor(bytes, 'docx'), storage, signal: controller.signal
  }), /OOXML_INSPECTION_ABORTED/);
  assert.ok(storage.state.destroyed > 0);
});

test('AVAILABLE requires ClamAV CLEAN and structural approval for the exact version', async () => {
  const bytes = createZip(packageEntries('docx'));
  const transitions = [], audits = [];
  let malware = 'CLEAN';
  const storage = storageFor(bytes);
  const service = createScanService({
    scanner: { async health() { return { ready: true }; }, async scan() { return { status: malware }; } },
    repository: { async transition(value) { transitions.push(value); return value; } }, storage,
    audit: { async emit(code, value) { audits.push([code, value]); } }
  });
  const record = recordFor(bytes, 'docx');
  assert.equal((await service.scan({ record, actor: { type: 'SERVICE' }, fencingToken: 'fence' })).toState, 'AVAILABLE');
  const readsAfterClean = storage.state.reads;
  malware = 'INFECTED';
  assert.equal((await service.scan({ record: { ...record, lockVersion: 1 }, actor: { type: 'SERVICE' }, fencingToken: 'fence' })).toState, 'QUARANTINED');
  assert.equal(storage.state.reads, readsAfterClean);
  assert.equal(audits[0][1].detailCode, 'OOXML_STRUCTURAL_APPROVED');
  const rejected = createScanService({ scanner: { async health() { return { ready: true }; }, async scan() { return { status: 'CLEAN' }; } },
    repository: { async transition(value) { return value; } }, storage: storageFor(bytes),
    structuralInspector: { async inspect() { return { status: 'REJECTED', code: 'OOXML_ACTIVE_CONTENT_FORBIDDEN' }; } }, audit: { async emit() {} } });
  assert.equal((await rejected.scan({ record, actor: { type: 'SERVICE' }, fencingToken: 'fence' })).toState, 'QUARANTINED');
});
