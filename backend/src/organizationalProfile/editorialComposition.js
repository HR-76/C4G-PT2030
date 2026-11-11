'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { isTenantCapabilityEvidenceForPool } = require('../security/tenantMigrationPreflight');
const { createEditorialRepository } = require('./editorialRepository');
const { createEditorialAuditWriter } = require('./editorialAudit');
const { createEditorialDecisionAudit } = require('./editorialDecisionAudit');
const { createTaxonomyAuthorization } = require('./taxonomyAuthorization');
const { OPS, VALIDATORS, createPreparedEditorialService } = require('./editorialService');
const { OrganizationalProfileContractError } = require('./errors');
const { createTaxonomySessionAuthority } = require('./taxonomySessionAuthority');
const { createAuthorityDataRepository } = require('../authorization/authorityDataRepository');
const { createTenantRuntime } = require('../security/tenantRuntime');
const { createEditorialTenantOperations } = require('./editorialTenantOperations');
const { tenantFailure } = require('../security/tenantRuntimeErrors');
const { preparedAuthorityBinding } = require('../security/tenantLeaseExecutor');
const { createTenantAuthorityRecovery } = require('../security/tenantAuthorityRecovery');
const { mapError } = require('./taxonomyRepository');
const OBSERVATIONS = Object.freeze({ submit: 'profile.editorial.submit', approve: 'profile.editorial.approve',
  publish: 'profile.editorial.publish', readCandidate: 'profile.editorial.read', readVersion: 'profile.editorial.read' });
const unavailable = () => new OrganizationalProfileContractError('F13_PERSISTENCE_UNAVAILABLE');

