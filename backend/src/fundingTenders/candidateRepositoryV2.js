'use strict';

const { createHash } = require('node:crypto');
const path = require('node:path');
const { types: { isProxy }, isDeepStrictEqual } = require('node:util');
const { cloneData, deepFreeze, jsonbBytes, MAX_SNAPSHOT_BYTES } = require('../opportunities/v2/data');
const { validateSnapshotV2 } = require('../opportunities/v2/validation');
const { contentDigestV2 } = require('../opportunities/v2/digests');
const { instant } = require('../opportunities/v2/normalization');
const { verifyEvidence, MAX_BYTES: MAX_EVIDENCE_BYTES } = require('./sourceEvidence');
const { selection, validateSelection } = require('./programmes');
const { OFFICIAL, validateSourceIdentity } = require('./sourceIdentity');
const { adaptEuOpportunityV2 } = require('./adapterV2');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_BATCH_BYTES = 3 * 1024 * 1024;
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const TRANSIENT = new Set(['40001', '40P01', '08006', 'ECONNRESET', '57P01']);

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

function error(code = 'FUNDING_V2_CANDIDATE_INVALID') {
  return Object.assign(new Error(code), { code });
}

function storageError(cause) {
  return Object.assign(new Error('FUNDING_V2_ARCHIVE_UNAVAILABLE'), {
    code: TRANSIENT.has(cause?.code) ? cause.code : 'FUNDING_V2_ARCHIVE_UNAVAILABLE'
  });
}

function runBinding(run) {
  if (!run || typeof run !== 'object' || isProxy(run) || Object.getPrototypeOf(run) !== Object.prototype) throw error();
  const descriptors = Object.getOwnPropertyDescriptors(run);
  const values = {};
  for (const key of ['run_id', 'source_code']) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') throw error();
    values[key] = descriptor.value;
  }
  if (!UUID.test(values.run_id)) throw error();
  validateSelection(values.source_code);
  return { runId: values.run_id.toLowerCase(), sourceSelection: values.source_code };
}

function candidateInput(run, rawBatch) {
  try {
    const binding = runBinding(run);
    const batch = cloneData(rawBatch, { maxBytes: MAX_BATCH_BYTES });
    const official = OFFICIAL.includes(binding.sourceSelection);
    if (!batch || batch.outcome !== 'FOUND' || batch.limited === true || batch.nextCursor
      || !Number.isSafeInteger(batch.received) || !INSTANT.test(batch.observedAt)
      || new Date(batch.observedAt).toISOString() !== batch.observedAt
      || (!official && (!verifyEvidence(batch.evidence) || batch.received !== batch.evidence.variants.length))
      || batch.record?.externalIdentifier !== batch.evidence.externalIdentifier) throw error();

    const programmeSelection = official ? [] : selection(binding.sourceSelection);
    if (programmeSelection.length && batch.evidence.variants.some(variant =>
      !variant.metadata.frameworkProgramme?.some(code => programmeSelection.includes(code)))) throw error();

    const snapshot = validateSnapshotV2(batch.canonicalSnapshot);
    let sourceFields;
    let derived;
    if(official){
      const evidence=batch.evidence.sourceEvidence;
      if(batch.evidence.kind!=='OFFICIAL_PROGRAMME' || evidence?.source!==binding.sourceSelection
        || evidence.observedAt!==batch.observedAt || evidence.fingerprint!==batch.evidence.fingerprint
        || batch.received!==evidence.documents?.length)throw error();
      validateSourceIdentity(binding.sourceSelection,batch.record.externalIdentifier);
      derived=require('./officialAdapterV2').adaptOfficialProgrammeV2({sourceEvidence:evidence,externalIdentifier:batch.record.externalIdentifier});
      sourceFields=officialFields(evidence,batch.record.externalIdentifier);
      if(batch.record.fields&&!isDeepStrictEqual(batch.record.fields,sourceFields))throw error();
    }else derived=adaptEuOpportunityV2(batch.evidence, { observedAt: batch.observedAt });
    if (!isDeepStrictEqual(snapshot, derived)) throw error();
    const source = snapshot.sourceRecords.find(item => item.namespace === (official?binding.sourceSelection:'EU_FUNDING_TENDERS') && item.role === 'CALL');
    if (!source || source.externalId !== batch.evidence.externalIdentifier) throw error();

    const evidenceJson = JSON.stringify(batch.evidence);
    const snapshotJson = JSON.stringify(snapshot);
    if (Buffer.byteLength(evidenceJson, 'utf8') > MAX_EVIDENCE_BYTES
      || Buffer.byteLength(snapshotJson, 'utf8') > MAX_SNAPSHOT_BYTES
      || jsonbBytes(snapshot) > MAX_SNAPSHOT_BYTES) throw error();

    const contentDigest = contentDigestV2(snapshot);
    const evidenceSha256 = hash(evidenceJson);
    // JSONB may reorder snapshot keys. Intent hashing is independent of object
    // key order; source artifact byte identity is retained in its own SHA-256.
    const payloadDigest = hash(canonical({
      archiveVersion: 1, ...binding, observedAt: batch.observedAt,
      externalIdentifier: source.externalId, mappingVersion: snapshot.provenance.mappingVersion,
      contentDigest, snapshot, evidence: batch.evidence
    }));
    return {
      ...binding, externalIdentifier: source.externalId, observedAt: batch.observedAt,
      mappingVersion: snapshot.provenance.mappingVersion, contentDigest, payloadDigest,
      snapshotJson, evidenceJson, evidenceFingerprint: batch.evidence.fingerprint, evidenceSha256, sourceFields
    };
  } catch {
    // Reject with a bounded public code; never include source/SQL/connection data.
    throw error();
  }
}

