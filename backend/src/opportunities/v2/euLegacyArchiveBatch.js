'use strict';
// Reconstructs the exact candidate input from an approved official artifact.
// The package loader verifies the artifact and current mapping before this step.
const { isDeepStrictEqual } = require('node:util');
const { cloneData, deepFreeze } = require('./data');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = () => { throw Object.assign(new Error('EU_LEGACY_ARCHIVE_BATCH_INVALID'), { code: 'EU_LEGACY_ARCHIVE_BATCH_INVALID' }); };

function archiveBatch(loaded) {
  const item = loaded?.item, artifact = loaded?.artifact;
  if (!item || !artifact || artifact.outcome !== 'FOUND'
    || item.action !== 'CHANGE_REQUIRES_APPROVAL'
    || item.externalIdentifier !== artifact.externalIdentifier
    || item.contentDigest !== artifact.contentDigest
    || !isDeepStrictEqual(item.expected, loaded.binding?.expected)
    || !Array.isArray(artifact.evidence?.variants)
    || artifact.received !== artifact.evidence.variants.length)
    fail();
  const batch = { outcome: 'FOUND', limited: false, nextCursor: null,
    received: artifact.received, observedAt: artifact.observedAt,
    record: { externalIdentifier: item.externalIdentifier, fields: artifact.sourceFields },
    evidence: artifact.evidence, canonicalSnapshot: artifact.snapshot };
  return deepFreeze(cloneData(batch, { maxBytes: 3 * 1024 * 1024 }));
}

function migrationRun(loaded, rawReceipt, configuration) {
  const receipt = cloneData(rawReceipt, { maxBytes: 2048 });
  if (!exact(receipt, ['scope', 'packageId', 'externalIdentifier', 'itemDigest',
    'bindingDigest', 'requestId', 'actorId', 'eventId', 'eventHash', 'expiresAt', 'replayed'])
    || receipt.scope !== 'PREARCHIVE_ONLY' || !UUID.test(receipt.packageId)
    || receipt.packageId !== loaded?.plan?.packageId
    || receipt.externalIdentifier !== loaded?.item?.externalIdentifier
    || receipt.itemDigest !== loaded?.item?.itemDigest
    || receipt.bindingDigest !== loaded?.bindingDigest
    || receipt.expiresAt !== loaded?.plan?.expiresAt
    || !UUID.test(receipt.requestId) || !UUID.test(receipt.actorId) || !UUID.test(receipt.eventId)
    || !SHA.test(receipt.eventHash) || typeof receipt.replayed !== 'boolean'
    || !Number.isSafeInteger(loaded.binding?.sourceFence) || loaded.binding.sourceFence < 1
    || !configuration || typeof configuration.policyVersion !== 'string'
    || !SHA.test(configuration.mappingDigest)) fail();
  return deepFreeze({ run_id: receipt.eventId, request_id: receipt.requestId,
    requested_by: receipt.actorId, source_code: 'EU_FUNDING_TENDERS',
    status: 'ERROR', error_code: 'EU_LEGACY_PREARCHIVE_STAGING',
    observed_at: loaded.artifact.observedAt,
    eu_source_fence: loaded.binding.sourceFence, eu_source_held: true,
    eu_writer_mode: 'CANONICAL_V2', eu_writer_policy: configuration.policyVersion,
    eu_writer_mapping_digest: configuration.mappingDigest });
}

module.exports = { archiveBatch, migrationRun };
