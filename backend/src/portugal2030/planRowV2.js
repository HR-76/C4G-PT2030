'use strict';
const { validateSnapshotV2, normalizers: n } = require('../opportunities/v2');
const { cloneData } = require('../opportunities/v2/data');
const { COLUMNS, fail } = require('./planXlsxReader');
const MAPPING_VERSION = 'pt2030-plan-xlsx-v2.0', SOURCE_NAMESPACE = 'PORTUGAL2030_PLAN';
const present = (value, evidenceRefs) => ({ state: 'PRESENT', value, evidenceRefs, reason: null });
const missing = (reason = 'NO_COLUMN_IN_SOURCE', evidenceRefs = ['headers']) => ({ state: 'NOT_FOUND', value: null, evidenceRefs, reason });
function contextData(value) {
  const context = cloneData(value, { maxBytes: 4096 });
  if (!context || !Number.isSafeInteger(context.physicalRow) || context.physicalRow < 3 || context.physicalRow > 1048576
    || !['EXCEL_1900', 'EXCEL_1904'].includes(context.dateSystem) || !/^[a-f0-9]{64}$/.test(context.fileDigest)
    || n.instant(context.observedAt) !== context.observedAt
    || context.documentModifiedAt !== null && n.instant(context.documentModifiedAt) !== context.documentModifiedAt) fail('PT2030_PLAN_ROW_INVALID');
  for (const key of ['sheetName', 'filename']) if (n.text(context[key], { maxLength: key === 'sheetName' ? 31 : 255 }) !== context[key]) fail('PT2030_PLAN_ROW_INVALID');
  return context;
}
function validatedCells(input, physicalRow) {
  const cells = cloneData(input, { maxBytes: 256 * 1024 });
  if (!cells || Array.isArray(cells) || Object.keys(cells).length !== 13 || COLUMNS.some(col => !Object.hasOwn(cells, col))) fail('PT2030_PLAN_ROW_INVALID');
  for (const col of COLUMNS) {
    const cell = cells[col];
    if (!cell || cell.address !== col + physicalRow || ![null, 's', 'inlineStr', 'n', 'str', 'b', 'e', 'd'].includes(cell.type)
      || cell.value !== null && typeof cell.value !== 'string' || cell.rawValue !== null && typeof cell.rawValue !== 'string'
      || cell.styleIndex !== null && (!Number.isSafeInteger(cell.styleIndex) || cell.styleIndex < 0)
      || Object.keys(cell).some(key => !['address', 'type', 'styleIndex', 'rawValue', 'value'].includes(key))) fail('PT2030_PLAN_ROW_INVALID');
  }
  return cells;
}
function adaptPlanRowV2(input, rawContext) {
  const context = contextData(rawContext), cells = validatedCells(input, context.physicalRow);
  const text = (col, maxLength = 300) => {
    const cell = cells[col];
    if (cell.value === null || !cell.value.trim()) return null;
    if (['b', 'e'].includes(cell.type)) fail('PT2030_PLAN_CELL_TYPE_INVALID');
    return n.text(cell.value, { maxLength });
  };
  const id = text('A', 128), title = text('D');
  if (!id || !title) fail('PT2030_PLAN_ID_TITLE_REQUIRED');
  if (cells.A.type === 'n' && !/^(?:0|[1-9]\d*)$/.test(id)) fail('PT2030_PLAN_ID_INVALID');
  const ref = col => ['cell-' + col];
  const concept = (label, scheme, code = null) => ({ key: n.conceptKey(scheme, label), sourceId: null, code, label, scheme, schemeVersion: null, mapping: 'UNMAPPED' });
  const one = (col, scheme) => { const value = text(col); return value === null ? missing('CELL_EMPTY', ref(col)) : present(concept(value, scheme), ref(col)); };
  const many = (col, scheme) => { const value = text(col, 10000); return value === null ? missing('CELL_EMPTY', ref(col)) : present(n.list(value).map(label => concept(label, scheme)), ref(col)); };
  const programmes = many('E', 'PT2030_PROGRAMME_LABEL'), fund = one('G', 'PT2030_FUND_LABEL');
  const funds = fund.state === 'PRESENT' ? present([fund.value], fund.evidenceRefs) : fund;
  const objectiveRaw = text('F'), objectiveMatch = objectiveRaw && /^([A-Za-z][A-Za-z0-9.]*)\s+-\s+(.+)$/.exec(objectiveRaw);
  const objectives = objectiveRaw === null ? missing('CELL_EMPTY', ref('F')) : present([concept(objectiveMatch ? objectiveMatch[2] : objectiveRaw, 'PT2030_SPECIFIC_OBJECTIVE', objectiveMatch ? objectiveMatch[1] : null)], ref('F'));
  const date = col => {
    const value = text(col, 30);
    if (value === null) return missing('CELL_EMPTY', ref(col));
    if (cells[col].type !== 'n') fail('PT2030_PLAN_DATE_TYPE_INVALID');
    return present({ precision: 'DATE', value: n.excelDate(value, context.dateSystem === 'EXCEL_1904' ? '1904' : '1900') }, ref(col));
  };
  const period = text('K', 128), amount = text('H', 256);
  if (amount !== null && cells.H.type !== 'n') fail('PT2030_PLAN_MONEY_TYPE_INVALID');
  const normalizedAmount = amount === null ? null : n.decimal(amount);
  const allocation = normalizedAmount === null ? missing('CELL_EMPTY', ref('H')) : present([{ key: 'allocation-1', money: { amount: normalizedAmount,
    currency: missing('CURRENCY_NOT_DECLARED'), interpretation: normalizedAmount === '0' ? 'ZERO_UNEXPLAINED' : 'PUBLISHED_AMOUNT' },
    scope: 'FUND_ALLOCATION', basis: 'PLANNED', programmeRefs: programmes.value?.map(item => item.key) || [], fundRefs: funds.value?.map(item => item.key) || [],
    period: null, sharedGroup: null, aggregation: 'UNKNOWN', qualifiers: [] }], ['cell-H', 'cell-G', 'cell-E']);
  const territories = many('L', 'PT2030_NUTS_II_LABEL');
  if (territories.state === 'PRESENT') territories.value = territories.value.map(value => ({ concept: value, scope: 'UNSPECIFIED' }));
  const sourceKey = 'PT2030_PLAN:' + id, observationId = 'obs-plan-' + id;
  const issues = [];
  if (normalizedAmount !== null) issues.push({ code: 'CURRENCY_NOT_DECLARED', field: '/financing/allocations/value/0/money/currency', evidenceRefs: ['headers'] });
  if (period !== null) issues.push({ code: 'PLANNING_PERIOD_BOUNDS_NOT_DECLARED', field: '/schedule/planningPeriod', evidenceRefs: ['cell-K'] });
  if (programmes.state === 'PRESENT') issues.push({ code: 'TAXONOMY_MAPPING_PENDING', field: '/programmes', evidenceRefs: ['cell-E'] });
  if (territories.state === 'PRESENT') issues.push({ code: 'TERRITORY_TAXONOMY_VERSION_UNKNOWN', field: '/eligibility/territories', evidenceRefs: ['cell-L'] });
  if (programmes.value?.length > 1 && normalizedAmount !== null) issues.push({ code: 'ALLOCATION_NOT_SPLIT_BY_PROGRAMME', field: '/financing/allocations', evidenceRefs: ['cell-E', 'cell-H'] });
  if (normalizedAmount === '0') issues.push({ code: 'ZERO_MEANING_UNCONFIRMED', field: '/financing/allocations/value/0/money/interpretation', evidenceRefs: ['cell-H'] });
  const transforms = { B: 'PIPE_LIST', E: 'PIPE_LIST', H: 'DECIMAL_CANONICAL', I: context.dateSystem + '_DATE', J: context.dateSystem + '_DATE', L: 'PIPE_LIST', M: 'PIPE_LIST' };
  return validateSnapshotV2({ schemaVersion: 2, contractVersion: 'opportunity-v2.0', identity: { kind: 'CALL', references: present([{ kind: 'PLAN_ID', value: id }], ['cell-A']) },
    sourceRecords: [{ key: sourceKey, namespace: SOURCE_NAMESPACE, externalId: id, transport: 'XLSX', role: 'PLAN', url: null }],
    description: { title: present(title, ['cell-D']), summary: missing(), language: missing('LANGUAGE_NOT_DECLARED') }, programmes, funds, parties: missing('PARTIES_NOT_DECLARED'),
    classification: { callNature: one('C', 'PT2030_CALL_NATURE_LABEL'), instruments: missing(), specificObjectives: objectives, themes: missing() }, publication: present('PLANNED', ['document-title']),
    schedule: { plannedOpening: date('I'), plannedClosing: date('J'), planningPeriod: period === null ? missing('CELL_EMPTY', ref('K')) : present({ label: period, scheme: 'PT2030_PLAN_FOUR_MONTH', start: null, end: null }, ref('K')),
      opening: missing('CONFIRMED_CALENDAR_NOT_DECLARED'), deadlines: missing('CONFIRMED_CALENDAR_NOT_DECLARED'), deadlineModel: missing('CONFIRMED_CALENDAR_NOT_DECLARED') },
    status: { published: missing('PUBLICATION_STATUS_NOT_DECLARED'), publishedCode: missing('PUBLICATION_STATUS_NOT_DECLARED') }, financing: { allocations: allocation, support: missing(), rates: missing(), eligibleCosts: missing() },
    eligibility: { beneficiaryTypes: many('B', 'PT2030_BENEFICIARY_LABEL'), territories, conditions: missing() }, applicationModes: many('M', 'PT2030_APPLICATION_MODE_LABEL'),
    relatedProject: { acronym: missing(), name: missing(), grantAgreementNumber: missing(), url: missing() }, links: { official: missing(), submission: missing(), documents: missing() },
    quality: { ruleVersion: 'opportunity-quality-v2.0', issues }, provenance: { mappingVersion: MAPPING_VERSION,
      observations: [{ id: observationId, sourceRecordKey: sourceKey, observedAt: context.observedAt, sourceModifiedAt: context.documentModifiedAt,
        artifactSha256: context.fileDigest, document: { name: context.filename, sha256: context.fileDigest, sheet: context.sheetName }, coverage: 'SOURCE_FILE' }],
      evidence: [...COLUMNS.map(col => ({ id: 'cell-' + col, observationId, locatorType: 'CELL', locator: context.sheetName + '!' + col + context.physicalRow, excerpt: null, transform: transforms[col] || 'TEXT_NFC_TRIM' })),
        { id: 'headers', observationId, locatorType: 'HEADER', locator: context.sheetName + '!A2:M2', excerpt: null, transform: 'IDENTITY' },
        { id: 'document-title', observationId, locatorType: 'DOCUMENT', locator: context.sheetName + '!A1', excerpt: null, transform: 'IDENTITY' }] }
  });
}
module.exports = { adaptPlanRowV2, validatedCells, MAPPING_VERSION, SOURCE_NAMESPACE };
