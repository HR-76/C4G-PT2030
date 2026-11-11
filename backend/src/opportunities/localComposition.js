'use strict';

const { createOpportunityJobRegistry, SERVICE_ACTORS } = require('./jobs');
const { createF12TenantOperations } = require('./tenantOperations');
const { createF12TenantLeaseAdapters } = require('./tenantLeaseAdapters');
const { createCatalogReconcileOrchestration, createDuplicateScanOrchestration } = require('./jobOrchestration');
const { createReplayService } = require('../async/replayService');
const { V2_KEYS, validateEnvelope } = require('../async/envelope');
const { createF12ReceiptRuntime } = require('./f12ReceiptRuntime');

function required(value, method, label) {
  if (!value || typeof value[method] !== 'function') throw new TypeError(`${label} is invalid.`);
}

function persistenceContext(trustedContext) {
  const actor = trustedContext?.actor;
  if (!actor || !['HUMAN', 'SERVICE'].includes(actor.type) || typeof actor.id !== 'string') {
    throw new TypeError('F12 trusted execution context is invalid.');
  }
  return Object.freeze({
    actor: Object.freeze({ type: actor.type, reference: actor.id }),
    audit: Object.freeze({
      membershipId: actor.membershipId || null,
      correlationId: trustedContext.correlationId,
      causationId: null,
    }),
  });
}

function unwrap(invocation) {
  if (!invocation || Object.getPrototypeOf(invocation) !== Object.prototype
      || Reflect.ownKeys(invocation).length !== 2
      || !Object.hasOwn(invocation, 'payload') || !Object.hasOwn(invocation, 'trustedContext')) {
    throw new TypeError('F12 operation invocation is invalid.');
  }
  return invocation;
}

function createRepositoryHandlers(repository, orchestration, serviceReceipts, jobDigests) {
  required(repository, 'withTransactionClient', 'F12 tenant repository');
  const execute = (client, invocation, work) => {
    const checked = unwrap(invocation);
    return repository.withTransactionClient(client, () => work(
      checked.payload,
      persistenceContext(checked.trustedContext),
    ));
  };
  const executeJob = (client, input, job) => execute(client, input, (payload, context) => {
    if (!serviceReceipts) return job.execute(payload.execution, context, client);
    const actor = input.trustedContext.actor;
    const validated = jobDigests.get(actor);
    if (!validated) throw new Error('F12_RECEIPT_EXECUTION_MISMATCH');
    const { envelope, rootExecutionId, terminalExecutionId } = validated;
    const execution = { ...payload.execution, actorCode: actor.id, executionId: envelope.executionId,
      correlationId: envelope.correlationId, deadlineAt: envelope.deadlineAt, idempotencyKey: envelope.idempotencyKey,
      payload: envelope.payload, contentDigest: validated.contentDigest, rootExecutionId, terminalExecutionId };
    return serviceReceipts.execute(client, { actor, execution }, () => job.execute(execution, context, client));
  });
  return Object.freeze({
    OPPORTUNITY_PRIVATE_CREATE: ({ client, input }) => execute(client, input,
      (payload, context) => repository.create(payload, context)),
    OPPORTUNITY_PRIVATE_GET: ({ client, input }) => execute(client, input,
      (payload) => repository.get(payload.opportunityId)),
    OPPORTUNITY_PRIVATE_LIST: ({ client, input }) => execute(client, input,
      (payload) => repository.list(payload)),
    OPPORTUNITY_PRIVATE_UPDATE: ({ client, input }) => execute(client, input,
      (payload, context) => repository.update(payload, context)),
    OPPORTUNITY_PRIVATE_ARCHIVE: ({ client, input }) => execute(client, input,
      (payload, context) => repository.changeLifecycle({ ...payload, action: 'ARCHIVE' }, context)),
    OPPORTUNITY_PRIVATE_RESTORE: ({ client, input }) => execute(client, input,
      (payload, context) => repository.changeLifecycle({ ...payload, action: 'RESTORE' }, context)),
    OPPORTUNITY_DUPLICATE_REVIEW: ({ client, input }) => execute(client, input,
      (payload, context) => repository.recordCandidate(payload, context)),
    OPPORTUNITY_DUPLICATE_SCAN_JOB: ({ client, input }) => executeJob(client, input, orchestration.duplicateScan),
    OPPORTUNITY_CATALOG_RECONCILE_JOB: ({ client, input }) => executeJob(client, input, orchestration.catalogReconcile),
    OPPORTUNITY_DOCUMENT_BIND: ({ client, input }) => execute(client, input,
      (payload, context) => repository.bindDocument(payload, context)),
  });
}

function serviceActor(code, operationCode, envelope, authorizationVersion) {
  return Object.freeze({
    type: 'SERVICE',
    id: code,
    organizationId: envelope.organizationId,
    membershipId: null,
    membershipVersion: 1,
    authorizationVersion,
    operationCode,
    executionId: envelope.executionId,
    jobType: envelope.jobType,
  });
}

