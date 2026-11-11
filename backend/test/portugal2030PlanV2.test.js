'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { crc32 } = require('node:zlib');
const yauzl = require('yauzl');
const { inspectPlanXlsxV2, planPreviewDigest, MAX_BYTES } = require('../src/portugal2030/planXlsxV2');
const { semanticSnapshotV2 } = require('../src/opportunities/v2');
const corpus = path.resolve(__dirname, '../../context/references/opportunity-v2');
const filename = 'PlanoAnualAvisos_download_140926-1.xlsx';
const original = fs.readFileSync(path.join(__dirname, 'fixtures/portugal2030', filename));
const options = { filename, sheetName: 'Sheet1', observedAt: '2026-10-30T22:47:58.470Z' };
const expected = JSON.parse(fs.readFileSync(path.join(corpus, 'pt2030-expected-177.json'), 'utf8'));
async function parts() {
  const zip = await yauzl.fromBufferPromise(original); const result = {};
  for await (const entry of zip.eachEntry()) {
    const stream = await zip.openReadStreamPromise(entry), chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    result[entry.fileName] = Buffer.concat(chunks);
  }
  zip.close(); return result;
}
// Minimal stored ZIP fixtures exercise the parser without calculating cells.
function pack(entries) {
  const locals = [], central = []; let offset = 0;
  for (const [name, raw] of Object.entries(entries)) {
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw), key = Buffer.from(name);
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x800, 6);
    head.writeUInt32LE(crc32(data), 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(key.length, 26);
    locals.push(head, key, data);
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x800, 8);
    dir.writeUInt32LE(crc32(data), 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(key.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, key); offset += head.length + key.length + data.length;
  }
  const c = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(c.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, c, end]);
}
async function modified(edit) { const p = await parts(); edit(p); return pack(p); }
function changeCell(p, address, inner, type = 'n') {
  const key = 'xl/worksheets/sheet1.xml';
  p[key] = p[key].toString().replace(new RegExp('<c\\b[^>]*\\br="' + address + '"[^>]*>[\\s\\S]*?<\\/c>'), '<c r="' + address + '" t="' + type + '">' + inner + '</c>');
}
function projection(row) {
  const s = row.canonicalSnapshot, labels = fact => fact.value.map(item => item.label);
  return { physicalRow: row.physicalRow, externalId: row.externalIdentifier, sourceColumnsDigest: row.sourceColumnsDigest,
    title: s.description.title.value, beneficiaryLabels: labels(s.eligibility.beneficiaryTypes), callNature: s.classification.callNature.value.label,
    programmeLabels: labels(s.programmes), specificObjectiveRaw: row.sourceCells.F.value.trim().normalize('NFC'), fundLabels: labels(s.funds),
    allocationAmount: s.financing.allocations.value[0].money.amount, currency: s.financing.allocations.value[0].money.currency.value,
    plannedOpening: s.schedule.plannedOpening.value.value, plannedClosing: s.schedule.plannedClosing.value.value,
    planningPeriodLabel: s.schedule.planningPeriod.value.label, territoryLabels: s.eligibility.territories.value.map(item => item.concept.label),
    applicationModeLabels: labels(s.applicationModes), publicationStage: s.publication.value, publishedState: s.status.published.value, confirmedDeadlines: s.schedule.deadlines.value };
}

test('PT plan reads all177 normative rows and preserves all13 source columns and five complete snapshots', async () => {
  const result = await inspectPlanXlsxV2(original, options);
  assert.equal(result.fileDigest, expected.sourceSha256); assert.equal(result.totalRows, 177); assert.equal(result.validRows, 177); assert.equal(result.errorRows, 0);
  assert.deepEqual(result.rows.map(projection), expected.rows);
  const raw = JSON.parse(fs.readFileSync(path.join(corpus, 'evidence/pt2030-plan-177.json'), 'utf8'));
  for (const row of result.rows) assert.deepEqual(row.sourceCells, raw.rows.find(item => item.physicalRow === row.physicalRow).cells);
  for (const id of ['8485', '8514', '8583', '8614', '8664']) {
    const reference = JSON.parse(fs.readFileSync(path.join(corpus, 'examples/pt2030-' + id + '.json'), 'utf8'));
    assert.deepEqual(semanticSnapshotV2(result.rows.find(row => row.externalIdentifier === id).canonicalSnapshot), semanticSnapshotV2(reference), id);
    assert.deepEqual(result.rows.find(row => row.externalIdentifier === id).canonicalSnapshot, reference, id + ' complete normative snapshot');
  }
  assert.ok(Object.isFrozen(result.rows[0].canonicalSnapshot));
});

