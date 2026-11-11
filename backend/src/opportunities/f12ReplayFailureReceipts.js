'use strict';

const { randomUUID } = require('node:crypto');
const { validateEnvelope } = require('../async/envelope');
const { createF12ReceiptTenantReader } = require('./f12ReceiptTenantReader');

const outcomes = new Set(['PERMANENT', 'CANCELLED', 'AUTHORIZATION_REVOKED', 'INCOMPATIBLE', 'POISON_MESSAGE', 'EXPIRED']);

function createF12ReplayFailureReceipts({ organizationId, recoveryCentral, api, registry, resolveReceiptExecution, transportRole, receipts }) {
  const readTenant = createF12ReceiptTenantReader(api);
  let cursor = null;
  async function anchor(envelope, delivery, contentDigest) {
    if (!delivery.rootExecutionId) return null;
    return resolveReceiptExecution(envelope.executionId, delivery.rootExecutionId,
      organizationId, envelope.jobType, contentDigest);
  }
  async function record({ client, envelope, delivery, code, fence }) {
    if (!outcomes.has(code)) return;
    const { contentDigest } = validateEnvelope(envelope, registry);
    const replay = await anchor(envelope, delivery, contentDigest);
    if (!replay) return;
    await client.query('RESET ROLE');
    await client.query('SET LOCAL ROLE c4g_f12_receipt_issuer');
    const { rows } = await client.query(`SELECT tenant_id,database_generation_id FROM c4g_system.tenant_identity
      WHERE product_code='C4G' AND database_role='TENANT'`);
    if (rows.length !== 1) throw new Error('F12_RECEIPT_TENANT_MISMATCH');
    await client.query(`INSERT INTO f12_replay_failure.receipt
      (proof_id,organization_id,tenant_id,database_generation_id,root_execution_id,replay_execution_id,
        execution_id,job_type,content_digest,fence,outcome)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [randomUUID(), organizationId, rows[0].tenant_id,
      rows[0].database_generation_id, delivery.rootExecutionId, replay, envelope.executionId,
      envelope.jobType, contentDigest, fence, code]);
    await client.query('RESET ROLE');
    await client.query(`SET LOCAL ROLE ${transportRole}`);
  }
  async function poll() {
    const { rows } = await recoveryCentral.query(`SELECT organization_id,tenant_id,database_generation_id,root_execution_id,
      execution_id,job_type,content_digest FROM f12_replay_capacity.pending_failures($1,$2)`,
      [organizationId, cursor]);
    cursor = rows.length === 5 ? rows.at(-1).execution_id : null;
    for (const target of rows) {
      try {
        const proof = await readTenant({ ...target, transaction_id: target.execution_id }, async client => {
          const { rows } = await client.query(`SELECT proof_id,organization_id,tenant_id,database_generation_id,root_execution_id,
            replay_execution_id,execution_id,job_type,content_digest,fence,outcome FROM f12_replay_failure.observe($1,$2,$3,$4)`,
            [organizationId, target.tenant_id, target.database_generation_id, target.execution_id]);
          return rows.length === 1 ? rows[0] : null;
        });
        if (!proof || !outcomes.has(proof.outcome)) continue;
        if (await resolveReceiptExecution(proof.execution_id, target.root_execution_id, organizationId,
          target.job_type, target.content_digest) !== target.execution_id) continue;
        const guards = await recoveryCentral.query(`SELECT transaction_id FROM f12_service_authority.commit_guard
          WHERE organization_id=$1 AND job_type=$2 AND execution_id=ANY($3::uuid[]) AND state IN ('PREPARED','UNKNOWN')`,
        [organizationId, target.job_type, [target.root_execution_id, target.execution_id]]);
        for (const guard of guards.rows) await receipts.recover(guard.transaction_id);
        await recoveryCentral.query('SELECT f12_replay_capacity.release_failure($1,$2,$3,$4)',
          [organizationId, target.root_execution_id, target.execution_id, JSON.stringify(proof)]);
      } catch { /* Leave capacity reserved when lineage or proof is unavailable. */ }
    }
  }
  return Object.freeze({ record, poll, async covers({ envelope, delivery }) {
    return Boolean(await anchor(envelope, delivery, validateEnvelope(envelope, registry).contentDigest));
  } });
}

module.exports = { createF12ReplayFailureReceipts };
