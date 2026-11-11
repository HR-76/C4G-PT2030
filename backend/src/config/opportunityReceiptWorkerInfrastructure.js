'use strict';

const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { createProductionCatalogs } = require('../authorization/catalogs');
const { createPgBossQueueAdapter } = require('../async/adapters/pgBossQueueAdapter');
const { inspectPgBossSchema } = require('../async/pgBossSchemaInspection');
const { deadLetterRecord } = require('../async/deadLetter');
const { createEnvelopeV2, createTrustedObservability, V2_KEYS, validateEnvelope } = require('../async/envelope');
const { createExecutionLineageProjection } = require('../async/executionLineageProjection');
const { OutboxRelay } = require('../async/outboxRelay');
const { OutboxRepository } = require('../async/outboxRepository');
const { createPersistentRetryPort } = require('../async/retryPort');
const { JOBS, SERVICE_ACTORS, createOpportunityJobRegistry } = require('../opportunities/jobs');
const { createIdentityFactory } = require('../opportunities/identity');
const { createPostgresOpportunityAuditWriter } = require('../opportunities/postgresAuditWriter');
const { createF12ReceiptRuntime } = require('../opportunities/f12ReceiptRuntime');
const { createF12InterruptedDeliveryRecovery } = require('../opportunities/f12InterruptedDeliveryRecovery');
const { resolveReplayTerminalExecution, createF12ReplayCapacityRelease } = require('../async/f12ReplayCapacity');
const { createF12ReplayFailureReceipts } = require('../opportunities/f12ReplayFailureReceipts');
const { TenantOpportunityRepository } = require('../opportunities/tenantRepository');
const { createTenantOperationCatalog } = require('../security/tenantOperationCatalog');
const { createTenantRuntime } = require('../security/tenantRuntime');
const { createConfiguredOpportunityRuntime } = require('./opportunityRuntime');

const transportRole = 'c4g_f12_opportunity_transport';
const workerRoles = Object.freeze([transportRole, 'c4g_opportunity_tenant_runtime',
  'c4g_f12_receipt_issuer', 'c4g_f4_metadata_executor']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const observation = () => createTrustedObservability({ traceparent: null, tracestate: null });
const registry = createOpportunityJobRegistry(Object.fromEntries(JOBS.map(type => [type, () => {
  throw new Error('F12 registry is for validation only.');
}])));

function opportunityQueueMap(organizationId) {
  if (!uuid.test(organizationId || '')) throw new TypeError('F12 worker organization is invalid.');
  return Object.freeze(Object.fromEntries(JOBS.map(type => [type, `c4g.${type}.${organizationId}`])));
}

async function transaction(pool, work) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally { client.release(discard); }
}

async function verifySharedCentral(central, peers) {
  const lock = 'hashtextextended($1, 43001308)';
  const challenge = randomUUID();
  await transaction(central, async client => {
    await client.query(`SELECT pg_advisory_xact_lock(${lock})`, [challenge]);
    for (const peer of peers) {
      const { rows } = await peer.query(`SELECT pg_try_advisory_xact_lock(${lock}) AS acquired`, [challenge]);
      if (rows[0]?.acquired !== false) throw new Error('F12_WORKER_CENTRAL_BINDING_MISMATCH');
    }
  });
}

