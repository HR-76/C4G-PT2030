'use strict';

const { createHash } = require('node:crypto');
const { cloneData, deepFreeze } = require('./data');
const { createActivationAuthorityV2, humanContext } = require('./activationAuthority');
const { createActivationAuditV2 } = require('./activationAudit');
const { sourceControlError } = require('./euSourceControl');
const { createCandidateArchiveV2 } = require('../../fundingTenders/candidateRepositoryV2');
const { observe11145, SOURCE, EXTERNAL_IDENTIFIER, COLLECTION_LIMITS } = require('../../fundingTenders/source11145');
const { preflightCentral } = require('../../security/centralMigrationPreflight');
const { centralEntries } = require('../../security/opportunityV2MigrationPackage');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PURPOSE = 'opportunity-eu-11145-archive-only-v1';
function fail(code = 'OPPORTUNITY_V2_11145_INVALID') { throw Object.assign(new Error(code), { code }); }
async function assertCollector11145Package(pool) {
  try {
    const proof = await preflightCentral(pool);
    if (![centralEntries.at(-1).version,require('../../security/opportunityEuWriterMigrationPackage').entry.version,
      '044_opportunity_eu_expired_reconciliation','045_opportunity_eu_legacy_prearchive'].includes(proof.currentVersion)) fail('OPPORTUNITY_V2_NOT_CONFIGURED');
    return true;
  } catch { fail('OPPORTUNITY_V2_NOT_CONFIGURED'); }
}
function command(raw) {
  let value;
  try { value = cloneData(raw, { maxBytes: 2048 }); } catch { fail(); }
  if (!value || Array.isArray(value) || Object.keys(value).length !== 2 || !UUID.test(value.requestId)
      || !Object.hasOwn(value, 'expectedSourceFence') || !Number.isSafeInteger(value.expectedSourceFence) || value.expectedSourceFence < 1) fail();
  return deepFreeze(value);
}
// UUIDv8 distinguishes the purpose from random legacy runs. All inputs needed
// to verify it survive in funding_run; no caller can substitute a legacy run.
function collectorRunId({ requestId, actorId, sourceFence, opportunityId }) {
  if (!UUID.test(requestId) || !UUID.test(actorId) || !UUID.test(opportunityId) || !Number.isSafeInteger(sourceFence) || sourceFence < 1) fail();
  const bytes = createHash('sha256').update(JSON.stringify([PURPOSE, SOURCE, EXTERNAL_IDENTIFIER, opportunityId, actorId, requestId, sourceFence])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 128; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function knownIdentity(client) {
  const rows = (await client.query(`SELECT o.opportunity_id,o.current_revision_id,o.row_version,o.lifecycle_state
    FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id)
    WHERE f.external_identifier=$1 FOR SHARE OF f,o`, [EXTERNAL_IDENTIFIER])).rows;
  const row = rows[0];
  if (rows.length !== 1 || !UUID.test(row?.opportunity_id) || !UUID.test(row?.current_revision_id)
      || !Number.isSafeInteger(Number(row?.row_version)) || Number(row.row_version) < 1 || row.lifecycle_state !== 'ACTIVE') fail('OPPORTUNITY_V2_11145_IDENTITY_REQUIRED');
  const identities = (await client.query('SELECT opportunity_id FROM opportunity_catalog.source_identity_v2 WHERE source_namespace=$1 AND external_identifier=$2', [SOURCE, EXTERNAL_IDENTIFIER])).rows;
  if (identities.some(item => item.opportunity_id !== row.opportunity_id)) fail('OPPORTUNITY_V2_11145_IDENTITY_REQUIRED');
  return { opportunityId: row.opportunity_id, revisionId: row.current_revision_id, rowVersion: Number(row.row_version) };
}
async function verifyCollector11145Run(client, { runId, actorId } = {}) {
  if (!UUID.test(runId) || !UUID.test(actorId)) fail();
  const run = (await client.query('SELECT * FROM opportunity_catalog.funding_run WHERE run_id=$1 FOR SHARE', [runId])).rows[0];
  const expected = await knownIdentity(client);
  if (!run || run.requested_by !== actorId || run.source_code !== SOURCE || run.status !== 'SUCCESS'
      || run.collected !== true || run.canonical_v2_required !== true || run.limited !== false
      || !Number.isSafeInteger(run.result_count) || run.result_count < 1 || run.result_count > COLLECTION_LIMITS.pageSize
      || [run.created_count, run.updated_count, run.unchanged_count, run.failed_count].some(value => value !== 0)
      || Number(run.fence) !== 1 || run.lease_until !== null || run.error_code !== null || !run.started_at || !run.finished_at
      || runId !== collectorRunId({ requestId: run.request_id, actorId, sourceFence: run.eu_source_fence, opportunityId: expected.opportunityId })) fail('OPPORTUNITY_V2_11145_RUN_INVALID');
  const proof = (await client.query(`SELECT
    (SELECT count(*)::integer FROM opportunity_catalog.funding_candidate_v2 WHERE run_id=$1) AS candidates,
    (SELECT max(json_array_length(source_evidence->'variants')) FROM opportunity_catalog.funding_candidate_v2 WHERE run_id=$1) AS variants,
    (SELECT count(*)::integer FROM opportunity_catalog.funding_run_item WHERE run_id=$1) AS items,
    (SELECT count(*)::integer FROM opportunity_catalog.funding_batch WHERE run_id=$1) AS batches,
    (SELECT count(*)::integer FROM opportunity_catalog.funding_cycle WHERE cycle_id=$1) AS cycles`, [runId])).rows[0];
  if (!proof || proof.candidates !== 1 || proof.variants !== run.result_count || proof.items !== 0 || proof.batches !== 0 || proof.cycles !== 0) fail('OPPORTUNITY_V2_11145_RUN_INVALID');
  const saved = await createCandidateArchiveV2().verify(client, { run, externalIdentifier: EXTERNAL_IDENTIFIER, required: true });
  return deepFreeze({ runId, archive: { kind: 'FUNDING', runId, externalIdentifier: EXTERNAL_IDENTIFIER },
    opportunityId: expected.opportunityId, expected, observedAt: new Date(run.observed_at).toISOString(),
    sourceFence: run.eu_source_fence, received: run.result_count, candidates: 1, payloadDigest: saved.payloadDigest, contentDigest: saved.contentDigest });
}
function createEu11145Collector({ pool, policyVersion, recentMfaRequirement, fetchImpl = globalThis.fetch } = {}) {
  if (!pool || typeof pool.connect !== 'function' || typeof fetchImpl !== 'function') throw new TypeError('Central pool and HTTP transport are required.');
  const authority = createActivationAuthorityV2({ policyVersion, recentMfaRequirement });
  const audit = createActivationAuditV2(), archive = createCandidateArchiveV2();
  async function transaction(context, work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SET LOCAL ROLE c4g_opportunity_central_runtime');
      await client.query("SET LOCAL statement_timeout='5s'"); await client.query("SET LOCAL lock_timeout='3s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout='10s'");
      // Same lock order as existing writers and source suspension; no network
      // operation ever runs while this transaction or the authority locks exist.
      await client.query('LOCK TABLE opportunity_catalog.funding_run IN ROW EXCLUSIVE MODE');
      const actorId = await authority.assertAdministrator(client, context);
      const result = await work(client, actorId);
      await authority.assertAdministrator(client, context);
      await client.query('COMMIT'); return result;
    } catch (raw) {
      await client.query('ROLLBACK').catch(() => {});
      const error = sourceControlError(raw);
      if (error.code?.startsWith('OPPORTUNITY_V2_')) throw error;
      fail(['23505', '40001', '40P01', '55P03'].includes(error.code) ? 'OPPORTUNITY_V2_11145_CONFLICT' : 'OPPORTUNITY_V2_11145_UNAVAILABLE');
    } finally { client.release(); }
  }
  async function check(client, actorId, input) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,620111))', [input.requestId]);
    const existing = (await client.query('SELECT run_id FROM opportunity_catalog.funding_run WHERE request_id=$1', [input.requestId])).rows[0];
    if (existing) {
      const identity = await knownIdentity(client);
      if (existing.run_id !== collectorRunId({ requestId: input.requestId, actorId, sourceFence: input.expectedSourceFence, opportunityId: identity.opportunityId })) fail('OPPORTUNITY_V2_IDEMPOTENCY_CONFLICT');
      return { replay: await verifyCollector11145Run(client, { runId: existing.run_id, actorId }) };
    }
    const fence = (await client.query('SELECT opportunity_catalog.assert_eu_active_v2($1) AS fence', [SOURCE])).rows[0]?.fence;
    if (fence !== input.expectedSourceFence) fail('OPPORTUNITY_V2_SOURCE_FENCE_STALE');
    return { identity: await knownIdentity(client) };
  }
  async function collect(raw, rawContext) {
    const input = command(raw), context = humanContext(rawContext);
    if (!context) fail('OPPORTUNITY_V2_AUTHORITY_DENIED');
    deepFreeze(context);
    await assertCollector11145Package(pool);
    const before = await transaction(context, (client, actorId) => check(client, actorId, input));
    if (before.replay) return deepFreeze({ ...before.replay, replayed: true });
    const observed = await observe11145({ fetchImpl });
    return transaction(context, async (client, actorId) => {
      const current = await check(client, actorId, input);
      if (current.replay) return deepFreeze({ ...current.replay, replayed: true });
      if (current.identity.opportunityId !== before.identity.opportunityId) fail('OPPORTUNITY_V2_11145_IDENTITY_REQUIRED');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,150001))', [SOURCE]);
      const runId = collectorRunId({ requestId: input.requestId, actorId, sourceFence: input.expectedSourceFence, opportunityId: current.identity.opportunityId });
      await client.query(`INSERT INTO opportunity_catalog.funding_run(run_id,request_id,requested_by,source_code,status,canonical_v2_required)
        VALUES($1,$2,$3,$4,'QUEUED',true)`, [runId, input.requestId, actorId, SOURCE]);
      const claimed = (await client.query(`UPDATE opportunity_catalog.funding_run SET status='RUNNING',started_at=clock_timestamp(),
        fence=fence+1,lease_until=clock_timestamp()+interval '150 seconds' WHERE run_id=$1 AND status='QUEUED' AND fence=0 RETURNING *`, [runId])).rows[0];
      if (!claimed || Number(claimed.fence) !== 1 || claimed.eu_source_fence !== input.expectedSourceFence) fail('OPPORTUNITY_V2_11145_RUN_INVALID');
      await archive.stage(client, { run: claimed, batch: observed.batch });
      const run = { ...claimed, observed_at: observed.batch.observedAt };
      const saved = await archive.verify(client, { run, externalIdentifier: EXTERNAL_IDENTIFIER, required: true });
      const completed = await client.query(`UPDATE opportunity_catalog.funding_run SET status='SUCCESS',collected=true,observed_at=$2,
        result_count=$4,finished_at=clock_timestamp(),lease_until=NULL WHERE run_id=$1 AND status='RUNNING' AND fence=1
        AND lease_until>clock_timestamp() AND eu_source_fence=$3 RETURNING run_id`, [runId, observed.batch.observedAt, input.expectedSourceFence, observed.batch.received]);
      if (completed.rowCount !== 1) fail('OPPORTUNITY_V2_11145_RUN_INVALID');
      await audit.recordCollection(client, { context, requestId: input.requestId, runId, payloadDigest: saved.payloadDigest });
      const result = await verifyCollector11145Run(client, { runId, actorId });
      return deepFreeze({ ...result, transport: observed.transport, replayed: false });
    });
  }
  return Object.freeze({ collect });
}

module.exports = { PURPOSE, command, collectorRunId, verifyCollector11145Run, assertCollector11145Package, createEu11145Collector };
