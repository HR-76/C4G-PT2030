'use strict';
// Explicit operational composition used only by the selected activation runtime.
// Production selection remains disabled by default.
// SERVICE and PT2030 document ingestion deliberately remain fail-closed.
const { randomUUID } = require('node:crypto');
const { createAcceptedOpportunityV2Repository, command } = require('./acceptedRepository');
const { createActivationAuthorityV2 } = require('./activationAuthority');
const { createActivationAuditV2 } = require('./activationAudit');
const { loadVerifiedActivationArchive, hash } = require('./activationArchive');
const p = require('./activationApproval');

function createOpportunityActivationV2({ pool, policyVersion, recentMfaRequirement } = {}) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('Central pool is required.');
  const authority = createActivationAuthorityV2({ policyVersion, recentMfaRequirement });
  const audit = createActivationAuditV2();
  const accepted = createAcceptedOpportunityV2Repository({ pool, authorize: authority.authorize, verifyApproval: p.verifyActivationApproval, audit });
  async function transaction(context, work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE c4g_opportunity_central_runtime');
      const actorId = await authority.assertAdministrator(client, context);
      const result = await work(client, actorId);
      await authority.assertAdministrator(client, context);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code?.startsWith('OPPORTUNITY_V2_')) throw error;
      p.fail(['23505', '40001', '40P01'].includes(error.code) ? 'OPPORTUNITY_V2_ACTIVATION_CONFLICT' : 'OPPORTUNITY_V2_ACTIVATION_UNAVAILABLE');
    } finally { client.release(); }
  }
  async function prepare(raw, context, bounded11145=false, boundedLegacy=false, expectedPreviewDigest=null) {
    const value = p.input(raw, ['requestId', 'archive', 'expected']);
    const archived = await transaction(context, client => loadVerifiedActivationArchive(client, value.archive,
      { allowLegacyPrearchive: boundedLegacy }));
    const candidateCommand = command({ requestId: value.requestId, candidateId: archived.candidateId, snapshot: archived.snapshot, mappingDigest: archived.mappingDigest, expected: value.expected });
    const preview = await accepted.preview(candidateCommand, context);
    if (expectedPreviewDigest && (preview.previewDigest !== expectedPreviewDigest
      || preview.items?.[0]?.action !== 'CHANGE_REQUIRES_APPROVAL')) p.fail('OPPORTUNITY_V2_APPROVAL_STALE');
    return transaction(context, async (client, actorId) => {
      const row = { prepared_by: actorId, source_code: archived.source, archive_locator: archived.archive, archive_digest: archived.payloadDigest,
        candidate_id: archived.candidateId, mapping_digest: archived.mappingDigest, snapshot_digest: archived.snapshotDigest, expected: candidateCommand.expected,
        preview, preview_digest: preview.previewDigest };
      row.plan_digest = hash(p.planBinding(row));
      // Archive may have changed between the two read transactions. Never persist
      // a plan from a different artifact or mapping; acceptance also checks CAS.
      const fresh = await loadVerifiedActivationArchive(client, archived.archive,
        { allowLegacyPrearchive: boundedLegacy });
      if (fresh.payloadDigest !== archived.payloadDigest || fresh.snapshotDigest !== archived.snapshotDigest || fresh.mappingDigest !== archived.mappingDigest) p.fail('OPPORTUNITY_V2_PLAN_ARCHIVE_CHANGED');
      if(bounded11145)await require('./executor11145Scope').verifyExecutor11145Plan(client,row,row.plan_digest);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,620071))', [value.requestId]);
      const existing = (await client.query('SELECT * FROM opportunity_catalog.activation_plan_v2 WHERE prepared_request_id=$1', [value.requestId])).rows[0];
      if (existing) {
        if (existing.plan_digest !== row.plan_digest) p.fail('OPPORTUNITY_V2_IDEMPOTENCY_CONFLICT');
        return p.planView(existing, true);
      }
      const stored = (await client.query(`INSERT INTO opportunity_catalog.activation_plan_v2(plan_id,prepared_request_id,prepared_by,source_code,archive_locator,archive_digest,candidate_id,mapping_digest,snapshot_digest,expected,preview,preview_digest,plan_digest,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,transaction_timestamp()+interval '1 hour') RETURNING *`,
      [randomUUID(), value.requestId, actorId, row.source_code, row.archive_locator, row.archive_digest, row.candidate_id, row.mapping_digest, row.snapshot_digest, row.expected, row.preview, row.preview_digest, row.plan_digest])).rows[0];
      await audit.recordDecision(client, { context, decision: 'PREPARED', planId: stored.plan_id, planDigest: stored.plan_digest, requestId: value.requestId });
      return p.planView(stored);
    });
  }
  async function decide(decision, raw, context, boundedLegacy=false) {
    const value = p.input(raw, ['requestId', 'planId', 'planDigest']);
    return transaction(context, async (client, actorId) => {
      const row = await p.lockedPlan(client, value.planId, { exclusive: true });
      if (row.plan_digest !== value.planDigest) p.fail('OPPORTUNITY_V2_APPROVAL_STALE');
      const intent = hash({ ...value, decision, actorId });
      const replay = (await client.query('SELECT * FROM opportunity_catalog.activation_decision_v2 WHERE request_id=$1', [value.requestId])).rows[0];
      if (replay) {
        if (replay.intent_digest !== intent) p.fail('OPPORTUNITY_V2_IDEMPOTENCY_CONFLICT');
        if (row.state !== decision || row.fence !== replay.result.fence || decision === 'APPROVED' && !row.unexpired) p.fail('OPPORTUNITY_V2_PLAN_NOT_APPROVED');
        return p.planView(row, true);
      }
      if (row.state === 'REVOKED' || decision === 'APPROVED' && (row.state !== 'DRAFT' || row.unexpired !== true)) p.fail('OPPORTUNITY_V2_PLAN_NOT_APPROVABLE');
      if (decision === 'APPROVED') {
        if (row.preview.items[0].action === 'BLOCKED') p.fail('OPPORTUNITY_V2_RECONCILIATION_BLOCKED');
        const archive = await p.verifyPlanArchive(client, row,
          { allowLegacyPrearchive: boundedLegacy });
        // A fresh accepted preview is compared with the exact review. CAS is
        // repeated by the writer; a concurrent change never inherits approval.
        const preview = await accepted.previewInTransaction(client, p.commandFor(row, archive, value.requestId), context);
        if (preview.previewDigest !== row.preview_digest) p.fail('OPPORTUNITY_V2_APPROVAL_STALE');
      }
      const updated = (await client.query(decision === 'APPROVED'
        ? "UPDATE opportunity_catalog.activation_plan_v2 SET state='APPROVED',fence=fence+1,approved_by=$2,approved_at=clock_timestamp() WHERE plan_id=$1 RETURNING *"
        : "UPDATE opportunity_catalog.activation_plan_v2 SET state='REVOKED',fence=fence+1,revoked_by=$2,revoked_at=clock_timestamp() WHERE plan_id=$1 RETURNING *", [value.planId, actorId])).rows[0];
      const result = p.planView(updated);
      await audit.recordDecision(client, { context, decision, planId: row.plan_id, planDigest: row.plan_digest, requestId: value.requestId });
      await client.query('INSERT INTO opportunity_catalog.activation_decision_v2(request_id,plan_id,decision,actor_id,intent_digest,result) VALUES($1,$2,$3,$4,$5,$6)', [value.requestId, row.plan_id, decision, actorId, intent, { planId: result.planId, state: result.state, fence: result.fence }]);
      return result;
    });
  }
  async function prepare11145(raw,context){
    const value=p.input(raw,['requestId','runId']);
    await require('./collector11145').assertCollector11145Package(pool);
    const collected=await transaction(context,(client,actorId)=>require('./collector11145').verifyCollector11145Run(client,{runId:value.runId,actorId}));
    if(!collected.expected||collected.expected.opportunityId!==collected.opportunityId)p.fail('OPPORTUNITY_V2_11145_SCOPE_INVALID');
    return prepare({requestId:value.requestId,archive:collected.archive,expected:collected.expected},context,true);
  }
  async function accept(raw, context, bounded11145=false, boundedLegacy=false) {
    const value = p.input(raw, ['requestId', 'planId', 'fence', ...(bounded11145?['sourceFence','planDigest']:(raw && Object.hasOwn(raw, 'sourceFence') ? ['sourceFence'] : []))]);
    const prepared = await transaction(context, async (client, actorId) => {
      const row = await p.lockedPlan(client, value.planId);
      if (row.state !== 'APPROVED' || row.fence !== value.fence || row.unexpired !== true || row.approved_by !== actorId) p.fail('OPPORTUNITY_V2_PLAN_NOT_APPROVED');
      if(bounded11145)await require('./executor11145Scope').verifyExecutor11145Plan(client,row,value.planDigest);
      await require('./euSourceControl').assertEuQuiescent(client, row.source_code, value.sourceFence);
      const archive = await p.verifyPlanArchive(client, row,
        { allowLegacyPrearchive: boundedLegacy });
      return p.commandFor(row, archive, value.requestId);
    });
    return accepted.accept(prepared, { ...context, planId: value.planId, fence: value.fence, ...(Object.hasOwn(value,'sourceFence')?{sourceFence:value.sourceFence}:{}),...(bounded11145?{executor11145Digest:value.planDigest}:{}),...(boundedLegacy?{legacyPrearchiveAcceptance:true}:{}) });
  }
  async function accept11145(value,context){await require('./collector11145').assertCollector11145Package(pool);return accept(value,context,true);}
  return Object.freeze({ prepare:(value,context,expectedPreviewDigest)=>prepare(value,context,false,false,expectedPreviewDigest), prepare11145, approve: (value, context) => decide('APPROVED', value, context), revoke: (value, context) => decide('REVOKED', value, context), accept:(value,context)=>accept(value,context),accept11145,
    prepareLegacy:(value,context,expectedPreviewDigest)=>prepare(value,context,false,true,expectedPreviewDigest),
    approveLegacy:(value,context)=>decide('APPROVED',value,context,true),
    acceptLegacy:(value,context)=>accept(value,context,false,true) });
}
module.exports = { createOpportunityActivationV2 };
