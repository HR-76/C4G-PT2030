'use strict';
const { snapshotDigest } = require('../security/tenantAuthorityRecovery');
const { receipt, fail } = require('./editorialUiContracts');
const sources = { CREATE_DRAFT: 'PROFILE_DRAFT_CREATE', EDIT_DRAFT: 'PROFILE_DRAFT_EDIT', SUBMIT: 'EDITORIAL_SUBMIT', APPROVE: 'EDITORIAL_APPROVE', PUBLISH: 'EDITORIAL_PUBLISH' };
// Root-composed observation. Never mounted with a caller-supplied pool, guard ID,
// source binding or operational instruction. No new mutation guard is prepared.
async function lookup({ input, context, handle, authority, data, policy, catalogs, coordinator, dependencies, clock }) {
  const { operation, resourceId, idempotencyKey, expectedRevision } = input;
  const organizationId = context.actor.organizationId, source = sources[operation];
  const outcome = (status, reason = null, result = null) => ({ status, receipt: result, reason,
    retryAfterSeconds: status === 'RESOLVING' ? 5 : null, correlationId: context.correlationId });
  const unknown = () => outcome('UNKNOWN', 'NO_CONCLUSIVE_EVIDENCE');
  const snapshot = await data.authorizationDataPort.load(context.actor), membership = await data.membershipPort.revalidate(context.actor);
  const target = { id: resourceId, organizationId, resourceType: 'PROFILE_PROJECTION', scopeType: 'ORGANIZATION', scopeId: null,
    status: 'ACTIVE', unitId: null, ancestorUnitIds: [], teamIds: [], distinctFromActorIds: [] };
  if (!snapshot || !membership || !policy.evaluate({ actor: context.actor, membership,
    snapshot: { ...snapshot, grants: snapshot.grants.filter(g => (!g.resourceId || g.resourceId === resourceId) && (!g.resourceType || g.resourceType === 'PROFILE_PROJECTION')) },
    resource: target, operation: catalogs.operationCatalog.resolve('F13_PROFILE_READ'), assuranceEvidence: context.assuranceEvidence,
    now: clock.now(), exactResourceScope: true }).allowed) fail('NOT_AUTHORIZED');
  const guards = (await coordinator.pool.query(require('../security/authorityProtocolQueries').intentionLookupQuery,
  [organizationId, context.actor.id, idempotencyKey, source, operation === 'CREATE_DRAFT' ? organizationId : resourceId])).rows;
  if (!guards.length || guards.length > 100 || guards.some(g => !g.protected_operations.some(p => p.resourceId === (operation === 'CREATE_DRAFT' ? organizationId : resourceId)))) return unknown();
  if (new Set(guards.map(g => g.intention_digest)).size !== 1) return unknown();
  for (let i = 0; i < guards.length; i++) {
    if (!['PREPARED', 'TENANT_COMMIT_UNKNOWN'].includes(guards[i].state)) continue;
    if (new Date(guards[i].deadline).getTime() > clock.now().getTime()) {
      try { await authority.resolve(handle); }
      catch (error) { if (['AUTHORITY_REQUIRED', 'AUTHORITY_STALE'].includes(error.code)) fail('NOT_AUTHORIZED'); return unknown(); }
      return outcome('RESOLVING', 'TRANSACTION_PENDING');
    }
    try { guards[i] = await coordinator.recover(guards[i].guard_id, false, Date.now() + 2000); }
    catch { return unknown(); }
  }
  let allocation, secret, open = false;
  try {
    const physical = await dependencies.directoryRepository.resolveSnapshotByOrganization(organizationId, 'API');
    if (!physical || guards.some(g => g.source_binding.snapshotDigest !== snapshotDigest(physical))) return unknown();
    secret = await dependencies.credentialProvider.resolve({ credentialRef: physical.credentialRef, tenantId: organizationId, workload: 'API',
      connectionVersion: physical.connectionVersion, correlationId: context.correlationId });
    const lease = secret; secret = null;
    allocation = await dependencies.poolManager.acquire({ tenantId: organizationId, workload: 'API', connectionVersion: physical.connectionVersion,
      workloadClass: 'OPERATIONAL', credentialLease: lease, correlationId: context.correlationId });
    const client = allocation.client;
    await client.query('BEGIN TRANSACTION READ ONLY'); open = true;
    await client.query("SET LOCAL statement_timeout TO '2000ms'");
    await dependencies.bindingVerifier.verify({ client, snapshot: physical, requiredCapabilities: ['F13_EDITORIAL_BASELINE_PUBLICATION', 'F7_AUDIT_LEDGER'], correlationId: context.correlationId });
    await client.query('SET LOCAL ROLE c4g_organization_profile_runtime');
    await client.query("SELECT set_config('app.organization_id',$1,true)", [organizationId]);
    const table = ['CREATE_DRAFT', 'EDIT_DRAFT'].includes(operation) ? 'idempotency_record' : 'editorial_idempotency_record';
    const row = (await client.query(`SELECT intention_digest,result_projection FROM organization_profile.${table} WHERE organization_id=$1 AND operation=$2 AND idempotency_key=$3`,
      [organizationId, source, idempotencyKey])).rows[0];
    if (row) {
      if (row.intention_digest !== guards[0].intention_digest || !guards.some(g => g.reconciliation_result === 'COMMITTED' || g.state === 'TENANT_COMMITTED')) return unknown();
      const value = row.result_projection;
      if (['CREATE_DRAFT', 'EDIT_DRAFT'].includes(operation)) {
        if (value.draftId !== resourceId || (operation === 'EDIT_DRAFT' && value.revision !== expectedRevision + 1)) return unknown();
      } else if (operation === 'SUBMIT') {
        const candidate = (await client.query('SELECT draft_id,source_revision FROM organization_profile.editorial_candidate WHERE organization_id=$1 AND candidate_id=$2', [organizationId, value.candidateId])).rows[0];
        if (!candidate || candidate.draft_id !== resourceId || Number(candidate.source_revision) !== expectedRevision + 1) return unknown();
      } else {
        const version = (await client.query('SELECT candidate_id FROM organization_profile.editorial_version WHERE organization_id=$1 AND version_id=$2', [organizationId, value.versionId])).rows[0];
        if (!version || (operation === 'APPROVE' ? version.candidate_id !== resourceId : value.versionId !== resourceId)) return unknown();
      }
      await authority.resolve(handle);
      return outcome('CONFIRMED', null, receipt(operation, value));
    }
    // Without the original authoring payload/revision a digest cannot prove the
    // requested creation/edit revision. Preserve UNKNOWN rather than guessing.
    if (['CREATE_DRAFT', 'EDIT_DRAFT', 'SUBMIT'].includes(operation)) return unknown();
    if (guards.every(g => g.reconciliation_result === 'ROLLED_BACK' || g.state === 'ABORTED')) {
      await authority.resolve(handle); return outcome('FAILED_FINAL', 'ROLLED_BACK');
    }
    return unknown();
  } catch (error) {
    if (['AUTHORITY_REQUIRED', 'AUTHORITY_STALE'].includes(error.code)) fail('NOT_AUTHORIZED');
    return unknown();
  } finally {
    if (allocation) { if (open) await allocation.client.query('ROLLBACK').catch(() => {}); await allocation.release({ discard: true }).catch(() => {}); }
    if (secret) await secret.dispose();
  }
}
module.exports = { lookup };
