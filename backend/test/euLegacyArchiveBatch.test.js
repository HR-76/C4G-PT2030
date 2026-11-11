'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { archiveBatch, migrationRun } = require('../src/opportunities/v2/euLegacyArchiveBatch');

test('EU legacy archive batch accepts only the bound official artifact', () => {
  const expected = { opportunityId: 'a', revisionId: 'b', rowVersion: 1 };
  const artifact = { outcome: 'FOUND', externalIdentifier: 'EU:1', received: 1,
    observedAt: '2026-10-31T21:40:00.000Z', evidence: { variants: [{}] },
    snapshot: { schemaVersion: 2 }, sourceFields: { title: 'Official' },
    contentDigest: 'c', mappingDigest: 'observed-old-mapping' };
  const loaded = { item: { action: 'CHANGE_REQUIRES_APPROVAL', externalIdentifier: 'EU:1',
    contentDigest: 'c', mappingDigest: 'm', expected }, artifact, binding: { expected } };
  const batch = archiveBatch(loaded);
  assert.equal(batch.record.externalIdentifier, 'EU:1');
  assert.equal(batch.received, 1);
  assert.deepEqual(batch.record.fields, artifact.sourceFields);
  assert.throws(() => { batch.record.fields.title = 'Changed'; });
  assert.throws(() => archiveBatch({ ...loaded, artifact: { ...artifact, contentDigest: 'other' } }),
    { code: 'EU_LEGACY_ARCHIVE_BATCH_INVALID' });
  assert.throws(() => archiveBatch({ ...loaded, artifact: { ...artifact, received: 2 } }),
    { code: 'EU_LEGACY_ARCHIVE_BATCH_INVALID' });
});

test('migration run derives a stable ID and actor only from a bound OIDC receipt', () => {
  const packageId = '00000000-0000-4000-8000-000000000001';
  const eventId = '00000000-0000-4000-8000-000000000002';
  const requestId = '01900000-0000-7000-8000-000000000003';
  const actorId = '00000000-0000-4000-8000-000000000004';
  const receipt = { scope: 'PREARCHIVE_ONLY', packageId, externalIdentifier: 'EU-1',
    itemDigest: 'a'.repeat(64), bindingDigest: 'b'.repeat(64), requestId,
    actorId, eventId, eventHash: 'c'.repeat(64),
    expiresAt: '2026-10-31T23:59:00.000Z', replayed: false };
  const loaded = { plan: { packageId, expiresAt: receipt.expiresAt },
    item: { externalIdentifier: 'EU-1', itemDigest: receipt.itemDigest },
    bindingDigest: receipt.bindingDigest, binding: { sourceFence: 7 },
    artifact: { observedAt: '2026-10-31T21:40:00.000Z' } };
  const configuration = { policyVersion: 'eu-existing-v2.0', mappingDigest: 'd'.repeat(64) };
  const run = migrationRun(loaded, receipt, configuration);
  assert.equal(run.run_id, eventId);
  assert.equal(run.requested_by, actorId);
  assert.equal(run.eu_source_fence, 7);
  assert.equal(run.error_code, 'EU_LEGACY_PREARCHIVE_STAGING');
  assert.throws(() => migrationRun(loaded, { ...receipt, itemDigest: 'e'.repeat(64) }, configuration),
    { code: 'EU_LEGACY_ARCHIVE_BATCH_INVALID' });
  assert.throws(() => migrationRun(loaded, { ...receipt, token: 'restricted' }, configuration),
    { code: 'EU_LEGACY_ARCHIVE_BATCH_INVALID' });
});