function officialRecords(evidence){
  const {SOURCES,parseInterreg,parsePoctep}=require('./officialSources');
  const body=url=>Buffer.from(evidence.documents.find(document=>document.url===url).bodyBase64,'base64');
  const config=SOURCES[evidence.source];
  return evidence.source==='INTERREG_EUROPE'?parseInterreg(body(config.url))
    :parsePoctep(JSON.parse(body(config.url).toString('utf8')),evidence.documents.some(document=>document.url===config.details)?JSON.parse(body(config.details).toString('utf8')):null);
}
function officialFields(evidence, externalIdentifier){
  const record=officialRecords(evidence).find(item=>item.externalIdentifier===externalIdentifier);
  if(!record)throw error();
  return {...record.fields,sourceTemporal:{status:record.declaredClosed?'CLOSED':'UNKNOWN',deadlines:[record.fields.closingDate],openings:[record.fields.openingDate]}};
}

function validateOfficialBatchV2(source,raw,{knownIdentifiers=[]}={}){
  try{
    const batch=cloneData(raw,{maxBytes:MAX_BATCH_BYTES});
    const {verifyOfficialProgrammeEvidenceV2,adaptOfficialProgrammeV2}=require('./officialAdapterV2');
    const evidence=verifyOfficialProgrammeEvidenceV2(batch.canonicalEvidence);
    if(evidence.source!==source||evidence.observedAt!==batch.observedAt)throw error();
    const rows=officialRecords(evidence);
    if(!Array.isArray(knownIdentifiers))throw error();
    for(const identifier of knownIdentifiers)validateSourceIdentity(source,identifier);
    const known=new Set(knownIdentifiers),asOf=evidence.observedAt.slice(0,10);
    const eligible=rows.filter(row=>known.has(row.externalIdentifier)||!row.declaredClosed&&row.fields.closingDate>=asOf);
    if(!Number.isSafeInteger(batch.received)||batch.received!==rows.length||batch.failed!==0
      ||batch.excluded!==rows.length-eligible.length
      ||typeof batch.limited!=='boolean'||!Array.isArray(batch.records)
      ||batch.records.length>eligible.length
      ||(batch.limited?batch.records.length<1||batch.records.length>=eligible.length:batch.records.length!==eligible.length)
      ||batch.records.some((record,index)=>record.externalIdentifier!==eligible[index].externalIdentifier))throw error();
    for(const row of rows)adaptOfficialProgrammeV2({sourceEvidence:evidence,externalIdentifier:row.externalIdentifier});
  }catch{throw error();}
}

