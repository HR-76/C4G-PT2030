'use strict';
const { isTenantCapabilityEvidenceForPool } = require('../security/tenantMigrationPreflight');
const { createFinancialRepository, mapError } = require('./financialRepository');
const { createFinancialAuditWriter } = require('./financialAudit');
const { createFinancialResourceLoader } = require('./financialResources');
const { createTaxonomyAuthorization } = require('./taxonomyAuthorization');
const { OPS, VALIDATORS, createPreparedFinancialService } = require('./financialService');
const { OrganizationalProfileContractError } = require('./errors');
const { isTaxonomySessionAuthority, createTaxonomySessionAuthority } = require('./taxonomySessionAuthority');
const { createTenantRuntime } = require('../security/tenantRuntime');
const { createFinancialTenantOperations } = require('./financialTenantOperations');
const { tenantFailure } = require('../security/tenantRuntimeErrors');
const { isPreparedTenantTransaction,preparedAuthorityBinding } = require('../security/tenantLeaseExecutor');
const { isAuthorityCoordinator } = require('../security/authorityCoordinator');
const { createTenantAuthorityRecovery } = require('../security/tenantAuthorityRecovery');
const { createAuthorityDataRepository } = require('../authorization/authorityDataRepository');

const OBSERVATIONS = Object.freeze(Object.fromEntries(Object.keys(OPS).map(method=>[method,`profile.financial.${method}`])));
function unavailable() { return new OrganizationalProfileContractError('F13_PERSISTENCE_UNAVAILABLE'); }

