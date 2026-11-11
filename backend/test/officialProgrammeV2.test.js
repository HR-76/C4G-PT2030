'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createOfficialProgrammeEvidenceV2, verifyOfficialProgrammeEvidenceV2, adaptOfficialProgrammeV2 } = require('../src/fundingTenders/officialAdapterV2');
const { contentDigestV2 } = require('../src/opportunities/v2');
const { SOURCES } = require('../src/fundingTenders/officialSources');
const dir = path.join(__dirname, 'fixtures/official-programmes');
const observedAt = '2026-10-30T23:45:00.000Z';
function evidence(source, current = false, transform = value => value) {
  const documents = source === 'INTERREG_EUROPE'
    ? [{ url: SOURCES.INTERREG_EUROPE.url, mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bodyBase64: fs.readFileSync(path.join(dir, 'interreg.xlsx')).toString('base64') }]
    : ['calendar', 'open'].map((name, index) => ({ url: index ? SOURCES.POCTEP.details : SOURCES.POCTEP.url, mediaType: 'application/json', bodyBase64: Buffer.from(transform(JSON.stringify(JSON.parse(fs.readFileSync(path.join(dir, current ? 'v2' : '', name + '.json'), 'utf8'))), name)).toString('base64') }));
  return createOfficialProgrammeEvidenceV2({ source, observedAt, documents });
}
const snapshot = (source, number, current = false, transform) => adaptOfficialProgrammeV2({ sourceEvidence: evidence(source, current, transform), externalIdentifier: source + ':2021-2027:CALL:' + number });

test('Interreg v2 captures exact call allocations and keeps civil precision, no programme-total duplication', () => {
  for (const number of [1, 2, 3]) {
    const value = snapshot('INTERREG_EUROPE', number);
    assert.equal(value.financing.allocations.value.length, 1);
    assert.equal(value.financing.allocations.value[0].money.amount, '130000000');
    assert.equal(value.financing.allocations.value[0].money.currency.value, 'EUR');
    assert.equal(value.financing.allocations.value[0].scope, 'CALL_TOTAL');
    assert.equal(value.schedule.deadlines.value[0].at.precision, 'DATE');
    assert.equal(value.parties.state, 'NOT_COLLECTED');
    assert.ok(value.quality.issues.some(i => i.code === 'GENERAL_CALLS_ONLY'));
    assert.ok(value.quality.issues.some(i => i.code === 'DEADLINE_TIME_NOT_COLLECTED'));
  }
  assert.equal(snapshot('INTERREG_EUROPE', 3).schedule.deadlines.value[0].at.value, '2024-06-07');
});

test('POCTEP v2 retains all ten rows, exact 52.500 EUR and INITIAL 21 million independently of caps', () => {
  const expected = ['900000', '8900000', '134800000', '53900000', '52500', '110900000', '33700000', '23900000', '10000000', '21000000'];
  expected.forEach((amount, index) => {
    const value = snapshot('POCTEP', index + 1);
    assert.equal(value.financing.allocations.value.length, 1);
    assert.equal(value.financing.allocations.value[0].money.amount, amount);
    assert.equal(value.financing.allocations.value[0].scope, 'FUND_ALLOCATION');
    assert.equal(value.financing.allocations.value[0].money.currency.value, 'EUR');
  });
  assert.deepEqual(snapshot('POCTEP', 10).financing.allocations.value[0].qualifiers, ['INITIAL']);
  assert.equal(snapshot('POCTEP', 9).financing.support.state, 'NOT_COLLECTED');
});

test('POCTEP published Madrid hours become UTC with DST and retain the uncorrected HTML claim', () => {
  const ninth = snapshot('POCTEP', 9), tenth = snapshot('POCTEP', 10);
  assert.deepEqual(ninth.schedule.opening.value, { precision: 'INSTANT', value: '2026-09-09T08:00:00.000Z', originalTimezone: 'Europe/Madrid' });
  assert.equal(ninth.schedule.deadlines.value[0].at.value, '2026-10-21T12:00:00.000Z');
  assert.equal(tenth.schedule.opening.value.value, '2026-09-29T08:00:00.000Z');
  assert.equal(tenth.schedule.deadlines.value[0].at.value, '2026-11-17T13:00:00.000Z');
  assert.ok(tenth.quality.issues.some(i => i.code === 'OFFICIAL_DOCUMENT_TIME_CONFLICT_REQUIRES_REVIEW'));
  assert.ok(tenth.quality.issues.some(i => i.code === 'BASES_NOT_RECONCILED'));
});

test('current integral corpus preserves closed ninth and published GMT modifications without inventing times', () => {
  const ninth = snapshot('POCTEP', 9, true), tenth = snapshot('POCTEP', 10, true);
  assert.equal(ninth.status.published.value, 'CLOSED');
  assert.equal(ninth.schedule.deadlines.value[0].at.precision, 'DATE');
  assert.equal(tenth.schedule.deadlines.value[0].at.value, '2026-11-17T13:00:00.000Z');
  assert.equal(tenth.provenance.observations[0].sourceModifiedAt, '2026-10-21T13:39:54.000Z');
  assert.equal(snapshot('POCTEP', 10).provenance.observations[0].sourceModifiedAt, null);
});

