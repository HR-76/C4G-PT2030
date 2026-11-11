const crypto = require('node:crypto');
const {validateEnvelope}=require('./envelope');
const {organizationScope}=require('./organizationScope');
class OutboxRepository {
  constructor({ clock = () => new Date(), telemetryPort = null } = {}) { this.clock=clock;this.telemetryPort=telemetryPort; }
  async enqueue(client,{organizationId,logicalId,envelope,contentDigest,digest=contentDigest}) {
    if (!client || typeof client.query!=='function') throw new TypeError('An existing source transaction is required.');
    const supplied=contentDigest||digest;const computed=validateEnvelope(envelope,{supports:()=>true});if(computed.envelope.organizationId!==organizationId)throw new Error('OUTBOX_CONTEXT_CONFLICT');digest=computed.contentDigest;if(supplied&&(!/^[a-f0-9]{64}$/.test(supplied)||!crypto.timingSafeEqual(Buffer.from(supplied,'hex'),Buffer.from(digest,'hex'))))throw new Error('OUTBOX_DIGEST_CONFLICT');
    const result=await client.query(`INSERT INTO async_exec.outbox
      (outbox_id, organization_id, logical_id, envelope, digest_sha256, state, available_at)
      VALUES ($1,$2,$3,$4::jsonb,$5,'PENDING',$6)
      ON CONFLICT (organization_id,logical_id) DO UPDATE SET logical_id=EXCLUDED.logical_id
      WHERE async_exec.outbox.digest_sha256=EXCLUDED.digest_sha256
      RETURNING outbox_id,digest_sha256`,[crypto.randomUUID(),organizationId,logicalId,JSON.stringify(envelope),digest,this.clock()]);
    if (!result.rows[0] || result.rows[0].digest_sha256!==digest) throw new Error('OUTBOX_DIGEST_CONFLICT');
    try{this.telemetryPort?.record('F9',1,{jobType:computed.envelope.jobType,result:'SUCCESS',errorClass:'none',queueClass:'functional',workerRole:'producer'});}catch{}
    return result.rows[0].outbox_id;
  }
  async enqueueLineage(client,{organizationId,logicalId,envelope,lineage,availableAt=this.clock()}) {
    if(!client||typeof client.query!=='function'||!lineage||Object.getPrototypeOf(lineage)!==Object.prototype||Reflect.ownKeys(lineage).length!==7)throw new TypeError('Trusted lineage transaction is required.');
    const computed=validateEnvelope(envelope,{supports:()=>true}),keys=['deliveryKind','attempt','rootExecutionId','previousExecutionId','contentDigest','envelopeDigest','replayRequestId'];if(keys.some(key=>!Object.hasOwn(lineage,key))||computed.envelope.organizationId!==organizationId||!['INITIAL','RETRY','REPLAY'].includes(lineage.deliveryKind)||!Number.isInteger(lineage.attempt)||lineage.attempt<1||lineage.attempt>5||computed.contentDigest!==lineage.contentDigest||computed.envelopeDigest!==lineage.envelopeDigest)throw new Error('OUTBOX_LINEAGE_CONFLICT');
    const id=crypto.randomUUID(),values=[id,organizationId,logicalId,JSON.stringify(computed.envelope),computed.contentDigest,availableAt,lineage.deliveryKind,lineage.attempt,lineage.rootExecutionId,lineage.previousExecutionId,lineage.contentDigest,lineage.envelopeDigest,lineage.replayRequestId];
    const inserted=await client.query(`INSERT INTO async_exec.outbox(outbox_id,organization_id,logical_id,envelope,digest_sha256,state,available_at,lineage_version,delivery_kind,attempt,root_execution_id,previous_execution_id,content_digest,envelope_digest,replay_request_id) VALUES($1,$2,$3,$4::jsonb,$5,'PENDING',$6,1,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(organization_id,logical_id) DO NOTHING RETURNING outbox_id::text,delivery_kind,attempt,root_execution_id::text,previous_execution_id::text,content_digest,envelope_digest,replay_request_id::text`,values);
    let row=inserted.rows[0];if(!row)row=(await client.query(`SELECT outbox_id::text,delivery_kind,attempt,root_execution_id::text,previous_execution_id::text,content_digest,envelope_digest,replay_request_id::text FROM async_exec.outbox WHERE ${organizationScope('organization_id',1)} AND logical_id=$2`,[organizationId,logicalId])).rows[0];
    if(!row||row.delivery_kind!==lineage.deliveryKind||Number(row.attempt)!==lineage.attempt||row.root_execution_id!==lineage.rootExecutionId||row.previous_execution_id!==lineage.previousExecutionId||row.content_digest!==lineage.contentDigest||row.envelope_digest!==lineage.envelopeDigest||row.replay_request_id!==lineage.replayRequestId)throw new Error('OUTBOX_LINEAGE_CONFLICT');return Object.freeze({outboxId:row.outbox_id,created:row.outbox_id===id});
  }
  async findLineage(client,{organizationId,logicalId}){if(!client||typeof client.query!=='function')throw new TypeError('An existing source transaction is required.');const row=(await client.query(`SELECT (envelope->>'executionId') AS execution_id,delivery_kind,attempt,root_execution_id::text,previous_execution_id::text,content_digest,envelope_digest,replay_request_id::text,available_at FROM async_exec.outbox WHERE ${organizationScope('organization_id',1)} AND logical_id=$2 FOR UPDATE`,[organizationId,logicalId])).rows[0];return row?Object.freeze({...row,attempt:Number(row.attempt),available_at:new Date(row.available_at).toISOString()}):null;}
  async claim(client,{owner,now=this.clock(),leaseMs=30000,batchSize=10}) {
    const result=await client.query(`WITH candidates AS (
      SELECT outbox_id FROM async_exec.outbox WHERE state IN ('PENDING','UNCERTAIN') AND available_at <= $1
      AND (lease_until IS NULL OR lease_until < $1) ORDER BY created_at,outbox_id FOR UPDATE SKIP LOCKED LIMIT $2)
      UPDATE async_exec.outbox o SET state='CLAIMED',claim_owner=$3,lease_until=$1 + ($4 * interval '1 millisecond'),fence=o.fence+1,updated_at=$1
      FROM candidates c WHERE o.outbox_id=c.outbox_id RETURNING o.*`,[now,Math.min(10,batchSize),owner,leaseMs]);
    return result.rows;
  }
  async markPublished(client,{id,owner,fence,queueId,now=this.clock()}) { const r=await client.query(`UPDATE async_exec.outbox SET state='PUBLISHED',queue_id=$4,published_at=$5,updated_at=$5 WHERE outbox_id=$1 AND claim_owner=$2 AND fence=$3 AND state='CLAIMED' RETURNING outbox_id`,[id,owner,fence,queueId,now]); return r.rowCount===1; }
  async markUncertain(client,{id,owner,fence,now=this.clock()}) { const r=await client.query(`UPDATE async_exec.outbox SET state='UNCERTAIN',updated_at=$4 WHERE outbox_id=$1 AND claim_owner=$2 AND fence=$3 AND state='CLAIMED' RETURNING outbox_id`,[id,owner,fence,now]); return r.rowCount===1; }
}
module.exports = { OutboxRepository };