function createF12LocalComposition({ authorization, authorizationOperationCatalog, tenantRuntime,
  tenantRepository, jobContextPort, continuationPort, scanIntentPort = continuationPort, telemetry = null,
  replay = null, serviceReceipts = null, receiptRuntimeDependencies = null, createTenantRuntime = null,
  resolveReceiptExecution = null }) {
  required(authorization, 'authorize', 'F12 authorization service');
  if (createTenantRuntime !== null && (tenantRuntime || typeof createTenantRuntime !== 'function')) {
    throw new TypeError('Configure a single F12 tenant runtime.');
  }
  required(jobContextPort, 'resolveOrganizationContext', 'F12 job context port');
  if (receiptRuntimeDependencies) {
    if (serviceReceipts) throw new TypeError('Configure a single F12 receipt runtime.');
    serviceReceipts = createF12ReceiptRuntime(receiptRuntimeDependencies);
  }
  const jobDigests = new WeakMap();
  if (serviceReceipts) {
    required(serviceReceipts, 'execute', 'F12 service receipts');
    required(serviceReceipts, 'loadVersion', 'F12 service grants');
  }
  const orchestration = Object.freeze({
    duplicateScan: createDuplicateScanOrchestration({ repository: tenantRepository, continuationPort }),
    catalogReconcile: createCatalogReconcileOrchestration({ repository: tenantRepository, scanIntentPort })
  });
  const operations = createF12TenantOperations({
    handlers: createRepositoryHandlers(tenantRepository, orchestration, serviceReceipts, jobDigests),
    authorizationOperationCatalog,
    serviceReceiptsEnabled: Boolean(receiptRuntimeDependencies),
  });
  tenantRuntime ||= createTenantRuntime?.({ operationCatalog: operations.catalog });
  required(tenantRuntime, 'resolve', 'F12 tenant runtime');
  const adapters = createF12TenantLeaseAdapters({ authorization, resolver: tenantRuntime, operations });
  const observed = (execution, work) => telemetry ? telemetry.run({ name: 'execute opportunity job', kind: 1, envelope: execution }, work) : work();
  async function jobActor(jobType, execution) {
    const { code, operation } = SERVICE_ACTORS[jobType];
    if (!serviceReceipts) return serviceActor(code, operation, execution, 1);
    const envelope = Object.fromEntries(V2_KEYS.map(key => [key, execution[key]]));
    const validated = validateEnvelope(envelope, jobs);
    if (validated.envelope.jobType !== jobType) throw new Error('F12_RECEIPT_EXECUTION_MISMATCH');
    const version = await serviceReceipts.loadVersion(validated.envelope.organizationId, jobType);
    const actor = serviceActor(code, operation, validated.envelope, version);
    const terminalExecutionId = resolveReceiptExecution ? await resolveReceiptExecution(validated.envelope.executionId,
      execution.rootExecutionId, validated.envelope.organizationId, jobType, validated.contentDigest) : null;
    jobDigests.set(actor, { ...validated, rootExecutionId: execution.rootExecutionId, terminalExecutionId });
    return actor;
  }
  const jobs = createOpportunityJobRegistry(Object.freeze({
    'opportunity.duplicate.scan': async (execution) => observed(execution, async () => adapters.runDuplicateScan({
      actor: await jobActor('opportunity.duplicate.scan', execution),
      resourceId: execution.payload.opportunityId,
      assuranceEvidence: null,
      correlationId: execution.correlationId,
      organizationContext: await jobContextPort.resolveOrganizationContext(execution.organizationId, execution, 'opportunity.duplicate.scan'),
      payload: Object.freeze({ execution: Object.freeze({ actorCode: 'F12_DUPLICATE_SCANNER',
        idempotencyKey: execution.idempotencyKey, executionId: execution.executionId,
        correlationId: execution.correlationId, deadlineAt: execution.deadlineAt,
        attempt: execution.attempt || 1, root: !execution.idempotencyKey.startsWith('f12ds1.'),
        payload: execution.payload }) }),
    })),
    'opportunity.catalog.reconcile': async (execution) => observed(execution, async () => adapters.runCatalogReconcile({
      actor: await jobActor('opportunity.catalog.reconcile', execution),
      resourceId: execution.payload.opportunityId,
      assuranceEvidence: null,
      correlationId: execution.correlationId,
      organizationContext: await jobContextPort.resolveOrganizationContext(execution.organizationId, execution, 'opportunity.catalog.reconcile'),
      payload: Object.freeze({ execution: Object.freeze({ actorCode: 'F12_CATALOG_RECONCILER',
        idempotencyKey: execution.idempotencyKey, executionId: execution.executionId,
        correlationId: execution.correlationId, deadlineAt: execution.deadlineAt,
        attempt: execution.attempt || 1, payload: execution.payload }) }),
    })),
  }));
  const replayService = replay === null ? null : createReplayService({
    authorization,
    repository: replay.repository,
    centralTransaction: replay.centralTransaction,
    tenantLocator: replay.tenantLocator,
    tenantReplayPort: replay.tenantReplayPort,
    registry: jobs,
    clock: replay.clock,
    id: replay.id,
    observabilityFactory: replay.observabilityFactory,
    policyVersion: replay.policyVersion,
    capacity: replay.capacity,
  });
  return Object.freeze({ adapters, jobs, operations, orchestration, replayService,
    receiptRecovery: receiptRuntimeDependencies ? serviceReceipts.recoverPending : null });
}

module.exports = { createF12LocalComposition };