// Root-only composition: context and policy are resolved server-side. No caller
// can obtain a prepared client, tenant adapter, repository or authority handle.
function createEditorialBinding(options, binding) {
  const { sessionStore, sessionRegistry, authorityCoordinator, authorizationCatalogs, telemetry,
    assurancePolicyVersion = 'c4g-assurance-v1', recentMfaRequirement,
    clock = { now: () => new Date() }, onFailure = () => {} } = options;
  const { tenantRuntimeDependencies, organizationId: boundOrganization = null } = binding;
  const data = createAuthorityDataRepository({ coordinator: authorityCoordinator, catalogs: authorizationCatalogs,
    policyVersion: assurancePolicyVersion, recentMfaRequirement });
  const authority = createTaxonomySessionAuthority({ sessionStore, sessionRegistry, authorityCoordinator,
    membershipPort: data.membershipPort, authorizationDataPort: data.authorizationDataPort, policyVersion: assurancePolicyVersion, clock });
  const auditScope = new AsyncLocalStorage();
  const authorization = createTaxonomyAuthorization({ catalogs: authorizationCatalogs, ...data,
    authorizationAuditPort: binding.authorizationAuditPort || createEditorialDecisionAudit({ scope: auditScope, clock, assurancePolicyVersion }),
    assurancePolicyVersion, recentMfaRequirement, clock });
  const guardPort = authorityCoordinator.bindAuthority({ sessionAuthority: authority, authorization,
    operationCatalog: authorizationCatalogs.operationCatalog, permissionCatalog: authorizationCatalogs.permissionCatalog,
    recentMfaRequirement, leaseMs: options.authorityLeaseMs || 10000 });
  const contexts = new WeakMap(), inputs = new WeakMap(), repositories = new Map();
  async function resolve(handle) {
    let context;
    try { context = await authority.resolve(handle); } catch { throw new OrganizationalProfileContractError('F13_AUTHORIZATION_REQUIRED'); }
    if (boundOrganization && context.actor.organizationId !== boundOrganization) throw new OrganizationalProfileContractError('F13_AUTHORIZATION_REQUIRED');
    const trusted = Object.freeze({ ...context, organizationId: context.actor.organizationId });
    contexts.set(trusted, handle); return trusted;
  }
  function repository(org) {
    if (!repositories.has(org)) repositories.set(org, createEditorialRepository({ organizationId: org,
      auditWriter: binding.auditWriter || createEditorialAuditWriter({ organizationId: org, tenantId: org, clock: () => clock.now() }) }));
    return repositories.get(org);
  }
  const operations = createEditorialTenantOperations({ inputs, authorizationOperationCatalog: authorizationCatalogs.operationCatalog,
    async execute(client, method, state) {
      const org = state.context.organizationId;
      const auditState = { client, organizationId: org, failed: false };
      try {
        await client.query('SET LOCAL ROLE c4g_organization_profile_runtime');
        await client.query("SELECT set_config('app.organization_id',$1,true)", [org]);
        const repo = repository(org);
        const service = createPreparedEditorialService({ repository: repo, contexts,
          revalidate: context => resolve(contexts.get(context)),
          async admitAuthorization(operation, command, context) {
            // Grant/MFA admission precedes existence lookup: unauthorized UUID
            // probes have the same result for existing, foreign and absent IDs.
            auditState.admission=true;
            const decision=await authorization.authorize(OPS[operation],context,{
              id:command.draftId||command.candidateId||command.versionId,organizationId:org,
              resourceType:operation==='submit'?'PROFILE_DRAFT':operation==='approve'?'PROFILE_DRAFT_REVISION':operation==='publish'?'PROFILE_VERSION':'PROFILE_PROJECTION',
              scopeType:'ORGANIZATION',scopeId:null,status:'ACTIVE',unitId:null,ancestorUnitIds:[],teamIds:[],distinctFromActorIds:[]});
            auditState.admission=false;
            if(auditState.failed)throw unavailable();
            if(!decision.allowed)throw new OrganizationalProfileContractError('F13_AUTHORIZATION_REQUIRED');
          },
          async protectAuthorization(prepared, operation, command, context, loaded) {
            const intention = repo.intention(operation, command);
            const protectedDecision = await guardPort.protect(prepared, { handle: contexts.get(context), operationCode: OPS[operation],
              resource: loaded.resource, approvalEvidence: operation === 'publish' ? loaded.version.approval_evidence : null,
              intention: intention ? { ...intention, key: command.idempotencyKey } : { operation: 'EDITORIAL_READ' } });
            state.guard = protectedDecision.token;
            if (auditState.failed) throw unavailable();
            return protectedDecision;
          } });
        return await auditScope.run(auditState, () => service.execute(client, method, state.command, state.context, state.reconciliation));
      } catch (error) {
        onFailure(error);
        const mapped = error.code === 'F13_APPROVAL_STALE' ? new OrganizationalProfileContractError(error.code) : mapError(error);
        throw tenantFailure(mapped.code, 'TENANT_OPERATION_UNAVAILABLE');
      }
    },
    beforeCommit: client => client.query('RESET ROLE'),
    authorityGuard: {
      assert(client, state) { authorityCoordinator.assert(state.guard, client, preparedAuthorityBinding(client).transactionId); },
      async complete(state, outcome) { if (state?.guard) await authorityCoordinator.complete(state.guard, outcome); }
    }
  });
  const runtime = createTenantRuntime({ ...tenantRuntimeDependencies, operationCatalog: operations.catalog });
  async function attempt(state) {
    const input = Object.freeze({}); inputs.set(input, state);
    try {
      const lease = await runtime.resolve({ correlationId: state.context.correlationId, operationAdapter: operations.adapters[state.method],
        organizationContext: { organizationId: state.context.organizationId, membershipId: state.context.actor.membershipId,
          membershipVersion: state.context.actor.membershipVersion } });
      return await lease.execute(input);
    } catch (error) {
      onFailure(error);
      if (error.internalCode === 'COMMIT_UNCERTAIN') return { uncertainCommit: true };
      if (error.internalCode?.startsWith('F13_')) throw new OrganizationalProfileContractError(error.internalCode);
      throw mapError(error);
    } finally { inputs.delete(input); }
  }
  async function execute(method, raw, handle) {
    const command = VALIDATORS[method](raw), context = await resolve(handle);
    authorityCoordinator.registerRecovery(context.organizationId, createTenantAuthorityRecovery(tenantRuntimeDependencies));
    const state = { method, command, context, reconciliation: false };
    const result = await attempt(state);
    if (!result?.uncertainCommit) return result;
    await authorityCoordinator.reconcile(state.guard);
    state.context = await resolve(handle); state.reconciliation = true; state.guard = null;
    const reconciled = await attempt(state);
    if (!reconciled || reconciled.uncertainCommit) throw unavailable();
    return reconciled;
  }
  return Object.freeze({ captureAuthenticatedRequest: request => authority.captureAuthenticatedRequest(request),
    service: Object.freeze(Object.fromEntries(Object.keys(OPS).map(method => [method, (command, handle) =>
      telemetry.observe(OBSERVATIONS[method], () => execute(method, command, handle))]))) });
}
function createEditorialRuntimeComposition(options) {
  return Object.freeze({ bindTenant(binding) {
    if (!isTenantCapabilityEvidenceForPool(binding.tenantCapabilityEvidence, binding.pool)
      || binding.tenantId !== binding.organizationId || binding.tenantCapabilityEvidence.tenantId !== binding.tenantId
      || !binding.tenantCapabilityEvidence.capabilities.includes('F13_EDITORIAL_BASELINE_PUBLICATION')) throw new TypeError('F13 editorial tenant binding is invalid.');
    return createEditorialBinding(options, binding);
  } });
}
function createEditorialHttpComposition(options) {
  const bound = createEditorialBinding(options, { tenantRuntimeDependencies: options.tenantRuntimeDependencies,
    authorizationAuditPort: options.authorizationAuditPort });
  return Object.freeze(Object.fromEntries(Object.keys(OPS).map(method => [method, async (command, request) => {
    let handle;
    try { handle = await bound.captureAuthenticatedRequest(request); }
    catch { throw new OrganizationalProfileContractError('F13_AUTHORIZATION_REQUIRED'); }
    return bound.service[method](command, handle);
  }])));
}
module.exports = { createEditorialRuntimeComposition, createEditorialHttpComposition };