function createFinancialProductionComposition({ authorizationCatalogs, sessionAuthority, telemetry, authorityCoordinator,
  authorityLeaseMs = 10000,
  featureTelemetry = null, clock = { now: () => new Date() }, assurancePolicyVersion = 'c4g-assurance-v1',
  recentMfaRequirement = Object.freeze({ maxAgeSeconds: 300, mfa: true,
    acceptedAcr: Object.freeze(['c4g-loa2']), acceptedAmr: Object.freeze(['otp']), amrMode: 'all' }) }) {
  if (!isTaxonomySessionAuthority(sessionAuthority) || !telemetry?.observe || !authorizationCatalogs?.permissionCatalog
      || !Number.isSafeInteger(authorityLeaseMs) || authorityLeaseMs<100 || authorityLeaseMs>10000
      || !authorizationCatalogs?.profileCatalog || Object.values(OPS).some(code => !authorizationCatalogs.operationCatalog?.resolve(code))) {
    throw new TypeError('F13 taxonomy production composition is incomplete.');
  }
  function bindTenant({ pool, organizationId, tenantId, tenantCapabilityEvidence, membershipPort,
    authorizationDataPort, authorizationAuditPort, tenantRuntimeDependencies, auditWriter = null }) {
    if (!pool?.connect || typeof organizationId !== 'string' || tenantId !== organizationId
        || !isTenantCapabilityEvidenceForPool(tenantCapabilityEvidence, pool)
        || tenantCapabilityEvidence.tenantId !== tenantId
        || !tenantCapabilityEvidence.capabilities.includes('F13_FINANCIAL_CAPACITY')
        || !tenantCapabilityEvidence.compatibility.writeVersions.includes(tenantCapabilityEvidence.currentVersion)
        || !isTaxonomySessionAuthority(sessionAuthority, { membershipPort, authorizationDataPort, policyVersion: assurancePolicyVersion,authorityCoordinator })
        || !membershipPort?.revalidate || !authorizationDataPort?.load || !authorizationAuditPort?.accept
        || !tenantRuntimeDependencies?.bindingVerifier?.verify || !tenantRuntimeDependencies?.poolManager?.acquire) {
      throw new TypeError('F13 taxonomy tenant binding is invalid.');
    }
    if (!isAuthorityCoordinator(authorityCoordinator)) {
      throw new TypeError('F13 coordinated Central authority required.');
    }
    authorityCoordinator.registerRecovery(tenantId,createTenantAuthorityRecovery(tenantRuntimeDependencies));
    const repository = createFinancialRepository({ organizationId,
      auditWriter: auditWriter || createFinancialAuditWriter({ organizationId, tenantId, clock: () => clock.now() }) });
    const authorization = createTaxonomyAuthorization({ catalogs: authorizationCatalogs, membershipPort, authorizationDataPort,
      authorizationAuditPort, assurancePolicyVersion, recentMfaRequirement, clock, telemetry: featureTelemetry });
    const guardPort=authorityCoordinator.bindAuthority({sessionAuthority,authorization,operationCatalog:authorizationCatalogs.operationCatalog,
      permissionCatalog:authorizationCatalogs.permissionCatalog,recentMfaRequirement,leaseMs:authorityLeaseMs});
    const contexts = new WeakMap();
    const executing = new WeakMap();
    const prepared = createPreparedFinancialService({ repository, loader: createFinancialResourceLoader({ organizationId }), authorization, contexts,
      revalidate: context => resolve(contexts.get(context), context.correlationId),
      async protectAuthorization(client,method,command,context,resource,additionalAuthorizations) {
        const state=executing.get(client);
        if (!state) throw unavailable();
        const intention=repository.intention(method,command);
        const protectedDecision=await guardPort.protect(client,{handle:contexts.get(context),operationCode:OPS[method],resource,additionalAuthorizations,
          intention:intention?{...intention,key:command.idempotencyKey}:null});
        state.guard=protectedDecision.token;
        return protectedDecision.decision;
      } });
    async function resolve(handle, correlationId = null) {
      let session;
      try { session = await sessionAuthority.resolve(handle); } catch { throw new OrganizationalProfileContractError('F13_AUTHORIZATION_REQUIRED'); }
      if (session.actor.organizationId !== organizationId) throw new OrganizationalProfileContractError('F13_AUTHORIZATION_REQUIRED');
      const context = Object.freeze({ ...session, organizationId, correlationId: correlationId || session.correlationId });
      contexts.set(context, handle);
      return context;
    }
    const inputs = new WeakMap();
    function assertPrepared(client) {
      if (!isPreparedTenantTransaction(client, { organizationId, tenantId, workload: 'API',
        requiredCapabilities: ['F13_FINANCIAL_CAPACITY', 'F7_AUDIT_LEDGER'] })) throw unavailable();
    }
    const operations = createFinancialTenantOperations({ inputs, authorizationOperationCatalog: authorizationCatalogs.operationCatalog,
      async execute(client, method, state) {
        const {command,context,reconciliation}=state;
        try {
          assertPrepared(client);
          executing.set(client,state);
          await client.query('SET LOCAL ROLE c4g_organization_profile_runtime');
          await client.query("SELECT set_config('app.organization_id',$1,true)", [organizationId]);
          return await prepared.execute(client, method, command, context, reconciliation);
        } catch (error) { const mapped = mapError(error); throw tenantFailure(mapped.code, 'TENANT_OPERATION_UNAVAILABLE'); }
        finally { executing.delete(client); }
      },
      authorityGuard:{
        assert(client,state){const physical=preparedAuthorityBinding(client);authorityCoordinator.assert(state.guard,client,physical.transactionId);},
        async complete(state,outcome){if(state?.guard)await authorityCoordinator.complete(state.guard,outcome);}
      },
      async beforeCommit(client, { context }) {
        assertPrepared(client);
        // F3/F5 writers now wait for the durable guard; their effective state
        // cannot change in this interval. F4 still verifies physical residency.
        // Physical verification runs after RESET ROLE, on this same allocation.
        await client.query('RESET ROLE');
      }
    });
    const runtime = createTenantRuntime({ ...tenantRuntimeDependencies, operationCatalog: operations.catalog,
      directoryRepository: { async resolveSnapshotByOrganization(org, workload) {
        const snapshot = await tenantRuntimeDependencies.directoryRepository.resolveSnapshotByOrganization(org, workload);
        if (!snapshot || org !== organizationId || snapshot.tenantId !== tenantId || snapshot.workload !== 'API'
            || snapshot.databaseGenerationId !== tenantCapabilityEvidence.databaseGenerationId
            || snapshot.schema.currentVersion !== tenantCapabilityEvidence.currentVersion
            || snapshot.schema.schemaFingerprint !== tenantCapabilityEvidence.schemaFingerprint) throw unavailable();
        return snapshot;
      } }
    });
    async function attempt(method, command, context, reconciliation) {
      const input = Object.freeze({});
      const state={command,context,reconciliation};
      inputs.set(input, state);
      try {
        const lease = await runtime.resolve({ correlationId: context.correlationId, operationAdapter: operations.adapters[method],
          organizationContext: { organizationId, membershipId: context.actor.membershipId, membershipVersion: context.actor.membershipVersion } });
        return await lease.execute(input);
      } catch (error) {
        if (error.internalCode === 'COMMIT_UNCERTAIN') return { uncertainCommit: true,guard:state.guard };
        if (error.internalCode?.startsWith('F13_')) throw new OrganizationalProfileContractError(error.internalCode);
        throw mapError(error);
      } finally { inputs.delete(input); }
    }
    async function execute(method, raw, handle) {
      const command = VALIDATORS[method](raw);
      const context = await resolve(handle);
      const result = await attempt(method, command, context, false);
      if (!result?.uncertainCommit) return result;
      await authorityCoordinator.reconcile(result.guard);
      const current = await resolve(handle);
      const reconciled = await attempt(method, command, current, true);
      if (reconciled?.uncertainCommit) {
        // Preserve the durable protocol, but never expose its private handle.
        await authorityCoordinator.reconcile(reconciled.guard);
        throw unavailable();
      }
      if (!reconciled) throw unavailable();
      return reconciled;
    }
    return Object.freeze(Object.fromEntries(Object.keys(OPS).map(method => [method,
      (command, sessionHandle) => telemetry.observe(OBSERVATIONS[method], () => execute(method, command, sessionHandle))])));
  }
  return Object.freeze({ bindTenant, operationCodes: Object.freeze(Object.values(OPS)) });
}
// Root-only adapter: session handles cannot be minted by a functional caller.
function createFinancialRuntimeComposition({ sessionStore, sessionRegistry, ...options }) {
  if (!sessionStore?.get || !sessionRegistry?.validateSession) throw new TypeError('F13 authenticated runtime is required.');
  const authorityData=createAuthorityDataRepository({coordinator:options.authorityCoordinator,
    policyVersion:options.assurancePolicyVersion,catalogs:options.authorizationCatalogs,recentMfaRequirement:options.recentMfaRequirement});
  return Object.freeze({ bindTenant(binding) {
    binding={...binding,membershipPort:authorityData.membershipPort,authorizationDataPort:authorityData.authorizationDataPort};
    const authority = createTaxonomySessionAuthority({ sessionStore, sessionRegistry,
      membershipPort: binding.membershipPort, authorizationDataPort: binding.authorizationDataPort,
      authorityCoordinator:options.authorityCoordinator,
      policyVersion: options.assurancePolicyVersion, clock: options.clock });
    const service = createFinancialProductionComposition({ ...options, sessionAuthority: authority }).bindTenant(binding);
    return Object.freeze({ service, captureAuthenticatedRequest: request => authority.captureAuthenticatedRequest(request) });
  } });
}
module.exports = { createFinancialProductionComposition, createFinancialRuntimeComposition };