test('evidence binds exact bytes, hashes, source scope and canonical observation time', () => {
  const packet = evidence('POCTEP', true);
  assert.ok(Object.isFrozen(packet.documents[0]));
  for (const mutate of [p => { p.documents[0].sha256 = '0'.repeat(64); }, p => { p.documents[0].bytes++; },
    p => { p.documents[0].bodyBase64 += ' '; }, p => { p.observedAt = '2026-10-30T12:00:00'; },
    p => { p.source = 'EU_FUNDING_TENDERS'; }, p => { p.documents[0].url = 'https://example.com/'; },
    p => { p.untrusted = true; }, p => { p.documents[0].extra = true; }]) {
    const copy = structuredClone(packet); mutate(copy); assert.throws(() => verifyOfficialProgrammeEvidenceV2(copy));
  }
  const keyOrder = JSON.parse(JSON.stringify(packet, (key, value) => value && !Array.isArray(value) && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse()) : value));
  assert.deepEqual(verifyOfficialProgrammeEvidenceV2(keyOrder), packet);
  assert.throws(() => adaptOfficialProgrammeV2({ sourceEvidence: packet, externalIdentifier: 'INTERREG_EUROPE:2021-2027:CALL:10' }));
  assert.throws(() => adaptOfficialProgrammeV2({ sourceEvidence: packet, externalIdentifier: 'POCTEP:2021-2027:CALL:11' }));
});

test('evidence refuses unrelated, duplicated, oversize or noncanonical document transport', () => {
  const packet = evidence('POCTEP');
  const docs = packet.documents.map(({ url, mediaType, bodyBase64 }) => ({ url, mediaType, bodyBase64 }));
  const make = documents => createOfficialProgrammeEvidenceV2({ source: 'POCTEP', observedAt, documents });
  assert.throws(() => make([docs[0], docs[0]]));
  assert.throws(() => make([{ ...docs[0], url: docs[0].url + '?token=secret' }]));
  assert.throws(() => make([{ ...docs[0], mediaType: 'text/html' }]));
  assert.throws(() => make([{ ...docs[0], bodyBase64: Buffer.alloc(2 * 1024 * 1024).toString('base64') }]));
  assert.throws(() => make([docs[1]]));
});

test('POCTEP rejects unsupported budgets, table drift and contradictions rather than claiming completeness', () => {
  for (const transform of [
    text => text.replaceAll('21 M€', '21,5 M€'),
    text => text.replaceAll('52.500 €', '52.50 €'),
    text => text.replaceAll('Apertura', 'Apertura nueva'),
    (text, name) => name === 'open' ? text.replaceAll('21 M€', '22 M€') : text,
    (text, name) => name === 'open' ? text.replaceAll('17/11/2026', '18/11/2026') : text,
    (text, name) => name === 'open' ? text.replaceAll('17 de noviembre de 2026', '18 de noviembre de 2026') : text,
    (text, name) => name === 'open' ? text.replaceAll('hora peninsular española', 'hora local') : text,
    text => text.replaceAll('17/11/2026', '31/02/2026')
  ]) assert.throws(() => snapshot('POCTEP', 10, false, transform));
});

test('explicit zero survives; million scaling is exact decimal arithmetic', () => {
  const zero = snapshot('POCTEP', 5, false, text => text.replaceAll('52.500 €', '0 €'));
  assert.equal(zero.financing.allocations.value[0].money.amount, '0');
  assert.equal(zero.financing.allocations.value[0].money.interpretation, 'ZERO_UNEXPLAINED');
  assert.ok(zero.quality.issues.some(i => i.code === 'ZERO_MEANING_UNCONFIRMED'));
  const fractional = snapshot('POCTEP', 1, false, text => text.replaceAll('0.9 M€', '0.12345678901234 M€'));
  assert.equal(fractional.financing.allocations.value[0].money.amount, '123456.78901234');
  assert.throws(() => snapshot('POCTEP', 1, false, text => text.replaceAll('0.9 M€', '0.123456789012345 M€')));
});

test('Madrid DST gaps and folds cannot silently choose an instant', () => {
  for (const [date, month, day] of [['29/03/2026', 'marzo', '29'], ['25/10/2026', 'octubre', '25']]) {
    assert.throws(() => snapshot('POCTEP', 10, true, text => text
      .replaceAll('29/09/2026', '01/01/2026').replaceAll('17/11/2026', date)
      .replaceAll('29 de septiembre de 2026', '1 de enero de 2026')
      .replaceAll('14:00 del martes', '02:30 del domingo')
      .replaceAll('17 de noviembre de 2026', `${day} de ${month} de 2026`)), { code: 'OFFICIAL_V2_CALENDAR_AMBIGUOUS' });
  }
});

test('malformed published hours cannot be parsed as a valid numeric suffix', () => {
  assert.throws(() => snapshot('POCTEP', 10, false, text => text.replaceAll('desde las 10:00 del martes', 'desde las 110:00 del martes')), { code: 'OFFICIAL_V2_CALENDAR_UNSUPPORTED' });
});

