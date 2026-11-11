'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { createAuthorityDataRepository } = require('../authorization/authorityDataRepository');
const { createTaxonomySessionAuthority } = require('../security/authenticatedAuthority');
const { createTaxonomyAuthorization } = require('../authorization/resourceAuthorization');
const { createPolicyEngine } = require('../authorization/policyEngine');
const { createTenantRuntime } = require('../security/tenantRuntime');
const { createAuthorizedTenantOperationCatalog } = require('../security/tenantOperationCatalog');
const { preparedAuthorityBinding } = require('../security/tenantLeaseExecutor');
const { createTenantAuthorityRecovery } = require('../security/tenantAuthorityRecovery');
const { tenantFailure } = require('../security/tenantRuntimeErrors');
const { createEditorialRepository } = require('./editorialRepository');
const { createEditorialAuditWriter } = require('./editorialAudit');
const { createAuthoringRepository } = require('./authoringRepository');
const { createAuthoringAuditWriter } = require('./authoringAudit');
const { createAuthoringResourceLoader } = require('./authoringResources');
const { createEditorialUiRepository } = require('./editorialUiRepository');
const { createEditorialUiAudit } = require('./editorialUiAudit');
const { createPreparedAuthoringService } = require('./authoringService');
const { createPreparedEditorialService } = require('./editorialService');
const { createEditorialUiTokens } = require('./editorialUiTokens');
const { fail, receipt } = require('./editorialUiContracts');
const operationFor = { create: 'F13_PROFILE_DRAFT_CREATE', edit: 'F13_PROFILE_DRAFT_EDIT', submit: 'F13_PROFILE_SUBMIT',
  approve: 'F13_PROFILE_APPROVE', publish: 'F13_PROFILE_PUBLISH' };