test('PT hash and evidence are bound to immutable input bytes during async extraction', async () => {
  const callerBuffer = Buffer.from(original), pending = inspectPlanXlsxV2(callerBuffer, options);
  callerBuffer.fill(0);
  const result = await pending;
  assert.equal(result.fileDigest, expected.sourceSha256);
  assert.equal(result.rows[0].canonicalSnapshot.provenance.observations[0].artifactSha256, expected.sourceSha256);
});

test('PT limits reject oversized archives and preview tampering without silently dropping rows', async () => {
  await assert.rejects(inspectPlanXlsxV2(Buffer.alloc(MAX_BYTES + 1), options), { code: 'PT2030_PLAN_LIMIT_EXCEEDED' });
  const preview = await inspectPlanXlsxV2(original, options);
  for (const kind of ['source', 'snapshot', 'count']) {
    const changed = structuredClone(preview);
    if (kind === 'source') changed.rows[0].sourceCells.H.value = '1';
    if (kind === 'snapshot') changed.rows[0].canonicalSnapshot.financing.allocations.value[0].money.amount = '1';
    if (kind === 'count') changed.totalRows--;
    assert.throws(() => planPreviewDigest(changed), { code: 'PT2030_PLAN_PREVIEW_INVALID' });
  }
});

test('PT preview intent binds raw XML lexemes and styles independently of the normative column digest', async () => {
  const preview = await inspectPlanXlsxV2(original, options);
  for (const key of ['rawValue', 'styleIndex']) {
    const changed = structuredClone(preview);
    changed.rows[0].sourceCells.H[key] = key === 'rawValue' ? '510000.00' : 0;
    assert.equal(changed.rows[0].sourceColumnsDigest, preview.rows[0].sourceColumnsDigest);
    assert.notEqual(planPreviewDigest(changed), preview.previewDigest, key);
  }
});

test('PT money never crosses Number and zero remains an observed unexplained zero', async () => {
  const buffer = await modified(p => changeCell(p, 'H3', '<v>999999999999999999999999.12345678</v>'));
  const result = await inspectPlanXlsxV2(buffer, options);
  assert.equal(result.rows[0].canonicalSnapshot.financing.allocations.value[0].money.amount, '999999999999999999999999.12345678');
  const zero = result.rows.find(row => row.externalIdentifier === '8664').canonicalSnapshot;
  assert.equal(zero.financing.allocations.value[0].money.interpretation, 'ZERO_UNEXPLAINED');
  assert.equal(zero.financing.allocations.value[0].money.currency.state, 'NOT_FOUND');
});

test('PT workbook date1904 is honored and invalid1900/fractional serials are row errors', async () => {
  const date1904 = await modified(p => { p['xl/workbook.xml'] = p['xl/workbook.xml'].toString().replace('date1904="false"', 'date1904="true"'); changeCell(p, 'I3', '<v>0</v>'); changeCell(p, 'J3', '<v>1</v>'); });
  const result = await inspectPlanXlsxV2(date1904, options);
  assert.equal(result.dateSystem, 'EXCEL_1904');
  assert.equal(result.rows[0].canonicalSnapshot.schedule.plannedOpening.value.value, '1904-01-01');
  assert.equal(result.rows[0].canonicalSnapshot.schedule.plannedClosing.value.value, '1904-01-02');
  for (const serial of ['60', '1.5', '-1']) {
    const invalid = await inspectPlanXlsxV2(await modified(p => changeCell(p, 'I3', '<v>' + serial + '</v>')), options);
    assert.equal(invalid.totalRows, 177); assert.equal(invalid.errorRows, 1); assert.equal(invalid.rows[0].canonicalSnapshot, null);
  }
});