test('observation refresh does not revise unchanged factual content; title edits keep identity', () => {
  const packet = evidence('POCTEP', true);
  const refreshed = createOfficialProgrammeEvidenceV2({ source: packet.source, observedAt: '2026-10-31T12:00:00.000Z', documents: packet.documents.map(({ url, mediaType, bodyBase64 }) => ({ url, mediaType, bodyBase64 })) });
  const first = adaptOfficialProgrammeV2({ sourceEvidence: packet, externalIdentifier: 'POCTEP:2021-2027:CALL:10' });
  const next = adaptOfficialProgrammeV2({ sourceEvidence: refreshed, externalIdentifier: 'POCTEP:2021-2027:CALL:10' });
  assert.equal(contentDigestV2(first), contentDigestV2(next));
  const changed = snapshot('POCTEP', 10, true, text => text.replaceAll('10ª Convocatoria', '10ª Convocatoria actualizada'));
  assert.equal(changed.sourceRecords[0].externalId, first.sourceRecords[0].externalId);
  assert.notEqual(contentDigestV2(changed), contentDigestV2(first));
});

test('HTML hours are exact source claims but known cross-document conflict remains review-required', () => {
  const value = snapshot('POCTEP', 10, true);
  const evidence = value.provenance.evidence.find(item => item.id === 'published-hours');
  assert.match(evidence.excerpt, /14:00/);
  assert.equal(evidence.locatorType, 'DOCUMENT');
  assert.ok(value.provenance.observations.every(item => item.coverage === 'SELECTED_FIELDS'));
  assert.ok(value.quality.issues.some(item => item.code === 'OFFICIAL_DOCUMENT_TIME_CONFLICT_REQUIRES_REVIEW'));
  assert.equal(value.links.documents.state, 'NOT_COLLECTED');
});

test('integral public fixture bytes are immutable and recoverable, with manifest hashes', () => {
  const manifest = require('./fixtures/official-programmes/v2/manifest.json');
  const documents = manifest.map(entry => {
    const bytes = fs.readFileSync(path.join(dir, 'v2', entry.name));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    return { url: entry.url, mediaType: 'application/json', bodyBase64: bytes.toString('base64') };
  });
  const packet = createOfficialProgrammeEvidenceV2({ source: 'POCTEP', observedAt, documents });
  for (const doc of packet.documents) assert.equal(doc.sha256, manifest.find(entry => entry.url === doc.url).sha256);
  const value = adaptOfficialProgrammeV2({ sourceEvidence: packet, externalIdentifier: 'POCTEP:2021-2027:CALL:10' });
  assert.ok(value.provenance.observations.every(obs => packet.documents.some(doc => doc.sha256 === obs.artifactSha256)));
});

test('explicit INITIAL enrichment is kept when another table omits it; contradictory prose amounts fail', () => {
  const unqualifiedCalendar = snapshot('POCTEP', 10, true, (text, name) => name === 'calendar' ? text.replaceAll('21 M€ (inicial)', '21 M€') : text);
  assert.deepEqual(unqualifiedCalendar.financing.allocations.value[0].qualifiers, ['INITIAL']);
  assert.ok(unqualifiedCalendar.financing.allocations.evidenceRefs.includes('initial-budget'));
  assert.throws(() => snapshot('POCTEP', 10, true, text => text.replaceAll('inicial de 21 millones', 'inicial de 22 millones')), { code: 'OFFICIAL_V2_CONFLICT' });
  assert.throws(() => snapshot('POCTEP', 10, false, text => text.replaceAll('21 M€ (inicial)', '21 M€ (final)')), { code: 'OFFICIAL_V2_MONEY_UNSUPPORTED' });
});

test('repeated equal rows are stable while contradictory duplicate rows and unrelated headings fail safely', () => {
  const duplicate = (text, conflicting = false) => {
    const data = JSON.parse(text), table = data.content.rendered.match(/<table\b[\s\S]*?<\/table>/i)[0];
    data.content.rendered += conflicting ? table.replaceAll('52.500 €', '53.500 €') : table;
    return JSON.stringify(data);
  };
  assert.equal(snapshot('POCTEP', 5, false, (text, name) => name === 'calendar' ? duplicate(text) : text).financing.allocations.value[0].money.amount, '52500');
  assert.throws(() => snapshot('POCTEP', 5, false, (text, name) => name === 'calendar' ? duplicate(text, true) : text), { code: 'OFFICIAL_V2_CONFLICT' });
  const packet = evidence('POCTEP', true, (text, name) => {
    if (name !== 'calendar') return text;
    const data = JSON.parse(text); data.content.rendered += '<h2>99ª Convocatoria</h2><p>99 M€</p>'; return JSON.stringify(data);
  });
  assert.throws(() => adaptOfficialProgrammeV2({ sourceEvidence: packet, externalIdentifier: 'POCTEP:2021-2027:CALL:99' }), { code: 'OFFICIAL_V2_IDENTITY_NOT_FOUND' });
});
