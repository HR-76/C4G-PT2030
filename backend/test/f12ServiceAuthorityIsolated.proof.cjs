'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { Worker, workerData, isMainThread } = require('node:worker_threads');
const { Pool } = require('pg');
const { createUuidV7 } = require('../src/audit/uuidV7');
const { createF12ReceiptRuntime } = require('../src/opportunities/f12ReceiptRuntime');
const { createF12ReceiptRecoveryService } = require('../src/config/f12ReceiptRecoveryService');
const { createTenantBindingVerifier } = require('../src/security/tenantBindingVerifier');
const { observeTenantRuntimeMetadata } = require('../src/security/tenantRuntimeMetadata');
const { applyRegisteredF12ReceiptPackage, applyRegisteredF12ReplayCapacityPackage,
  applyRegisteredF12FailureCapacityPackage } = require('../scripts/runCentralMigrations');
const { preflightCentral } = require('../src/security/centralMigrationPreflight');
const { createF12ReceiptTenantMigrationRunner, createF12FailureReceiptTenantMigrationRunner } =
  require('../src/security/tenantMigrationRunner');
const { createTenantSchemaRepository } = require('../src/security/tenantSchemaRepository');
const { createTenantSchemaObservationPublisher } = require('../src/security/tenantSchemaObservationPublisher');
const { createTenantConnectionRepository } = require('../src/security/tenantConnectionRepository');
const { createTenantWorkloadDirectoryRepository } = require('../src/security/tenantWorkloadDirectoryRepository');
const { configureLocalTenantDatabaseConnect, createLocalTenantIdentityProvisioner,
  validateLocalTenantRoleChain } = require('../src/security/localTenantIdentityProvisioner');
const { createF12LocalComposition } = require('../src/opportunities/localComposition');
const { snapshotEligible } = require('../src/security/tenantResolver');
const { createProductionCatalogs } = require('../src/authorization/catalogs');
const { createEnvelopeV2, createTrustedObservability } = require('../src/async/envelope');
const { createTenantRuntime } = require('../src/security/tenantRuntime');
const { OutboxRepository } = require('../src/async/outboxRepository');
const { createReplayService } = require('../src/async/replayService');
const { ReplayRequestRepository } = require('../src/async/replayRequestRepository');
const { createReplayAuditWriter } = require('../src/async/replayAuditWriter');
const { createReplayExecutionAuditWriter } = require('../src/async/replayExecutionAuditWriter');
const { createTenantReplayPort } = require('../src/async/tenantReplayPort');
const { f12ReplayCapacity } = require('../src/async/f12ReplayCapacity');
const { createOpportunityReceiptWorker, loadOpportunityReceiptWorker } = require('../src/config/opportunityReceiptWorker');
const { createOpportunityReceiptWorkerInfrastructure, opportunityQueueMap, transportRole, workerRoles } =
  require('../src/config/opportunityReceiptWorkerInfrastructure');

const cumulative = process.argv.length === 3 && process.argv[2] === '--cumulative';
const crashChild = !isMainThread && workerData?.f12Crash === true;
if (!cumulative && !crashChild && (process.env.C4G_CAPACITY_PROOF_ISOLATED !== 'yes' || process.env.C4G_CAPACITY_PROOF_PORT !== '56439')) {
  throw new Error('ISOLATED_PROOF_REQUIRED');
}
const options = { host: '127.0.0.1', port: 56439, user: 'capacity_proof', statement_timeout: 5000 };
const admin = new Pool({ ...options, database: 'postgres' });
const sql = file => readFileSync(path.resolve(__dirname, '../database', file), 'utf8');
const job = 'opportunity.duplicate.scan';

async function openDatabase() {
  const database = 'f12_guard_' + randomUUID().replaceAll('-', '');
  await admin.query('CREATE DATABASE ' + database);
  return new Pool({ ...options, database });
}

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function crashWorkerAtCommit(env) {
  for (const key of ['CENTRAL_DATABASE_URL', 'F12_OPPORTUNITY_QUEUE_DATABASE_URL',
    'F12_RECEIPT_ISSUER_DATABASE_URL', 'F12_RECEIPT_RECOVERY_DATABASE_URL']) {
    const url = new URL(env[key]);
    assert.deepEqual([url.hostname, url.port, url.pathname], ['127.0.0.1', '5547', '/f12_synthetic_central']);
  }
  for (const key of ['OPPORTUNITY_API_CREDENTIALS_JSON', 'F12_OPPORTUNITY_WORKER_CREDENTIALS_JSON']) {
    for (const entry of JSON.parse(env[key])) {
      assert.deepEqual([entry.host, entry.port, entry.database], ['127.0.0.1', 5547, 'f12_synthetic_tenant_a']);
    }
  }
  const createRuntime = dependencies => createTenantRuntime({ ...dependencies, poolManager: {
    ...dependencies.poolManager,
    async acquire(input) {
      const allocation = await dependencies.poolManager.acquire(input);
      const { client } = allocation;
      let writing = false;
      return { ...allocation, client: {
        on: client.on.bind(client), removeListener: client.removeListener.bind(client),
        async query(statement, values) {
          if (statement === 'BEGIN TRANSACTION READ WRITE') writing = true;
          const result = await client.query(statement, values);
          if (writing && statement === 'COMMIT') process.exit(73);
          return result;
        }
      } };
    }
  } });
  const worker = createOpportunityReceiptWorker(await createOpportunityReceiptWorkerInfrastructure({ env, createRuntime }));
  try { await worker.runOnce(); }
  finally { await worker.shutdown(); }
  throw new Error('F12 worker did not reach the crash point');
}

