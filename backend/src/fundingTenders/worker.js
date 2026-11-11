'use strict';
const { randomUUID } = require('node:crypto');
const { createFundingRepository } = require('./repository');
const { createJobRegistry } = require('../async/jobRegistry');
const { createWorkerProcessor } = require('../async/workerProcessor');
const { InboxRepository } = require('../async/inboxRepository');
const { OutboxRepository } = require('../async/outboxRepository');
const { OutboxRelay } = require('../async/outboxRelay');
const { WorkerLifecycle } = require('../async/workerLifecycle');
const { result } = require('../async/jobResult');
const { createPersistentRetryPort } = require('../async/retryPort');
const { createTrustedObservability } = require('../async/envelope');
const { createExecutionLineageProjection } = require('../async/executionLineageProjection');
const { normalizeClaimedJob } = require('../async/adapters/pgBossQueueAdapter');
const TYPE = 'funding_tenders.refresh';
function createFundingWorker({ pool, queue, source, repository = createFundingRepository({ pool }), clock = () => new Date() }) {
  const workerId = `funding-${randomUUID()}`;
  const controlled=repository.euSourceControlEnabled===true;
  const deferPort=controlled?require('./sourceDeferral').createFundingSourceDeferral({transaction:repository.transaction}):null;
  const outbox = new OutboxRepository({ clock });
  // This relay cannot claim XLSX/tenant jobs belonging to another composition.
  outbox.claim = async (client, { owner, now }) => (await client.query(`WITH candidates AS (
    SELECT outbox_id FROM async_exec.outbox WHERE organization_id IS NULL AND envelope->>'jobType'=$3
    ${controlled?"AND EXISTS(SELECT 1 FROM opportunity_catalog.funding_run r WHERE r.run_id::text=async_exec.outbox.envelope->'payload'->>'runId' AND opportunity_catalog.eu_source_execution_allowed_v2(r.source_code))":''}
    AND available_at<=$1 AND (state IN ('PENDING','UNCERTAIN') OR state='CLAIMED' AND lease_until<$1)
    AND (lease_until IS NULL OR lease_until<$1) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE async_exec.outbox o SET state='CLAIMED',claim_owner=$2,lease_until=$1+interval '30 seconds',fence=o.fence+1,updated_at=$1 FROM candidates c WHERE o.outbox_id=c.outbox_id RETURNING o.*`, [now, owner, TYPE])).rows;
  const projection = createExecutionLineageProjection({ transaction: repository.transaction });
  const relay = new OutboxRelay({ repository: outbox, queue, transaction: repository.transaction, workerId, clock, projectionPort: projection });
  const consumerQueue = { ...queue, async claim(input) {
    const deliveries = await queue.claim(input);
    return Promise.all(deliveries.map(async delivery => normalizeClaimedJob({ id: delivery.id, data: delivery.envelope }, input.type, await projection.load(delivery.envelope.executionId))));
  } };
  let lifecycle;
  const registry = createJobRegistry([{ type: TYPE, version: 1, payloadVersion: 1, async handler(envelope) {
    let run;
    const execution={executionId:envelope.executionId,inboxFence:envelope.fencingToken,workerId,consumer:'funding-central-v1'};
    try {
      run = await repository.claim(envelope.payload.runId,execution);
      if (!run) return result('SUCCESS');
      if (!run.collected) {
        const input={signal:lifecycle.controller.signal,source:run.source_code};
        const batch=require('./discoveryDetails').isDetailCursor(run.checkpoint?.input_cursor)
          ? await source.lookup({...input,externalIdentifier:run.checkpoint.input_cursor.externalIdentifier})
          : await source.collect({...input,...(run.knownIdentifiers?{knownIdentifiers:run.knownIdentifiers}:{}),...(run.checkpoint?{cursor:run.checkpoint.input_cursor,pageBudget:1}:{})});
        await repository.stage(run,batch,execution);
      }
      for (const item of await repository.pending(run,execution)) {
        if (lifecycle.controller.signal.aborted) throw Object.assign(new Error('WORKER_DRAINING'), { code: 'WORKER_DRAINING' });
        await repository.apply(run, item,execution);
      }
      await repository.finish(run,null,execution); return result('SUCCESS');
    } catch (error) {
      if(controlled){
        // A pause can arrive while the source transport is in flight. Do not
        // finish/error the run or manufacture a new retry/deadline.
        const allowed=await repository.sourceExecutionAllowed(envelope.payload.runId);
        if(allowed===false)return result('RETRYABLE','FUNDING_SOURCE_SUSPENDED');
        // A handler can outlive its lease and the pause/resume cycle. Leave the
        // original transport pending for a fresh claim; it owns no new epoch.
        if(['OPPORTUNITY_V2_SOURCE_FENCE_STALE','FUNDING_FENCE_STALE','OPPORTUNITY_V2_EU_SUSPENDED'].includes(error.code))throw error;
      }
      // Lost service authority cannot authorize even an error completion. The
      // durable lease/reaper handles recovery; never downgrade to the v1 path.
      if(error.code?.startsWith('OPPORTUNITY_V2_EU_WRITER_'))throw error;
      if (error.code === 'WORKER_DRAINING' || lifecycle.controller.signal.aborted) return result('RETRYABLE', 'WORKER_DRAINING');
      if (run && ['40001','40P01','08006','ECONNRESET','57P01'].includes(error.code) && envelope.attempt < 5) return result('RETRYABLE', 'FUNDING_TRANSIENT_FAILURE');
      if (run && error.code !== 'FUNDING_FENCE_STALE') await repository.finish(run, ['SOURCE_TIMEOUT', 'SOURCE_UNAVAILABLE', 'SOURCE_RESPONSE_INVALID', 'SOURCE_RESPONSE_TOO_LARGE', 'SOURCE_REJECTED', 'SOURCE_CURSOR_INVALID', 'FUNDING_CHECKPOINT_INVALID', 'FUNDING_DISCOVERY_MODE_DISABLED', 'FUNDING_FORBIDDEN'].includes(error.code) ? error.code : 'FUNDING_PROCESSING_FAILED',execution);
      return result('PERMANENT', 'FUNDING_PROCESSING_FAILED');
    }
  } }]);
  const persistentRetry = createPersistentRetryPort({ outboxRepository: outbox, registry, clock, observabilityFactory: () => createTrustedObservability({ traceparent: null, tracestate: null }) });
  const retryPort = { async schedule(input) {
    await persistentRetry.schedule(input);
    if(typeof repository.releaseRetry==='function')return repository.releaseRetry(input.client,input.envelope,workerId);
    await input.client.query("UPDATE opportunity_catalog.funding_run SET lease_until=clock_timestamp() WHERE run_id=$1 AND status='RUNNING'", [input.envelope.payload.runId]);
  } };
  lifecycle = new WorkerLifecycle({ queue, run: async () => {}, graceMs: 30000 });
  const processor = createWorkerProcessor({ queue: consumerQueue, registry, retryPort, deferPort, inbox: new InboxRepository({ clock }), transactionResolver: { resolve(organizationId, envelope) { if (organizationId !== null || envelope.authority !== 'CENTRAL' || envelope.jobType !== TYPE) throw new Error('CENTRAL_JOB_REQUIRED'); return repository.transaction; } }, lifecycle, consumer: 'funding-central-v1', workerId, clock, leaseMs: 150000 });
  async function reconcile() { return repository.transaction(async client => {
    // A crash cannot strand an active source forever. Re-deliver within the
    // original deadline; after it, expose an error and allow an explicit new run.
    await client.query(`UPDATE async_exec.outbox o SET state='PENDING',lease_until=NULL,available_at=clock_timestamp()
      FROM opportunity_catalog.funding_run r WHERE o.organization_id IS NULL AND o.envelope->>'jobType'=$1 AND o.envelope->'payload'->>'runId'=r.run_id::text
      AND r.status='RUNNING' AND r.lease_until<clock_timestamp() AND (o.envelope->>'deadlineAt')::timestamptz>clock_timestamp() AND o.state='PUBLISHED'
      ${controlled?'AND opportunity_catalog.eu_source_execution_allowed_v2(r.source_code)':''}
      AND NOT EXISTS(SELECT 1 FROM async_exec.outbox newer WHERE newer.envelope->'payload'->>'runId'=r.run_id::text AND newer.attempt>o.attempt)`, [TYPE]);
    await client.query(`UPDATE opportunity_catalog.funding_run r SET status='ERROR',error_code='FUNDING_EXECUTION_EXPIRED',finished_at=clock_timestamp(),lease_until=NULL,fence=fence+1
      WHERE r.status IN ('QUEUED','RUNNING') AND r.created_at+interval '5 minutes'<clock_timestamp() AND (r.lease_until IS NULL OR r.lease_until<clock_timestamp())
      ${controlled?'AND opportunity_catalog.eu_source_execution_allowed_v2(r.source_code)':''}`);
    if(repository.reconcileCoverage&&(!controlled||(await client.query("SELECT opportunity_catalog.eu_source_execution_allowed_v2('EU_FUNDING_TENDERS') AS allowed")).rows[0]?.allowed===true))await repository.reconcileCoverage(client);
  }); }
  let timer = null, active = null, stopped = false;
  const progress={...(repository.euWriterSupported===true?{euWriterSupported:true,euWriterPolicyVersion:repository.euWriterPolicyVersion,euWriterMappingDigest:repository.euWriterMappingDigest}:{}),...(repository.enrichmentSupported===true?{enrichmentSupported:true}:{}),...(repository.discoveryDetailSupported===true?{discoveryDetailSupported:true}:{}),refreshSupported:repository.refreshSupported===true,resolutionSupported:repository.resolutionSupported===true,lastPollAt:null,consecutiveFailures:0,coverageSupported:typeof repository.reconcileCoverage==='function'};
  async function runOnce() { if (active) return active; active = (async () => { await reconcile(); await relay.poll(); return processor.processOnce({ type: TYPE, batchSize: 1 }); })(); try { const value=await active;progress.lastPollAt=clock().getTime();progress.consecutiveFailures=0;return value; } catch(error) {progress.consecutiveFailures++;throw error;} finally { active = null; } }
  async function tick() { if (stopped) return; try { await runOnce(); } catch { /* Durable state is retried by the next bounded poll. */ } finally { if (!stopped) timer = setTimeout(tick, 1000); } }
  return { registry, queue, runOnce, health(){return {...progress};}, async start() { if (!timer && !stopped) timer = setTimeout(tick, 0); }, async shutdown() { stopped = true; clearTimeout(timer); lifecycle.controller.abort(); if (active) await active.catch(() => {}); await lifecycle.shutdown(); } };
}
module.exports = { TYPE, createFundingWorker };