const domainMethod = { create: 'createDraft', edit: 'editDraft' };
function resource(id, org, type = 'PROFILE_PROJECTION', authors = []) {
  return { id, organizationId: org, resourceType: type, scopeType: 'ORGANIZATION', scopeId: null, status: 'ACTIVE',
    distinctFromActorIds: authors, unitId: null, ancestorUnitIds: [], teamIds: [] };
}
function createEditorialUiComposition(options) {
  const { sessionStore, sessionRegistry, authorityCoordinator: coordinator, authorizationCatalogs: catalogs,
    tenantRuntimeDependencies: dependencies, assurancePolicyVersion: policyVersion, recentMfaRequirement,
    mfaCategory, tokenKeys, tokenKeyId, clock = { now: () => new Date() } } = options;
  const tokens = createEditorialUiTokens({ keys: tokenKeys, currentKeyId: tokenKeyId, clock: () => clock.now().getTime() });
  if (typeof mfaCategory !== 'string' || !mfaCategory) fail('SERVICE_UNAVAILABLE');
  const data = createAuthorityDataRepository({ coordinator, catalogs, policyVersion, recentMfaRequirement });
  const authority = createTaxonomySessionAuthority({ sessionStore, sessionRegistry, authorityCoordinator: coordinator,
    ...data, policyVersion, clock });
  const scope = new AsyncLocalStorage(), contexts = new WeakMap(), inputs = new WeakMap();
  const authorization = createTaxonomyAuthorization({ catalogs, ...data, assurancePolicyVersion: policyVersion, recentMfaRequirement, clock,
    authorizationAuditPort: createEditorialUiAudit({ scope, catalogs, clock, policyVersion }) });
  const policy = createPolicyEngine({ permissionCatalog: catalogs.permissionCatalog, profileCatalog: catalogs.profileCatalog,
    assurancePolicyVersion: policyVersion, recentMfaRequirement });
  const guardPort = coordinator.bindAuthority({ sessionAuthority: authority, authorization, operationCatalog: catalogs.operationCatalog,
    permissionCatalog: catalogs.permissionCatalog, recentMfaRequirement });
  async function resolve(handle) {
    const current = await authority.resolve(handle), context = { ...current, organizationId: current.actor.organizationId };
    contexts.set(context, handle); return context;
  }
  async function evaluate(context, operationCode, target) {
    const membership = await data.membershipPort.revalidate(context.actor), snapshot = await data.authorizationDataPort.load(context.actor);
    if (!membership || !snapshot) return { allowed: false, reasonCode: 'NOT_AUTHORIZED' };
    const scoped = { ...snapshot, grants: snapshot.grants.filter(g => (!g.resourceId || g.resourceId === target.id) && (!g.resourceType || g.resourceType === target.resourceType)) };
    const decision = policy.evaluate({ actor: context.actor, membership, snapshot: scoped,
      operation: catalogs.operationCatalog.resolve(operationCode), resource: target,
      assuranceEvidence: context.assuranceEvidence, now: clock.now(), exactResourceScope: true });
    if (target.distinctFromActorIds.includes(context.actor.id)) return { allowed: false, reasonCode: 'SOD_VIOLATION' };
    return decision;
  }
  async function readAllowed(context, id) { return (await evaluate(context, 'F13_PROFILE_READ', resource(id, context.organizationId))).allowed; }
  function binding(context, operation, id, digest) { return { subjectId: context.actor.id, organizationId: context.organizationId, operation, resourceId: id, expectedDigest: digest }; }
  async function pending(context, ids, key = null) {
    const candidates = (await coordinator.pool.query("SELECT guard_id,deadline FROM public.authority_commit_guard WHERE state IN ('PREPARED','TENANT_COMMIT_UNKNOWN') AND scope_keys && $1::text[] ORDER BY authority_epoch", [[`ORG:${context.organizationId}`]])).rows;
    for (const candidate of candidates) {
      const row = (await coordinator.pool.query('SELECT * FROM public.authority_commit_guard WHERE guard_id=$1', [candidate.guard_id])).rows[0];
      if (row && ['PREPARED', 'TENANT_COMMIT_UNKNOWN'].includes(row.state) && row.idempotency_key && row.idempotency_key !== key
        && row.protected_operations.some(p => ids.includes(p.resourceId))) return true;
    }
    return false;
  }
  async function action(context, operation, id, { authors = [], digest = null, blocked = null } = {}) {
    const op = operationFor[operation.toLowerCase()];
    const target = resource(id, context.organizationId, catalogs.operationCatalog.resolve(op).resourceType, authors);
    const decision = await evaluate(context, op, target);
    let status = 'AVAILABLE', reason = null;
    if (!decision.allowed) {
      if (decision.reasonCode === 'SOD_VIOLATION') { status = 'BLOCKED'; reason = 'AUTHOR_OR_SUBMITTER'; }
      else if (['AUTH_EVIDENCE_MISSING', 'AUTH_EVIDENCE_EXPIRED', 'MFA_EVIDENCE_INSUFFICIENT'].includes(decision.reasonCode)) status = 'MFA_REQUIRED';
      else { status = 'BLOCKED'; reason = 'NOT_AUTHORIZED'; }
    }
    if (blocked && status !== 'BLOCKED') { status = 'BLOCKED'; reason = blocked; }
    if (await pending(context, [id])) { status = 'BLOCKED'; reason = 'STATE_CONFLICT'; }
    return { operation, status, reason, concurrencyToken: null, expiresAt: null,
      ...(status === 'AVAILABLE' && digest ? tokens.issue(binding(context, operation, id, digest)) : {}) };
  }
  const adapters = {}, operations = [...new Set([...Object.values(operationFor), 'F13_PROFILE_READ'])].map(operationCode => {
    const queryModule = Object.freeze({ moduleCode: `${operationCode}_EDITORIAL_UI`, requiresAuditWrite: true,
      async execute({ client, input }) { try { return await run(client, inputs.get(input)); }
        catch (error) { options.onFailure?.(error); throw tenantFailure(error.code || 'SERVICE_UNAVAILABLE', 'TENANT_OPERATION_UNAVAILABLE'); } },
      beforeCommit: ({ client }) => client.query('RESET ROLE'),
      authorityGuard: Object.freeze({ assert({ client, input }) { coordinator.assert(inputs.get(input).guard, client, preparedAuthorityBinding(client).transactionId); },
        async complete({ input, outcome }) { if (inputs.get(input).guard) await coordinator.complete(inputs.get(input).guard, outcome); } }) });
    adapters[operationCode] = Object.freeze({ operationCode, queryModule });
    return Object.freeze({ operationCode, ownerModule: 'F13_EDITORIAL_BASELINE', accessMode: operationCode === 'F13_PROFILE_READ' ? 'READ' : 'WRITE', workload: 'API', workloadClass: 'FUNCTIONAL', queryModule,
      compatibleSchemaVersions: Object.freeze(['016_f13_editorial_baseline_publication','017_opportunity_evidenced_criteria','018_f13_pq1_publication','019_f13_pq1_activation','020_f14_pq1_decisions','021_application_first_slice','022_application_team_tasks']), requiredCapabilities: Object.freeze(['F13_EDITORIAL_BASELINE_PUBLICATION', 'F13_PROFILE_AUTHORING', 'F7_AUDIT_LEDGER']),
      allowedCompatibilityStates: Object.freeze(['COMPATIBLE']), readOnlyEligible: false,
      inputSchema: Object.freeze({ validate: value => inputs.has(value) }), resultSchema: Object.freeze({ validate: value => value !== undefined }),
      requiredPermission: operationCode, limits: Object.freeze({ maxPageSize: 100, maxRows: 10000, maxBytes: 1048576 }), timeoutMs: 10000 });
  });
  const runtime = createTenantRuntime({ ...dependencies, operationCatalog: createAuthorizedTenantOperationCatalog(
    Object.freeze({ catalogVersion: 'f13-editorial-ui-v1', operations: Object.freeze(operations) }), catalogs.operationCatalog) });
  async function run(client, state) {
    const { method, id, input } = state, org = state.context.organizationId;
    await client.query('SET LOCAL ROLE c4g_organization_profile_runtime');
    await client.query("SELECT set_config('app.organization_id',$1,true)", [org]);
    const auditState = { client, organizationId: org, sequence: 0 };
    return scope.run(auditState, async () => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-P1:' || $1::text,43001301))", [org]);
      state.context = await resolve(state.handle);
      const context = state.context;
      let readId = id || input.draftId || input.resourceId || org;
      if (['drafts', 'candidates', 'versions', 'catalog'].includes(method)) {
        const snapshot = await data.authorizationDataPort.load(context.actor);
        readId = snapshot.grants.find(g => g.permission === 'organization_profile.read' && g.resourceId)?.resourceId || org;
      }
      if (!await readAllowed(context, readId)) fail('NOT_AUTHORIZED');
      const repo = createEditorialRepository({ organizationId: org, auditWriter: createEditorialAuditWriter({ organizationId: org, tenantId: org, clock: () => clock.now() }) });
      const ui = createEditorialUiRepository({ organizationId: org, tokens });
      async function protect(operation, command, trusted, target, approvalEvidence = null, intention = null) {
        const protectedDecision = await guardPort.protect(client, { handle: state.handle, operationCode: operation,
          resource: target, approvalEvidence, intention });
        state.guard = protectedDecision.token; return protectedDecision;
      }
      if (!operationFor[method]) {
        await protect('F13_PROFILE_READ', null, context, resource(readId, org), null, { operation: 'EDITORIAL_READ' });
        if (method === 'context') {
          return { enabled: true, organization: { id: org, name: state.organizationName || org }, canCreateDraft: (await action(context, 'CREATE', org)).status === 'AVAILABLE', mfa: { category: mfaCategory, stepUpPath: '/api/auth/step-up' } };
        }
        if (['drafts', 'candidates', 'versions', 'catalog'].includes(method)) return ui.page(client, method, input, context, candidateId => readAllowed(context, candidateId));
        if (method === 'draft') {
          const draft = await ui.draft(client, id), blocked = draft.lifecycle !== 'DRAFT' ? 'STATE_CONFLICT' : null;
          return { ...draft, actions: await Promise.all(['EDIT', 'SUBMIT'].map(op => action(context, op, id, { blocked }))) };
        }
        const domain = method === 'candidate' ? 'readCandidate' : 'readVersion', command = method === 'candidate' ? { candidateId: id } : { versionId: id };
        const loaded = await repo.resource(client, domain, command, false), raw = await repo.execute(client, domain, command, {}, loaded);
        const projected = await ui.editorial(client, method, loaded, raw);
        if (projected.versionId && method === 'candidate' && !await readAllowed(context, projected.versionId)) projected.versionId = null;
        const authors = loaded.candidate.identity_record.authors.map(a => a.subjectId);
        let blocked = method === 'candidate' ? (projected.versionId ? 'STATE_CONFLICT' : raw.completion.result !== 'COMPLETE' ? 'INCOMPLETE' : null) : raw.state === 'PUBLISHED' ? 'STATE_CONFLICT' : null;
        if (method === 'version' && !blocked) {
          const evidence = loaded.version.approval_evidence;
          try { await coordinator.validateEpochs(evidence.scopeEpochs); if (evidence.validUntil !== null && (!Number.isSafeInteger(evidence.validUntil) || evidence.validUntil <= clock.now().getTime())) blocked = 'APPROVAL_STALE'; }
          catch { blocked = 'APPROVAL_STALE'; }
        }
        return { ...projected, actions: [await action(context, method === 'candidate' ? 'APPROVE' : 'PUBLISH', id,
          { authors, blocked, digest: method === 'candidate' ? loaded.candidate.candidate_digest : loaded.version.version_digest })] };
      }
      if (await pending(context, [id || input.draftId, org], input.idempotencyKey)) fail('STATE_CONFLICT');
      if (domainMethod[method]) {
        const command = method === 'create' ? { ...input, scopeId: null } : { ...input, draftId: id };
        const authoring = createAuthoringRepository({ organizationId: org, materialExtension: require('./competencyMaterial'),
          auditWriter: createAuthoringAuditWriter({ organizationId: org, tenantId: org, clock: () => clock.now() }) });
        const service = createPreparedAuthoringService({ repository: authoring, contexts, loader: createAuthoringResourceLoader({ organizationId: org }), revalidate: () => resolve(state.handle),
          async protectAuthorization(prepared, operation, cmd, trusted, target) {
            const intention = authoring.intention(operation, cmd);
            return (await protect(operationFor[method], cmd, trusted, target, null, { ...intention, key: cmd.idempotencyKey })).decision;
          } });
        return receipt(method, await service.execute(client, domainMethod[method], command, context, state.reconciliation));
      }
      let command;
      if (method === 'submit') command = { ...input, draftId: id };
      else {
        const loaded = await repo.resource(client, method, method === 'approve' ? { candidateId: id } : { versionId: id }, false);
        const digest = method === 'approve' ? loaded.candidate.candidate_digest : loaded.version.version_digest;
        tokens.verify(input.concurrencyToken, binding(context, method.toUpperCase(), id, digest));
        command = method === 'approve' ? { candidateId: id, expectedCandidateDigest: digest, idempotencyKey: input.idempotencyKey }
          : { versionId: id, expectedVersionDigest: digest, idempotencyKey: input.idempotencyKey };
      }
      const service = createPreparedEditorialService({ repository: repo, contexts, revalidate: () => resolve(state.handle),
        async admitAuthorization(operation, cmd, trusted) {
          const target = resource(id, org, catalogs.operationCatalog.resolve(operationFor[method]).resourceType);
          if (!(await authorization.authorize(operationFor[method], trusted, target)).allowed) fail('NOT_AUTHORIZED');
        }, async protectAuthorization(prepared, operation, cmd, trusted, loaded) {
          const intention = repo.intention(operation, cmd);
          return protect(operationFor[method], cmd, trusted, loaded.resource, method === 'publish' ? loaded.version.approval_evidence : null, { ...intention, key: cmd.idempotencyKey });
        } });
      return receipt(method, await service.execute(client, method, command, context, state.reconciliation));
    });
  }
  async function attempt(state) {
    const opaque = Object.freeze({}); inputs.set(opaque, state);
    try {
      const lease = await runtime.resolve({ correlationId: state.context.correlationId,
        operationAdapter: adapters[operationFor[state.method] || 'F13_PROFILE_READ'], organizationContext: { organizationId: state.context.organizationId,
          membershipId: state.context.actor.membershipId, membershipVersion: state.context.actor.membershipVersion } });
      return await lease.execute(opaque);
    } catch (error) {
      if (error.internalCode === 'COMMIT_UNCERTAIN') return { uncertainCommit: true };
      if (error.code || error.internalCode) throw Object.assign(new Error('Editorial UI operation refused.'), { code: error.internalCode || error.code });
      throw tenantFailure('SERVICE_UNAVAILABLE', 'TENANT_OPERATION_UNAVAILABLE');
    } finally { inputs.delete(opaque); }
  }
  return Object.freeze({ async execute(method, input, id, request) {
    const handle = await authority.captureAuthenticatedRequest(request), context = await resolve(handle);
    coordinator.registerRecovery(context.organizationId, createTenantAuthorityRecovery(dependencies));
    if (method === 'lookup') return require('./editorialUiRecovery').lookup({ input, context, handle, authority, data, policy, catalogs, coordinator, dependencies, clock });
    const selected = request.organizationContext?.organization;
    const state = { method, input, id, handle, context, reconciliation: false, organizationName: selected?.displayName || selected?.display_name || selected?.name };
    const result = await attempt(state);
    if (!result?.uncertainCommit) return result;
    await coordinator.reconcile(state.guard);
    state.context = await resolve(handle); state.reconciliation = true; state.guard = null;
    const recovered = await attempt(state);
    if (!recovered || recovered.uncertainCommit) fail('SERVICE_UNAVAILABLE');
    return recovered;
  } });
}
module.exports = { createEditorialUiComposition };
