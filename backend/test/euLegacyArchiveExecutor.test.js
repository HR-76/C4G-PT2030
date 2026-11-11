'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEuLegacyArchiveExecutor } = require('../src/opportunities/v2/euLegacyArchiveExecutor');

const packageId = '00000000-0000-4000-8000-000000000001';
const receipt = { scope: 'PREARCHIVE_ONLY', packageId, externalIdentifier: 'EU-1',
  itemDigest: 'a'.repeat(64), bindingDigest: 'b'.repeat(64),
  requestId: '01900000-0000-7000-8000-000000000003',
  actorId: '00000000-0000-4000-8000-000000000004',
  eventId: '00000000-0000-4000-8000-000000000002', eventHash: 'c'.repeat(64),
  expiresAt: '2026-10-31T23:59:00.000Z', replayed: false };
const loaded = { plan: { packageId, expiresAt: receipt.expiresAt },
  item: { externalIdentifier: 'EU-1', itemDigest: receipt.itemDigest,
    contentDigest: 'd'.repeat(64) }, bindingDigest: receipt.bindingDigest,
  binding: { sourceFence: 7 }, artifact: { observedAt: '2026-10-31T21:40:00.000Z',
    snapshot: { schemaVersion: 2 } } };
function fixture({ failAt, prior = false } = {}) {
  const calls = [], client = { async query(sql) { calls.push(sql); return { rows: sql.startsWith('SELECT 1 FROM opportunity_catalog.funding_candidate_v2') && prior ? [{ '?column?': 1 }] : [] }; }, release() { calls.push('RELEASE'); } };
  const archive = {
    async stageLegacyMigration() { calls.push('STAGE'); if (failAt === 'STAGE') throw Error('private SQL');
      return { stored: true, externalIdentifier: 'EU-1', contentDigest: loaded.item.contentDigest }; },
    async verify() { calls.push('VERIFY'); if (failAt === 'VERIFY') throw Error('private SQL');
      return { contentDigest: loaded.item.contentDigest, payloadDigest: 'e'.repeat(64),
        canonicalSnapshot: loaded.artifact.snapshot }; }
  };
  const executor = createEuLegacyArchiveExecutor({ pool: { connect: async () => client },
    archive, load: () => loaded, current: async () => { calls.push('CURRENT'); if (failAt === 'CURRENT') throw Error('private SQL'); } });
  return { executor, calls };
}
test('one EU identity is checked, staged and verified before the only commit', async () => {
  const { executor, calls } = fixture();
  const result = await executor.executeOne(receipt);
  assert.equal(result.status, 'ARCHIVED');
  assert.equal(result.runId, receipt.eventId);
  assert(calls.indexOf('CURRENT') < calls.indexOf('STAGE'));
  assert(calls.indexOf('STAGE') < calls.indexOf('VERIFY'));
  assert(calls.indexOf('VERIFY') < calls.indexOf('COMMIT'));
  assert.equal(calls.at(-1), 'RELEASE');
});
test('a failed archive rolls back without reporting private SQL', async () => {
  for (const failAt of ['CURRENT', 'STAGE', 'VERIFY']) {
    const { executor, calls } = fixture({ failAt });
    await assert.rejects(executor.executeOne(receipt), { code: 'EU_LEGACY_ARCHIVE_UNAVAILABLE' });
    assert(calls.includes('ROLLBACK') && !calls.includes('COMMIT'));
    assert.equal(calls.at(-1), 'RELEASE');
  }
});

test('a previously committed identity is verified and checkpointed without staging again', async () => {
  const { executor, calls } = fixture({ prior: true });
  assert.equal((await executor.executeOne(receipt)).status, 'ALREADY_ARCHIVED');
  assert(calls.includes('VERIFY'));
  assert(!calls.includes('CURRENT') && !calls.includes('STAGE'));
  assert(calls.includes('COMMIT'));
});
