'use strict';

const { createHash } = require('node:crypto');
const { canonicalize } = require('../organizationalProfile/canonicalization');
const { boundedSourceFields } = require('./merge');
const { verifyEvidence } = require('./sourceEvidence');

const PHASE = 'DISCOVERY_DETAIL';
const RESULT_PHASE = 'DISCOVERY_DETAIL_RESULT';
const OUTCOMES = ['FOUND', 'CONFLICT', 'ABSENT', 'ERROR'];
// Alias c is the funding_cycle being completed. This catches a mode change or
// interrupted hand-off as well as an explicitly unresolved individual lookup.
const requiresReviewSql = `EXISTS(SELECT 1 FROM opportunity_catalog.funding_batch b WHERE b.cycle_id=c.cycle_id
  AND b.input_cursor->>'phase'='DISCOVERY_DETAIL' AND (b.next_cursor->>'outcome') IS DISTINCT FROM 'FOUND')
  OR EXISTS(SELECT 1 FROM opportunity_catalog.funding_cycle_seen s WHERE s.cycle_id=c.cycle_id
    AND NOT EXISTS(SELECT 1 FROM opportunity_catalog.funding_refresh_target t WHERE t.cycle_id=s.cycle_id AND t.external_identifier=s.external_identifier)
    AND NOT EXISTS(SELECT 1 FROM opportunity_catalog.funding_batch b JOIN opportunity_catalog.funding_run_item i USING(run_id)
      WHERE b.cycle_id=s.cycle_id AND i.external_identifier=s.external_identifier AND i.result IN ('CREATED','UPDATED','UNCHANGED','FAILED','REVIEW')))
  OR EXISTS(SELECT 1 FROM opportunity_catalog.funding_batch b JOIN opportunity_catalog.funding_run_item i USING(run_id) WHERE b.cycle_id=c.cycle_id AND i.result='REVIEW')`;
function invalid(code = 'FUNDING_CHECKPOINT_INVALID') { throw Object.assign(new Error(code), { code }); }
function isDetailCursor(cursor) { return cursor?.phase === 'KNOWN' || cursor?.phase === PHASE; }
function fieldsDigest(fields) { return createHash('sha256').update(canonicalize(boundedSourceFields(fields))).digest('hex'); }

// cycle_seen has no catalogue-identity FK. Repeating the enqueue is harmless and
// never creates a placeholder opportunity to make the maintenance FK succeed.
async function enqueue(client, checkpoint, records) {
  if (!records.length) return;
  await client.query(`INSERT INTO opportunity_catalog.funding_cycle_seen(cycle_id,external_identifier)
    SELECT $1,unnest($2::text[]) ON CONFLICT DO NOTHING`, [checkpoint.cycle_id, records.map(record => record.externalIdentifier)]);
}

async function next(client, checkpoint) {
  const target = (await client.query(`SELECT s.external_identifier FROM opportunity_catalog.funding_cycle_seen s
    WHERE s.cycle_id=$1
      AND NOT EXISTS(SELECT 1 FROM opportunity_catalog.funding_refresh_target t WHERE t.cycle_id=s.cycle_id AND t.external_identifier=s.external_identifier)
      AND NOT EXISTS(SELECT 1 FROM opportunity_catalog.funding_batch b WHERE b.cycle_id=s.cycle_id
        AND b.input_cursor->>'phase'='DISCOVERY_DETAIL' AND b.input_cursor->>'externalIdentifier'=s.external_identifier)
    ORDER BY s.external_identifier LIMIT 1`, [checkpoint.cycle_id])).rows[0];
  return target ? { ...checkpoint, next_cursor: { phase: PHASE, externalIdentifier: target.external_identifier } } : null;
}