async function proveQueueRecovery(central, tenant, env, organizationId, hardCrash = false) {
  const { PgBoss } = await import('pg-boss');
  const setup = new PgBoss({ connectionString: central.options.connectionString,
    createSchema: false, migrate: false, supervise: false, schedule: false });
  await setup.start();
  try {
    for (const name of Object.values(opportunityQueueMap(organizationId))) {
      if (!await setup.getQueue(name)) await setup.createQueue(name);
    }
  } finally { await setup.stop(); }
  const type = 'opportunity.catalog.reconcile';
  const initial = randomUUID();
  const source = (await tenant.query(`SELECT opportunity_id, current_revision_id FROM opportunity_catalog.opportunity
    WHERE organization_id=$1 AND quality_score>0 ORDER BY opportunity_id LIMIT 1`, [organizationId])).rows[0];
  assert.ok(source);
  await tenant.query("UPDATE opportunity_catalog.opportunity SET quality_score=0, quality_bucket='LOW' WHERE organization_id=$1 AND opportunity_id=$2",
    [organizationId, source.opportunity_id]);
  let lost = false, sqlFailure, handlerFailure;
  const createRuntime = dependencies => createTenantRuntime({ ...dependencies, operationCatalog: {
    resolveAdapter(adapter) {
      const operation = dependencies.operationCatalog.resolveAdapter(adapter);
      if (!operation) return null;
      return Object.freeze({ ...operation, queryModule: Object.freeze({ ...operation.queryModule,
        async execute(input) {
          try { return await operation.queryModule.execute(input); }
          catch (error) { handlerFailure = error; throw error; }
        }
      }) });
    }
  }, poolManager: {
    ...dependencies.poolManager,
    async acquire(input) {
      const allocation = await dependencies.poolManager.acquire(input);
      const { client } = allocation;
      let write = false;
      return { ...allocation, client: {
        on: client.on.bind(client), removeListener: client.removeListener.bind(client),
        async query(statement, values) {
          if (statement === 'BEGIN TRANSACTION READ WRITE') write = true;
          const result = await client.query(statement, values).catch(error => {
            sqlFailure ||= error;
            throw error;
          });
          if (write && statement === 'COMMIT' && !lost) {
            lost = true;
            throw new Error('commit acknowledgement lost after PostgreSQL committed');
          }
          return result;
        }
      } };
    }
  } });
  let deliveryError;
  const errorObserver = error => { deliveryError = error; };
  let worker = createOpportunityReceiptWorker({
    ...await createOpportunityReceiptWorkerInfrastructure({ env, createRuntime }), errorObserver
  });
  try {
    const built = createEnvelopeV2({
      trustedContext: { organizationId, actor: { kind: 'SERVICE', serviceActorCode: 'F12_CATALOG_RECONCILER' },
        operation: type, correlationId: createUuidV7(), causationId: createUuidV7() },
      job: { type, version: 1, payloadVersion: 1, idempotencyKey: initial },
      payload: { opportunityId: source.opportunity_id, revisionId: source.current_revision_id, reasonCode: 'QUALITY_PROJECTION_DRIFT' },
      registry: worker.registry, observability: createTrustedObservability({ traceparent: null, tracestate: null }),
      id: () => initial
    });
    await transaction(tenant, client => new OutboxRepository().enqueueLineage(client, {
      organizationId, logicalId: initial, envelope: built.envelope,
      lineage: { deliveryKind: 'INITIAL', attempt: 1, rootExecutionId: initial, previousExecutionId: null,
        contentDigest: built.contentDigest, envelopeDigest: built.envelopeDigest, replayRequestId: null }
    }));
    if (hardCrash) {
      const code = await new Promise((resolve, reject) => {
        const child = new Worker(__filename, { workerData: { f12Crash: true, env } });
        child.once('error', reject);
        child.once('exit', resolve);
      });
      assert.equal(code, 73);
      const state = () => tenant.query(`SELECT state,execution_id,fence,result_code FROM async_exec.inbox
        WHERE organization_id=$1 AND idempotency_key=$2`, [organizationId, initial]).then(result => result.rows[0]);
      const deliveries = () => tenant.query(`SELECT delivery_kind FROM async_exec.outbox
        WHERE organization_id=$1 AND root_execution_id=$2`, [organizationId, initial]).then(result => result.rows);
      const active = await state();
      assert.equal(active.state, 'PROCESSING');
      assert.deepEqual(await deliveries(), [{ delivery_kind: 'INITIAL' }]);
      await worker.runOnce();
      assert.deepEqual(await state(), active);
      await worker.shutdown();
      // Simulate passage of the lease interval without changing the runtime's lease policy.
      await tenant.query(`UPDATE async_exec.inbox SET lease_until=clock_timestamp()-interval '1 second'
        WHERE organization_id=$1 AND idempotency_key=$2`, [organizationId, initial]);
      worker = await loadOpportunityReceiptWorker({ env });
      await worker.runOnce();
      assert.deepEqual(await state(), { state: 'COMPLETED', execution_id: initial, fence: active.fence, result_code: 'SUCCESS' });
      assert.deepEqual(await deliveries(), [{ delivery_kind: 'INITIAL' }]);
      assert.equal((await central.query("SELECT state FROM pgboss.job_common WHERE data->>'executionId'=$1",
        [initial])).rows[0]?.state, 'completed');
      assert.deepEqual((await central.query('SELECT state FROM f12_service_authority.commit_guard WHERE execution_id=$1',
        [initial])).rows, [{ state: 'COMMITTED' }]);
      assert.equal((await tenant.query('SELECT 1 FROM f12_service_receipts.effect_receipt WHERE execution_id=$1', [initial])).rowCount, 1);
      assert.equal((await tenant.query(`SELECT 1 FROM audit.event WHERE organization_id=$1 AND correlation_id=$2
        AND event_code='OPPORTUNITY_QUALITY_EVALUATED'`, [organizationId, built.envelope.correlationId])).rowCount, 1);
      console.log('PASS: expired inbox recovered after worker exit at COMMIT, without an outbox retry or duplicate effect.');
      return { built, initial };
    }
    await worker.runOnce();
    if (!lost && deliveryError) {
      throw new Error(`F12 handler stopped before commit: ${deliveryError.internalCode || deliveryError.code || deliveryError.message}`
        + (sqlFailure ? ` (${sqlFailure.code}: ${sqlFailure.message})` : ''), { cause: handlerFailure || deliveryError });
    }
    if (!lost) {
      const outboxState = (await tenant.query('SELECT state FROM async_exec.outbox WHERE organization_id=$1 AND logical_id=$2',
        [organizationId, initial])).rows[0]?.state;
      const queueState = (await central.query("SELECT state FROM pgboss.job_common WHERE data->>'executionId'=$1",
        [initial])).rows[0]?.state;
      throw new Error(`F12 commit was not reached (outbox=${outboxState}, queue=${queueState})`);
    }
    assert.equal(deliveryError?.internalCode, 'COMMIT_UNCERTAIN');
    const inbox = () => tenant.query(`SELECT state,execution_id,fence FROM async_exec.inbox
      WHERE organization_id=$1 AND idempotency_key=$2`, [organizationId, initial]).then(result => result.rows[0]);
    const guards = () => central.query(`SELECT transaction_id,state FROM f12_service_authority.commit_guard
      WHERE organization_id=$1 AND execution_id=$2`, [organizationId, initial]).then(result => result.rows);
    assert.equal((await inbox()).state, 'UNCERTAIN');
    const [guard] = await guards();
    assert.equal(guard.state, 'PREPARED');
    const retry = (await tenant.query(`SELECT envelope->>'executionId' AS execution_id, available_at
      FROM async_exec.outbox WHERE organization_id=$1 AND root_execution_id=$2 AND delivery_kind='RETRY'`,
    [organizationId, initial])).rows[0];
    assert.ok(retry);
    assert.notEqual(retry.execution_id, initial);
    await worker.shutdown();
    worker = await loadOpportunityReceiptWorker({ env });
    await delay(Math.max(0, retry.available_at.getTime() - Date.now()) + 20);
    await worker.runOnce();
    assert.deepEqual(await inbox(), { state: 'COMPLETED', execution_id: retry.execution_id, fence: '2' });
    assert.deepEqual(await guards(), [{ transaction_id: guard.transaction_id, state: 'COMMITTED' }]);
    assert.equal((await tenant.query('SELECT 1 FROM f12_service_receipts.effect_receipt WHERE execution_id=$1', [initial])).rowCount, 1);
    assert.equal((await tenant.query(`SELECT 1 FROM audit.event WHERE organization_id=$1 AND correlation_id=$2
      AND event_code='OPPORTUNITY_QUALITY_EVALUATED'`, [organizationId, built.envelope.correlationId])).rowCount, 1);
    assert.equal((await central.query("SELECT state FROM pgboss.job_common WHERE data->>'executionId'=$1",
      [retry.execution_id])).rows[0]?.state, 'completed');
    assert.ok((await tenant.query('SELECT quality_score FROM opportunity_catalog.opportunity WHERE organization_id=$1 AND opportunity_id=$2',
      [organizationId, source.opportunity_id])).rows[0].quality_score > 0);
    console.log('PASS: pg-boss redelivery after worker restart completed the inbox with one committed effect receipt.');
    return { built, initial };
  } finally { await worker.shutdown(); }
}

