'use strict';

const { validateEnvelope } = require('../async/envelope');
const { isPreparedTenantTransaction } = require('../security/tenantLeaseExecutor');
const { JOBS, SERVICE_ACTORS } = require('./jobs');

const consumer = 'f12-opportunity-worker';
const pendingAck = 'F12_RECEIPT_ACK_PENDING';
const batchSize = 5;

function createF12InterruptedDeliveryRecovery({ organizationId, directory, runTransport, recoveryCentral, receipts, queue, registry,
  resolveReceiptExecution = null }) {
  let cursor = null;
  async function poll() {
    const snapshot = await directory.resolveSnapshotByOrganization(organizationId, 'WORKER');
    if (!snapshot?.databaseGenerationId) return;
    const binding = { organizationId, tenantId: snapshot.tenantId, databaseGenerationId: snapshot.databaseGenerationId,
      workload: 'WORKER', requiredCapabilities: ['F9_EXECUTION_LINEAGE', 'F12_SERVICE_RECEIPTS'] };
    const inTenant = work => runTransport(client => {
      if (!isPreparedTenantTransaction(client, binding)) throw new Error('F12_INTERRUPTED_DELIVERY_BINDING_CHANGED');
      return work(client);
    });
    const candidates = await inTenant(async client => (await client.query(`
      SELECT i.execution_id, i.job_type, i.job_version, i.idempotency_key, i.digest_sha256, i.fence,
        i.claim_owner, i.state, o.envelope, o.content_digest, o.envelope_digest, o.root_execution_id, o.queue_id
      FROM async_exec.inbox i JOIN async_exec.outbox o
        ON o.organization_id=i.organization_id AND o.lineage_version=1
        AND (o.envelope->>'executionId')::uuid=i.execution_id
      WHERE i.organization_id=$1 AND i.consumer=$2 AND i.job_type=ANY($3::text[])
        AND ($4::uuid IS NULL OR i.execution_id>$4) AND o.state='PUBLISHED' AND o.queue_id IS NOT NULL
        AND ((i.state='PROCESSING' AND i.lease_until<=clock_timestamp()) OR (i.state='COMPLETED' AND i.result_code=$5))
      ORDER BY i.execution_id LIMIT ${batchSize}`,
    [organizationId, consumer, JOBS, cursor, pendingAck])).rows);
    cursor = candidates.length === batchSize ? candidates.at(-1).execution_id : null;
    for (const row of candidates) {
      try { await reconcile(row, binding, inTenant); }
      catch { /* An unavailable proof or queue remains eligible on the next pass. */ }
    }
  }

  async function reconcile(row, binding, inTenant) {
    const { envelope, contentDigest, envelopeDigest } = validateEnvelope(row.envelope, registry);
    if (envelope.organizationId !== organizationId || envelope.executionId !== row.execution_id
        || envelope.jobType !== row.job_type || envelope.jobVersion !== row.job_version
        || envelope.idempotencyKey !== row.idempotency_key || contentDigest !== row.digest_sha256
        || contentDigest !== row.content_digest || envelopeDigest !== row.envelope_digest
        || envelope.actor.serviceActorCode !== SERVICE_ACTORS[row.job_type].code) return;
    const key = [organizationId, consumer, row.job_type, row.job_version, row.idempotency_key,
      row.execution_id, row.claim_owner, row.fence, pendingAck, contentDigest];
    if (row.state === 'PROCESSING') {
      const terminal = resolveReceiptExecution ? await resolveReceiptExecution(row.execution_id, row.root_execution_id,
        organizationId, row.job_type, contentDigest) : null;
      const guards = await recoveryCentral.query(`
        SELECT transaction_id FROM f12_service_authority.commit_guard
        WHERE organization_id=$1 AND job_type=$2 AND execution_id=$3 AND tenant_id=$4
          AND database_generation_id=$5 AND content_digest=$6 AND state<>'ROLLED_BACK' LIMIT 2`,
      [organizationId, row.job_type, terminal ?? row.root_execution_id, binding.tenantId, binding.databaseGenerationId, contentDigest]);
      if (guards.rows.length !== 1 || await receipts.recover(guards.rows[0].transaction_id) !== 'COMMITTED') return;
      const updated = await inTenant(client => client.query(`
        UPDATE async_exec.inbox SET state='COMPLETED', result_code=$9, completed_at=clock_timestamp()
        WHERE organization_id=$1 AND consumer=$2 AND job_type=$3 AND job_version=$4 AND idempotency_key=$5
          AND execution_id=$6 AND claim_owner=$7 AND fence=$8 AND digest_sha256=$10
          AND state='PROCESSING' AND lease_until<=clock_timestamp()`, key).then(result => result.rowCount));
      if (updated !== 1) return;
    }

    const delivery = { type: row.job_type, id: row.queue_id };
    let [job] = await queue.getState(delivery);
    if (job && job.data?.executionId !== row.execution_id) return;
    if (job?.state === 'active') {
      await queue.complete({ ...delivery, result: { code: 'SUCCESS' } });
      [job] = await queue.getState(delivery);
    }
    // pg-boss cannot acknowledge a delivery that its maintenance already retired.
    // The receipt and completed inbox remain authoritative in that case.
    if (job && !['completed', 'failed', 'cancelled'].includes(job.state)) return;
    await inTenant(client => client.query(`
      UPDATE async_exec.inbox SET result_code='SUCCESS'
      WHERE organization_id=$1 AND consumer=$2 AND job_type=$3 AND job_version=$4 AND idempotency_key=$5
        AND execution_id=$6 AND claim_owner=$7 AND fence=$8 AND result_code=$9 AND digest_sha256=$10
        AND state='COMPLETED'`, key).then(result => result.rowCount));
  }

  return Object.freeze({ poll });
}

module.exports = { createF12InterruptedDeliveryRecovery, consumer };