const LEGACY_EU = new Set(['EU_FUNDING_TENDERS', 'CORDIS', 'ERASMUS']);
function prearchiveError(code = 'FUNDING_V2_PREARCHIVE_APPROVAL_REQUIRED') {
  return Object.assign(new Error(code), { code });
}
const isUuid = value => typeof value === 'string' && UUID.test(value);
const isSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
async function legacyPrearchivePermit(client, { run, batch, value, preapproval, workspaceRoot, packageLoader }) {
  if (run.eu_writer_mode !== 'CANONICAL_V2' || !LEGACY_EU.has(value.sourceSelection)) return null;
  let heads;
  try {
    heads = (await client.query(`SELECT o.current_schema_version FROM opportunity_catalog.funding_identity f
      JOIN opportunity_catalog.opportunity o USING(opportunity_id)
      WHERE f.external_identifier=$1 FOR SHARE OF o`, [value.externalIdentifier])).rows;
  } catch { throw prearchiveError('FUNDING_V2_PREARCHIVE_UNAVAILABLE'); }
  if (heads.length > 1 || heads.length === 1 && ![1, 2].includes(heads[0].current_schema_version))
    throw prearchiveError('FUNDING_V2_PREARCHIVE_STATE_CHANGED');
  if (!heads.length || heads[0].current_schema_version === 2) {
    if (preapproval !== null) throw prearchiveError();
    return null;
  }
  let receipt;
  try { receipt = cloneData(preapproval, { maxBytes: 2048 }); } catch { throw prearchiveError(); }
  const keys = ['packageId', 'itemDigest', 'bindingDigest', 'eventId', 'eventHash', 'actorId'];
  const fullKeys = [...keys, 'scope', 'externalIdentifier', 'requestId', 'expiresAt', 'replayed'];
  const receivedKeys = receipt && !Array.isArray(receipt) ? Object.keys(receipt) : [];
  const compact = receivedKeys.length === keys.length && keys.every(key => Object.hasOwn(receipt, key));
  const full = receivedKeys.length === fullKeys.length && fullKeys.every(key => Object.hasOwn(receipt, key));
  if (!receipt || (!compact && !full)
    || !isUuid(receipt.packageId) || !isUuid(receipt.eventId) || !isUuid(receipt.actorId)
    || !isSha(receipt.itemDigest) || !isSha(receipt.bindingDigest) || !isSha(receipt.eventHash))
    throw prearchiveError();
  let loaded;
  try {
    loaded = packageLoader(workspaceRoot, receipt.packageId, receipt.itemDigest);
  } catch { throw prearchiveError('FUNDING_V2_PREARCHIVE_STATE_CHANGED'); }
  if (loaded.bindingDigest !== receipt.bindingDigest
    || full && (receipt.scope !== 'PREARCHIVE_ONLY'
      || receipt.externalIdentifier !== value.externalIdentifier
      || !isUuid(receipt.requestId) || receipt.expiresAt !== loaded.plan.expiresAt
      || typeof receipt.replayed !== 'boolean')
    || loaded.item.externalIdentifier !== value.externalIdentifier
    || value.sourceSelection !== 'EU_FUNDING_TENDERS'
    || Number(run.eu_source_fence) !== loaded.binding.sourceFence
    || value.contentDigest !== loaded.item.contentDigest
    || value.evidenceFingerprint !== loaded.item.evidenceFingerprint
    || batch.observedAt !== loaded.artifact.observedAt
    || !isDeepStrictEqual(batch.evidence, loaded.artifact.evidence)
    || !isDeepStrictEqual(batch.canonicalSnapshot, loaded.artifact.snapshot)
    || !isDeepStrictEqual(batch.record?.fields, loaded.artifact.sourceFields))
    throw prearchiveError('FUNDING_V2_PREARCHIVE_STATE_CHANGED');
  let status;
  try {
    status = (await client.query(`SELECT opportunity_catalog.authorize_eu_legacy_prearchive_v1(
      $1::uuid,$2::text,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::text,
        $9::uuid,$10::uuid,$11::integer,$12::integer,$13::timestamptz,$14::timestamptz,$15::text,$16::text) AS status`,
    [receipt.eventId, receipt.eventHash, receipt.actorId, value.runId, value.externalIdentifier,
      value.payloadDigest, receipt.bindingDigest, receipt.itemDigest,
      loaded.binding.expected.opportunityId, loaded.binding.expected.revisionId,
      loaded.binding.expected.rowVersion, loaded.binding.sourceFence,
        loaded.plan.createdAt, loaded.plan.expiresAt, value.contentDigest,
        value.evidenceFingerprint])).rows[0]?.status;
  } catch (cause) {
    if (cause?.message === 'FUNDING_V2_PREARCHIVE_APPROVAL_REQUIRED'
      || cause?.message === 'FUNDING_V2_PREARCHIVE_STATE_CHANGED')
      throw prearchiveError(cause.message);
    throw prearchiveError('FUNDING_V2_PREARCHIVE_UNAVAILABLE');
  }
  if (!['NEW', 'REPLAY'].includes(status)) throw prearchiveError('FUNDING_V2_PREARCHIVE_UNAVAILABLE');
  return status;
}

