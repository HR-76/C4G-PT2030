const { tenantFailure, aggregateCleanup } = require('./tenantRuntimeErrors');
const { sameSnapshot } = require('./tenantLeaseExecutor');
const { types: { isProxy } } = require('node:util');

const INPUT_KEYS = Object.freeze(['correlationId', 'operationAdapter', 'organizationContext']);
const CONTEXT_KEYS = Object.freeze(['membershipId', 'membershipVersion', 'organizationId']);

function closedObject(value, keys) {
  if (!value || typeof value !== 'object' || isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length
    && keys.every(key => descriptors[key] && descriptors[key].enumerable && 'value' in descriptors[key]);
}

function capabilitiesAllow(snapshot, required) {
  const capabilities = snapshot.schema.verifiedCapabilities;
  return capabilities && Object.getPrototypeOf(capabilities) === Object.prototype
    && required.every(code => capabilities[code] === true);
}

function operationAllowsSnapshot(snapshot, operation) {
  const state = snapshot.schema.compatibilityState;
  const { receiptManifest, failureReceiptManifest, assignedReviewManifest, applicationChatManifest, organizationStrategyManifest, applicationTaskDetailsManifest, documentDeletionManifest } = require('./tenantMigrationManifest');
  const assignment = assignedReviewManifest.at(-1);
  const chat = applicationChatManifest.at(-1);
  const strategy = organizationStrategyManifest.at(-1);
  const taskDetails = applicationTaskDetailsManifest.at(-1);
  const deletion = documentDeletionManifest.at(-1);
  const current = snapshot.schema.currentVersion;
  const currentEntry = [chat, strategy, taskDetails, deletion].find(entry => entry.version === current);
  const receipt = [receiptManifest.at(-1), failureReceiptManifest.at(-1)]
    .find(entry => entry.version === snapshot.schema.currentVersion);
  const compatibleVersion = receipt
    ? snapshot.schema.schemaFingerprint === receipt.schemaFingerprint
      && snapshot.schema.verifiedCapabilities?.F12_SERVICE_RECEIPTS === true
      && (operation.compatibleSchemaVersions.includes(receipt.version)
        || operation.compatibleSchemaVersions.includes(receiptManifest.at(-2).version)
        || (receipt === failureReceiptManifest.at(-1) && operation.compatibleSchemaVersions.includes(receiptManifest.at(-1).version)))
    : currentEntry
      ? snapshot.schema.schemaFingerprint === currentEntry.schemaFingerprint
        && snapshot.schema.verifiedCapabilities?.APPLICATION_TEAM_CHAT === true
        && (currentEntry === chat || snapshot.schema.verifiedCapabilities?.ORGANIZATION_STRATEGY === true)
        && (currentEntry !== taskDetails && currentEntry !== deletion || snapshot.schema.verifiedCapabilities?.APPLICATION_TASK_DETAILS === true)
        && (currentEntry !== deletion || snapshot.schema.verifiedCapabilities?.DOCUMENT_DELETION === true)
        && [current, ...(currentEntry === taskDetails || currentEntry === deletion ? [strategy.version] : []), chat.version, assignment.version, assignedReviewManifest.at(-2).version]
          .some(version => operation.compatibleSchemaVersions.includes(version))
    : snapshot.schema.currentVersion === assignment.version
      ? snapshot.schema.schemaFingerprint === assignment.schemaFingerprint
        && snapshot.schema.verifiedCapabilities?.APPLICATION_REVIEW_ASSIGNMENTS === true
        && (operation.compatibleSchemaVersions.includes(assignment.version)
          || operation.compatibleSchemaVersions.includes(assignedReviewManifest.at(-2).version))
      : operation.compatibleSchemaVersions.includes(snapshot.schema.currentVersion);
  return compatibleVersion
    && operation.allowedCompatibilityStates.includes(state)
    && (state !== 'READ_ONLY' || (operation.readOnlyEligible === true && operation.accessMode === 'READ'));
}

function snapshotEligible(snapshot, organizationId, operation, regionPolicy) {
  return snapshot && snapshot.organizationId === organizationId
    && snapshot.workload === operation.workload
    && typeof snapshot.tenantId === 'string'
    && snapshot.deploymentMode === 'DATABASE_PER_ORGANIZATION'
    && snapshot.provisioningStatus === 'READY'
    && snapshot.connectionState === 'AVAILABLE'
    && Number.isSafeInteger(snapshot.connectionVersion) && snapshot.connectionVersion > 0
    && Number.isSafeInteger(snapshot.connectionRevision) && snapshot.connectionRevision > 0
    && snapshot.versionState === 'VALIDATED'
    && typeof snapshot.databaseGenerationId === 'string'
    && typeof snapshot.databaseRef === 'string'
    && typeof snapshot.credentialRef === 'string'
    && typeof snapshot.bindingDigest === 'string' && snapshot.bindingDigest.length > 0
    && typeof snapshot.observedSystemIdentifier === 'string' && snapshot.observedSystemIdentifier.length > 0
    && ['COMPATIBLE', 'READ_ONLY'].includes(snapshot.schema.compatibilityState)
    && operationAllowsSnapshot(snapshot, operation)
    && typeof snapshot.schema.schemaFingerprint === 'string' && snapshot.schema.schemaFingerprint.length > 0
    && Number.isSafeInteger(snapshot.schema.revision) && snapshot.schema.revision > 0
    && capabilitiesAllow(snapshot, operation.requiredCapabilities)
    && regionPolicy.allows(snapshot.regionCode, snapshot.residencyPolicyVersion) === true;
}

function createTenantResolver({ membershipRepository, directoryRepository, operationCatalog, credentialProvider,
  bindingVerifier, poolManager, leaseExecutor, regionPolicy, clock, scheduler, maxAttempts = 2,
  validateOrganizationContext = context => closedObject(context, CONTEXT_KEYS) }) {
  if (!membershipRepository || !directoryRepository || !operationCatalog || !credentialProvider || !bindingVerifier
      || !poolManager || !leaseExecutor || !regionPolicy || typeof regionPolicy.allows !== 'function' || !clock
      || !scheduler || typeof scheduler.setTimeout !== 'function' || typeof scheduler.clearTimeout !== 'function'
      || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('Tenant resolver dependencies are incomplete.');
  }
  const now = () => {
    const value = clock.now();
    const number = value instanceof Date ? value.getTime() : Number(value);
    if (!Number.isFinite(number)) throw new TypeError('Tenant runtime clock returned an invalid instant.');
    return number;
  };
  async function withinAllocationDeadline(allocation, operation, correlationId) {
    const remaining = allocation.deadline - now();
    if (remaining <= 0) throw tenantFailure('LEASE_TIMEOUT', 'TENANT_OPERATION_UNAVAILABLE', { correlationId });
    let timeout;
    const timed = new Promise((resolve, reject) => {
      timeout = scheduler.setTimeout(() => reject(tenantFailure('LEASE_TIMEOUT', 'TENANT_OPERATION_UNAVAILABLE', {
        correlationId
      })), remaining);
    });
    try { return await Promise.race([Promise.resolve().then(operation), timed]); }
    finally { scheduler.clearTimeout(timeout); }
  }

  return Object.freeze({
    async resolve(input) {
      if (!closedObject(input, INPUT_KEYS) || !validateOrganizationContext(input.organizationContext)
          || typeof input.correlationId !== 'string' || input.correlationId.trim() === '') {
        throw new TypeError('Tenant resolution input is invalid.');
      }
      const operation = operationCatalog.resolveAdapter(input.operationAdapter);
      if (!operation) throw tenantFailure('OPERATION_NOT_REGISTERED', 'TENANT_OPERATION_UNAVAILABLE', { correlationId: input.correlationId });
      const operationWorkload = operation.workload;
      if (!['API', 'WORKER'].includes(operationWorkload)) {
        throw tenantFailure('WORKLOAD_INVALID', 'TENANT_OPERATION_UNAVAILABLE', { correlationId: input.correlationId });
      }
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let context;
        try { context = await membershipRepository.revalidateContext(input.organizationContext, now()); }
        catch { throw tenantFailure('ORGANIZATION_CONTEXT_UNAVAILABLE', 'TENANT_NOT_AVAILABLE', { correlationId: input.correlationId }); }
        if (!context) throw tenantFailure('ORGANIZATION_MISMATCH', 'TENANT_NOT_AVAILABLE', { correlationId: input.correlationId });
        let snapshot;
        try { snapshot = await directoryRepository.resolveSnapshotByOrganization(input.organizationContext.organizationId, operationWorkload); }
        catch { throw tenantFailure('DIRECTORY_AMBIGUOUS', 'TENANT_NOT_AVAILABLE', { correlationId: input.correlationId }); }
        if (!snapshotEligible(snapshot, input.organizationContext.organizationId, operation, regionPolicy)) {
          throw tenantFailure(snapshot ? 'CONNECTION_NOT_AVAILABLE' : 'DIRECTORY_NOT_FOUND', 'TENANT_NOT_AVAILABLE', { correlationId: input.correlationId });
        }
        let secret;
        let allocation;
        let primary = null;
        try {
          if (snapshot.workload !== operationWorkload) throw tenantFailure('WORKLOAD_MISMATCH', 'TENANT_NOT_AVAILABLE', { correlationId: input.correlationId });
          if(Number.isSafeInteger(snapshot.fence)&&typeof poolManager.synchronizeFence==='function')poolManager.synchronizeFence({tenantId:snapshot.tenantId,workload:operationWorkload,fence:snapshot.fence,connectionVersion:snapshot.connectionVersion});
          secret = await credentialProvider.resolve({ credentialRef: snapshot.credentialRef, tenantId: snapshot.tenantId,
            workload:operationWorkload,connectionVersion: snapshot.connectionVersion, correlationId: input.correlationId });
          const credentialLease = secret;
          secret = null;
          allocation = await poolManager.acquire({ tenantId: snapshot.tenantId, workload:operationWorkload,connectionVersion: snapshot.connectionVersion,
            workloadClass: operation.workloadClass, credentialLease, correlationId: input.correlationId });
          const current = await withinAllocationDeadline(allocation, async () => {
            await bindingVerifier.verify({ client: allocation.client, snapshot, phase:'PREPARATION',
              requiredCapabilities: operation.requiredCapabilities, correlationId: input.correlationId });
            return directoryRepository.resolveSnapshotByOrganization(snapshot.organizationId, operationWorkload);
          }, input.correlationId);
          if (!sameSnapshot(snapshot, current)) {
            const stale = allocation;
            allocation = null;
            await stale.release({ discard: true, cause: new Error('Tenant snapshot changed during acquisition.') });
            if (attempt < maxAttempts) continue;
            throw tenantFailure('RECONCILIATION_REQUIRED', 'TENANT_NOT_AVAILABLE', { correlationId: input.correlationId });
          }
          return leaseExecutor.issue({ allocation, snapshot, organizationContext: input.organizationContext,
            operation, correlationId: input.correlationId });
        } catch (error) {
          primary = error;
          if (allocation) {
            try { await allocation.release({ discard: true, cause: error }); }
            catch (cleanup) { throw aggregateCleanup(error, cleanup); }
          }
          throw error;
        } finally {
          if (secret) {
            try { await secret.dispose(); }
            catch (cleanup) {
              if (primary) throw aggregateCleanup(primary, cleanup);
              if (allocation) {
                try { await allocation.release({ discard: true, cause: cleanup }); }
                catch (releaseError) { throw aggregateCleanup(cleanup, releaseError); }
              }
              throw cleanup;
            }
          }
        }
      }
      throw tenantFailure('RECONCILIATION_REQUIRED', 'TENANT_NOT_AVAILABLE', { correlationId: input.correlationId });
    }
  });
}

module.exports = { capabilitiesAllow, createTenantResolver, operationAllowsSnapshot, snapshotEligible };
