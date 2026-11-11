'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const { loadStoredCatalog, buildStoredCatalog } = require('../src/opportunities/catalogRead/storedEvidence');
const { publishStoredCatalog } = require('../src/opportunities/catalogRead/isolatedStoredPublisher');
const { buildProjection, emptyExtension, stableId } = require('../src/opportunities/catalogRead/model');
const directory = path.resolve(__dirname, '../../context/references/opportunity-v2/evidence');
test('178 real records retain source dates, planned status and uncertain money without duplicate identities', () => {
  const corpus = loadStoredCatalog(directory), again = loadStoredCatalog(directory);
  assert.deepEqual(corpus, again); assert.equal(corpus.records.length, 178);
  assert.equal(new Set(corpus.records.map(r => r.opportunityId)).size, 178);
  for (const r of corpus.records) {
    const ext = emptyExtension(r.snapshot, { opportunityId:r.opportunityId,revisionId:r.revisionId,extensionId:stableId(r.revisionId),acceptanceDigest:'a'.repeat(64),recordedAt:'2026-10-31T00:00:00.000Z' });
    const p = buildProjection(r.snapshot, ext, { asOf:'2026-11-02T00:00:00.000Z' });
    assert(p.detail.summary.quality.reviewRequired);
    assert(p.detail.summary.freshness.observedAt.startsWith('2026-10-30'));
    if (r.snapshot.sourceRecords[0].namespace === 'PORTUGAL2030_PLAN') {
      assert.equal(p.detail.summary.status.code,'planned'); assert.equal(p.detail.summary.deadline.state,'unknown');
      assert.equal(r.snapshot.financing.allocations.value[0].money.currency.state,'NOT_FOUND');
      assert.equal(r.snapshot.schedule.deadlines.value,null);
    }
  }
  const zero=corpus.records.find(r=>r.snapshot.sourceRecords[0].externalId==='8664');
  assert.equal(zero.snapshot.financing.allocations.value[0].money.amount,'0');
  const shared=corpus.records.find(r=>r.snapshot.sourceRecords[0].externalId==='8614');
  assert.equal(shared.snapshot.programmes.value.length,3);assert.equal(shared.snapshot.financing.allocations.value.length,1);
});
test('preserved EU 11145 stays the accepted v2.0 revision when the live adapter mapping evolves', () => {
  // Regression (11/11/2026): mapping v2.1 re-derived this record, the corpus digest no longer
  // matched the published generation and the local API refused to start.
  const corpus = loadStoredCatalog(directory), eu = corpus.records.find(r => r.snapshot.sourceRecords[0].namespace === 'EU_FUNDING_TENDERS');
  assert.equal(eu.contentDigest, '355df5dc59a25556d9103fa276921d7e43d66a1087630481b0c4867460a96ce6');
  assert.equal(eu.snapshot.provenance.mappingVersion, 'eu-funding-type8-v2.0');
  assert(corpus.corpusDigest.startsWith('922eea65e8d7'));
});
test('tampered persisted input is refused before mapping', () => {
  const names=Object.keys(require('../src/opportunities/catalogRead/storedEvidence.manifest.json').files);
  const files=Object.fromEntries(names.map(n=>[n,fs.readFileSync(path.join(directory,n))]));
  files['eu-11145.json']=Buffer.concat([files['eu-11145.json'],Buffer.from(' ')]);
  assert.throws(()=>buildStoredCatalog(files),/HASH_MISMATCH/);
});
test('habitual target and caller-modified canonical content are refused before connection', async () => {
  let connected=false;const pool={connect(){connected=true;throw Error('UNEXPECTED_CONNECTION')}};
  const target={host:'127.0.0.1',port:5432,database:'c4g_central_dev'};
  await assert.rejects(()=>publishStoredCatalog({pool,target,isolated:true}),/ISOLATED_TARGET_REQUIRED/);
  const corpus=structuredClone(loadStoredCatalog(directory));corpus.records[0].snapshot.description.title.value='Unreviewed change';
  await assert.rejects(()=>publishStoredCatalog({pool,target:{host:'127.0.0.1',port:5555,database:'gcni_catalog_123456789abc'},isolated:true,corpus}),/CORPUS_CHANGED/);
  await assert.rejects(()=>publishStoredCatalog({pool:{...pool,options:{host:'127.0.0.1',port:5432,database:'c4g_central_dev'}},target:{host:'127.0.0.1',port:5555,database:'gcni_catalog_123456789abc'},isolated:true,corpus:loadStoredCatalog(directory)}),/POOL_TARGET_MISMATCH/);
  assert.equal(connected,false);
});
