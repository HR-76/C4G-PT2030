'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { cloneData, deepFreeze } = require('./v2/data');
const { contentDigestV2 } = require('./v2');
const { canonical } = require('../async/envelope');
const { adaptManualOpportunityV2, manualEditorialId, MAPPING_VERSION, MAPPING_DIGEST } = require('./manualV2');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRANSIENT = new Set(['40001', '40P01', '08006', 'ECONNRESET', '57P01']);
const hash = value => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
function fail(code = 'MANUAL_V2_CANDIDATE_INVALID') { throw Object.assign(new Error(code), { code }); }
function checked(raw) {
  try {
    const input = cloneData(raw, { maxBytes: 600 * 1024 });
    const keys = ['userId', 'requestId', 'editorialId', 'observedAt', 'snapshot', 'artifact'];
    if (!input || Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))
      || manualEditorialId(input.userId, input.requestId) !== input.editorialId
      || input.userId !== input.userId.toLowerCase() || input.requestId !== input.requestId.toLowerCase()) fail();
    const bundle = adaptManualOpportunityV2(input.artifact.json, { editorialId: input.editorialId, observedAt: input.observedAt });
    if (!isDeepStrictEqual(bundle.snapshot, input.snapshot) || !isDeepStrictEqual(bundle.artifact, input.artifact)) fail();
    return deepFreeze(input);
  } catch { fail(); }
}
function intentDigest(input) {
  return hash({ operation: 'C4G_MANUAL_CANDIDATE_V2', userId: input.userId, requestId: input.requestId,
    editorialId: input.editorialId, declaration: input.artifact.json, mappingVersion: MAPPING_VERSION, mappingDigest: MAPPING_DIGEST });
}
function payloadDigest(input) {
  return hash({ ...input, mappingVersion: MAPPING_VERSION, mappingDigest: MAPPING_DIGEST });
}
function verifyStored(row, incoming) {
  try {
    if (!row || !UUID.test(row.candidate_id) || row.requested_by !== incoming.userId || row.request_id !== incoming.requestId
      || row.mapping_version !== MAPPING_VERSION || row.mapping_digest !== MAPPING_DIGEST) fail();
    // node-postgres normally returns a Date; test doubles may return ISO text.
    const observedAt = typeof row.observed_at === 'string' ? row.observed_at : Date.prototype.toISOString.call(row.observed_at);
    const saved = checked({ userId: row.requested_by, requestId: row.request_id, editorialId: row.editorial_id,
      observedAt, snapshot: row.canonical_snapshot, artifact: row.artifact });
    if (intentDigest(saved) !== row.intent_digest || payloadDigest(saved) !== row.payload_digest
      || contentDigestV2(saved.snapshot) !== row.content_digest) fail();
    return saved;
  } catch { fail(); }
}
function receipt(row, replayed) {
  return deepFreeze({ candidateId: row.candidate_id, requestId: row.request_id, sourceIdentifier: 'EDITORIAL:' + row.editorial_id,
    contentDigest: row.content_digest, reviewRequired: true, replayed });
}

// Must be called inside the central transaction and current administrator lock.
// One immutable row is the declaration, its derived snapshot and retry receipt;
// no catalog opportunity, connector identity, accepted revision or tenant write.
function createManualCandidateArchiveV2({ audit } = {}) {
  if (typeof audit !== 'function') throw new TypeError('Manual v2 candidate audit is required.');
  return Object.freeze({ async stage(client, raw) {
    const input = checked(raw), intent = intentDigest(input);
    try {
      const inserted = await client.query('INSERT INTO opportunity_catalog.manual_v2_candidate(candidate_id,requested_by,request_id,editorial_id,intent_digest,content_digest,artifact,canonical_snapshot,observed_at,mapping_version,mapping_digest,payload_digest) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12) ON CONFLICT(requested_by,request_id) DO NOTHING RETURNING *',
        [randomUUID(), input.userId, input.requestId, input.editorialId, intent, contentDigestV2(input.snapshot), JSON.stringify(input.artifact),
          JSON.stringify(input.snapshot), input.observedAt, MAPPING_VERSION, MAPPING_DIGEST, payloadDigest(input)]);
      if (![0, 1].includes(inserted.rowCount)) fail();
      const row = inserted.rows[0] || (await client.query('SELECT candidate_id,requested_by,request_id,editorial_id,intent_digest,content_digest,artifact,canonical_snapshot,observed_at,mapping_version,mapping_digest,payload_digest FROM opportunity_catalog.manual_v2_candidate WHERE requested_by=$1 AND request_id=$2', [input.userId, input.requestId])).rows[0];
      verifyStored(row, input);
      if (row.intent_digest !== intent) fail('MANUAL_V2_IDEMPOTENCY_CONFLICT');
      if (inserted.rowCount === 1) await audit(client, { actor: { type: 'HUMAN', id: input.userId }, eventCode: 'OPPORTUNITY_IMPORT_CONFIRMED',
        requestId: `manual:v2:${input.userId}:${input.requestId}`, detailCode: 'MANUAL_V2_CANDIDATE_STAGED' });
      return receipt(row, inserted.rowCount === 0);
    } catch (error) {
      if (typeof error?.code === 'string' && error.code.startsWith('MANUAL_V2_')) throw error;
      throw Object.assign(new Error('MANUAL_V2_ARCHIVE_UNAVAILABLE'), { code: TRANSIENT.has(error?.code) ? error.code : 'MANUAL_V2_ARCHIVE_UNAVAILABLE' });
    }
  } });
}

module.exports = { createManualCandidateArchiveV2, verifyStoredManualCandidateV2: row => verifyStored(row, { userId: row?.requested_by, requestId: row?.request_id }) };
