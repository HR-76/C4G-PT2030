'use strict';
const xlsx = require('xlsx');
const { validateSnapshotV2, normalizers: n } = require('../opportunities/v2');
const { sourceDescription } = require('./sourceDescription');
const { createOfficialProgrammeEvidenceV2, verifyOfficialProgrammeEvidenceV2, DOCUMENTS, invalid } = require('./officialEvidenceV2');
const MAPPING_VERSION = 'official-programmes-v2.0';
const present = (value, evidenceRefs) => ({ state: 'PRESENT', value, evidenceRefs, reason: null });
const absent = (reason = 'OUTSIDE_MAPPING_COVERAGE', evidenceRefs = [], state = 'NOT_COLLECTED') => ({ state, value: null, evidenceRefs, reason });
const plain = value => (sourceDescription(String(value ?? '').replace(/\[\/?vc_[^\]]*\]/g, ''), 2 * 1024 * 1024) || '').replace(/\s+/g, ' ').normalize('NFC').trim();
const header = value => plain(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const concept = (label, scheme) => ({ key: n.conceptKey(scheme, label), sourceId: null, code: null, label, scheme, schemeVersion: null, mapping: 'UNMAPPED' });
function civil(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) invalid('OFFICIAL_V2_CALENDAR_INVALID');
  return n.civilDate(`${match[3]}-${match[2]}-${match[1]}`);
}
function money(raw, source) {
  let match;
  if (source === 'INTERREG_EUROPE') {
    match = /^EUR ([0-9]+(?:\.[0-9]+)?) million$/.exec(raw);
    if (match) return { amount: n.decimal(match[1], { scale: 6 }), initial: false };
  } else {
    match = /^([0-9]+(?:\.[0-9]+)?) M€(?: \((inicial)\))?$/.exec(raw);
    if (match) return { amount: n.decimal(match[1], { scale: 6 }), initial: Boolean(match[2]) };
    match = /^([0-9]+(?:\.[0-9]{3})*(?:,[0-9]+)?) €(?: \((inicial)\))?$/.exec(raw);
    if (match) return { amount: n.decimal(match[1], { decimalSeparator: ',', groupSeparator: '.' }), initial: Boolean(match[2]) };
  }
  invalid('OFFICIAL_V2_MONEY_UNSUPPORTED');
}
function interregRows(bytes) {
  // Reuse the existing ZIP bounds and fail-closed workbook contract. The lazy
  // import avoids a dependency cycle when the source enables this adapter.
  require('./officialSources').parseInterreg(bytes);
  const wb = xlsx.read(bytes, { type: 'buffer', cellDates: false, cellFormula: true, sheetRows: 110 });
  const sheet = wb.Sheets[wb.SheetNames[0]], matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const at = matrix.findIndex(row => row.some(value => plain(value) === 'Call number'));
  const heads = matrix[at].map(plain), expected = ['Call number', 'Geographical area covered by the call*', 'Policy objective or specific objective concerned**', 'Type of eligible applicants', 'Total amount of support for the call***', 'Start date of the call', 'End date of the call', 'Comment'];
  if (heads.length !== expected.length || expected.some(value => heads.filter(head => head === value).length !== 1)
    || plain(matrix[0][0]) !== 'Interreg Europe programme: timetable of the planned calls') invalid('OFFICIAL_V2_SCHEMA_CHANGED');
  const rows = [];
  for (let index = at + 1; index < matrix.length; index++) {
    const row = matrix[index], title = plain(row[heads.indexOf('Call number')]);
    const number = { 'First call': 1, 'Second call': 2, 'Third call': 3 }[title];
    if (!number) continue; // The legacy parser has already rejected unknown rows.
    const value = key => row[heads.indexOf(key)];
    const cell = key => wb.SheetNames[0] + '!' + xlsx.utils.encode_cell({ r: index, c: heads.indexOf(key) });
    if (plain(value('Comment')) !== 'Confirmed') invalid('OFFICIAL_V2_PUBLICATION_UNSUPPORTED');
    const date = key => { const raw = value(key); if (!Number.isSafeInteger(raw)) invalid(); return n.excelDate(String(raw)); };
    rows.push({ number, title, opening: date('Start date of the call'), closing: date('End date of the call'), budget: money(plain(value('Total amount of support for the call***')), 'INTERREG_EUROPE'),
      status: null, locator: cell('Call number'), moneyLocator: cell('Total amount of support for the call***'), openingLocator: cell('Start date of the call'), closingLocator: cell('End date of the call'),
      programmeLocator: wb.SheetNames[0] + '!A1', publicationLocator: cell('Comment'), sheet: wb.SheetNames[0] });
  }
  return rows;
}
function tables(html) {
  if (typeof html !== 'string' || Buffer.byteLength(html) > 2 * 1024 * 1024) invalid();
  const found = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)];
  if (!found.length || found.length > 20) invalid('OFFICIAL_V2_SCHEMA_CHANGED');
  const out = [];
  found.forEach((table, tableIndex) => {
    if (/<table\b/i.test(table[1])) invalid();
    const tr = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
    const cells = row => [...row.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)].map(match => {
      if (/(?:rowspan|colspan)\s*=\s*["']?(?!1(?:["'\s>]|$))\d/i.test(match[2])) invalid();
      return plain(match[3]);
    });
    const heads = tr.length ? cells(tr[0][1]).map(header) : [];
    if (!heads.includes('convocatoria')) return;
    const required = ['convocatoria', 'prioridad', 'feder', 'apertura', 'cierre', 'resolucion'];
    if (required.some(key => heads.filter(head => head === key).length !== 1) || heads.some(key => !required.includes(key) && key !== 'documentos') || new Set(heads).size !== heads.length) invalid('OFFICIAL_V2_SCHEMA_CHANGED');
    tr.slice(1).forEach((entry, rowIndex) => {
      const values = cells(entry[1]);
      if (values.every(value => !value)) return;
      if (values.length !== heads.length || out.length >= 100) invalid();
      const value = key => values[heads.indexOf(key)], label = value('convocatoria');
      const number = /^(\d{1,3})[.\s]*[ªa]\s+Convocatoria\b/i.exec(label);
      if (!number || +number[1] < 1) invalid();
      const locator = key => `/content/rendered :: table[${tableIndex + 1}]/tr[${rowIndex + 2}]/td[${heads.indexOf(key) + 1}]`;
      const statusMatches = [...label.matchAll(/\((ABIERTA|CERRADA)\)/gi)].map(match => match[1].toUpperCase());
      if (new Set(statusMatches).size > 1) invalid('OFFICIAL_V2_CONFLICT');
      out.push({ number: +number[1], title: n.text(label.replace(/\s*\((?:ABIERTA|CERRADA)\)/gi, ''), { maxLength: 300 }),
        opening: civil(value('apertura')), closing: civil(value('cierre')), budget: money(value('feder'), 'POCTEP'), status: statusMatches[0] || null,
        locator: locator('convocatoria'), moneyLocator: locator('feder'), fundLocator: `/content/rendered :: table[${tableIndex + 1}]/tr[1]/cell[${heads.indexOf('feder') + 1}]`, openingLocator: locator('apertura'), closingLocator: locator('cierre'),
        publicationLocator: locator('convocatoria'), programmeLocator: '/content/rendered :: programme-heading',
        section: html.slice(table.index + table[0].length, found[tableIndex + 1]?.index ?? html.length), sectionLocator: `/content/rendered :: after-table[${tableIndex + 1}]` });
    });
  });
  if (!out.length) invalid('OFFICIAL_V2_SCHEMA_CHANGED');
  return out;
}
function page(document, expectedId, expectedUrl) {
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(document.bodyBase64, 'base64'))); } catch { invalid(); }
  if (value?.id !== expectedId || value.link !== expectedUrl || typeof value.content?.rendered !== 'string' || !/POCTEP 2021-2027/.test(plain(value.content.rendered))) invalid();
  return value;
}
function madridInstant(date, hours, minutes) {
  n.civilDate(date);
  if (+hours > 23 || +minutes > 59) invalid('OFFICIAL_V2_CALENDAR_INVALID');
  const local = `${date}T${hours}:${minutes}:00.000`, naive = Date.parse(local + 'Z');
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const matches = [1, 2].map(offset => new Date(naive - offset * 3600000)).filter(instant => {
    const p = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.000` === local;
  });
  if (matches.length !== 1) invalid('OFFICIAL_V2_CALENDAR_AMBIGUOUS');
  return { precision: 'INSTANT', value: matches[0].toISOString(), originalTimezone: 'Europe/Madrid' };
}
function hours(detail) {
  const text = plain(detail.section), sentences = text.match(/El plazo para la presentación de candidaturas[^.]+\./gi) || [];
  if (!sentences.length) return null;
  if (sentences.length !== 1 || !sentences[0].includes('(hora peninsular española)')) invalid('OFFICIAL_V2_TIMEZONE_UNSUPPORTED');
  const monthNames = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const times = [...sentences[0].matchAll(/(?<![0-9])(\d{2}):(\d{2})(?: horas)? del? (?:lunes |martes |miércoles |jueves |viernes |sábado |domingo )?(\d{1,2}) de ([a-zñ]+) de (\d{4})(?![0-9])/gi)];
  if (times.length !== 2) invalid('OFFICIAL_V2_CALENDAR_UNSUPPORTED');
  const values = times.map(match => {
    const month = monthNames.indexOf(match[4].toLowerCase()) + 1;
    if (!month) invalid('OFFICIAL_V2_CALENDAR_UNSUPPORTED');
    const date = n.civilDate(`${match[5]}-${String(month).padStart(2, '0')}-${match[3].padStart(2, '0')}`);
    return { date, at: madridInstant(date, match[1], match[2]) };
  });
  if (values[0].date !== detail.opening || values[1].date !== detail.closing) invalid('OFFICIAL_V2_CONFLICT');
  return { opening: values[0].at, closing: values[1].at, excerpt: sentences[0] };
}
function initialBudget(detail) {
  const sentences = [...plain(detail.section).matchAll(/La ayuda FEDER asignada a (?:esta|la presente) convocatoria asciende a una cantidad prevista inicial de ([0-9]+(?:\.[0-9]+)?) millones de euros/gi)];
  if (sentences.length > 1 || sentences.some(sentence => n.decimal(sentence[1], { scale: 6 }) !== detail.budget.amount)) invalid('OFFICIAL_V2_CONFLICT');
  return sentences.length === 1;
}
function skeleton() {
  return { schemaVersion: 2, contractVersion: 'opportunity-v2.0', identity: { kind: 'CALL', references: absent() }, sourceRecords: [],
    description: { title: absent(), summary: absent(), language: absent() }, programmes: absent(), funds: absent(), parties: absent('FUNDER_ROLE_NOT_COLLECTED'),
    classification: { callNature: absent(), instruments: absent(), specificObjectives: absent(), themes: absent() }, publication: absent(),
    schedule: { plannedOpening: absent(), plannedClosing: absent(), planningPeriod: absent(), opening: absent(), deadlines: absent(), deadlineModel: absent() },
    status: { published: absent(), publishedCode: absent() }, financing: { allocations: absent(), support: absent(), rates: absent(), eligibleCosts: absent() },
    eligibility: { beneficiaryTypes: absent(), territories: absent(), conditions: absent() }, applicationModes: absent(),
    relatedProject: { acronym: absent(), name: absent(), grantAgreementNumber: absent(), url: absent() }, links: { official: absent(), submission: absent(), documents: absent() },
    quality: { ruleVersion: 'opportunity-quality-v2.0', issues: [] }, provenance: { mappingVersion: MAPPING_VERSION, observations: [], evidence: [] } };
}
function adaptOfficialProgrammeV2({ sourceEvidence, externalIdentifier } = {}) {
  const evidence = verifyOfficialProgrammeEvidenceV2(sourceEvidence), source = evidence.source;
  const match = typeof externalIdentifier === 'string' && new RegExp('^' + source + ':2021-2027:CALL:([1-9][0-9]{0,2})$').exec(externalIdentifier);
  if (!match) invalid('OFFICIAL_V2_IDENTITY_INVALID');
  const documents = evidence.documents, primary = documents.find(doc => doc.url === DOCUMENTS[source][0].url);
  const primaryIndex = documents.indexOf(primary), out = skeleton();
  let rows, detail, primaryPage, detailPage, detailIndex;
  if (source === 'INTERREG_EUROPE') rows = interregRows(Buffer.from(primary.bodyBase64, 'base64'));
  else {
    primaryPage = page(primary, 2831, 'https://www.poctep.eu/convocatorias/');
    rows = tables(primaryPage.content.rendered);
    const doc = documents.find(value => value.url === DOCUMENTS.POCTEP[1].url);
    if (doc) {
      detailIndex = documents.indexOf(doc); detailPage = page(doc, 9396, 'https://www.poctep.eu/convocatorias-abiertas-poctep-2021-2027/');
      const details = tables(detailPage.content.rendered);
      for (const candidate of details) {
        const parent = rows.find(row => row.number === candidate.number);
        if (!parent || parent.status === 'CERRADA' || parent.opening !== candidate.opening || parent.closing !== candidate.closing || parent.budget.amount !== candidate.budget.amount) invalid('OFFICIAL_V2_CONFLICT');
        candidate.initialInProse = initialBudget(candidate);
      }
      const matchingDetails = details.filter(value => value.number === +match[1]);
      if (matchingDetails.length > 1) invalid('OFFICIAL_V2_CONFLICT');
      detail = matchingDetails[0];
    }
  }
  const unique = new Map();
  for (const row of rows) {
    if (row.opening > row.closing) invalid('OFFICIAL_V2_CALENDAR_INVALID');
    const previous = unique.get(row.number);
    // Repeated records are only equivalent after comparing every mapped fact.
    if (previous && JSON.stringify([previous.title, previous.opening, previous.closing, previous.budget, previous.status]) !== JSON.stringify([row.title, row.opening, row.closing, row.budget, row.status])) invalid('OFFICIAL_V2_CONFLICT');
    if (!previous) unique.set(row.number, row);
  }
  const row = unique.get(+match[1]);
  if (!row) invalid('OFFICIAL_V2_IDENTITY_NOT_FOUND');
  const sourceKey = externalIdentifier, official = source === 'INTERREG_EUROPE' ? 'https://www.interregeurope.eu/call-for-projects' : detail ? detailPage.link : primaryPage.link;
  out.sourceRecords = [{ key: sourceKey, namespace: source, externalId: externalIdentifier, transport: source === 'INTERREG_EUROPE' ? 'XLSX' : 'HTML', role: 'CALL', url: official }];
  function observation(index, parsed) {
    const doc = documents[index];
    let sourceModifiedAt = null;
    if (parsed?.modified_gmt && parsed.modified_gmt !== '0000-00-00T00:00:00') {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(parsed.modified_gmt)) invalid();
      sourceModifiedAt = n.instant(parsed.modified_gmt + 'Z');
    }
    out.provenance.observations.push({ id: 'document-' + index, sourceRecordKey: sourceKey, observedAt: evidence.observedAt, sourceModifiedAt,
      artifactSha256: doc.sha256, document: source === 'INTERREG_EUROPE' ? { name: 'Calls_planning_web.xlsx', sha256: doc.sha256, sheet: row.sheet } : null,
      coverage: source === 'INTERREG_EUROPE' ? 'SOURCE_FILE' : 'SELECTED_FIELDS' });
  }
  observation(primaryIndex, primaryPage);
  if (detail) observation(detailIndex, detailPage);
  function ref(id, locator, transform = 'TEXT_NFC_TRIM', index = primaryIndex, excerpt = null, locatorType = source === 'INTERREG_EUROPE' ? 'CELL' : 'DOCUMENT') {
    out.provenance.evidence.push({ id, observationId: 'document-' + index, locatorType, locator, excerpt, transform }); return id;
  }
  const callRef = ref('call', row.locator), programmeRef = ref('programme', row.programmeLocator), budgetRef = ref('budget', row.moneyLocator, 'EXACT_LOCALIZED_DECIMAL_WITH_SCALE');
  const currencyRef = ref('currency', row.moneyLocator, source === 'INTERREG_EUROPE' ? 'EXPLICIT_CURRENCY_CODE' : 'EXPLICIT_EURO_SYMBOL');
  const openingRef = ref('opening', row.openingLocator, source === 'INTERREG_EUROPE' ? 'EXCEL_1900_DATE' : 'DDMMYYYY_CIVIL_DATE');
  const closingRef = ref('closing', row.closingLocator, source === 'INTERREG_EUROPE' ? 'EXCEL_1900_DATE' : 'DDMMYYYY_CIVIL_DATE');
  const issue = (code, field, evidenceRefs) => out.quality.issues.push({ code, field, evidenceRefs });
  out.identity.references = present([{ kind: 'SOURCE_CALL_ID', value: externalIdentifier }, { kind: 'CALL_REFERENCE', value: row.title }], [callRef]);
  out.description.title = present(n.text(row.title, { maxLength: 300 }), [callRef]);
  const programme = concept(source === 'INTERREG_EUROPE' ? 'Interreg Europe' : 'POCTEP 2021-2027', source + '_PROGRAMME_LABEL');
  out.programmes = present([programme], [programmeRef]);
  out.publication = present('PUBLISHED', [ref('publication', row.publicationLocator, 'CONFIRMED_CALL_PUBLICATION')]);
  out.schedule.opening = present({ precision: 'DATE', value: row.opening }, [openingRef]);
  out.schedule.deadlines = present([{ at: { precision: 'DATE', value: row.closing }, phase: null }], [closingRef]);
  out.schedule.deadlineModel = present('SINGLE', [openingRef, closingRef]);
  if (row.status) {
    out.status.published = present(row.status === 'ABIERTA' ? 'OPEN' : 'CLOSED', [callRef]);
    out.status.publishedCode = present(row.status, [callRef]);
  } else {
    out.status.published = absent('STATUS_NOT_DECLARED', [callRef], 'NOT_FOUND');
    out.status.publishedCode = absent('STATUS_NOT_DECLARED', [callRef], 'NOT_FOUND');
  }
  const fund = source === 'POCTEP' ? concept('FEDER', 'POCTEP_FUND_LABEL') : null;
  if (fund) out.funds = present([fund], [ref('fund', row.fundLocator)]);
  const allocationRefs = [budgetRef];
  if (detail?.budget.initial || detail?.initialInProse) allocationRefs.push(ref('initial-budget', detail.initialInProse ? detail.sectionLocator : detail.moneyLocator, 'EXPLICIT_INITIAL_ALLOCATION_QUALIFIER', detailIndex));
  out.financing.allocations = present([{ key: 'allocation-1', money: { amount: row.budget.amount, currency: present('EUR', [currencyRef]), interpretation: row.budget.amount === '0' ? 'ZERO_UNEXPLAINED' : 'PUBLISHED_AMOUNT' },
    scope: source === 'POCTEP' ? 'FUND_ALLOCATION' : 'CALL_TOTAL', basis: 'CONFIRMED', programmeRefs: [programme.key], fundRefs: fund ? [fund.key] : [], period: null, sharedGroup: null, aggregation: 'UNKNOWN', qualifiers: row.budget.initial || detail?.budget.initial || detail?.initialInProse ? ['INITIAL'] : [] }], allocationRefs);
  out.links.official = present(official, [ref('official-link', source === 'POCTEP' ? '/link' : row.programmeLocator, source === 'POCTEP' ? 'OFFICIAL_SOURCE_URL' : 'CONFIGURED_OFFICIAL_SOURCE_URL', detail ? detailIndex : primaryIndex, null, source === 'POCTEP' ? 'JSON_POINTER' : 'CELL')]);
  if (row.budget.amount === '0') issue('ZERO_MEANING_UNCONFIRMED', '/financing/allocations/value/0/money/interpretation', [budgetRef]);
  issue('PROGRAMME_TAXONOMY_UNMAPPED', '/programmes', [programmeRef]);
  issue('ADDITIONAL_FIELDS_NOT_COLLECTED', '/eligibility', [callRef]);
  if (source === 'INTERREG_EUROPE') {
    issue('GENERAL_CALLS_ONLY', '/sourceRecords', [programmeRef]);
    issue('DEADLINE_TIME_NOT_COLLECTED', '/schedule/deadlines', [closingRef]);
  } else {
    issue('BASES_NOT_RECONCILED', '/links/documents', [callRef]);
    if (+match[1] === 10) issue('OFFICIAL_DOCUMENT_TIME_CONFLICT_REQUIRES_REVIEW', '/schedule/deadlines', [closingRef]);
    const exact = detail && hours(detail);
    if (exact) {
      const timeRef = ref('published-hours', detail.sectionLocator, 'EUROPE_MADRID_LOCAL_TIME_TO_UTC', detailIndex, exact.excerpt);
      out.schedule.opening = present(exact.opening, [openingRef, timeRef]);
      out.schedule.deadlines = present([{ at: exact.closing, phase: null }], [closingRef, timeRef]);
    } else issue('DEADLINE_TIME_NOT_COLLECTED', '/schedule/deadlines', [closingRef]);
  }
  return validateSnapshotV2(out);
}
module.exports = { createOfficialProgrammeEvidenceV2, verifyOfficialProgrammeEvidenceV2, adaptOfficialProgrammeV2, MAPPING_VERSION };
