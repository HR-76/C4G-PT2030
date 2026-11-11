'use strict';

const crypto = require('node:crypto');
const { validateEnvelope } = require('./envelope');

const DIGEST = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function equalDigest(left, right) { return DIGEST.test(left || '') && DIGEST.test(right || '') && crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex')); }
function transactionPort(value) { if (typeof value === 'function') return value; if (value && typeof value.transaction === 'function') return value.transaction.bind(value); throw new TypeError('Execution projection transaction is invalid.'); }
function lineage(row) {
  const attempt=Number(row?.attempt),kind=row?.delivery_kind;
  if (!row || !UUID.test(row.execution_id || '') || !(row.organization_id===null || UUID.test(row.organization_id || ''))
    || typeof row.job_type!=='string' || !row.job_type || Number(row.lineage_version)!==1
    || !Number.isInteger(attempt) || attempt<1 || attempt>5 || !UUID.test(row.root_execution_id || '')
    || !DIGEST.test(row.content_digest || '') || !DIGEST.test(row.envelope_digest || '')
    || !(kind==='INITIAL' && attempt===1 && row.root_execution_id===row.execution_id && row.previous_execution_id===null && row.replay_request_id===null
      || kind==='RETRY' && attempt>=2 && UUID.test(row.previous_execution_id || '') && row.replay_request_id===null
      || kind==='REPLAY' && attempt===1 && UUID.test(row.previous_execution_id || '') && UUID.test(row.replay_request_id || ''))) throw new Error('ASYNC_LINEAGE_PROJECTION_INVALID');
  return Object.freeze({ executionId:row.execution_id,organizationId:row.organization_id,jobType:row.job_type,lineageVersion:1,
    deliveryKind:kind,attempt,rootExecutionId:row.root_execution_id,previousExecutionId:row.previous_execution_id,
    contentDigest:row.content_digest,envelopeDigest:row.envelope_digest,replayRequestId:row.replay_request_id });
}

function createExecutionLineageProjection({ transaction }) {
  const run = transactionPort(transaction);
  async function project({ row, envelope, client }) {
    if (client !== undefined && (!client || typeof client.query !== 'function')) throw new TypeError('Execution projection client is invalid.');
    const validated = validateEnvelope(envelope, { supports: () => true });
    const attempt = row?.attempt;
    if (!row || !(['number', 'string'].includes(typeof attempt)) || (typeof attempt === 'string' && !/^[1-5]$/.test(attempt))
      || !Number.isInteger(Number(attempt)) || Number(attempt) < 1 || Number(attempt) > 5
      || Number(row.lineage_version) !== 1 || row.delivery_kind === null
      || row.root_execution_id === null || row.content_digest !== validated.contentDigest
      || row.envelope_digest !== validated.envelopeDigest) throw new Error('ASYNC_LINEAGE_PROJECTION_INVALID');
    const work = async client => {
      await client.query(`INSERT INTO async_exec.execution(execution_id,organization_id,job_type,state,attempt,deadline_at,lineage_version,delivery_kind,root_execution_id,previous_execution_id,content_digest,envelope_digest,replay_request_id)
        VALUES($1,$2,$3,'QUEUED',$4,$5,1,$6,$7,$8,$9,$10,$11) ON CONFLICT(execution_id) DO NOTHING`, [
        validated.envelope.executionId, validated.envelope.organizationId, validated.envelope.jobType, Number(row.attempt),
        validated.envelope.deadlineAt, row.delivery_kind, row.root_execution_id, row.previous_execution_id,
        validated.contentDigest, validated.envelopeDigest, row.replay_request_id
      ]);
      const current = (await client.query(`SELECT execution_id::text,organization_id::text,job_type,lineage_version,delivery_kind,attempt,root_execution_id::text,previous_execution_id::text,content_digest,envelope_digest,replay_request_id::text FROM async_exec.execution WHERE execution_id=$1`, [validated.envelope.executionId])).rows[0];
      if (!current || current.organization_id !== validated.envelope.organizationId || current.job_type !== validated.envelope.jobType
        || Number(current.lineage_version) !== 1 || current.delivery_kind !== row.delivery_kind || Number(current.attempt) !== Number(row.attempt)
        || current.root_execution_id !== row.root_execution_id || current.previous_execution_id !== row.previous_execution_id
        || current.replay_request_id !== row.replay_request_id || !equalDigest(current.content_digest, validated.contentDigest)
        || !equalDigest(current.envelope_digest, validated.envelopeDigest)) throw new Error('ASYNC_LINEAGE_PROJECTION_CONFLICT');
      return Object.freeze({ executionId: current.execution_id });
    };
    // A relay already owns the transaction and its source-admission locks.
    // Reuse it so a queued suspension cannot strand a nested pool checkout.
    return client === undefined ? run(work) : work(client);
  }
  async function load(executionId) {
    if (!UUID.test(executionId || '')) throw new TypeError('Execution lineage identity is invalid.');
    return run(async client => {
      const row = (await client.query(`SELECT execution_id::text,organization_id::text,job_type,lineage_version,delivery_kind,attempt,root_execution_id::text,previous_execution_id::text,content_digest,envelope_digest,replay_request_id::text FROM async_exec.execution WHERE execution_id=$1`, [executionId])).rows[0];
      if (row) return lineage(row);
      // The expression and predicate repeat the partial unique index f9_*_outbox_execution_v1 so this stays an index lookup.
      // Queue publication can precede the relay commit, or survive its rollback.
      // The immutable source intent already exists and preserves retry/replay
      // lineage without waiting for that projection or inventing attempt one.
      const rows=(await client.query(`SELECT organization_id::text,envelope,digest_sha256,lineage_version,delivery_kind,attempt,root_execution_id::text,previous_execution_id::text,content_digest,envelope_digest,replay_request_id::text FROM async_exec.outbox WHERE (envelope->>'executionId')::uuid = $1::uuid AND lineage_version = 1 LIMIT 2`,[executionId])).rows;
      if(rows.length!==1)throw new Error('ASYNC_LINEAGE_PROJECTION_UNAVAILABLE');
      const durable=rows[0];let validated;
      try{validated=validateEnvelope(durable.envelope,{supports:()=>true});}catch{throw new Error('ASYNC_LINEAGE_PROJECTION_INVALID');}
      if(validated.envelope.executionId!==executionId || durable.organization_id!==validated.envelope.organizationId
        || !equalDigest(durable.digest_sha256,validated.contentDigest) || !equalDigest(durable.content_digest,validated.contentDigest)
        || !equalDigest(durable.envelope_digest,validated.envelopeDigest))throw new Error('ASYNC_LINEAGE_PROJECTION_CONFLICT');
      return lineage({...durable,execution_id:executionId,job_type:validated.envelope.jobType});
    });
  }
  return Object.freeze({ project, load });
}

module.exports = { createExecutionLineageProjection };
