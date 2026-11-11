'use strict';
const path = require('node:path').posix;
const { crc32 } = require('node:zlib');
const { types: { isProxy } } = require('node:util');
const yauzl = require('yauzl');
const { SaxesParser } = require('saxes');

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const MAX_BYTES = 10 * 1024 * 1024, MAX_ROWS = 5000;
const LIMITS = Object.freeze({ maxBytes: MAX_BYTES, maxRows: MAX_ROWS, maxEntries: 256, maxExpandedBytes: 32 * 1024 * 1024, maxXmlBytes: 8 * 1024 * 1024, maxCells: 70000, maxXmlNodes: 150000, maxXmlDepth: 64 });
const HEADERS = Object.freeze(['ID', 'Tipo Ent. Beneficiária', 'Natureza Aviso', 'Designacao do Aviso', 'Programa', 'Objetivo Especifico', 'Fundo', 'Dotação Fundo', 'Data Inicio Prevista', 'Data Fim Prevista', 'Quadrimestre', 'NUTS II', 'Modalidade Apresentação Candidatura']);
const COLUMNS = Object.freeze([... 'ABCDEFGHIJKLM']);
function fail(code = 'PT2030_PLAN_FILE_INVALID') { throw Object.assign(new Error(code), { code }); }
const children = (node, local, uri = NS) => (node?.children || []).filter(value => value.local === local && value.uri === uri);
function child(node, local, uri = NS) { const result = children(node, local, uri); if (result.length > 1) fail('PT2030_PLAN_XML_INVALID'); return result[0]; }
function attr(node, local, uri = '') { return node?.attributes.find(value => value.local === local && value.uri === uri)?.value; }
function xml(buffer, budget) {
  let source; try { source = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { fail('PT2030_PLAN_XML_INVALID'); }
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) fail('PT2030_PLAN_XML_INVALID');
  const parser = new SaxesParser({ xmlns: true, defaultXMLVersion: '1.0', forceXMLVersion: true });
  const stack = []; let root;
  parser.on('doctype', () => fail('PT2030_PLAN_XML_INVALID'));
  parser.on('error', () => fail('PT2030_PLAN_XML_INVALID'));
  parser.on('opentag', tag => {
    if (++budget.nodes > LIMITS.maxXmlNodes || stack.length >= LIMITS.maxXmlDepth) fail('PT2030_PLAN_LIMIT_EXCEEDED');
    const node = { local: tag.local, uri: tag.uri, attributes: Object.values(tag.attributes), text: '', children: [] };
    if (stack.length) stack.at(-1).children.push(node); else { if (root) fail('PT2030_PLAN_XML_INVALID'); root = node; }
    stack.push(node);
  });
  const text = value => { if (stack.length) stack.at(-1).text += value; };
  parser.on('text', text); parser.on('cdata', text); parser.on('closetag', () => stack.pop());
  try { parser.write(source).close(); } catch (error) { if (error.code?.startsWith('PT2030_PLAN_')) throw error; fail('PT2030_PLAN_XML_INVALID'); }
  if (!root || parser.xmlDecl?.encoding && !/^utf-?8$/i.test(parser.xmlDecl.encoding)) fail('PT2030_PLAN_XML_INVALID');
  return root;
}
function visit(node, work) { work(node); for (const value of node.children) visit(value, work); }
function richText(node) {
  if (!node) return null;
  // Phonetic runs annotate text and do not replace its authored string.
  const raw = node.children.map(value => value.uri !== NS ? '' : value.local === 't' ? value.text : value.local === 'r' ? children(value, 't').map(t => t.text).join('') : '').join('');
  // One pass is essential: _x005F_x0020_ means the literal text _x0020_.
  const value = raw.replace(/_x([a-fA-F0-9]{4})_/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
  if (!value.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail('PT2030_PLAN_CELL_ENCODING_INVALID');
  return value;
}
function relationshipTarget(base, target) {
  if (typeof target !== 'string' || !target || /[\\\0%?#]/.test(target) || /^[a-z]+:/i.test(target)) fail('PT2030_PLAN_FILE_INVALID');
  const resolved = target.startsWith('/') ? target.slice(1) : path.normalize(path.join(path.dirname(base), target));
  if (resolved.startsWith('../') || resolved.startsWith('/') || resolved.includes('//')) fail('PT2030_PLAN_FILE_INVALID');
  return resolved;
}
async function readParts(buffer) {
  if (isProxy(buffer) || !Buffer.isBuffer(buffer) || buffer.length < 4) fail();
  if (buffer.length > MAX_BYTES) fail('PT2030_PLAN_LIMIT_EXCEEDED');
  let zip; const entries = new Map(), budget = { nodes: 0 }; let expanded = 0, count = 0;
  try {
    zip = await yauzl.fromBufferPromise(Buffer.from(buffer), { validateEntrySizes: true, strictFileNames: true });
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      if (++count > LIMITS.maxEntries || !name || name.length > 512 || /[\\\0%]/.test(name) || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').some(segment => segment === '..' || segment === '.') || entries.has(name.toLowerCase())) fail('PT2030_PLAN_FILE_INVALID');
      if (/(^|\/)(?:externalLinks|embeddings|activeX)(\/|$)|vbaProject|\.(?:exe|js|vbs|ps1|dll)$/i.test(name)) fail('PT2030_PLAN_EXTERNAL_LINK_FORBIDDEN');
      if (entry.isEncrypted() || !entry.canDecodeFileData() || ![0, 8].includes(entry.compressionMethod)) fail();
      if (entry.uncompressedSize > LIMITS.maxXmlBytes || expanded + entry.uncompressedSize > LIMITS.maxExpandedBytes) fail('PT2030_PLAN_LIMIT_EXCEEDED');
      const stream = await zip.openReadStreamPromise(entry); const chunks = []; let actual = 0, checksum = 0;
      try {
        for await (const chunk of stream) {
          actual += chunk.length; expanded += chunk.length;
          if (actual > LIMITS.maxXmlBytes || expanded > LIMITS.maxExpandedBytes) fail('PT2030_PLAN_LIMIT_EXCEEDED');
          checksum = crc32(chunk, checksum); chunks.push(chunk);
        }
      } finally { stream.destroy(); }
      if (actual !== entry.uncompressedSize || checksum !== entry.crc32) fail();
      const data = Buffer.concat(chunks); entries.set(name.toLowerCase(), { name, data, root: /\.(?:xml|rels)$/i.test(name) ? xml(data, budget) : null });
    }
  } catch (error) { if (error.code?.startsWith('PT2030_PLAN_')) throw error; fail(); }
  finally { zip?.close(); }
  return entries;
}
function inspectPackage(entries) {
  for (const { name, root } of entries.values()) {
    if (!root) continue;
    if (name.endsWith('.rels') && (root.local !== 'Relationships' || root.uri !== REL)) fail('PT2030_PLAN_XML_INVALID');
    visit(root, node => {
      if (node.local === 'Relationship' && node.uri === REL && (attr(node, 'TargetMode') === 'External' || /\/(?:externalLink|hyperlink|oleObject|package|attachedTemplate)$/.test(attr(node, 'Type') || ''))) fail('PT2030_PLAN_EXTERNAL_LINK_FORBIDDEN');
      if (node.uri === NS && ['externalReferences', 'hyperlink', 'oleObjects'].includes(node.local)) fail('PT2030_PLAN_EXTERNAL_LINK_FORBIDDEN');
      if (node.uri === NS && node.local === 'f') fail('PT2030_PLAN_FORMULA_FORBIDDEN');
      // Conditional/table number formats need a separate interpretation of the
      // source contract. Do not claim currency absence while ignoring them.
      if (['conditionalFormatting', 'tableParts'].includes(node.local)) fail('PT2030_PLAN_MONEY_FORMAT_UNSUPPORTED');
      if (node.local === 'Override' && /macroEnabled|vbaProject/i.test(attr(node, 'ContentType') || '')) fail('PT2030_PLAN_FILE_INVALID');
    });
  }
}
async function readPlanWorkbook(buffer, sheetName) {
  const entries = await readParts(buffer);
  inspectPackage(entries);
  const workbook = entries.get('xl/workbook.xml')?.root;
  if (workbook?.uri !== NS || workbook.local !== 'workbook') fail();
  const flags = attr(child(workbook, 'workbookPr'), 'date1904');
  if (flags !== undefined && !['0', '1', 'true', 'false'].includes(flags)) fail();
  const dateSystem = ['1', 'true'].includes(flags) ? 'EXCEL_1904' : 'EXCEL_1900';
  const sheets = children(child(workbook, 'sheets'), 'sheet');
  if (new Set(sheets.map(sheet => attr(sheet, 'name'))).size !== sheets.length) fail();
  const selected = sheets.find(sheet => attr(sheet, 'name') === sheetName);
  if (!selected) fail('PT2030_PLAN_SHEET_NOT_FOUND');
  const id = attr(selected, 'id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships');
  const relationships = children(entries.get('xl/_rels/workbook.xml.rels')?.root, 'Relationship', REL);
  if (new Set(relationships.map(rel => attr(rel, 'Id'))).size !== relationships.length) fail();
  const relation = relationships.find(rel => attr(rel, 'Id') === id);
  if (!relation || !/\/worksheet$/.test(attr(relation, 'Type'))) fail();
  const sheetPart = relationshipTarget('xl/workbook.xml', attr(relation, 'Target'));
  const sheet = entries.get(sheetPart.toLowerCase())?.root;
  if (sheet?.uri !== NS || sheet.local !== 'worksheet') fail();
  const sharedRelation = relationships.filter(rel => /\/sharedStrings$/.test(attr(rel, 'Type')));
  if (sharedRelation.length > 1) fail();
  const sharedRoot = sharedRelation.length ? entries.get(relationshipTarget('xl/workbook.xml', attr(sharedRelation[0], 'Target')).toLowerCase())?.root : null;
  if (sharedRelation.length && (sharedRoot?.local !== 'sst' || sharedRoot.uri !== NS)) fail();
  const shared = sharedRoot ? children(sharedRoot, 'si').map(richText) : [];
  const stylesRelation = relationships.filter(rel => /\/styles$/.test(attr(rel, 'Type')));
  if (stylesRelation.length > 1) fail();
  const styles = stylesRelation.length ? entries.get(relationshipTarget('xl/workbook.xml', attr(stylesRelation[0], 'Target')).toLowerCase())?.root : null;
  if (stylesRelation.length && (styles?.uri !== NS || styles.local !== 'styleSheet')) fail();
  const formats = new Map([['0', 'General'], ['1', '0'], ['2', '0.00'], ['3', '#,##0'], ['4', '#,##0.00']]);
  const customFormats = new Set();
  for (const format of children(child(styles, 'numFmts'), 'numFmt')) {
    const id = attr(format, 'numFmtId'), code = attr(format, 'formatCode');
    if (!/^\d{1,5}$/.test(id || '') || Number(id) < 164 || typeof code !== 'string' || customFormats.has(id)) fail();
    formats.set(id, code); customFormats.add(id);
  }
  const cellFormats = children(child(styles, 'cellXfs'), 'xf'), baseFormats = children(child(styles, 'cellStyleXfs'), 'xf');
  function moneyFormat(styleIndex) {
    if (!styles) { if (styleIndex === null || styleIndex === 0) return; fail('PT2030_PLAN_MONEY_FORMAT_UNSUPPORTED'); }
    const format = cellFormats[styleIndex ?? 0];
    if (!format) fail('PT2030_PLAN_MONEY_FORMAT_UNSUPPORTED');
    const baseIndex = attr(format, 'xfId') || '0';
    if (!/^\d{1,5}$/.test(baseIndex)) fail();
    const base = baseFormats[+baseIndex];
    const id = ['0', 'false'].includes(attr(format, 'applyNumberFormat')) ? attr(base, 'numFmtId') || '0' : attr(format, 'numFmtId') ?? attr(base, 'numFmtId') ?? '0';
    if (!['General', '0', '0.00', '#,##0', '#,##0.00'].includes(formats.get(id))) fail('PT2030_PLAN_MONEY_FORMAT_UNSUPPORTED');
  }
  const moneyColumnStyles = [];
  for (const column of children(child(sheet, 'cols'), 'col')) {
    const min = attr(column, 'min'), max = attr(column, 'max'), style = attr(column, 'style');
    if (!/^[1-9]\d{0,4}$/.test(min || '') || !/^[1-9]\d{0,4}$/.test(max || '') || +min > +max || +max > 16384) fail();
    if (+min <= 8 && +max >= 8 && style !== undefined) {
      if (!/^\d{1,5}$/.test(style)) fail();
      moneyColumnStyles.push(+style);
    }
  }
  const rows = new Map(); let cellCount = 0;
  for (const row of children(child(sheet, 'sheetData'), 'row')) {
    const rowNumber = attr(row, 'r');
    if (!/^[1-9]\d{0,6}$/.test(rowNumber || '') || +rowNumber > 1048576 || rows.has(+rowNumber)) fail();
    const cells = {};
    for (const cell of children(row, 'c')) {
      if (++cellCount > LIMITS.maxCells) fail('PT2030_PLAN_LIMIT_EXCEEDED');
      const address = attr(cell, 'r'), match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(address || '');
      if (!match || +match[2] !== +rowNumber || Object.hasOwn(cells, match[1])) fail();
      const type = attr(cell, 't') || 'n', rawValue = child(cell, 'v')?.text ?? null;
      let value = rawValue;
      if (type === 's') {
        if (!/^(?:0|[1-9]\d*)$/.test(rawValue || '') || +rawValue >= shared.length) fail();
        value = shared[+rawValue];
      } else if (type === 'inlineStr') value = richText(child(cell, 'is'));
      else if (!['n', 'str', 'b', 'e', 'd'].includes(type)) fail();
      const style = attr(cell, 's');
      if (style !== undefined && !/^(?:0|[1-9]\d{0,7})$/.test(style)) fail();
      cells[match[1]] = { address, type, styleIndex: style === undefined ? null : +style, rawValue, value };
      if (+rowNumber > 2 && match[1] === 'H' && value !== null && value.trim()) {
        moneyFormat(cells.H.styleIndex);
        // Conservative admission covers every source of inherited formatting,
        // without pretending to evaluate Excel's rendering precedence.
        for (const columnStyle of moneyColumnStyles) moneyFormat(columnStyle);
        const rowStyle = attr(row, 's');
        if (rowStyle !== undefined) { if (!/^\d{1,5}$/.test(rowStyle)) fail(); moneyFormat(+rowStyle); }
      }
    }
    rows.set(+rowNumber, cells);
  }
  const title = rows.get(1)?.A?.value;
  if (typeof title !== 'string' || title.normalize('NFC').trim() !== 'Plano Anual de Avisos') fail('PT2030_PLAN_DOCUMENT_CONTEXT_REQUIRED');
  for (const [line, cells] of rows) for (const [col, cell] of Object.entries(cells)) {
    if (!COLUMNS.includes(col) && cell.value !== null && cell.value.trim() !== '') fail('PT2030_PLAN_HEADERS_CHANGED');
    if (line === 1 && col !== 'A' && cell.value !== null && cell.value.trim() !== '') fail('PT2030_PLAN_HEADERS_CHANGED');
  }
  if (HEADERS.some((name, index) => rows.get(2)?.[COLUMNS[index]]?.value?.normalize('NFC').trim() !== name)) fail('PT2030_PLAN_HEADERS_CHANGED');
  const records = [...rows].filter(([line, cells]) => line > 2 && Object.values(cells).some(cell => cell.value !== null && cell.value.trim() !== '')).sort(([left], [right]) => left - right);
  if (!records.length) fail('PT2030_PLAN_WORKBOOK_EMPTY');
  if (records.length > MAX_ROWS) fail('PT2030_PLAN_LIMIT_EXCEEDED');
  let documentModifiedAt = null;
  const core = entries.get('docprops/core.xml')?.root;
  if (core) { const modified = children(core, 'modified', 'http://purl.org/dc/terms/'); if (modified.length > 1) fail(); documentModifiedAt = modified[0]?.text || null; }
  return { dateSystem, documentModifiedAt, rows: records.map(([physicalRow, cells]) => ({ physicalRow, sourceCells: Object.fromEntries(COLUMNS.map(col => [col, cells[col] || { address: col + physicalRow, type: null, styleIndex: null, rawValue: null, value: null }])) })) };
}
async function listPlanSheets(buffer) {
  const entries = await readParts(Buffer.from(buffer));
  inspectPackage(entries);
  const workbook = entries.get('xl/workbook.xml')?.root;
  if (workbook?.local !== 'workbook' || workbook.uri !== NS) fail();
  const sheets = children(child(workbook, 'sheets'), 'sheet').map(sheet => attr(sheet, 'name'));
  if (!sheets.length || sheets.length > 100 || sheets.some(name => typeof name !== 'string' || !name.trim() || name.length > 31) || new Set(sheets).size !== sheets.length) fail();
  return sheets;
}
module.exports = { readPlanWorkbook, listPlanSheets, MAX_BYTES, MAX_ROWS, LIMITS, HEADERS, COLUMNS, fail };