async function proveReplayCapacity(central, tenant, env, source, otherSource, tenantId, replayLogin, recovery) {
  const organizationId = env.F12_OPPORTUNITY_WORKER_ORGANIZATION_ID;
  const { built, initial } = source;
  const type = built.envelope.jobType;
  const outbox = new OutboxRepository();
  await central.query('INSERT INTO f12_replay_capacity.policy VALUES (1,2,1)');
  const repository = new ReplayRequestRepository({ auditWriter: createReplayAuditWriter() });
  const consume = repository.consume.bind(repository);
  let failConsume = true;
  repository.consume = async (...args) => {
    if (failConsume) { failConsume = false; throw new Error('F12_TEST_CONSUME_INTERRUPTED'); }
    return consume(...args);
  };
  const tenantReplayPort = createTenantReplayPort({ transactionFor: (_target, work) => transaction(tenant, work),
    outboxRepository: outbox, auditWriterFor: () => createReplayExecutionAuditWriter({ tenantId }) });
  let worker = await loadOpportunityReceiptWorker({ env });
  const service = createReplayService({
    authorization: { authorize: async () => ({ allowed: true }) }, repository, capacity: f12ReplayCapacity,
    centralTransaction: work => transaction(replayLogin, work), tenantReplayPort, registry: worker.registry,
    tenantLocator: { resolve: async () => ({ tenantId }) },
    observabilityFactory: () => createTrustedObservability({ traceparent: null, tracestate: null })
  });
  const actor = () => ({ type: 'HUMAN', id: randomUUID(), membershipId: randomUUID(), organizationId,
    membershipVersion: 1, authorizationVersion: 1 });
  async function approve(executionId) {
    await central.query("UPDATE async_exec.execution SET state='FAILED' WHERE execution_id=$1", [executionId]);
    const assuranceEvidence = { authTime: Math.floor(Date.now() / 1000) };
    const request = await service.request({ originalExecutionId: executionId, actor: actor(), assuranceEvidence,
      correlationId: createUuidV7(), idempotencyKey: randomUUID() });
    await service.approve({ replayRequestId: request.replayRequestId, actor: actor(), assuranceEvidence,
      correlationId: createUuidV7() });
    return { organizationId, replayRequestId: request.replayRequestId };
  }
  async function resetInbox() {
    await tenant.query("UPDATE async_exec.inbox SET state='FAILED' WHERE organization_id=$1 AND idempotency_key=$2",
      [organizationId, initial]);
  }
  const reservations = async () => (await central.query(`SELECT execution_id,generation,terminal_nonce
    FROM f12_replay_capacity.reservation WHERE organization_id=$1 AND root_execution_id=$2 ORDER BY generation`,
  [organizationId, initial])).rows;
  const release = (execution, nonce) => recovery.query('SELECT f12_replay_capacity.release($1,$2,$3,$4) AS released',
    [organizationId, initial, execution, nonce]).then(result => result.rows[0].released);
  try {
    const command = await approve(initial);
    await resetInbox();
    await assert.rejects(service.execute(command), /F12_TEST_CONSUME_INTERRUPTED/);
    const [first] = await reservations();
    assert.equal(first.generation, '1');
    assert.equal(first.terminal_nonce, null);
    const competing = await approve(otherSource.initial);
    await assert.rejects(service.execute(competing), { code: 'ASYNC_REPLAY_CAPACITY_RETRY_LATER' });
    assert.equal((await central.query('SELECT state FROM async_exec.replay_request WHERE replay_request_id=$1',
      [competing.replayRequestId])).rows[0].state, 'APPROVED');
    assert.equal((await tenant.query('SELECT 1 FROM async_exec.outbox WHERE replay_request_id=$1',
      [competing.replayRequestId])).rowCount, 0);
    await assert.rejects(transaction(replayLogin, client => repository.reserve(client, {
      ...competing, executionId: randomUUID(), reservationDigest: '0'.repeat(64)
    })), /F12_CAPACITY_RESERVATION_REQUIRED/);
    const originalNonce = (await central.query("SELECT transaction_id FROM f12_service_authority.commit_guard WHERE execution_id=$1 AND state='COMMITTED'",
      [initial])).rows[0].transaction_id;
    assert.equal(await release(first.execution_id, originalNonce), false);
    await worker.runOnce();
    assert.equal((await reservations())[0].terminal_nonce, null);
    assert.equal((await service.reconcile(command)).state, 'CONSUMED');
    await transaction(replayLogin, async locked => {
      await f12ReplayCapacity.lockReplay(locked, command);
      await assert.rejects(transaction(recovery, async competing => {
        await competing.query("SET LOCAL lock_timeout='150ms'");
        await competing.query('SELECT f12_replay_capacity.release($1,$2,$3,$4)',
          [organizationId, initial, first.execution_id, originalNonce]);
      }), { code: '55P03' });
    });
    await worker.shutdown();
    worker = await loadOpportunityReceiptWorker({ env });
    await worker.runOnce();
    const [released] = await reservations();
    assert.ok(released.terminal_nonce);
    assert.notEqual(released.terminal_nonce, originalNonce);
    const next = await approve(first.execution_id);
    await resetInbox();
    const [replayed, repeated] = await Promise.all([service.execute(next), service.execute(next)]);
    assert.equal(repeated.reservedExecutionId, replayed.reservedExecutionId);
    assert.equal((await tenant.query('SELECT 1 FROM async_exec.outbox WHERE replay_request_id=$1',
      [next.replayRequestId])).rowCount, 1);
    const [, second] = await reservations();
    assert.equal(second.generation, '2');
    assert.equal(second.execution_id, replayed.reservedExecutionId);
    assert.equal(await release(second.execution_id, released.terminal_nonce), false);
    await worker.runOnce();
    await worker.shutdown();
    worker = await loadOpportunityReceiptWorker({ env });
    await worker.runOnce();
    const [, final] = await reservations();
    assert.ok(final.terminal_nonce);
    assert.equal(await release(final.execution_id, final.terminal_nonce), true);
    await worker.shutdown();
    const { database_generation_id: databaseGenerationId } = (await tenant.query(
      'SELECT database_generation_id FROM c4g_system.tenant_identity')).rows[0];
    const { revision } = (await central.query('SELECT revision FROM public.tenant_schema_state WHERE tenant_id=$1', [tenantId])).rows[0];
    const migrate = createF12FailureReceiptTenantMigrationRunner({ pool: tenant, timeoutMs: 10000,
      scheduler: { setTimeout, clearTimeout },
      observationPublisher: createTenantSchemaObservationPublisher(createTenantSchemaRepository(central)) });
    const request = { tenantId, databaseGenerationId, expectedRevision: Number(revision),
      correlationId: randomUUID(), idempotencyKey: 'failure-receipt-migration' };
    const tenantUpdate = await migrate.migrate(request);
    assert.deepEqual(tenantUpdate.appliedVersions, ['035_f12_replay_failure_receipt']);
    assert.equal(tenantUpdate.evidence.currentVersion, '035_f12_replay_failure_receipt');
    assert.deepEqual((await migrate.migrate(request)).appliedVersions, []);
    assert.deepEqual(await applyRegisteredF12FailureCapacityPackage(central), ['038_f12_replay_failure_capacity']);
    assert.deepEqual(await applyRegisteredF12FailureCapacityPackage(central), []);
    assert.equal((await preflightCentral(central)).currentVersion, '038_f12_replay_failure_capacity');
    const failed = await approve(second.execution_id);
    await resetInbox();
    const failedReplay = await service.execute(failed);
    await worker.shutdown();
    const createRuntime = () => ({ async resolve() {
      throw Object.assign(new Error('synthetic permanent failure before effect'), { code: 'POISON_MESSAGE' });
    } });
    worker = createOpportunityReceiptWorker(await createOpportunityReceiptWorkerInfrastructure({ env, createRuntime }));
    await worker.runOnce();
    const failedId = failedReplay.reservedExecutionId;
    const failure = (await tenant.query('SELECT proof_id,outcome FROM f12_replay_failure.receipt WHERE replay_execution_id=$1',
      [failedId])).rows[0];
    assert.equal(failure.outcome, 'POISON_MESSAGE');
    await assert.rejects(tenant.query('UPDATE f12_replay_failure.receipt SET outcome=$2 WHERE proof_id=$1',
      [failure.proof_id, 'CANCELLED']), /F12_FAILURE_RECEIPT_IMMUTABLE/);
    await worker.shutdown();
    worker = await loadOpportunityReceiptWorker({ env });
    await worker.runOnce();
    const terminal = (await central.query('SELECT terminal_nonce,failure_proof_id FROM f12_replay_capacity.reservation WHERE execution_id=$1',
      [failedId])).rows[0];
    assert.deepEqual(terminal, { terminal_nonce: null, failure_proof_id: failure.proof_id });
    assert.equal((await central.query('SELECT 1 FROM f12_service_authority.commit_guard WHERE execution_id=$1 AND state=\'COMMITTED\'',
      [failedId])).rowCount, 0);
    const afterFailure = await approve(failedId);
    await resetInbox();
    const reacquired = await service.execute(afterFailure);
    assert.equal((await central.query('SELECT generation FROM f12_replay_capacity.reservation WHERE execution_id=$1',
      [reacquired.reservedExecutionId])).rows[0].generation, '4');
    await assert.rejects(replayLogin.query('SELECT f12_replay_capacity.release_failure($1,$2,$3,$4)',
      [organizationId, initial, failedId, '{}']), { code: '42501' });
    await tenant.query('GRANT SELECT ON f12_replay_failure.receipt TO PUBLIC');
    try {
      await assert.rejects(worker.runOnce(), { code: 'TENANT_NOT_AVAILABLE' });
    } finally {
      await tenant.query('REVOKE SELECT ON f12_replay_failure.receipt FROM PUBLIC');
    }
    console.log('PASS: protected failure receipt released replay capacity without creating an effect receipt.');
    assert.equal((await tenant.query(`SELECT 1 FROM audit.event WHERE organization_id=$1 AND correlation_id=$2
      AND event_code='OPPORTUNITY_QUALITY_EVALUATED'`, [organizationId, built.envelope.correlationId])).rowCount, 1);
    await assert.rejects(replayLogin.query('SELECT * FROM f12_replay_capacity.reservation'), { code: '42501' });
    await assert.rejects(recovery.query('SELECT f12_replay_capacity.reserve_replay($1,$2,$3)',
      [organizationId, next.replayRequestId, final.execution_id]), { code: '42501' });
    console.log('PASS: replay capacity held across interrupted consume, released by exact receipt and reacquired in a new generation.');
  } finally { await worker.shutdown(); }
}

