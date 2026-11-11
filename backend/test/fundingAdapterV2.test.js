'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildEvidence } = require('../src/fundingTenders/sourceEvidence');
const { adaptEuOpportunityV2 } = require('../src/fundingTenders/adapterV2');
const { semanticSnapshotV2, validateSnapshotV2 } = require('../src/opportunities/v2');

const corpus = path.resolve(__dirname, '../../context/references/opportunity-v2');
const official = () => JSON.parse(fs.readFileSync(path.join(corpus, 'evidence/eu-11145.json'), 'utf8')).results[0];
const expected = JSON.parse(fs.readFileSync(path.join(corpus, 'examples/eu-11145-v2.1.json'), 'utf8'));
const observedAt = '2026-10-30T22:45:39.461Z';
const adapt = (items = [official()], id = 'CASCADE:11145') => adaptEuOpportunityV2(buildEvidence(id, items), { observedAt });
function topic(programme = '43108390') {
  return { content: 'Published topic', summary: 'Published summary', language: 'en', metadata: {
    DATASOURCE: ['SEDIA'], type: ['1'], identifier: ['HORIZON-TEST-01'], callccm2Id: ['100'], ccm2Id: ['101'], language: ['en'], frameworkProgramme: [programme],
    startDate: ['2026-01-01T00:00:00.000+0000'], deadlineDate: ['2027-01-01T00:00:00.000+0000'], status: ['31094502'],
    actions: [JSON.stringify([{ plannedOpeningDate: '2026-01-01', deadlineDates: ['2027-01-01'] }])],
    budgetOverview: ['{"currency":"EUR","budgetTopicActionMap":{"g1":[{"action":"HORIZON-TEST-01 - RIA","minContribution":0.01,"maxContribution":18181527.09,"budgetYearMap":{"2026":"120000"}}],"other":[{"action":"HORIZON-OTHER - RIA","budgetYearMap":{"2026":"99999999"}}]}}']
  } };
}

test('EU adapter v2 reproduces every normative 11145 fact with source evidence', () => {
  const snapshot = adapt();
  assert.deepEqual(semanticSnapshotV2(snapshot), semanticSnapshotV2(expected));
  assert.equal(snapshot.financing.allocations.value[0].money.amount, '120000');
  assert.equal(snapshot.financing.allocations.value[0].money.currency.state, 'NOT_FOUND');
  assert.equal(snapshot.financing.support.value[0].maximum, '1500');
  assert.equal(snapshot.financing.support.value[0].currency.value, 'EUR');
  assert.equal(snapshot.parties.value[0].name, 'Gnomon Informatics SA');
  assert.equal(snapshot.relatedProject.grantAgreementNumber.value, '101190010');
  assert.equal(snapshot.schedule.deadlines.value.length, 7);
  assert.equal(snapshot.schedule.deadlines.value.at(-1).at.value, '2028-09-02T04:59:00.000Z');
  assert.equal(Object.isFrozen(snapshot), true);
  assert.deepEqual(adapt(), snapshot);
});

test('EU adapter v2 locators resolve in the exact archived evidence and input stays untouched', () => {
  const evidence = buildEvidence('CASCADE:11145', [official()]);
  const before = JSON.stringify(evidence);
  const snapshot = adaptEuOpportunityV2(evidence, { observedAt });
  for (const item of snapshot.provenance.evidence) {
    let value = evidence;
    for (const key of item.locator.slice(1).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))) value = value[key];
    assert.notEqual(value, undefined, item.id);
  }
  assert.equal(JSON.stringify(evidence), before);
});

test('EU type1 scopes budget to the exact topic and preserves fractional numeric lexemes', () => {
  const snapshot = adapt([topic()], 'HORIZON-TEST-01');
  assert.equal(snapshot.identity.kind, 'CALL');
  assert.equal(snapshot.programmes.value[0].code, 'HORIZON');
  assert.equal(snapshot.financing.allocations.value.length, 1);
  assert.equal(snapshot.financing.allocations.value[0].money.amount, '120000');
  assert.equal(snapshot.financing.allocations.value[0].scope, 'TOPIC_OR_SHARED');
  assert.equal(snapshot.financing.allocations.value[0].sharedGroup, 'g1');
  assert.equal(snapshot.financing.support.value[0].minimum, '0.01');
  assert.equal(snapshot.financing.support.value[0].maximum, '18181527.09');
  assert.equal(snapshot.schedule.opening.value.precision, 'DATE');
  assert.equal(snapshot.schedule.deadlines.value[0].at.precision, 'DATE');
  assert.equal(snapshot.sourceRecords[0].namespace, 'EU_FUNDING_TENDERS');
});

