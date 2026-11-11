'use strict';
const { snapshotDigest } = require('../security/tenantAuthorityRecovery');
const {fail}=require('./release');
async function lookup({ input, context, handle, authority, data, policy, catalogs, coordinator, dependencies, clock }) {
  const org = context.actor.organizationId;
  const outcome = (status, receipt = null) => ({ status, receipt, correlationId: context.correlationId,
    reason: status === 'UNKNOWN' ? 'NO_CONCLUSIVE_EVIDENCE' : status === 'RESOLVING' ? 'TRANSACTION_PENDING' : null });
  if (!['PQ1_ACTIVATE','PQ1_EVALUATE','PQ1_DECIDE'].includes(input.operation)) fail('INVALID_INPUT');
  async function authorize() {
    const current = await authority.resolve(handle), snapshot = await data.authorizationDataPort.load(current.actor), membership = await data.membershipPort.revalidate(current.actor);
    const resource = { id: input.resourceId, organizationId: org, resourceType: input.operation==='PQ1_ACTIVATE'?'PROFILE_PROJECTION':'PREQUALIFICATION_EVALUATION', scopeType: 'ORGANIZATION', scopeId: null,
      status: 'ACTIVE', unitId: null, teamIds: [], ancestorUnitIds: [], distinctFromActorIds: [] };
    if (!membership || !snapshot || !policy.evaluate({ actor: current.actor, membership,
      snapshot: { ...snapshot, grants: snapshot.grants.filter(g => (!g.resourceId || g.resourceId === resource.id) && (!g.resourceType || g.resourceType === resource.resourceType)) },
      resource, operation: catalogs.operationCatalog.resolve(input.operation==='PQ1_ACTIVATE'?'F13_PROFILE_READ':'F14_PREQUALIFICATION_READ'), assuranceEvidence: current.assuranceEvidence,
      now: clock.now(), exactResourceScope: true }).allowed) fail('NOT_AUTHORIZED');
  }
  let allocation, credential, opened = false;
  try {
    await authorize();
    const guards = (await coordinator.pool.query(require('../security/authorityProtocolQueries')[input.operation==='PQ1_DECIDE'?'pq1DecisionLookupQuery':'pq1EffectiveLookupQuery'],
      [org,context.actor.id,input.idempotencyKey,input.operation,input.resourceId])).rows;
    if (!guards.length || guards.length > 100 || new Set(guards.map(g => g.intention_digest)).size !== 1) return outcome('UNKNOWN');
    const physical = await dependencies.directoryRepository.resolveSnapshotByOrganization(org, 'API');
    if (!physical || guards.some(g => g.source_binding.snapshotDigest !== snapshotDigest(physical))) return outcome('UNKNOWN');
    for (let i = 0; i < guards.length; i++) if (['PREPARED','TENANT_COMMIT_UNKNOWN'].includes(guards[i].state)) {
      if (new Date(guards[i].deadline) > clock.now()) { await authorize(); return outcome('RESOLVING'); }
      guards[i] = await coordinator.recover(guards[i].guard_id, false, Date.now() + 2000);
    }
    credential = await dependencies.credentialProvider.resolve({ credentialRef: physical.credentialRef, tenantId: org, workload: 'API', connectionVersion: physical.connectionVersion, correlationId: context.correlationId });
    const credentialLease = credential; credential = null;
    allocation = await dependencies.poolManager.acquire({ tenantId: org, workload: 'API', connectionVersion: physical.connectionVersion, workloadClass: 'OPERATIONAL', credentialLease, correlationId: context.correlationId });
    const client = allocation.client;
    await client.query('BEGIN TRANSACTION READ ONLY'); opened = true;
    await client.query("SET LOCAL statement_timeout TO '2000ms'");
    await dependencies.bindingVerifier.verify({ client, snapshot: physical, requiredCapabilities: ['F14_PQ1_DECISIONS','F13_PQ1_ACTIVATION','F7_AUDIT_LEDGER'] });
    await client.query('SET LOCAL ROLE c4g_organization_profile_runtime');
    await client.query("SELECT set_config('app.organization_id',$1,true)", [org]);
    const row = input.operation==='PQ1_DECIDE'?(await client.query('SELECT intention_digest,result_projection FROM organization_profile.pq1_decision WHERE organization_id=$1 AND subject_id=$2 AND evaluation_id=$3 AND idempotency_key=$4',[org,context.actor.id,input.resourceId,input.idempotencyKey])).rows[0]:(await client.query(`SELECT intention_digest,result_projection FROM organization_profile.pq1_effective_receipt
      WHERE organization_id=$1 AND subject_id=$2 AND operation=$3 AND resource_id=$4 AND idempotency_key=$5`,
    [org,context.actor.id,input.operation,input.resourceId,input.idempotencyKey])).rows[0];
    await authorize();
    if (row && row.intention_digest === guards[0].intention_digest && guards.some(g => g.state === 'TENANT_COMMITTED' || g.reconciliation_result === 'COMMITTED')) return outcome('CONFIRMED', row.result_projection);
    if (!row && guards.every(g => g.state === 'ABORTED' || g.reconciliation_result === 'ROLLED_BACK')) return outcome('FAILED_FINAL');
    return outcome('UNKNOWN');
  } catch (e) {
    if (['NOT_AUTHORIZED','RESOURCE_NOT_AVAILABLE'].includes(e.code)) throw e;
    return outcome('UNKNOWN');
  } finally {
    if (allocation) { if (opened) await allocation.client.query('ROLLBACK').catch(() => {}); await allocation.release({ discard: true }).catch(() => {}); }
    if (credential) await credential.dispose();
  }
}
// A post-commit loss of authority cannot turn an uncertain write into a refusal.
// Return no receipt without current authorization; keep the original intention.
async function recoverCommit({reconcile,refresh,replay}){
 const unknown=()=>({status:'UNKNOWN',reason:'NO_CONCLUSIVE_EVIDENCE'});
 try{const terminal=await reconcile();if(terminal?.reconciliation_result==='ROLLED_BACK')return {status:'FAILED_FINAL'};
  await refresh();const value=await replay();return !value||value.uncertain?unknown():value;
 }catch{return unknown();}
}
module.exports = { lookup,recoverCommit };