async function proveHandlerRecovery(central, tenant, org, { issuer = central, recovery = central,
  tenantWriter = tenant, tenantReader = tenant, configuredF4 = null, credentialRef = null, bindingDigest = null } = {}) {
  const reconcile = 'opportunity.catalog.reconcile';
  await central.query(`INSERT INTO f12_service_authority.service_grant(organization_id,job_type,version,active)
    VALUES ($1,$2,2,true)`, [org, reconcile]);
  const identity = (await tenant.query('SELECT tenant_id, database_generation_id FROM c4g_system.tenant_identity')).rows[0];
  const capabilities = ['F9_EXECUTION_LINEAGE', 'F12_PRIVATE_CATALOG_READ', 'F12_SERVICE_RECEIPTS'];
  const expectedTenant = { tenantId: identity.tenant_id, databaseGenerationId: identity.database_generation_id };
  const readMetadata = client => observeTenantRuntimeMetadata(client, expectedTenant);
  const metadata = tenantReader === tenant ? null : await transaction(tenantReader, readMetadata);
  const snapshot = { organizationId: org, ...expectedTenant,
    workload: 'API', connectionVersion: 1, connectionState: 'AVAILABLE', versionState: 'VALIDATED', provisioningStatus: 'READY',
    observedSystemIdentifier: metadata?.systemIdentifier || 'isolated', bindingDigest: bindingDigest || 'isolated',
    credentialRef, regionCode: 'EU_TEST', residencyPolicyVersion: 'v1', schema: {
      compatibilityState: 'COMPATIBLE', currentVersion: metadata?.currentVersion || 'isolated',
      schemaFingerprint: metadata?.schemaFingerprint || 'isolated'
    } };
  let simulateDrift = false;
  const receiptRuntimeDependencies = { central: issuer, recoveryCentral: recovery, tenantRuntimeDependencies: {
    directoryRepository: { async resolveSnapshotByOrganization(id, workload) {
      assert.equal(id, org);
      assert.equal(workload, 'API');
      const observed = configuredF4 ? await configuredF4.directoryRepository.resolveSnapshotByOrganization(id, workload) : snapshot;
      return simulateDrift ? { ...observed, databaseGenerationId: randomUUID() } : observed;
    } },
    regionPolicy: { allows: () => true },
    credentialProvider: { async resolve() { return {}; } },
    poolManager: { async acquire() {
      const client = await tenantReader.connect();
      return { client, release: () => client.release() };
    } },
    bindingVerifier: createTenantBindingVerifier({ async observe({ client }) {
      if (metadata) {
        const observed = await readMetadata(client);
        return { ...observed, schemaVersion: observed.currentVersion, bindingDigest: snapshot.bindingDigest };
      }
      const observed = (await client.query('SELECT tenant_id, database_generation_id FROM c4g_system.tenant_identity')).rows[0];
      return { tenantId: observed.tenant_id, databaseGenerationId: observed.database_generation_id,
        systemIdentifier: 'isolated', bindingDigest: 'isolated', schemaVersion: 'isolated', schemaFingerprint: 'isolated', capabilities };
    } }),
    ...(configuredF4 && { regionPolicy: configuredF4.regionPolicy, credentialProvider: configuredF4.credentialProvider,
      poolManager: configuredF4.poolManager, bindingVerifier: configuredF4.bindingVerifier })
  } };
  const serviceReceipts = createF12ReceiptRuntime(receiptRuntimeDependencies);
  let effectClient, currentExecution, activeNonce;
  let failBeforeCommit = false;
  const repository = {
    scope: org,
    async withTransactionClient(client, work) {
      effectClient = client;
      try { return await work(); } finally { effectClient = null; }
    },
    async recomputeCurrentQuality() {
      await effectClient.query('INSERT INTO public.synthetic_effect VALUES ($1)', [currentExecution]);
      return { changed: true };
    },
    async scanDuplicateBatch() { return { targets: [], moreCandidates: false }; },
    async recordCandidate() { throw new Error('unexpected candidate'); }
  };
  const composition = createF12LocalComposition({
    receiptRuntimeDependencies,
    authorizationOperationCatalog: createProductionCatalogs({ catalogVersion: 'f12' }).operationCatalog,
    authorization: { async authorize({ operationCode, actor }) {
      assert.equal(actor.authorizationVersion, actor.jobType === reconcile ? 2 : 1);
      return { allowed: true, operation: { code: operationCode } };
    } },
    tenantRuntime: { async resolve({ operationAdapter }) {
      return { async execute(input) {
        await transaction(tenantWriter, async client => {
          if (tenantWriter !== tenant) await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
          await operationAdapter.queryModule.execute({ client, input });
          activeNonce = (await central.query(
            'SELECT transaction_id FROM f12_service_authority.commit_guard WHERE execution_id=$1', [currentExecution])).rows[0].transaction_id;
          assert.equal(await serviceReceipts.recover(activeNonce), 'PENDING');
          if (failBeforeCommit) throw new Error('handler transaction rolled back');
        });
        throw new Error('commit acknowledgement lost');
      } };
    } },
    tenantRepository: repository,
    jobContextPort: { async resolveOrganizationContext() { return {}; } },
    continuationPort: { async enqueue() { throw new Error('unexpected continuation'); } },
  });
  if (configuredF4) {
    const publishedWorker = await configuredF4.directoryRepository.resolveSnapshotByOrganization(org, 'WORKER');
    for (const code of ['OPPORTUNITY_DUPLICATE_SCAN_JOB', 'OPPORTUNITY_CATALOG_RECONCILE_JOB']) {
      const operation = composition.operations.catalog.resolveAdapter(composition.operations.adapters[code]);
      assert.equal(snapshotEligible(publishedWorker, org, operation, configuredF4.regionPolicy), true);
    }
  }
  for (const jobType of [reconcile, job, reconcile]) {
    currentExecution = randomUUID();
    const scan = jobType === job;
    const { envelope, contentDigest } = createEnvelopeV2({
      trustedContext: { organizationId: org, actor: { kind: 'SERVICE',
        serviceActorCode: scan ? 'F12_DUPLICATE_SCANNER' : 'F12_CATALOG_RECONCILER' },
      operation: jobType, correlationId: randomUUID(), causationId: randomUUID() },
      job: { type: jobType, version: 1, payloadVersion: 1, idempotencyKey: currentExecution },
      payload: { opportunityId: randomUUID(), revisionId: randomUUID(),
        ...(scan ? { ruleVersion: 'opportunity-deduplication-v1' } : { reasonCode: 'QUALITY_PROJECTION_DRIFT' }) },
      registry: composition.jobs, observability: createTrustedObservability({ traceparent: null, tracestate: null }),
      id: () => currentExecution
    });
    await assert.rejects(composition.jobs.resolve(jobType).handler(envelope),
      failBeforeCommit ? /handler transaction rolled back/ : /commit acknowledgement lost/);
    const receipts = await tenant.query('SELECT content_digest FROM f12_service_receipts.effect_receipt WHERE transaction_id=$1', [activeNonce]);
    assert.deepEqual(receipts.rows, failBeforeCommit ? [] : [{ content_digest: contentDigest }]);
    const expected = failBeforeCommit ? 'ROLLED_BACK' : 'COMMITTED';
    simulateDrift = true;
    const unavailable = await composition.receiptRecovery();
    assert.deepEqual(unavailable.results, [{ nonce: activeNonce, state: 'UNAVAILABLE' }]);
    simulateDrift = false;
    if (recovery !== central && failBeforeCommit) {
      let tick;
      const service = createF12ReceiptRecoveryService({
        central: recovery, tenantRuntimeDependencies: receiptRuntimeDependencies.tenantRuntimeDependencies,
        scheduler: { setTimeout(work) { tick = work; return 1; }, clearTimeout() { tick = null; } }
      });
      await service.ready();
      assert.equal(typeof tick, 'function');
      const run = tick;
      tick = null;
      run();
      await service.close();
      assert.equal(tick, null);
      assert.equal((await central.query('SELECT state FROM f12_service_authority.commit_guard WHERE transaction_id=$1',
        [activeNonce])).rows[0].state, expected);
    } else {
      assert.deepEqual((await composition.receiptRecovery()).results, [{ nonce: activeNonce, state: expected }]);
    }
    assert.equal(await serviceReceipts.recover(activeNonce), expected);
    if (!scan) assert.equal((await tenant.query('SELECT 1 FROM public.synthetic_effect WHERE transaction_id=$1',
      [currentExecution])).rowCount, failBeforeCommit ? 0 : 1);
    failBeforeCommit = scan;
  }
}