async function stage(client, run, batch, { resolutionEnabled = false, enrichmentEnabled = false } = {}) {
  const checkpoint = run.checkpoint, id = checkpoint?.input_cursor?.externalIdentifier;
  if (!enrichmentEnabled || checkpoint?.input_cursor?.phase !== PHASE || typeof id !== 'string' || !id || id.length > 128
    || !OUTCOMES.includes(batch.outcome) || !Number.isSafeInteger(batch.received) || batch.received < 0 || batch.received > 25
    || typeof batch.observedAt !== 'string' || !Number.isFinite(Date.parse(batch.observedAt))) invalid();
  if (resolutionEnabled) batch = await require('./resolutions').retainResolution(client, id, batch, { enrichmentEnabled });
  const conflictReasons = require('./conflictDiagnostics').validate(batch.outcome, batch.conflictReasons);
  let record = null;
  if (batch.outcome === 'FOUND') {
    if (batch.record?.externalIdentifier !== id || !verifyEvidence(batch.evidence) || batch.evidence.externalIdentifier !== id
      || batch.received !== batch.evidence.variants.length || !['OPEN', 'UPCOMING', 'CLOSED', 'CANCELLED'].includes(batch.record.fields?.sourceTemporal?.status)) invalid();
    record = { ...batch.record, fields: boundedSourceFields(batch.record.fields) };
  }
  // A detail job has no pagination successor. This tagged result uses the
  // existing bounded JSON checkpoint to retain even ABSENT/CONFLICT diagnostics.
  const result = {
    phase: RESULT_PHASE, outcome: batch.outcome, received: batch.received, observedAt: new Date(batch.observedAt).toISOString(),
    ...(conflictReasons ? { conflictReasons } : {}), evidenceFingerprint: record ? batch.evidence.fingerprint : null,
    fieldsDigest: record ? fieldsDigest(record.fields) : null
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 2048) invalid();
  const changed = await client.query(`UPDATE opportunity_catalog.funding_batch SET next_cursor=$2
    WHERE run_id=$1 AND cycle_id=$3 AND input_cursor->>'phase'=$4 AND input_cursor->>'externalIdentifier'=$5 RETURNING run_id`,
  [run.run_id, result, checkpoint.cycle_id, PHASE, id]);
  if (changed.rowCount !== 1) invalid();
  return record ? [record] : [];
}

function verifyStaged(checkpoint, stored, observedAt) {
  const result = checkpoint?.next_cursor;
  if (!Number.isFinite(new Date(observedAt).getTime())) invalid('FUNDING_DISCOVERY_REQUIRES_LOOKUP');
  if (checkpoint?.input_cursor?.phase !== PHASE || checkpoint.input_cursor.externalIdentifier !== stored.external_identifier
    || result?.phase !== RESULT_PHASE || result.outcome !== 'FOUND' || !Number.isSafeInteger(result.received) || result.received < 1 || result.received > 25
    || !/^[a-f0-9]{64}$/.test(result.evidenceFingerprint) || result.observedAt !== new Date(observedAt).toISOString()
    || result.fieldsDigest !== fieldsDigest(stored.source_fields)) invalid('FUNDING_DISCOVERY_REQUIRES_LOOKUP');
  return true;
}

async function finish(client, row, checkpoint, createNext, { enrichmentEnabled = false } = {}) {
  // A claimed detail may resume after its mode is disabled. Its parent records
  // the visible error; allow terminal cleanup without advancing the queue.
  if (checkpoint.input_cursor?.phase !== PHASE || !enrichmentEnabled && row.status !== 'ERROR') invalid();
  // Discovery counters already account for the provider page. Detail outcomes
  // contribute applied results only, never a second received/pages count.
  const canonical=row.eu_writer_mode==='CANONICAL_V2';
  const changed = await client.query(`UPDATE opportunity_catalog.funding_cycle SET created_count=created_count+$2,
    updated_count=updated_count+$3,unchanged_count=unchanged_count+$4,failed_count=failed_count+$5${canonical?',review_count=review_count+$6':''}
    WHERE cycle_id=$1 AND status='RUNNING' RETURNING cycle_id`,
  [checkpoint.cycle_id, row.created_count, row.updated_count, row.unchanged_count, row.failed_count,...(canonical?[row.review_count]:[])]);
  if (changed.rowCount !== 1) invalid();
  const refresh = require('./refresh');
  const successor = enrichmentEnabled && row.status === 'SUCCESS' ? await refresh.next(client, checkpoint, { enrichmentEnabled }) : null;
  if (successor) { await createNext(successor); return; }
  await refresh.complete(client, checkpoint.cycle_id, row.error_code);
}

module.exports = { PHASE, RESULT_PHASE, isDetailCursor, enqueue, next, stage, verifyStaged, finish, requiresReviewSql };
