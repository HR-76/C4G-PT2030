'use strict';
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const { reconcileFunding } = require('../../../backend/src/fundingTenders/reconciliation');
const { CASCADE_BASE } = require('../../../backend/src/fundingTenders/identity');
const { createSource } = require('./v1FixtureFunder');
const { createFundingWorker } = require('../../../backend/src/fundingTenders/worker');
const { CentralOpportunityRepository } = require('../../../backend/src/opportunities/centralRepository');
async function run({ pool, repo, admin, queue }) {
  const catalog = new CentralOpportunityRepository({ pool, identityFactory: require('../../../backend/src/opportunities/identity').createIdentityFactory() });
  const runId = (await repo.status(admin)).lastRun.runId;
  const seeds = [
    { key: 'LEGACY-CERV', source: { title: 'Cascade source', callReference: 'LEGACY-CERV', officialUrl: CASCADE_BASE + '11674', programmeName: 'LIFE', closingDate: '2099-01-01' }, manual: { title: 'Manual title', programmeName: 'Curated programme' } },
    { key: 'LEGACY-ESC', source: { title: 'ESC source', callReference: 'LEGACY-ESC', officialUrl: 'https://example.invalid/esc', programmeName: '43254037', closingDate: '2099-01-01' }, manual: {} }
  ];
  for (const seed of seeds) {
    seed.source.funderName = 'European Commission';
    const created = await catalog.create({ schemaVersion: 1, requestId: randomUUID(), snapshot: { ...seed.source, ...seed.manual,
      schemaVersion: 1, provenanceId: randomUUID(), lifecycleState: 'ACTIVE', validationState: 'PENDING_REVIEW', normalizationVersion: 'opportunity-normalization-v1', qualityRuleVersion: 'opportunity-quality-v1' },
      provenance: { schemaVersion: 1, sourceType: 'EU_FUNDING_API', sourceNamespace: 'EU_FUNDING_TENDERS', externalIdentifier: seed.key, observedAt: new Date().toISOString() }
    }, { actor: { type: 'SERVICE', reference: 'SYNTHETIC_FIXTURE' } });
    seed.id = created.opportunityId; seed.revision = created.revisionId;
    await pool.query('INSERT INTO opportunity_catalog.funding_identity(external_identifier,opportunity_id,last_source_fields,observed_at,last_run_id) VALUES($1,$2,$3,clock_timestamp(),$4)', [seed.key, seed.id, seed.source, runId]);
    await pool.query("INSERT INTO opportunity_catalog.funding_observation VALUES($1,$2,$3,$4,clock_timestamp(),$5,'[]')", [runId, seed.key, seed.id, seed.revision, seed.source]);
  }
  const corrections = seeds.map((s, i) => ({ callReference: s.key, sourceUrl: s.source.officialUrl, from: s.source.programmeName, rawProgrammeCode: i ? '43254037' : '43251589' }));
  // A real FK keeps the original opportunity and revision pinned throughout repair.
  await pool.query('CREATE TABLE public.synthetic_cascade_relation(opportunity_id uuid REFERENCES opportunity_catalog.opportunity,revision_id uuid REFERENCES opportunity_catalog.revision)');
  await pool.query('INSERT INTO public.synthetic_cascade_relation VALUES($1,$2)', [seeds[0].id, seeds[0].revision]);
  const snapshot = async () => {
    const result = {};
    for (const table of ['revision', 'provenance', 'idempotency_record', 'funding_observation']) result[table] = (await pool.query(`SELECT to_jsonb(t)::text value FROM opportunity_catalog.${table} t ORDER BY to_jsonb(t)::text`)).rows.map(x => x.value);
    return result;
  };
  const before = await snapshot(), identityBefore = await repo.get(seeds[0].id);
  const preview = await reconcileFunding({ pool, programmeCorrections: corrections }); assert.equal(preview.changes.length, 2);
  await assert.rejects(reconcileFunding({ pool, programmeCorrections: corrections, apply: true, expectedDigest: 'stale' }), { code: 'FUNDING_RECONCILIATION_STALE' });
  let updates = 0;
  const failingPool = { async connect() { const client = await pool.connect(); return { release: () => client.release(), query(sql, values) {
    if (sql.startsWith('UPDATE opportunity_catalog.funding_identity SET') && ++updates === 2) throw Error('SIMULATED_REPAIR_FAILURE');
    return client.query(sql, values);
  } }; } };
  await assert.rejects(reconcileFunding({ pool: failingPool, programmeCorrections: corrections, apply: true, expectedDigest: preview.digest }), /SIMULATED_REPAIR_FAILURE/);
  assert.deepEqual(await snapshot(), before); // The read model stamps each read with its own evaluation instant (asOf).
  const withoutAsOf = value => JSON.parse(JSON.stringify(value, (key, child) => key === 'asOf' || key === 'ageSeconds' ? undefined : child));
  assert.deepEqual(withoutAsOf(await repo.get(seeds[0].id)), withoutAsOf(identityBefore));
  const applied = await reconcileFunding({ pool, programmeCorrections: corrections, apply: true, expectedDigest: preview.digest });
  assert.equal(applied.changes.length, 2);
  const repaired = await repo.get(seeds[0].id); assert.equal(repaired.externalIdentifier, 'CASCADE:11674');
  assert.equal(repaired.snapshot.title, 'Manual title'); assert.equal(repaired.snapshot.programmeName, 'Curated programme');
  assert.deepEqual(repaired.conflicts, ['programmeName', 'title']);
  assert.equal((await repo.get(seeds[1].id)).snapshot.programmeName, 'ESC');
  assert.deepEqual((await pool.query('SELECT * FROM public.synthetic_cascade_relation')).rows, [{ opportunity_id: seeds[0].id, revision_id: seeds[0].revision }]);
  const after = await snapshot(); for (const [table, rows] of Object.entries(before)) for (const row of rows) assert.ok(after[table].includes(row), table + ' history changed');
  const repeat = await reconcileFunding({ pool, programmeCorrections: corrections }); assert.equal(repeat.changes.length, 0);
  await reconcileFunding({ pool, programmeCorrections: corrections, apply: true, expectedDigest: repeat.digest }); assert.deepEqual(await snapshot(), after);
  const results = ['11674', '11702', '11674'].map(id => ({ content: 'Cascade source', metadata: { type: ['8'], identifier: ['LEGACY-CERV'], callccm2Id: [id], frameworkProgramme: ['43251589'], deadlineDate: ['2099-01-01'] } }));
  const source = createSource({ fetchImpl: async () => new Response(JSON.stringify({ results })) });
  const worker = createFundingWorker({ pool, queue, source });
  await repo.enqueue(admin, randomUUID()); await worker.runOnce();
  assert.equal((await repo.status(admin)).lastRun.created, 1); assert.equal((await repo.status(admin)).lastRun.status, 'SUCCESS');
  assert.equal((await repo.get(seeds[0].id)).snapshot.title, 'Manual title');
  const firstCollectionHistory = await snapshot();
  await repo.enqueue(admin, randomUUID()); await worker.runOnce();
  const last = (await repo.status(admin)).lastRun; assert.equal(last.created, 0); assert.equal(last.updated, 0); assert.equal(last.unchanged, 2);
  assert.deepEqual((await snapshot()).revision, firstCollectionHistory.revision);
  const found = await repo.list({ q: 'LEGACY-CERV' }); assert.equal(found.items.length, 2);
  assert.equal(new Set(found.items.map(x => x.opportunityId)).size, 2);
  assert.ok(found.items.some(x => x.opportunityId === seeds[0].id));
  return { status: 'PASS', preservedUuidAndRelation: true, immutableHistoryPreserved: true, rollbackAtomic: true, manualFieldsPreserved: true, reconciliationIdempotent: true, cascadeCallsSeparated: true, reimportIdempotent: true, topicSearchPreserved: true };
}
module.exports = { run };
