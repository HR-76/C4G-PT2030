'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createTenantReplayPort({ transactionFor, outboxRepository, auditWriterFor }) {
  if (typeof transactionFor !== 'function' || !outboxRepository || typeof outboxRepository.enqueueLineage !== 'function' || typeof auditWriterFor !== 'function') throw new TypeError('Tenant replay dependencies are invalid.');
  async function checkIntent(client, target) {
    if (!UUID.test(target.replayRequestId || '') || !UUID.test(target.executionId || '') || !UUID.test(target.rootExecutionId || '')
        || !UUID.test(target.previousExecutionId || '') || !/^[a-f0-9]{64}$/.test(target.contentDigest || '')) {
      throw new TypeError('Tenant replay lookup is invalid.');
    }
    const row = (await client.query(`SELECT ((envelope->>'executionId')::uuid=$3::uuid AND root_execution_id=$4::uuid
      AND previous_execution_id=$5::uuid AND envelope->>'jobType'=$6 AND content_digest=$7) AS matches
      FROM async_exec.outbox WHERE organization_id=$1 AND lineage_version=1 AND delivery_kind='REPLAY' AND replay_request_id=$2`,
    [target.organizationId, target.replayRequestId, target.executionId, target.rootExecutionId, target.previousExecutionId,
      target.jobType, target.contentDigest])).rows[0];
    if (row && row.matches !== true) throw new Error('ASYNC_REPLAY_SOURCE_CONFLICT');
    return Boolean(row);
  }
  async function run(target, work) {
    if (!target || !UUID.test(target.organizationId || '') || !UUID.test(target.tenantId || '') || !['opportunity.duplicate.scan', 'opportunity.catalog.reconcile'].includes(target.jobType) || typeof work !== 'function') throw new TypeError('Tenant replay target is invalid.');
    return transactionFor(Object.freeze({ ...target }), async client => work(Object.freeze({
      client,
      outboxRepository,
      auditWriter: auditWriterFor(Object.freeze({ ...target })),
      async lockAndCheckReplayIntent(identity) {
        if (!UUID.test(identity?.replayRequestId || '')) throw new TypeError('Tenant replay lookup is invalid.');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,43001309))', [identity.replayRequestId]);
        return checkIntent(client, { ...identity, ...target });
      },
      async loadEnvelopeByExecution(existingClient, executionId) {
        if (existingClient !== client || !UUID.test(executionId || '')) throw new TypeError('Tenant replay source is invalid.');
        const row = (await client.query(`SELECT envelope FROM async_exec.outbox WHERE organization_id=$1 AND lineage_version=1 AND (envelope->>'executionId')::uuid=$2`, [target.organizationId, executionId])).rows[0];
        return row ? row.envelope : null;
      }
    })));
  }
  async function exists(target) {
    if (!target || !UUID.test(target.organizationId || '') || !UUID.test(target.tenantId || '') || !UUID.test(target.replayRequestId || '') || !UUID.test(target.executionId || '') || !UUID.test(target.rootExecutionId || '') || !UUID.test(target.previousExecutionId || '') || !['opportunity.duplicate.scan', 'opportunity.catalog.reconcile'].includes(target.jobType) || !/^[a-f0-9]{64}$/.test(target.contentDigest || '')) throw new TypeError('Tenant replay lookup is invalid.');
    return transactionFor(Object.freeze({ organizationId: target.organizationId, tenantId: target.tenantId, jobType: target.jobType }),
      client => checkIntent(client, target));
  }
  return Object.freeze({ run, exists });
}

module.exports = { createTenantReplayPort };