async function createOpportunityReceiptWorkerInfrastructure({ env, telemetry, createRuntime = createTenantRuntime }) {
  const organizationId = env.F12_OPPORTUNITY_WORKER_ORGANIZATION_ID;
  const queueMap = opportunityQueueMap(organizationId);
  for (const name of ['CENTRAL_DATABASE_URL', 'F12_RECEIPT_ISSUER_DATABASE_URL', 'F12_RECEIPT_RECOVERY_DATABASE_URL',
    'F12_OPPORTUNITY_QUEUE_DATABASE_URL']) {
    if (!env[name]) throw new TypeError(`F12 worker requires ${name}.`);
  }
  const pool = name => require('./poolResilience').guardPool(new Pool({ connectionString: env[name], max: 5, connectionTimeoutMillis: 5000, statement_timeout: 5000 }), 'receipt-worker');
  const central = pool('CENTRAL_DATABASE_URL');
  const issuer = pool('F12_RECEIPT_ISSUER_DATABASE_URL');
  const recoveryCentral = pool('F12_RECEIPT_RECOVERY_DATABASE_URL');
  const queuePool = pool('F12_OPPORTUNITY_QUEUE_DATABASE_URL');
  const close = [() => central.end(), () => issuer.end(), () => recoveryCentral.end(), () => queuePool.end()];
  const closeAll = async () => {
    const results = await Promise.allSettled(close.map(end => end()));
    const failed = results.filter(result => result.status === 'rejected');
    if (failed.length) throw new Error('F12 worker resource cleanup failed.');
  };
  let queue;
  try {
    await verifySharedCentral(central, [issuer, recoveryCentral, queuePool]);
    const api = createConfiguredOpportunityRuntime({ centralPool: central, env });
    close.push(() => api.poolManager.closeAll());
    const worker = createConfiguredOpportunityRuntime({ centralPool: central, env, workerFunctionalRoles: workerRoles });
    close.push(() => worker.poolManager.closeAll());
    const directory = worker.directoryRepository;
    const snapshot = await directory.resolveSnapshotByOrganization(organizationId, 'WORKER');
    if (!snapshot?.tenantId) throw new Error('F12_WORKER_TENANT_REQUIRED');
    const contexts = new WeakSet();
    const newContext = (jobType = null, version = null) => {
      const context = Object.freeze({ organizationId, jobType, version });
      contexts.add(context);
      return context;
    };
    async function activeGrant(type) {
      const { rows } = await issuer.query(`SELECT version FROM f12_service_authority.service_grant
        WHERE organization_id=$1 AND job_type=$2 AND active`, [organizationId, type]);
      return Number(rows[0]?.version);
    }
    const membershipRepository = { async revalidateContext(context) {
      if (!contexts.has(context)) return null;
      const { rows } = await central.query("SELECT id FROM public.organization WHERE id=$1 AND status='ACTIVE'", [organizationId]);
      if (rows.length !== 1) return null;
      if (context.jobType && await activeGrant(context.jobType) !== context.version) return null;
      return context;
    } };
    const dependencies = { ...worker, membershipRepository, validateOrganizationContext: context => contexts.has(context) };
    const transportInput = new WeakMap();
    const transportModule = Object.freeze({
      moduleCode: 'F12_OPPORTUNITY_TRANSPORT_QUERY',
      async execute({ client, input }) {
        await client.query(`SET LOCAL ROLE ${transportRole}`);
        return transportInput.get(input)(client);
      },
      beforeCommit: ({ client }) => client.query('RESET ROLE')
    });
    const transportAdapter = Object.freeze({ operationCode: 'F12_OPPORTUNITY_TRANSPORT', queryModule: transportModule });
    const transportCatalog = createTenantOperationCatalog(Object.freeze({
      catalogVersion: 'f12-opportunity-transport-v1',
      operations: Object.freeze([Object.freeze({ ...transportAdapter, ownerModule: 'F12_OPPORTUNITY_WORKER',
        accessMode: 'WRITE', workload: 'WORKER', workloadClass: 'OPERATIONAL',
        compatibleSchemaVersions: Object.freeze(['034_f12_service_receipt']),
        requiredCapabilities: Object.freeze(['F9_ASYNC_EXECUTION', 'F9_EXECUTION_LINEAGE', 'F12_SERVICE_RECEIPTS']),
        allowedCompatibilityStates: Object.freeze(['COMPATIBLE']), readOnlyEligible: false,
        inputSchema: Object.freeze({ validate: input => transportInput.has(input) }),
        resultSchema: Object.freeze({ validate: value => value !== undefined }),
        requiredPermission: 'F12_OPPORTUNITY_TRANSPORT',
        limits: Object.freeze({ maxPageSize: 10, maxRows: 10, maxBytes: 1048576 }), timeoutMs: 5000 })])
    }));
    const transport = createTenantRuntime({ ...dependencies, operationCatalog: transportCatalog });
    const transportContext = newContext();
    async function tenantTransaction(work, correlationId = randomUUID()) {
      const input = Object.freeze({});
      transportInput.set(input, work);
      try {
        const lease = await transport.resolve({ organizationContext: transportContext, operationAdapter: transportAdapter, correlationId });
        // Some F9 writes intentionally return no result.
        return (await lease.execute(input)).value;
      } finally { transportInput.delete(input); }
    }
    const runTransport = (work, correlationId) => tenantTransaction(async client => ({ value: await work(client) }), correlationId);
    const outbox = new OutboxRepository();
    const claim = async (client, { owner, now }) => (await client.query(`WITH ready AS (
      SELECT outbox_id FROM async_exec.outbox WHERE organization_id=$1 AND lineage_version=1
      AND envelope->>'jobType'=ANY($2::text[]) AND state IN ('PENDING','UNCERTAIN') AND available_at <= $3
      AND (lease_until IS NULL OR lease_until < $3) ORDER BY created_at,outbox_id FOR UPDATE SKIP LOCKED LIMIT 10)
      UPDATE async_exec.outbox o SET state='CLAIMED',claim_owner=$4,lease_until=$3 + interval '30 seconds',
      fence=o.fence+1,updated_at=$3 FROM ready WHERE o.outbox_id=ready.outbox_id RETURNING o.*`,
    [organizationId, JOBS, now, owner])).rows;
    const projection = createExecutionLineageProjection({ transaction: work => transaction(central, work) });
    queue = await createPgBossQueueAdapter({ connectionString: env.F12_OPPORTUNITY_QUEUE_DATABASE_URL, queueMap,
      inspectSchema: () => inspectPgBossSchema(queuePool, Object.values(queueMap)),
      lineagePort: { async load(id) {
        const lineage = await projection.load(id);
        if (lineage.organizationId !== organizationId) throw new Error('F12_WORKER_TENANT_MISMATCH');
        return lineage;
      } }
    });
    const continuationPort = { async enqueue(input, client) {
      const type = JOBS[0];
      const { envelope, contentDigest, envelopeDigest } = createEnvelopeV2({
        trustedContext: { organizationId, actor: { kind: 'SERVICE', serviceActorCode: SERVICE_ACTORS[type].code },
          operation: type, correlationId: input.correlationId, causationId: input.causationId },
        job: { type, version: 1, payloadVersion: 1, idempotencyKey: input.idempotencyKey,
          deadlineMs: Math.min(300000, Date.parse(input.deadlineAt) - Date.now()) },
        payload: input.payload, registry, observability: observation()
      });
      return (await outbox.enqueueLineage(client, { organizationId, logicalId: input.idempotencyKey, envelope,
        lineage: { deliveryKind: 'INITIAL', attempt: 1, rootExecutionId: envelope.executionId, previousExecutionId: null,
          contentDigest, envelopeDigest, replayRequestId: null } })).created;
    } };
    const receiptRuntimeDependencies = { central: issuer, recoveryCentral, tenantRuntimeDependencies: api };
    const receipts = createF12ReceiptRuntime(receiptRuntimeDependencies);
    const capacityEnabled = (await recoveryCentral.query(`SELECT
      to_regprocedure('f12_replay_capacity.pending_proofs(uuid,uuid)') IS NOT NULL AS enabled`)).rows[0]?.enabled === true;
    const resolveReceiptExecution = capacityEnabled ? (...identity) => resolveReplayTerminalExecution(projection, ...identity) : null;
    const failureEnabled = capacityEnabled && (await recoveryCentral.query(`SELECT
      to_regprocedure('f12_replay_capacity.pending_failures(uuid,uuid)') IS NOT NULL AS enabled`)).rows[0]?.enabled === true;
    if (failureEnabled && snapshot.schema?.verifiedCapabilities?.F12_REPLAY_FAILURE_RECEIPT !== true) {
      throw new Error('F12_FAILURE_RECEIPT_TENANT_MIGRATION_REQUIRED');
    }
    const failures = failureEnabled ? createF12ReplayFailureReceipts({ organizationId, recoveryCentral, api, registry,
      resolveReceiptExecution, transportRole, receipts }) : undefined;
    const releaseCapacity = capacityEnabled ? createF12ReplayCapacityRelease({ organizationId, recoveryCentral,
      receipts }) : null;
    const interrupted = createF12InterruptedDeliveryRecovery({ organizationId, directory, runTransport, recoveryCentral,
      receipts, queue, registry, resolveReceiptExecution });
    let nextRecovery = 0;
    return {
      queue, close: closeAll,
      terminalReceiptPort: failures,
      interruptedDeliveryRecovery: { async poll() {
        if (Date.now() < nextRecovery) return;
        nextRecovery = Date.now() + 5000;
        await interrupted.poll();
        await releaseCapacity?.();
        await failures?.poll();
      } },
      relay: new OutboxRelay({ repository: { claim, markPublished: outbox.markPublished.bind(outbox),
        markUncertain: outbox.markUncertain.bind(outbox) }, queue, transaction: runTransport, workerId: randomUUID(),
        projectionPort: { project: ({ row, envelope }) => projection.project({ row, envelope }) }, telemetry }),
      transactionResolver: { async resolve(id, envelope) {
        if (id !== organizationId) throw new Error('F12_WORKER_TENANT_MISMATCH');
        return work => runTransport(work, envelope.correlationId);
      } },
      retryPort: createPersistentRetryPort({ outboxRepository: outbox, registry, observabilityFactory: observation }),
      deadLetterPort: { async record(input) {
        const row = deadLetterRecord(input);
        await transaction(central, async client => {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 43001307))', [row.executionId]);
          await client.query(`INSERT INTO async_exec.dead_letter(dead_letter_id,execution_id,organization_id,job_type,
            envelope_version,job_version,payload_version,classification,attempts,correlation_id,causation_id,
            digest_sha256,detail_code,lineage_version)
            SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1 WHERE NOT EXISTS
            (SELECT 1 FROM async_exec.dead_letter WHERE execution_id=$2 AND organization_id=$3)`,
          [row.deadLetterId,row.executionId,row.organizationId,row.jobType,row.envelopeVersion,row.jobVersion,
            row.payloadVersion,row.classification,row.attempts,row.correlationId,row.causationId,row.digestSha256,row.detailCode]);
        });
      } },
      compositionDependencies: {
        receiptRuntimeDependencies,
        resolveReceiptExecution,
        authorizationOperationCatalog: createProductionCatalogs({ catalogVersion: 'f12' }).operationCatalog,
        authorization: { async authorize({ operationCode, actor }) {
          const allowed = actor.type === 'SERVICE' && actor.organizationId === organizationId
            && SERVICE_ACTORS[actor.jobType]?.operation === operationCode && SERVICE_ACTORS[actor.jobType]?.code === actor.id
            && await activeGrant(actor.jobType) === actor.authorizationVersion;
          return { allowed, operation: { code: operationCode } };
        } },
        createTenantRuntime: ({ operationCatalog }) => createRuntime({ ...dependencies, operationCatalog }),
        tenantRepository: new TenantOpportunityRepository({ pool: { connect() { throw new Error('F12_PREPARED_CLIENT_REQUIRED'); } },
          organizationId, identityFactory: createIdentityFactory(),
          auditWriter: createPostgresOpportunityAuditWriter({ authority: 'ORGANIZATION', organizationId, tenantId: snapshot.tenantId }) }),
        continuationPort,
        jobContextPort: { async resolveOrganizationContext(id, execution, type) {
          const envelope = validateEnvelope(Object.fromEntries(V2_KEYS.map(key => [key, execution[key]])), registry).envelope;
          if (id !== organizationId || envelope.jobType !== type || envelope.operation !== type
              || envelope.actor.serviceActorCode !== SERVICE_ACTORS[type].code || !uuid.test(execution.rootExecutionId || '')
              || typeof execution.assertFence !== 'function') {
            throw new Error('F12_WORKER_CONTEXT_INVALID');
          }
          await execution.assertFence();
          return newContext(type, await activeGrant(type));
        } }
      }
    };
  } catch (error) {
    await queue?.shutdown().catch(() => {});
    await closeAll().catch(() => {});
    throw error;
  }
}

module.exports = { createOpportunityReceiptWorkerInfrastructure, opportunityQueueMap, transportRole, workerRoles };