test('PT formulas are rejected in every source column without evaluating cached values', async () => {
  for (const col of 'ABCDEFGHIJKLM') await assert.rejects(inspectPlanXlsxV2(await modified(p => changeCell(p, col + '3', '<f>1+1</f><v>2</v>')), options), { code: 'PT2030_PLAN_FORMULA_FORBIDDEN' });
});

test('PT source contract rejects extra/duplicate headers and unknown populated columns', async () => {
  await assert.rejects(inspectPlanXlsxV2(await modified(p => changeCell(p, 'B2', '<is><t>ID</t></is>', 'inlineStr')), options), { code: 'PT2030_PLAN_HEADERS_CHANGED' });
  await assert.rejects(inspectPlanXlsxV2(await modified(p => { p['xl/worksheets/sheet1.xml'] = p['xl/worksheets/sheet1.xml'].toString().replace('</row>', '<c r="N1" t="inlineStr"><is><t>New source column</t></is></c></row>'); }), options), { code: 'PT2030_PLAN_HEADERS_CHANGED' });
});

test('PT duplicate identities retain both source rows as conflicts and never select a winner', async () => {
  const result = await inspectPlanXlsxV2(await modified(p => changeCell(p, 'A4', '<v>8485</v>')), options);
  assert.equal(result.totalRows, 177); assert.equal(result.errorRows, 2); assert.equal(result.validRows, 175);
  for (const row of result.rows.slice(0, 2)) { assert.equal(row.canonicalSnapshot, null); assert.ok(row.errors.includes('PT2030_PLAN_DUPLICATE_ID')); assert.equal(Object.keys(row.sourceCells).length, 13); }
});

test('PT missing values stay unavailable while malformed/inverted data are accounted for', async () => {
  const result = await inspectPlanXlsxV2(await modified(p => { changeCell(p, 'H3', ''); changeCell(p, 'I4', '<v>50000</v>'); changeCell(p, 'H5', '<v>-10</v>'); }), options);
  assert.equal(result.totalRows, 177); assert.equal(result.validRows, 175); assert.equal(result.errorRows, 2);
  assert.equal(result.rows[0].canonicalSnapshot.financing.allocations.state, 'NOT_FOUND');
  assert.equal(result.rows[0].canonicalSnapshot.financing.allocations.value, null);
});

test('PT observations do not change preview meaning; edition changes include all columns', async () => {
  const first = await inspectPlanXlsxV2(original, options), later = await inspectPlanXlsxV2(original, { ...options, observedAt: '2027-01-01T00:00:00.000Z' });
  assert.equal(first.mappingDigest, later.mappingDigest); assert.equal(first.previewDigest, later.previewDigest); assert.equal(first.rows[0].contentDigest, later.rows[0].contentDigest);
  assert.notEqual(first.rows[0].canonicalSnapshot.provenance.observations[0].observedAt, later.rows[0].canonicalSnapshot.provenance.observations[0].observedAt);
  const changed = await inspectPlanXlsxV2(await modified(p => changeCell(p, 'K3', '<is><t>Q2</t></is>', 'inlineStr')), options);
  assert.notEqual(first.previewDigest, changed.previewDigest); assert.notEqual(first.rows[0].sourceColumnsDigest, changed.rows[0].sourceColumnsDigest); assert.notEqual(first.rows[0].contentDigest, changed.rows[0].contentDigest);
  assert.equal(first.rows[0].canonicalSnapshot.publication.value, 'PLANNED');
  assert.equal(first.rows[0].canonicalSnapshot.schedule.deadlines.state, 'NOT_FOUND');
});

