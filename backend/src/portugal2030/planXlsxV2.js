'use strict';
const { createHash } = require('node:crypto');
const { types: { isProxy } } = require('node:util');
const { cloneData, deepFreeze } = require('../opportunities/v2/data');
const { contentDigestV2, normalizers: n } = require('../opportunities/v2');
const { readPlanWorkbook, MAX_BYTES, MAX_ROWS, LIMITS, HEADERS, COLUMNS, fail } = require('./planXlsxReader');
const { adaptPlanRowV2, validatedCells, MAPPING_VERSION, SOURCE_NAMESPACE } = require('./planRowV2');
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
function canonical(value) { return Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value); }
const MAPPING_DIGEST = hash(canonical({ mappingVersion: MAPPING_VERSION, sourceNamespace: SOURCE_NAMESPACE, headers: HEADERS, sourceColumns: COLUMNS, parserVersion: 'pt2030-lexical-ooxml-v2.0' }));
function sourceColumnsDigest(sourceCells, physicalRow) {
  const cells = validatedCells(sourceCells, physicalRow);
  return hash(canonical(Object.fromEntries(COLUMNS.map(col => [col, { type: cells[col].type, value: cells[col].value }]))));
}
function planPreviewDigest(input) {
  const bundle = cloneData(input, { maxBytes: 32 * 1024 * 1024 });
  if (!bundle || bundle.sourceNamespace !== SOURCE_NAMESPACE || bundle.mappingVersion !== MAPPING_VERSION || bundle.mappingDigest !== MAPPING_DIGEST
    || !Array.isArray(bundle.rows) || bundle.rows.length > MAX_ROWS || bundle.rows.length !== bundle.totalRows
    || !Number.isSafeInteger(bundle.validRows) || !Number.isSafeInteger(bundle.errorRows) || bundle.validRows + bundle.errorRows !== bundle.totalRows) fail('PT2030_PLAN_PREVIEW_INVALID');
  const rows = bundle.rows.map(row => {
    if (sourceColumnsDigest(row.sourceCells, row.physicalRow) !== row.sourceColumnsDigest || !Array.isArray(row.errors)) fail('PT2030_PLAN_PREVIEW_INVALID');
    const contentDigest = row.canonicalSnapshot === null ? null : contentDigestV2(row.canonicalSnapshot);
    if (contentDigest !== row.contentDigest || Boolean(row.errors.length) !== (row.canonicalSnapshot === null)) fail('PT2030_PLAN_PREVIEW_INVALID');
    // The S0 column digest intentionally ignores physical/style details; preview
    // intent also binds the complete archived cell evidence, including lexemes.
    const sourceEvidenceDigest = hash(canonical(row.sourceCells));
    return { physicalRow: row.physicalRow, externalIdentifier: row.externalIdentifier, sourceColumnsDigest: row.sourceColumnsDigest, sourceEvidenceDigest, contentDigest, errors: row.errors };
  });
  if (rows.filter(row => !row.errors.length).length !== bundle.validRows) fail('PT2030_PLAN_PREVIEW_INVALID');
  return hash(canonical({ sourceNamespace: SOURCE_NAMESPACE, mappingVersion: MAPPING_VERSION, mappingDigest: MAPPING_DIGEST,
    fileDigest: bundle.fileDigest, filename: bundle.filename, sheetName: bundle.sheetName, dateSystem: bundle.dateSystem, headerRow: bundle.headerRow,
    totalRows: bundle.totalRows, validRows: bundle.validRows, errorRows: bundle.errorRows, rows }));
}
async function inspectPlanXlsxV2(buffer, inputOptions) {
  const options = cloneData(inputOptions, { maxBytes: 4096 });
  if (!options || Object.keys(options).length !== 3 || !['sheetName', 'filename', 'observedAt'].every(key => Object.hasOwn(options, key))
    || n.text(options.sheetName, { maxLength: 31 }) !== options.sheetName || n.text(options.filename, { maxLength: 255 }) !== options.filename
    || /[\\/:\0]/.test(options.filename) || !/\.xlsx$/i.test(options.filename) || n.instant(options.observedAt) !== options.observedAt) fail('PT2030_PLAN_OPTIONS_INVALID');
  if (isProxy(buffer) || !Buffer.isBuffer(buffer) || buffer.length < 4) fail();
  if (buffer.length > MAX_BYTES) fail('PT2030_PLAN_LIMIT_EXCEEDED');
  // Copy before yielding: provenance and parsing must describe the same bytes,
  // even if the caller reuses or mutates its upload buffer during ZIP reads.
  const bytes = Buffer.from(buffer), fileDigest = hash(bytes);
  const parsed = await readPlanWorkbook(bytes, options.sheetName);
  const documentModifiedAt = parsed.documentModifiedAt === null ? null : n.instant(parsed.documentModifiedAt);
  const rows = parsed.rows.map(row => {
    let externalIdentifier = null, canonicalSnapshot = null, contentDigest = null; const errors = [];
    try {
      if (row.sourceCells.A.value !== null) externalIdentifier = n.text(row.sourceCells.A.value, { maxLength: 128 });
      canonicalSnapshot = adaptPlanRowV2(row.sourceCells, { ...options, physicalRow: row.physicalRow, fileDigest, documentModifiedAt, dateSystem: parsed.dateSystem });
      contentDigest = contentDigestV2(canonicalSnapshot);
    } catch (error) { canonicalSnapshot = null; contentDigest = null; errors.push(error.code?.startsWith('PT2030_PLAN_') || error.code?.startsWith('OPPORTUNITY_V2_') ? error.code : 'PT2030_PLAN_ROW_INVALID'); }
    return { ...row, externalIdentifier, sourceColumnsDigest: sourceColumnsDigest(row.sourceCells, row.physicalRow), canonicalSnapshot, contentDigest, errors };
  });
  const ids = new Map();
  for (const row of rows) if (row.externalIdentifier !== null) ids.set(row.externalIdentifier, (ids.get(row.externalIdentifier) || 0) + 1);
  for (const row of rows) if (ids.get(row.externalIdentifier) > 1) { row.errors.push('PT2030_PLAN_DUPLICATE_ID'); row.canonicalSnapshot = null; row.contentDigest = null; }
  const validRows = rows.filter(row => !row.errors.length).length;
  const result = { sourceNamespace: SOURCE_NAMESPACE, mappingVersion: MAPPING_VERSION, fileDigest, filename: options.filename, sheetName: options.sheetName,
    dateSystem: parsed.dateSystem, headerRow: 2, observedAt: options.observedAt, documentModifiedAt, totalRows: rows.length, validRows, errorRows: rows.length - validRows, rows, mappingDigest: MAPPING_DIGEST, limits: LIMITS };
  result.previewDigest = planPreviewDigest(result);
  return deepFreeze(result);
}
module.exports = { inspectPlanXlsxV2, adaptPlanRowV2, planPreviewDigest, sourceColumnsDigest, MAX_BYTES, MAX_ROWS, MIME, HEADERS, MAPPING_VERSION, MAPPING_DIGEST, SOURCE_NAMESPACE, LIMITS };