test('EU selection does not change canonical identity for Erasmus and unknown programme stays unmapped', () => {
  for (const [id, code] of [['43353764', 'ERASMUS'], ['99999999', null]]) {
    const snapshot = adapt([topic(id)], 'HORIZON-TEST-01');
    assert.equal(snapshot.sourceRecords[0].namespace, 'EU_FUNDING_TENDERS');
    assert.equal(snapshot.programmes.value[0].sourceId, id);
    assert.equal(snapshot.programmes.value[0].code, code);
    assert.equal(snapshot.programmes.value[0].mapping, code ? 'VERIFIED' : 'UNMAPPED');
  }
});

test('EU variants differing in budget conflict before any snapshot is accepted', () => {
  const first = official(), second = official(); second.metadata.budget = ['120001'];
  assert.throws(() => adapt([first, second]), { code: 'SOURCE_V2_CONFLICT' });
  assert.deepEqual(semanticSnapshotV2(adapt([first, first])), semanticSnapshotV2(adapt([first])));
});

test('EU adapter never silently truncates excess source calendar or money', () => {
  const record = official();
  record.metadata.deadlineDate = Array.from({ length: 65 }, (_, i) => new Date(Date.UTC(2027, 0, i + 1)).toISOString());
  assert.throws(() => adapt([record]));
  record.metadata.deadlineDate = official().metadata.deadlineDate;
  record.metadata.budget = ['120000.123456789'];
  assert.throws(() => adapt([record]));
});

test('EU adapter rejects tampered evidence, wrong identity and active objects without getters', () => {
  const evidence = buildEvidence('CASCADE:11145', [official()]);
  evidence.variants[0].metadata.budget = ['999'];
  assert.throws(() => adaptEuOpportunityV2(evidence, { observedAt }));
  assert.throws(() => adapt([official()], 'CASCADE:123'));
  let invoked = false;
  const active = {}; Object.defineProperty(active, 'version', { enumerable: true, get() { invoked = true; return 1; } });
  assert.throws(() => adaptEuOpportunityV2(active, { observedAt }));
  assert.equal(invoked, false);
});

test('EU absence is explicit and zero remains distinct from missing currency', () => {
  const record = official(); delete record.metadata.projectAcronym; delete record.metadata.projectId;
  record.metadata.budget = ['0'];
  const snapshot = adapt([record]);
  assert.equal(snapshot.relatedProject.acronym.state, 'NOT_FOUND');
  assert.equal(snapshot.relatedProject.grantAgreementNumber.state, 'NOT_FOUND');
  assert.equal(snapshot.financing.allocations.value[0].money.amount, '0');
  assert.equal(snapshot.financing.allocations.value[0].money.interpretation, 'ZERO_UNEXPLAINED');
  validateSnapshotV2(snapshot);
});

test('EU cascade title never falls back to the parent topic or hides a contradictory call title', () => {
  const missing = official(); delete missing.content; delete missing.metadata.callTitle;
  assert.throws(() => adapt([missing]));
  const conflict = official(); conflict.metadata.callTitle = ['Different cascade title'];
  assert.throws(() => adapt([conflict]), { code: 'SOURCE_V2_CONFLICT' });
});

test('EU type1 keeps more than 32 allocations without redundant evidence-reference overflow', () => {
  const record = topic();
  const budget = JSON.parse(record.metadata.budgetOverview[0]);
  budget.budgetTopicActionMap.g1[0].budgetYearMap = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [String(2026 + i), String(i + 1)]));
  record.metadata.budgetOverview = [JSON.stringify(budget)];
  const snapshot = adapt([record], 'HORIZON-TEST-01');
  assert.equal(snapshot.financing.allocations.value.length, 33);
  assert.equal(snapshot.financing.allocations.value.at(-1).money.amount, '33');
  assert.ok(snapshot.financing.allocations.evidenceRefs.length <= 32);
});

test('EU type1 numeric JSON contributions retain all 24 integer and eight fractional digits', () => {
  const record = topic();
  record.metadata.budgetOverview[0] = record.metadata.budgetOverview[0].replace('18181527.09', '999999999999999999999999.12345678');
  const snapshot = adapt([record], 'HORIZON-TEST-01');
  assert.equal(snapshot.financing.support.value[0].maximum, '999999999999999999999999.12345678');
});

test('EU direct awarder preserves dotted company suffixes and refuses ambiguous sentence boundaries', () => {
  for (const name of ['Example S.A.', 'Example Ltd.', 'Example Inc.']) {
    const record = official();
    record.metadata.description = [`This call is launched solely by ${name} (Gnomon) . The financial support is separate.`];
    assert.equal(adapt([record]).parties.value[0].name, name);
  }
  for (const description of [
    'This call is launched solely by Example S.A. The financial support is separate.',
    'This call is launched solely by Example S.A. This is another sentence (Other) .'
  ]) {
    const record = official(); record.metadata.description = [description];
    assert.equal(adapt([record]).parties.state, 'NOT_COLLECTED');
  }
});

