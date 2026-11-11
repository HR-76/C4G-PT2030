'use strict';
// Type 2 = EU External Action calls for proposals (EuropeAid/Prospect), as listed
// with types 1 and 8 in the official "filtered data" example of the EC API page.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSource, formData, normalizeRecord } = require('../src/fundingTenders/source');
const { buildEvidence, verifyEvidence } = require('../src/fundingTenders/sourceEvidence');
const { extractEnrichment } = require('../src/fundingTenders/enrichment');
const { adaptEuOpportunityV2 } = require('../src/fundingTenders/adapterV2');
const { implementationDigest } = require('../src/opportunities/v2/activationArchive');
const ID = 'EuropeAid/187757/DD/ACT/KH';
const URL_2 = 'https://webgate.ec.europa.eu/prospect/external/publishedcalls.htm?callId=187757';
const observedAt = '2026-11-11T12:00:00.000Z';
const sample = () => structuredClone(require('./fixtures/fundingType2/public-sample.json'));
const item = () => sample().results[0];

test('discovery requests external action calls and exact lookup reaches them without widening cascade lookups', async () => {
  const query = async (...args) => JSON.parse(await formData(...args).get('query').text());
  assert.deepEqual((await query()).bool.must[0], { terms: { type: ['1', '2', '8'] } });
  assert.deepEqual((await query('EU_FUNDING_TENDERS', ID)).bool.must, [{ terms: { type: ['1', '2'] } }, { term: { identifier: ID } }]);
  assert.deepEqual((await query('EU_FUNDING_TENDERS', 'CASCADE:11145')).bool.must, [{ term: { type: '8' } }, { term: { callccm2Id: '11145' } }]);
});

test('a type 2 record keeps its published identity, link, programme and deadline', () => {
  const record = normalizeRecord(item(), { asOf: '2026-11-11' });
  assert.equal(record.externalIdentifier, ID);
  assert.equal(record.fields.officialUrl, URL_2);
  assert.equal(record.fields.programmeName, 'RELEX-PROSPECT');
  assert.equal(record.fields.closingDate, '2026-12-11');
  assert.equal(record.fields.sourceTemporal.status, 'OPEN');
  const undated = item(); delete undated.metadata.deadlineDate;
  assert.throws(() => normalizeRecord(undated, { asOf: '2026-11-11' }), { code: 'SOURCE_NOT_CURRENT' });
});

test('evidence accepts type 2 without topic/call ccm ids and still rejects tenders and mixed identities', () => {
  const evidence = buildEvidence(ID, [item()]);
  assert.equal(verifyEvidence(evidence), true);
  const tender = item(); tender.metadata.type = ['0'];
  assert.throws(() => buildEvidence(ID, [tender]));
  assert.throws(() => buildEvidence('EuropeAid/1/DD/ACT/XX', [item()]));
  const other = item(); other.metadata.callIdentifier = ['999999'];
  assert.throws(() => buildEvidence(ID, [item(), other]));
});

test('enrichment publishes programme, call budget with currency and official documents for type 2', () => {
  const fields = extractEnrichment([item()], { externalIdentifier: ID, observedAt }).fields;
  assert.equal(fields.programme.status, 'PUBLISHED');
  assert.equal(fields.programme.items[0].value.code, 'RELEX-PROSPECT');
  assert.deepEqual(fields.budget.items.map(i => [i.value.amount, i.value.currency, i.value.scope]), [['5993000', 'EUR', 'CALL']]);
  assert.equal(fields.documents.status, 'PUBLISHED');
  assert.ok(fields.documents.items.length >= 1 && fields.documents.items.length <= 8);
  for (const doc of fields.documents.items) { assert.ok(doc.value.title); assert.ok(doc.value.url.startsWith('https://webgate.ec.europa.eu/')); assert.equal(doc.evidence.url, URL_2); }
  const broken = item(); broken.metadata.publicationDocuments = ['not json'];
  assert.equal(extractEnrichment([broken], { externalIdentifier: ID, observedAt }).fields.documents.status, 'UNSUPPORTED');
});

test('canonical snapshot maps a type 2 call with its own mapping version and never fabricates a portal topic link', () => {
  const snapshot = adaptEuOpportunityV2(buildEvidence(ID, [item()]), { observedAt });
  assert.equal(snapshot.provenance.mappingVersion, 'eu-funding-type2-v2.1');
  assert.equal(snapshot.identity.kind, 'CALL');
  assert.deepEqual(snapshot.identity.references.value, [{ kind: 'CALL_REFERENCE', value: ID }]);
  assert.equal(snapshot.links.official.value, URL_2);
  assert.equal(snapshot.sourceRecords[0].url, URL_2);
  assert.equal(snapshot.quality.issues.some(i => i.code === 'SOURCE_URL_RECONSTRUCTED_FROM_CALL_ID'), false);
  assert.equal(snapshot.programmes.value[0].code, 'RELEX-PROSPECT');
  assert.equal(snapshot.programmes.value[0].mapping, 'VERIFIED');
  const allocation = snapshot.financing.allocations.value[0];
  assert.deepEqual([allocation.money.amount, allocation.money.currency.value, allocation.scope, allocation.aggregation], ['5993000', 'EUR', 'CALL_TOTAL', 'STANDALONE']);
  assert.equal(snapshot.schedule.deadlines.value.length, 1);
  assert.equal(snapshot.status.published.value, 'OPEN');
  assert.equal(snapshot.parties.state, 'NOT_COLLECTED');
  const foreign = item(); foreign.metadata.url = ['https://example.org/call']; foreign.url = 'https://example.org/call';
  assert.throws(() => adaptEuOpportunityV2(buildEvidence(ID, [foreign]), { observedAt }), { code: 'SOURCE_V2_INVALID' });
  assert.match(implementationDigest('EU_FUNDING_TENDERS', snapshot.provenance.mappingVersion), /^[a-f0-9]{64}$/);
});

test('exact lookup of a type 2 call returns enrichment and a canonical candidate', async () => {
  const source = createSource({ enrichmentEnabled: true, canonicalV2Enabled: true, clock: () => Date.parse(observedAt),
    fetchImpl: async () => new Response(JSON.stringify({ totalResults: 1, results: sample().results })) });
  const result = await source.lookup({ externalIdentifier: ID });
  assert.equal(result.outcome, 'FOUND');
  assert.equal(result.record.fields.programmeName, 'RELEX-PROSPECT');
  assert.equal(result.record.fields.sourceEnrichment.fields.budget.status, 'PUBLISHED');
  assert.equal(result.canonicalSnapshot.provenance.mappingVersion, 'eu-funding-type2-v2.1');
  const filtered = await source.lookup({ externalIdentifier: ID, source: 'ERASMUS' });
  assert.equal(filtered.outcome, 'ERROR');
});