async function prove() {
  let central, tenant;
  try {
    const actual = (await admin.query('SHOW data_directory')).rows[0].data_directory;
    const expected = path.resolve(__dirname, '../../.tmp/capacity-proof-pg-20261110');
    assert.equal(path.resolve(actual).toLowerCase(), expected.toLowerCase());
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='c4g_tenant_owner') THEN
        CREATE ROLE c4g_tenant_owner NOLOGIN NOINHERIT;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='c4g_tenant_runtime') THEN
        CREATE ROLE c4g_tenant_runtime NOLOGIN NOINHERIT;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='c4g_central_owner') THEN
        CREATE ROLE c4g_central_owner NOLOGIN NOINHERIT;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='c4g_central_runtime') THEN
        CREATE ROLE c4g_central_runtime NOLOGIN NOINHERIT;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='c4g_opportunity_tenant_runtime') THEN
        CREATE ROLE c4g_opportunity_tenant_runtime NOLOGIN NOINHERIT;
      END IF;
    END $$;`);
    central = await openDatabase();
    tenant = await openDatabase();
    await central.query(`CREATE TABLE public.organization(id uuid PRIMARY KEY);
      CREATE TABLE public.tenant(tenant_id uuid PRIMARY KEY, organization_id uuid NOT NULL, UNIQUE(tenant_id, organization_id));
      CREATE TABLE public.tenant_database_generation(database_generation_id uuid PRIMARY KEY, tenant_id uuid NOT NULL, retired_at timestamptz);`);
    await central.query(sql('central/candidates/f12_service_authority.up.sql'));
    await tenant.query(sql('tenant/migrations/000_tenant_control_baseline.up.sql'));
    await tenant.query(sql('tenant/candidates/f12_service_receipt.up.sql'));
    await assert.rejects(transaction(tenant, async client => {
      await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
      await client.query('SELECT * FROM f12_service_receipts.effect_receipt');
    }), { code: '42501' });
    await tenant.query('CREATE TABLE public.synthetic_effect(transaction_id uuid PRIMARY KEY)');

    const [org, tenantId, generation, nonce, execution] = Array.from({ length: 5 }, () => randomUUID());
    const digest = 'a'.repeat(64);
    await central.query('INSERT INTO public.organization VALUES ($1)', [org]);
    await central.query('INSERT INTO public.tenant VALUES ($1,$2)', [tenantId, org]);
    await central.query('INSERT INTO public.tenant_database_generation VALUES ($1,$2)', [generation, tenantId]);
    await central.query('INSERT INTO f12_service_authority.service_grant(organization_id,job_type,active) VALUES ($1,$2,true)', [org, job]);
    await tenant.query(`INSERT INTO c4g_system.tenant_identity(singleton_key,product_code,database_role,marker_format_version,tenant_id,database_generation_id,identity_revision)
      VALUES(true,'C4G','TENANT',1,$1,$2,1)`, [tenantId, generation]);
    const args = [nonce, org, tenantId, generation, job, 1, execution, digest];
    const prepare = `INSERT INTO f12_service_authority.commit_guard
      (transaction_id,organization_id,tenant_id,database_generation_id,job_type,grant_version,execution_id,content_digest)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`;
    const revoke = `UPDATE f12_service_authority.service_grant SET version=version+1,active=false
      WHERE organization_id=$1 AND job_type=$2`;
    const receipt = `INSERT INTO f12_service_receipts.effect_receipt
      (transaction_id,organization_id,tenant_id,database_generation_id,job_type,grant_version,execution_id,content_digest)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`;

    const otherOrg = randomUUID();
    await central.query('INSERT INTO public.organization VALUES ($1)', [otherOrg]);
    await central.query('INSERT INTO f12_service_authority.service_grant(organization_id,job_type,active) VALUES ($1,$2,true)', [otherOrg, job]);
    await assert.rejects(central.query(prepare, [nonce, otherOrg, ...args.slice(2)]), { code: '23503' });
    await assert.rejects(transaction(central, async client => {
      await client.query('SET LOCAL ROLE c4g_central_runtime');
      await client.query(prepare, args);
    }), { code: '42501' });

    const writer = await central.connect();
    const revoker = await central.connect();
    try {
      await writer.query('BEGIN');
      await writer.query(prepare, args);
      const pid = (await revoker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pending = assert.rejects(revoker.query(revoke, [org, job]), /F12_SERVICE_GUARD_PENDING/);
      pending.catch(() => {});
      const deadline = Date.now() + 3000;
      for (;;) {
        const { blocked } = (await writer.query('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid])).rows[0];
        if (blocked) break;
        assert.ok(Date.now() < deadline, 'revocation should wait for preparation');
        await delay(20);
      }
      await writer.query('COMMIT');
      await pending;
    } finally {
      await writer.query('ROLLBACK');
      writer.release();
      revoker.release();
    }

    await assert.rejects(tenant.query(receipt, [nonce, org, tenantId, randomUUID(), job, 1, execution, digest]), /F12_RECEIPT_TENANT_MISMATCH/);
    await assert.rejects(transaction(tenant, async client => {
      await client.query('INSERT INTO public.synthetic_effect VALUES ($1)', [nonce]);
      await client.query(receipt, args);
      throw new Error('synthetic rollback');
    }), /synthetic rollback/);
    assert.equal((await tenant.query('SELECT 1 FROM f12_service_receipts.effect_receipt')).rowCount, 0);
    assert.equal((await tenant.query('SELECT 1 FROM public.synthetic_effect')).rowCount, 0);
    await assert.rejects(transaction(tenant, async client => {
      await client.query('SET LOCAL ROLE c4g_tenant_runtime');
      await client.query(receipt, args);
    }), { code: '42501' });
    await transaction(tenant, async client => {
      await client.query('INSERT INTO public.synthetic_effect VALUES ($1)', [nonce]);
      await client.query(receipt, args);
    });
    await central.query("UPDATE f12_service_authority.commit_guard SET state='UNKNOWN' WHERE transaction_id=$1", [nonce]);
    await assert.rejects(central.query(revoke, [org, job]), /F12_SERVICE_GUARD_PENDING/);
    assert.equal((await central.query(revoke, [otherOrg, job])).rowCount, 1);
    const observed = (await tenant.query('SELECT * FROM f12_service_receipts.effect_receipt WHERE transaction_id=$1', [nonce])).rows[0];
    assert.deepEqual([observed.transaction_id, observed.organization_id, observed.tenant_id, observed.database_generation_id,
      observed.job_type, Number(observed.grant_version), observed.execution_id, observed.content_digest], args);
    await assert.rejects(tenant.query('DELETE FROM f12_service_receipts.effect_receipt'), /F12_RECEIPT_IMMUTABLE/);
    // Only the isolated harness resolves this guard. Runtime recovery is absent.
    await central.query("UPDATE f12_service_authority.commit_guard SET state='COMMITTED' WHERE transaction_id=$1", [nonce]);
    await proveHandlerRecovery(central, tenant, org);
    await central.query(revoke, [org, job]);
    await assert.rejects(central.query(prepare, [randomUUID(), ...args.slice(1)]), /F12_GRANT_STALE/);
    console.log('PASS: preparation/revocation race, unresolved commit, receipt rollback, tenant binding, organization isolation, runtime writes denied and stale grant denied');
  } finally {
    await Promise.all([central?.end(), tenant?.end(), admin.end()]);
  }
}

async function proveCumulative() {
  const url = new URL(process.env.F12_GATE_URL);
  if (url.hostname !== '127.0.0.1' || url.port !== '5547' || url.username !== 'c4g_f12_admin' || url.pathname !== '/postgres') {
    throw new Error('ISOLATED_F12_GATE_REQUIRED');
  }
  const open = name => {
    const target = new URL(url);
    target.pathname = '/' + name;
    return new Pool({ connectionString: target.href });
  };
  const central = open('f12_synthetic_central');
  const tenant = open('f12_synthetic_tenant_a');
  const limited = [];
  let configuredF4;
  try {
    const { manifest: centralManifest } = require('../src/security/centralMigrationManifest');
    const { manifest: tenantManifest } = require('../src/security/tenantMigrationManifest');
    const centralLedger = (await central.query('SELECT version FROM public.c4g_schema_migration ORDER BY version')).rows;
    assert.deepEqual(centralLedger.map(row => row.version), centralManifest.map(entry => entry.version));
    const tenantLedger = (await tenant.query('SELECT migration_id FROM c4g_system.schema_migration ORDER BY ordinal')).rows;
    assert.deepEqual(tenantLedger.map(row => row.migration_id), tenantManifest.map(entry => entry.version));
    const { tenant_id: id, database_generation_id: generation } =
      (await tenant.query('SELECT tenant_id, database_generation_id FROM c4g_system.tenant_identity')).rows[0];
    const existing = (await central.query('SELECT organization_id FROM public.tenant WHERE tenant_id=$1', [id])).rows[0];
    const org = existing?.organization_id || id;
    await central.query(`INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code)
      VALUES($1,'Synthetic Receipt','Synthetic Receipt','f12-receipt-test','SYNTHETIC','ACTIVE','EUR','MFA_REQUIRED')
      ON CONFLICT (id) DO NOTHING`, [org]);
    await central.query(`INSERT INTO public.tenant(tenant_id,organization_id,deployment_mode)
      VALUES($1,$2,'DATABASE_PER_ORGANIZATION') ON CONFLICT(tenant_id) DO NOTHING`, [id, org]);
    await central.query(`INSERT INTO public.tenant_database_generation(database_generation_id,tenant_id,database_ref)
      VALUES($1,$2,'f12-receipt-test') ON CONFLICT(database_generation_id) DO NOTHING`, [generation, id]);
    assert.deepEqual(await applyRegisteredF12ReceiptPackage(central), ['036_f12_service_authority']);
    assert.deepEqual(await applyRegisteredF12ReceiptPackage(central), []);
    assert.equal((await preflightCentral(central)).currentVersion, '036_f12_service_authority');
    const apiLogin = 'f12_api_' + randomUUID().replaceAll('-', '');
    const workerLogin = 'f12_worker_' + randomUUID().replaceAll('-', '');
    const apiPassword = randomUUID().replaceAll('-', '');
    const workerPassword = randomUUID().replaceAll('-', '');
    const provisioner = await createLocalTenantIdentityProvisioner(tenant);
    await provisioner.reconcile({ apiLogin, apiPassword, workerLogin, workerPassword,
      apiRoles: ['c4g_opportunity_tenant_runtime'] });
    await central.query('INSERT INTO public.tenant_schema_state(tenant_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
    const revision = Number((await central.query('SELECT revision FROM public.tenant_schema_state WHERE tenant_id=$1', [id])).rows[0].revision);
    const migration = createF12ReceiptTenantMigrationRunner({ pool: tenant, timeoutMs: 10000,
      scheduler: { setTimeout, clearTimeout },
      observationPublisher: createTenantSchemaObservationPublisher(createTenantSchemaRepository(central)) });
    const request = { tenantId: id, databaseGenerationId: generation, expectedRevision: revision,
      correlationId: randomUUID(), idempotencyKey: 'receipt-migration' };
    const migrated = await migration.migrate(request);
    assert.equal(migrated.evidence.currentVersion, '034_f12_service_receipt');
    assert.deepEqual((await migration.migrate(request)).appliedVersions, []);
    await tenant.query('CREATE TABLE public.synthetic_effect(transaction_id uuid PRIMARY KEY)');
    await central.query('INSERT INTO f12_service_authority.service_grant(organization_id,job_type,active) VALUES ($1,$2,true)', [org, job]);
    await assert.rejects(transaction(tenant, async client => {
      await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
      await client.query('SELECT * FROM f12_service_receipts.effect_receipt');
    }), { code: '42501' });
    async function login(role) {
      assert.ok(['c4g_f12_guard_issuer', 'c4g_f12_guard_recovery',
        'c4g_f12_worker_directory', 'c4g_f12_worker_queue', 'c4g_f12_capacity_replay'].includes(role));
      const name = 'f12_proof_' + randomUUID().replaceAll('-', '');
      const password = randomUUID().replaceAll('-', '');
      await central.query(`CREATE ROLE ${name} LOGIN NOINHERIT PASSWORD '${password}'`);
      await central.query(`GRANT ${role} TO ${name} WITH INHERIT TRUE, SET FALSE, ADMIN FALSE`);
      await central.query(`GRANT CONNECT ON DATABASE f12_synthetic_central TO ${name}`);
      const target = new URL(url);
      target.pathname = '/f12_synthetic_central';
      target.username = name;
      target.password = password;
      const pool = new Pool({ connectionString: target.href });
      limited.push(pool);
      return pool;
    }
    const issuer = await login('c4g_f12_guard_issuer');
    const recovery = await login('c4g_f12_guard_recovery');
    await assert.rejects(issuer.query("UPDATE f12_service_authority.commit_guard SET state='COMMITTED'"), { code: '42501' });
    await assert.rejects(recovery.query('SELECT * FROM f12_service_authority.service_grant'), { code: '42501' });
    await assert.rejects(recovery.query('UPDATE f12_service_authority.commit_guard SET content_digest=NULL'), { code: '42501' });
    await tenant.query(sql('tenant/provisioning/f12_opportunity_transport.sql'));
    await provisioner.reconcile({ apiLogin, apiPassword, workerLogin, workerPassword,
      apiRoles: ['c4g_opportunity_tenant_runtime'], workerRoles: workerRoles.filter(role => role !== 'c4g_f4_metadata_executor') });
    await configureLocalTenantDatabaseConnect(tenant, { database: 'f12_synthetic_tenant_a',
      authorizedLogins: [apiLogin, workerLogin], knownLogins: [apiLogin, workerLogin],
      migratorRoles: ['c4g_tenant_migrator'] });
    await tenant.query('GRANT USAGE ON SCHEMA public TO c4g_opportunity_tenant_runtime');
    await tenant.query('GRANT INSERT ON public.synthetic_effect TO c4g_opportunity_tenant_runtime');
    function openTenantLogin(username, password) {
      const target = new URL(url);
      target.pathname = '/f12_synthetic_tenant_a';
      target.username = username;
      target.password = password;
      const pool = new Pool({ connectionString: target.href });
      limited.push(pool);
      return pool;
    }
    const tenantWriter = openTenantLogin(workerLogin, workerPassword);
    const tenantReader = openTenantLogin(apiLogin, apiPassword);
    await validateLocalTenantRoleChain(tenantWriter, { login: workerLogin, workload: 'WORKER',
      functionalRoles: workerRoles });
    await assert.rejects(transaction(tenantWriter, async client => {
      await client.query(`SET LOCAL ROLE ${transportRole}`);
      await client.query('DELETE FROM async_exec.inbox WHERE false');
    }), { code: '42501' });
    await validateLocalTenantRoleChain(tenantReader, { login: apiLogin, workload: 'API',
      functionalRoles: ['c4g_opportunity_tenant_runtime', 'c4g_f4_metadata_executor'] });
    const admitted = await transaction(tenantReader, client =>
      observeTenantRuntimeMetadata(client, { tenantId: id, databaseGenerationId: generation }));
    assert.equal(admitted.currentVersion, '034_f12_service_receipt');
    assert.ok(admitted.capabilities.includes('F12_SERVICE_RECEIPTS'));
    await assert.rejects(transaction(tenantWriter, async client => {
      await client.query('SET LOCAL ROLE c4g_f12_receipt_issuer');
      await client.query('SELECT transaction_id FROM f12_service_receipts.effect_receipt');
    }), { code: '42501' });
    const connectionVersion = Number((await central.query(`SELECT GREATEST(
      COALESCE((SELECT MAX(connection_version) FROM public.organization_connection_version WHERE tenant_id=$1),0),
      COALESCE((SELECT MAX(connection_version) FROM public.tenant_workload_connection_version WHERE tenant_id=$1),0)
    ) + 1 AS next`, [id])).rows[0].next);
    const credential = { tenantId: id, credentialRef: 'f12-receipt-test', connectionVersion,
      host: url.hostname, port: Number(url.port), database: 'f12_synthetic_tenant_a', login: apiLogin,
      password: apiPassword, ssl: false };
    configuredF4 = require('../src/config/opportunityRuntime').createConfiguredOpportunityRuntime({
      centralPool: central, env: { OPPORTUNITY_API_CREDENTIALS_JSON: JSON.stringify([credential]),
        OPPORTUNITY_ALLOWED_RESIDENCY_JSON: JSON.stringify([{ regionCode: 'EU_TEST', policyVersion: 'v1' }]) }
    });
    const bindingDigest = require('../src/security/localTenantCredentialAdapter').bindingDigest({ ...credential, workload: 'API' });
    const databaseRef = (await central.query('SELECT database_ref FROM public.tenant_database_generation WHERE database_generation_id=$1',
      [generation])).rows[0].database_ref;
    await central.query(`INSERT INTO public.organization_connection_version(tenant_id,connection_version,deployment_mode,
      database_generation_id,database_ref,credential_ref,region_code,residency_policy_version,version_state)
      VALUES ($1,$2,'DATABASE_PER_ORGANIZATION',$3,$4,$5,'EU_TEST','v1','CANDIDATE')`,
    [id, connectionVersion, generation, databaseRef, credential.credentialRef]);
    await createTenantConnectionRepository(central).validateVersion({ tenantId: id, connectionVersion,
      observedSystemIdentifier: admitted.systemIdentifier, bindingDigest, correlationId: randomUUID(),
      idempotencyKey: 'receipt-connection' });
    const directory = createTenantWorkloadDirectoryRepository(central);
    const workerCredential = { ...credential, login: workerLogin, password: workerPassword,
      credentialRef: 'f12-receipt-worker-test', workload: 'WORKER' };
    const workerDigest = require('../src/security/localTenantCredentialAdapter').bindingDigest(workerCredential);
    for (const candidate of [
      { tenantId: id, workload: 'API', connectionVersion, credentialRef: credential.credentialRef, bindingDigest },
      { tenantId: id, workload: 'WORKER', connectionVersion, credentialRef: workerCredential.credentialRef, bindingDigest: workerDigest }
    ]) {
      const current = await directory.resolvePublished({ tenantId: id, workload: candidate.workload });
      await directory.createCandidate(candidate);
      await directory.validateCandidate({ ...candidate, compatibilityStatus: 'COMPATIBLE', provisioningStatus: 'READY' });
      await directory.publishCandidate({ ...candidate, expectedFence: current?.fence ?? 0,
        expectedCurrentVersion: current?.connectionVersion ?? null });
    }
    const published = await configuredF4.directoryRepository.resolveSnapshotByOrganization(org, 'API');
    assert.equal(published.schema.currentVersion, admitted.currentVersion);
    assert.equal(published.schema.schemaFingerprint, admitted.schemaFingerprint);
    assert.equal(published.schema.revision, revision + 1);
    assert.equal(published.schema.verifiedCapabilities.F12_SERVICE_RECEIPTS, true);
    assert.equal(published.databaseGenerationId, generation);
    const publishedWorker = await configuredF4.directoryRepository.resolveSnapshotByOrganization(org, 'WORKER');
    assert.equal(publishedWorker.bindingDigest, workerDigest);
    assert.equal(publishedWorker.databaseGenerationId, generation);
    await proveHandlerRecovery(central, tenant, org, { issuer, recovery, tenantWriter, tenantReader,
      configuredF4, credentialRef: credential.credentialRef, bindingDigest });
    const { workload: ignoredWorkload, ...workerEntry } = workerCredential;
    await central.query(sql('central/provisioning/f12_opportunity_worker.sql'));
    const directoryLogin = await login('c4g_f12_worker_directory');
    const queueLogin = await login('c4g_f12_worker_queue');
    await assert.rejects(directoryLogin.query('DELETE FROM async_exec.execution WHERE false'), { code: '42501' });
    await assert.rejects(queueLogin.query('SELECT * FROM f12_service_authority.commit_guard'), { code: '42501' });
    const workerEnv = {
      CENTRAL_DATABASE_URL: directoryLogin.options.connectionString,
      F12_OPPORTUNITY_QUEUE_DATABASE_URL: queueLogin.options.connectionString,
      F12_RECEIPT_ISSUER_DATABASE_URL: issuer.options.connectionString,
      F12_RECEIPT_RECOVERY_DATABASE_URL: recovery.options.connectionString,
      F12_OPPORTUNITY_WORKER_ORGANIZATION_ID: org,
      OPPORTUNITY_API_CREDENTIALS_JSON: JSON.stringify([credential]),
      F12_OPPORTUNITY_WORKER_CREDENTIALS_JSON: JSON.stringify([workerEntry]),
      OPPORTUNITY_ALLOWED_RESIDENCY_JSON: JSON.stringify([{ regionCode: 'EU_TEST', policyVersion: 'v1' }])
    };
    const otherSource = await proveQueueRecovery(central, tenant, workerEnv, org);
    const replaySource = await proveQueueRecovery(central, tenant, workerEnv, org, true);
    assert.deepEqual(await applyRegisteredF12ReplayCapacityPackage(central), ['037_f12_replay_capacity']);
    assert.deepEqual(await applyRegisteredF12ReplayCapacityPackage(central), []);
    assert.equal((await preflightCentral(central)).currentVersion, '037_f12_replay_capacity');
    const replayLogin = await login('c4g_f12_capacity_replay');
    await proveReplayCapacity(central, tenant, workerEnv, replaySource, otherSource, id, replayLogin, recovery);
    console.log('PASS: registered Central and tenant migrations, full F4 admission and receipt recovery with limited logins.');
  } finally {
    await Promise.all([central.end(), tenant.end(), admin.end(), configuredF4?.poolManager.closeAll(),
      ...limited.map(pool => pool.end())]);
  }
}

(crashChild ? crashWorkerAtCommit(workerData.env) : cumulative ? proveCumulative() : prove())
  .catch(error => { console.error(error); process.exitCode = 1; });
