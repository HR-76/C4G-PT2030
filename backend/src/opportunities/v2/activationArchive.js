'use strict';
// Server-owned archive resolution. A client snapshot/hash is never evidence.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { cloneData, deepFreeze } = require('./data');
const { canonicalize } = require('../../organizationalProfile/canonicalization');
const { rawSnapshotDigest } = require('./reconciliation');
const { createCandidateArchiveV2 } = require('../../fundingTenders/candidateRepositoryV2');
const { verifyStoredManualCandidateV2 } = require('../manualV2Archive');
const manual = require('../manualV2');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(canonicalize(value));
function fail(code = 'OPPORTUNITY_V2_ARCHIVE_INVALID') { throw Object.assign(new Error(code), { code }); }
function locator(raw) {
  const value = cloneData(raw, { maxBytes: 2048 });
  if (value?.kind === 'PORTUGAL2030_PLAN') fail('OPPORTUNITY_V2_DOCUMENT_PIPELINE_REQUIRED');
  const keys = value?.kind === 'FUNDING' ? ['kind', 'runId', 'externalIdentifier'] : value?.kind === 'MANUAL' ? ['kind', 'candidateId'] : [];
  if (!keys.length || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail();
  if (value.kind === 'FUNDING' ? !UUID.test(value.runId) || typeof value.externalIdentifier !== 'string' || !value.externalIdentifier.length || value.externalIdentifier.length > 128 || /[\u0000-\u001f]/.test(value.externalIdentifier) : !UUID.test(value.candidateId)) fail();
  return deepFreeze(value);
}
function implementationDigest(source, version) {
  if (source === 'C4G_MANUAL') return manual.MAPPING_DIGEST;
  const base = 'backend/src/fundingTenders/';
  const files = ['INTERREG_EUROPE', 'POCTEP'].includes(source)
    ? ['officialAdapterV2.js', 'officialEvidenceV2.js', 'officialSources.js']
    : ['adapterV2.js', 'sourceEvidence.js', 'sourceDescription.js', 'programmeTaxonomy.js'];
  const root = path.resolve(__dirname, '../../../..');
  // Same explicitly labelled implementation fingerprint as the S6 rehearsal.
  return sha(JSON.stringify({ version, files: Object.fromEntries(files.map(file => base + file).sort().map(file => [file, sha(fs.readFileSync(path.join(root, file)))])) }));
}
async function loadVerifiedActivationArchive(client, raw, { allowLegacyPrearchive = false } = {}) {
  const archive = locator(raw);
  let snapshot, source, payloadDigest, candidateId;
  if (archive.kind === 'FUNDING') {
    const run = (await client.query('SELECT run_id,source_code,observed_at,status,error_code,limited,canonical_v2_required FROM opportunity_catalog.funding_run WHERE run_id=$1 FOR SHARE', [archive.runId])).rows[0];
    const legacy = allowLegacyPrearchive && run?.status === 'ERROR'
      && run.error_code === 'EU_LEGACY_PREARCHIVE_STAGING' && run.source_code === 'EU_FUNDING_TENDERS';
    if (!run || !(run.status === 'SUCCESS' && run.canonical_v2_required === true
      || legacy && run.canonical_v2_required === false) || run.limited !== false) fail('OPPORTUNITY_V2_SOURCE_RUN_NOT_COMPLETE');
    const verified = await createCandidateArchiveV2().verify(client, { run, externalIdentifier: archive.externalIdentifier, required: true });
    snapshot = verified.canonicalSnapshot; source = run.source_code; payloadDigest = verified.payloadDigest;
    candidateId = 'funding:' + hash(archive);
  } else {
    const row = (await client.query('SELECT candidate_id,requested_by,request_id,editorial_id,intent_digest,content_digest,artifact,canonical_snapshot,observed_at,mapping_version,mapping_digest,payload_digest FROM opportunity_catalog.manual_v2_candidate WHERE candidate_id=$1', [archive.candidateId])).rows[0];
    const saved = verifyStoredManualCandidateV2(row);
    snapshot = saved.snapshot; source = 'C4G_MANUAL'; payloadDigest = row.payload_digest; candidateId = 'manual:' + row.candidate_id;
  }
  return deepFreeze({ archive, source, candidateId, snapshot, payloadDigest,
    mappingDigest: implementationDigest(source, snapshot.provenance.mappingVersion), snapshotDigest: rawSnapshotDigest(snapshot) });
}
module.exports = { locator, loadVerifiedActivationArchive, implementationDigest, hash };