test('PT external relationships, DTD, workbook errors and active options fail explicitly', async () => {
  await assert.rejects(inspectPlanXlsxV2(await modified(p => { p['xl/_rels/workbook.xml.rels'] = p['xl/_rels/workbook.xml.rels'].toString().replace('Target="theme/theme1.xml"', 'Target="https://example.org/source.xml" TargetMode="External"'); }), options), { code: 'PT2030_PLAN_EXTERNAL_LINK_FORBIDDEN' });
  await assert.rejects(inspectPlanXlsxV2(await modified(p => { p['xl/sharedStrings.xml'] = p['xl/sharedStrings.xml'].toString().replace('<sst ', '<!DOCTYPE sst [<!ENTITY a "unsafe">]><sst '); }), options), { code: 'PT2030_PLAN_XML_INVALID' });
  await assert.rejects(inspectPlanXlsxV2(Buffer.from('broken'), options));
  let invoked = false; const active = { ...options }; Object.defineProperty(active, 'filename', { enumerable: true, get() { invoked = true; return filename; } });
  await assert.rejects(inspectPlanXlsxV2(original, active)); assert.equal(invoked, false);
});

test('PT changed monetary display semantics cannot masquerade as an absent currency', async () => {
  const buffer = await modified(p => { p['xl/styles.xml'] = p['xl/styles.xml'].toString().replace('numFmtId="170" formatCode="#,##0.00"', 'numFmtId="170" formatCode="#,##0.00 &quot;EUR&quot;"'); });
  await assert.rejects(inspectPlanXlsxV2(buffer, options), { code: 'PT2030_PLAN_MONEY_FORMAT_UNSUPPORTED' });
  for (const kind of ['row', 'column', 'conditional']) {
    const inherited = await modified(p => {
      let sheet = p['xl/worksheets/sheet1.xml'].toString();
      if (kind === 'row') sheet = sheet.replace('r="3" customFormat="false"', 'r="3" s="4" customFormat="true"');
      if (kind === 'column') sheet = sheet.replace('max="13" min="4" style="0"', 'max="13" min="4" style="4"');
      if (kind === 'conditional') sheet = sheet.replace('</worksheet>', '<conditionalFormatting sqref="H3"><cfRule type="expression" priority="1"><formula>TRUE</formula></cfRule></conditionalFormatting></worksheet>');
      p['xl/worksheets/sheet1.xml'] = sheet;
    });
    await assert.rejects(inspectPlanXlsxV2(inherited, options), { code: 'PT2030_PLAN_MONEY_FORMAT_UNSUPPORTED' }, kind);
  }
});

test('PT OOXML text escapes are decoded once without corrupting protected literal escapes', async () => {
  const result = await inspectPlanXlsxV2(await modified(p => {
    changeCell(p, 'D3', '<is><t>Alpha_x0020_Beta</t></is>', 'inlineStr');
    changeCell(p, 'D4', '<is><t>A_x005F_x0020_B</t></is>', 'inlineStr');
    p['xl/sharedStrings.xml'] = p['xl/sharedStrings.xml'].toString().replace('CONTRATOS DE IMPACTO SOCIAL', 'CONTRATOS_x0020_DE IMPACTO SOCIAL');
  }), options);
  assert.equal(result.rows[0].canonicalSnapshot.description.title.value, 'Alpha Beta');
  assert.equal(result.rows[1].canonicalSnapshot.description.title.value, 'A_x0020_B');
  const shared = await inspectPlanXlsxV2(await modified(p => { p['xl/sharedStrings.xml'] = p['xl/sharedStrings.xml'].toString().replace('CONTRATOS DE IMPACTO SOCIAL', 'CONTRATOS_x0020_DE IMPACTO SOCIAL'); }), options);
  assert.equal(shared.rows[0].canonicalSnapshot.description.title.value, 'CONTRATOS DE IMPACTO SOCIAL');
});

test('PT XML node budget applies to the entire workbook including unused package parts', async () => {
  const buffer = await modified(p => { p['docProps/extra1.xml'] = '<root>' + '<n/>'.repeat(80000) + '</root>'; p['docProps/extra2.xml'] = '<root>' + '<n/>'.repeat(80000) + '</root>'; });
  await assert.rejects(inspectPlanXlsxV2(buffer, options), { code: 'PT2030_PLAN_LIMIT_EXCEEDED' });
});