function createCandidateArchiveV2({ workspaceRoot = path.resolve(__dirname, '../../..'),
  packageLoader = require('../opportunities/v2/euLegacyPreapproval').loadPackage } = {}) {
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot))
    throw new TypeError('Candidate archive workspace root is invalid.');
  if (typeof packageLoader !== 'function') throw new TypeError('Candidate archive package loader is invalid.');
  async function stageInternal(client, { run, batch, preapproval = null }, migration = false) {
      const value = candidateInput(run, batch);
      if (!client || typeof client.query !== 'function') throw error('FUNDING_V2_ARCHIVE_UNAVAILABLE');
      try {
        const permit = await legacyPrearchivePermit(client, { run, batch, value, preapproval, workspaceRoot, packageLoader });
        if (migration && permit === null) throw prearchiveError();
        if (permit === 'REPLAY') {
          const prior = (await client.query(
            'SELECT payload_digest FROM opportunity_catalog.funding_candidate_v2 WHERE run_id=$1 AND external_identifier=$2',
            [value.runId, value.externalIdentifier])).rows[0];
          if (!prior || prior.payload_digest !== value.payloadDigest)
            throw prearchiveError('FUNDING_V2_PREARCHIVE_STATE_CHANGED');
          return deepFreeze({ stored: false, externalIdentifier: value.externalIdentifier,
            contentDigest: value.contentDigest, payloadDigest: value.payloadDigest });
        }
        if (migration) {
          if (permit !== 'NEW') throw prearchiveError();
          await client.query(`INSERT INTO opportunity_catalog.funding_run(
            run_id,request_id,requested_by,status,source_code,observed_at,finished_at,error_code,
            eu_source_fence,eu_source_held,eu_writer_mode,eu_writer_policy,eu_writer_mapping_digest)
            VALUES($1,$2,$3,'ERROR','EU_FUNDING_TENDERS',$4,clock_timestamp(),
              'EU_LEGACY_PREARCHIVE_STAGING',$5,true,'CANONICAL_V2',$6,$7)`,
          [run.run_id, run.request_id, run.requested_by, run.observed_at,
            run.eu_source_fence, run.eu_writer_policy, run.eu_writer_mapping_digest]);
        }
        // The caller owns the active transaction, current authority and run fence.
        // This table has only a funding_run FK: a candidate may precede the identity.
        const inserted = await client.query(
          'INSERT INTO opportunity_catalog.funding_candidate_v2(run_id,external_identifier,source_selection,observed_at,snapshot_schema_version,mapping_version,content_digest,payload_digest,canonical_snapshot,source_evidence,evidence_fingerprint,evidence_sha256) VALUES($1,$2,$3,$4,2,$5,$6,$7,$8::jsonb,$9::json,$10,$11) ON CONFLICT(run_id,external_identifier) DO NOTHING RETURNING payload_digest',
          [value.runId, value.externalIdentifier, value.sourceSelection, value.observedAt, value.mappingVersion,
            value.contentDigest, value.payloadDigest, value.snapshotJson, value.evidenceJson, value.evidenceFingerprint, value.evidenceSha256]
        );
        if (inserted.rowCount !== 1) {
          const existing = (await client.query(
            'SELECT payload_digest FROM opportunity_catalog.funding_candidate_v2 WHERE run_id=$1 AND external_identifier=$2',
            [value.runId, value.externalIdentifier]
          )).rows[0];
          if (!existing || existing.payload_digest !== value.payloadDigest) throw error('FUNDING_V2_CANDIDATE_REPLAY_CONFLICT');
        }
        return deepFreeze({ stored: inserted.rowCount === 1, externalIdentifier: value.externalIdentifier,
          contentDigest: value.contentDigest, payloadDigest: value.payloadDigest });
      } catch (cause) {
        if (cause?.code?.startsWith('FUNDING_V2_PREARCHIVE_')) throw cause;
        if (cause?.code === 'FUNDING_V2_CANDIDATE_REPLAY_CONFLICT') throw cause;
        throw storageError(cause);
      }
  }
  return Object.freeze({
    stage: (client, args) => stageInternal(client, args),
    stageLegacyMigration(client, { loaded, receipt }) {
      const { archiveBatch, migrationRun } = require('../opportunities/v2/euLegacyArchiveBatch');
      const configuration = require('./euWriter').euWriterConfiguration();
      const run = migrationRun(loaded, receipt, configuration), batch = archiveBatch(loaded);
      return stageInternal(client, { run, batch, preapproval: receipt }, true);
    },

    async verify(client, { run, externalIdentifier, required = true }) {
      let binding, runObservedAt;
      try {
        binding = runBinding(run);
        const observation = Object.getOwnPropertyDescriptor(run, 'observed_at');
        if (!observation || !Object.hasOwn(observation, 'value')) throw error();
        runObservedAt = observation.value instanceof Date
          ? Date.prototype.toISOString.call(observation.value) : instant(observation.value);
        if (typeof required !== 'boolean' || typeof externalIdentifier !== 'string'
          || !externalIdentifier.length || externalIdentifier.length > 128 || /[\u0000-\u001f]/.test(externalIdentifier)) throw error();
      } catch { throw error(); }
      if (!client || typeof client.query !== 'function') throw error('FUNDING_V2_ARCHIVE_UNAVAILABLE');
      let row;
      try {
        row = (await client.query(
          'SELECT run_id,external_identifier,source_selection,observed_at,snapshot_schema_version,mapping_version,content_digest,payload_digest,canonical_snapshot,source_evidence,evidence_fingerprint,evidence_sha256 FROM opportunity_catalog.funding_candidate_v2 WHERE run_id=$1 AND external_identifier=$2',
          [binding.runId, externalIdentifier]
        )).rows[0];
      } catch (cause) { throw storageError(cause); }
      // Only the trusted parent may set required=false, after independently
      // verifying an archived legacy P2 resolution. A present row is never exempt.
      if (!row && !required) return null;
      try {
        if (!row || row.run_id !== binding.runId || row.external_identifier !== externalIdentifier
          || row.source_selection !== binding.sourceSelection || row.snapshot_schema_version !== 2) throw error();
        const observedAt = row.observed_at instanceof Date
          ? Date.prototype.toISOString.call(row.observed_at) : new Date(row.observed_at).toISOString();
        if (observedAt !== runObservedAt) throw error();
        const checked = candidateInput(run, { outcome: 'FOUND', observedAt,
          received: OFFICIAL.includes(binding.sourceSelection)?row.source_evidence?.sourceEvidence?.documents?.length:row.source_evidence?.variants?.length, record: { externalIdentifier },
          evidence: row.source_evidence, canonicalSnapshot: row.canonical_snapshot });
        if (row.mapping_version !== checked.mappingVersion || row.content_digest !== checked.contentDigest
          || row.payload_digest !== checked.payloadDigest || row.evidence_fingerprint !== checked.evidenceFingerprint
          || row.evidence_sha256 !== checked.evidenceSha256) throw error();
        return deepFreeze({ externalIdentifier, contentDigest: checked.contentDigest, payloadDigest: checked.payloadDigest,
          canonicalSnapshot: JSON.parse(checked.snapshotJson),...(checked.sourceFields?{sourceFields:checked.sourceFields}:{}) });
      } catch { throw error(); }
    }
  });
}

module.exports = { createCandidateArchiveV2, validateOfficialBatchV2, legacyPrearchivePermit };