test('EU adapter v2.1 takes the description from the published narrative when the API summary only repeats the title', () => {
  const item = topic(); item.summary = item.content;
  item.metadata.descriptionByte = ['<p class="topicdescriptionkind">Expected Outcome:</p><p>Projects deliver &amp; validate results.</p>'];
  const snapshot = adapt([item], 'HORIZON-TEST-01');
  assert.equal(snapshot.description.summary.value, 'Expected Outcome:\nProjects deliver & validate results.');
  const ref = snapshot.provenance.evidence.find(e => e.id === snapshot.description.summary.evidenceRefs[0]);
  assert.equal(ref.locator, '/variants/0/metadata/descriptionByte/0'); assert.equal(ref.transform, 'HTML_TO_TEXT_NFC_TRIM');
  assert.equal(snapshot.provenance.mappingVersion, 'eu-funding-type1-v2.1');
  const cascade = adapt();
  assert.notEqual(cascade.description.summary.value, cascade.description.title.value);
  assert.ok(cascade.description.summary.value.length > 500);
  assert.equal(cascade.provenance.evidence.find(e => e.id === 'summary').locator, '/variants/0/metadata/description/0');
});

test('EU adapter v2.1 keeps a distinct published summary, marks long narratives as excerpts and never invents text', () => {
  const distinct = topic(); distinct.metadata.descriptionByte = ['<p>Narrative</p>'];
  assert.equal(adapt([distinct], 'HORIZON-TEST-01').description.summary.value, 'Published summary');
  const long = topic(); long.summary = long.content; long.metadata.descriptionByte = ['<p>' + 'é'.repeat(9000) + '</p>'];
  const excerpt = adapt([long], 'HORIZON-TEST-01');
  assert.equal([...excerpt.description.summary.value].length, 4000); assert.ok(excerpt.description.summary.value.endsWith('…'));
  assert.ok(excerpt.quality.issues.some(i => i.code === 'DESCRIPTION_EXCERPT' && i.field === '/description/summary'));
  const bare = topic(); bare.summary = bare.content;
  assert.equal(adapt([bare], 'HORIZON-TEST-01').description.summary.value, 'Published topic');
  const empty = topic(); empty.summary = empty.content; empty.metadata.descriptionByte = ['<p> </p>'];
  assert.equal(adapt([empty], 'HORIZON-TEST-01').description.summary.value, 'Published topic');
});

test('EU adapter keeps a published title longer than 300 characters as a marked excerpt instead of rejecting the call', () => {
  const longTitle = 'Financial Support to Third Parties — ' + 'é'.repeat(320);
  const item = topic(); item.content = longTitle; item.summary = longTitle; item.metadata.descriptionByte = ['<p>Narrative</p>'];
  const snapshot = adapt([item], 'HORIZON-TEST-01');
  assert.equal([...snapshot.description.title.value].length, 300); assert.ok(snapshot.description.title.value.endsWith('…'));
  assert.ok(longTitle.startsWith(snapshot.description.title.value.slice(0, -1)));
  assert.ok(snapshot.quality.issues.some(i => i.code === 'TITLE_EXCERPT' && i.field === '/description/title'));
  assert.equal(snapshot.provenance.evidence.find(e => e.id === 'call-title').transform, 'TEXT_NFC_TRIM_EXCERPT');
  assert.equal(snapshot.description.summary.value, 'Narrative');
  const short = adapt([topic()], 'HORIZON-TEST-01');
  assert.equal(short.quality.issues.some(i => i.code === 'TITLE_EXCERPT'), false);
  assert.equal(short.provenance.evidence.find(e => e.id === 'call-title').transform, 'TEXT_NFC_TRIM');
  const cascade = official(); cascade.content = longTitle; cascade.summary = longTitle; cascade.metadata.callTitle = [longTitle];
  assert.equal([...adapt([cascade]).description.title.value].length, 300);
  const diverging = official(); diverging.content = longTitle; diverging.metadata.callTitle = ['Other ' + longTitle];
  assert.throws(() => adapt([diverging]), { code: 'SOURCE_V2_CONFLICT' });
});

test('a long cascade title cut by the search index matches its full call title; short prefixes still conflict', () => {
  const full = 'SYSTEMEU - Financial Support to Third Parties (FSTP) ' + 'é'.repeat(700);
  const cut = official(); cut.content = [...full].slice(0, 349).join(''); cut.metadata.callTitle = [full];
  const snapshot = adapt([cut]);
  assert.equal([...snapshot.description.title.value].length, 300);
  assert.ok(snapshot.quality.issues.some(i => i.code === 'TITLE_EXCERPT'));
  const short = official(); short.content = 'Gnomon'; short.metadata.callTitle = ['Gnomon Internships Offer'];
  assert.throws(() => adapt([short]), { code: 'SOURCE_V2_CONFLICT' });
  const other = official(); other.content = [...full].slice(0, 349).join('') + 'X'; other.metadata.callTitle = [full];
  assert.throws(() => adapt([other]), { code: 'SOURCE_V2_CONFLICT' });
});
