const crypto=require('node:crypto');const {validateEnvelope}=require('./envelope');const {organizationScope}=require('./organizationScope');
const COLUMNS='consumer,job_type,job_version,organization_id,idempotency_key,digest_sha256,execution_id,state,claim_owner,lease_until,fence,result_code,created_at,completed_at';
class InboxRepository {
  constructor({telemetryPort=null,clock=()=>new Date()}={}){this.telemetryPort=telemetryPort;this.clock=clock;}
  async begin(client,{consumer,jobType,jobVersion,organizationId,idempotencyKey,envelope,contentDigest,digest=contentDigest,executionId,owner,leaseUntil,replay=false}) {
    const supplied=contentDigest||digest;const computed=validateEnvelope(envelope,{supports:()=>true});const trusted=computed.envelope;if(trusted.jobType!==jobType||trusted.jobVersion!==jobVersion||trusted.organizationId!==organizationId||trusted.idempotencyKey!==idempotencyKey||trusted.executionId!==executionId)throw new Error('INBOX_CONTEXT_CONFLICT');digest=computed.contentDigest;if(supplied&&(!/^[a-f0-9]{64}$/.test(supplied)||!crypto.timingSafeEqual(Buffer.from(supplied,'hex'),Buffer.from(digest,'hex'))))throw new Error('INBOX_DIGEST_CONFLICT');
    const inserted=await client.query(`INSERT INTO async_exec.inbox
      (consumer,job_type,job_version,organization_id,idempotency_key,digest_sha256,execution_id,state,claim_owner,lease_until,fence)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'PROCESSING',$8,$9,1)
      ON CONFLICT (consumer,job_type,job_version,organization_id,idempotency_key) DO NOTHING RETURNING ${COLUMNS}`,[consumer,jobType,jobVersion,organizationId,idempotencyKey,digest,executionId,owner,leaseUntil]);
    if(inserted.rows[0]) { try{this.telemetryPort?.record('F9',1,{jobType,result:'SUCCESS',errorClass:'none',queueClass:'functional',workerRole:'worker'});}catch{} return Object.freeze({status:'CLAIMED',row:inserted.rows[0]}); }
    const existing=await client.query(`SELECT ${COLUMNS} FROM async_exec.inbox WHERE consumer=$1 AND job_type=$2 AND job_version=$3 AND ${organizationScope('organization_id',4)} AND idempotency_key=$5 FOR UPDATE`,[consumer,jobType,jobVersion,organizationId,idempotencyKey]);
    const row=existing.rows[0]; if(!row || row.digest_sha256!==digest) throw new Error('INBOX_DIGEST_CONFLICT');
    if(replay===true && ['FAILED','CANCELLED'].includes(row.state)){
      // The tenant outbox is the durable proof of an authorized replay. Bind it
      // to the terminal execution so an old replay cannot reopen a later one.
      const reopened=await client.query(`UPDATE async_exec.inbox i SET state='PROCESSING',claim_owner=$6,lease_until=$7,fence=i.fence+1,execution_id=$8::uuid,result_code=NULL,completed_at=NULL
        WHERE i.consumer=$1 AND i.job_type=$2 AND i.job_version=$3 AND ${organizationScope('i.organization_id',4)} AND i.idempotency_key=$5 AND i.fence=$9 AND i.state IN ('FAILED','CANCELLED')
        AND EXISTS (SELECT 1 FROM async_exec.outbox o WHERE o.organization_id=i.organization_id AND o.lineage_version=1 AND o.delivery_kind='REPLAY' AND o.replay_request_id IS NOT NULL AND o.previous_execution_id=i.execution_id AND o.content_digest=i.digest_sha256 AND o.envelope->>'executionId'=($8::uuid)::text AND o.envelope->>'jobType'=i.job_type AND o.envelope->>'idempotencyKey'=i.idempotency_key)
        RETURNING ${COLUMNS}`,[consumer,jobType,jobVersion,organizationId,idempotencyKey,owner,leaseUntil,executionId,Number(row.fence)]);
      if(reopened.rows[0])return Object.freeze({status:'CLAIMED',row:reopened.rows[0]});
    }
    if(['PROCESSING','UNCERTAIN'].includes(row.state)&&row.lease_until&&new Date(row.lease_until).getTime()<=this.clock().getTime()){
      const reclaimed=await client.query(`UPDATE async_exec.inbox SET state='PROCESSING',claim_owner=$6,lease_until=$7,fence=fence+1,execution_id=$8 WHERE consumer=$1 AND job_type=$2 AND job_version=$3 AND ${organizationScope('organization_id',4)} AND idempotency_key=$5 AND fence=$9 AND state IN ('PROCESSING','UNCERTAIN') AND lease_until<=clock_timestamp() RETURNING ${COLUMNS}`,[consumer,jobType,jobVersion,organizationId,idempotencyKey,owner,leaseUntil,executionId,Number(row.fence)]);
      if(reclaimed.rows[0])return Object.freeze({status:'CLAIMED',row:reclaimed.rows[0]});
    }
    return Object.freeze({status:row.state==='COMPLETED'?'DUPLICATE':'BUSY',row});
  }
  async complete(client,{consumer,jobType,jobVersion,organizationId,idempotencyKey,owner,fence,resultCode}) { const r=await client.query(`UPDATE async_exec.inbox SET state='COMPLETED',result_code=$8,completed_at=clock_timestamp() WHERE consumer=$1 AND job_type=$2 AND job_version=$3 AND ${organizationScope('organization_id',4)} AND idempotency_key=$5 AND claim_owner=$6 AND fence=$7 AND state='PROCESSING' RETURNING idempotency_key`,[consumer,jobType,jobVersion,organizationId,idempotencyKey,owner,fence,resultCode]); return r.rowCount===1; }
  async heartbeat(client,{consumer,jobType,jobVersion,organizationId,idempotencyKey,owner,fence,leaseUntil}){const r=await client.query(`UPDATE async_exec.inbox SET lease_until=$8 WHERE consumer=$1 AND job_type=$2 AND job_version=$3 AND ${organizationScope('organization_id',4)} AND idempotency_key=$5 AND claim_owner=$6 AND fence=$7 AND state='PROCESSING' RETURNING fence`,[consumer,jobType,jobVersion,organizationId,idempotencyKey,owner,fence,leaseUntil]);return r.rowCount===1;}
  async transition(client,{consumer,jobType,jobVersion,organizationId,idempotencyKey,owner,fence,state,resultCode}){if(!['UNCERTAIN','FAILED','CANCELLED'].includes(state))throw new TypeError('Inbox transition is invalid.');const r=await client.query(`UPDATE async_exec.inbox SET state=$8::async_exec.inbox_state,result_code=$9,lease_until=CASE WHEN $8::text='UNCERTAIN' THEN clock_timestamp() ELSE NULL END WHERE consumer=$1 AND job_type=$2 AND job_version=$3 AND ${organizationScope('organization_id',4)} AND idempotency_key=$5 AND claim_owner=$6 AND fence=$7 AND state='PROCESSING' RETURNING idempotency_key`,[consumer,jobType,jobVersion,organizationId,idempotencyKey,owner,fence,state,resultCode]);return r.rowCount===1;}
}
module.exports = { InboxRepository };
