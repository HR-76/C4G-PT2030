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
const { createPq1Repository } = require('./pq1Repository');
const { createEditorialAuditWriter } = require('./editorialAudit');
const { createAuthoringRepository } = require('./authoringRepository');
const { createAuthoringAuditWriter } = require('./authoringAudit');
const { createAuthoringResourceLoader } = require('./authoringResources');
const { createPq1UiRepository } = require('./pq1UiRepository');
const { createEditorialUiAudit } = require('./editorialUiAudit');
const { createPreparedAuthoringService } = require('./authoringService');
const { createPreparedEditorialService } = require('./editorialService');
const { createPq1UiTokens } = require('./pq1UiTokens');
const { fail, receipt } = require('./pq1UiContracts');
const operationFor = { create: 'F13_PROFILE_DRAFT_CREATE', edit: 'F13_PROFILE_DRAFT_EDIT', submit: 'F13_PROFILE_SUBMIT',
  approve: 'F13_PROFILE_APPROVE', publish: 'F13_PROFILE_PUBLISH', competencies: 'F13_COMPETENCY_DRAFT_EDIT', experiences: 'F13_EXPERIENCE_DRAFT_EDIT', attach: 'F13_EVIDENCE_ATTACH', verify: 'F13_COMPETENCY_VERIFY', revoke: 'F13_ASSERTION_REVOKE' };
const { OPS: uiOperations, domain: competencyMethods } = require('./pq1UiContracts');
const { intentDigest } = require('../security/tenantRepositorySupport');
const { createCompetencyRepository } = require('./competencyRepository');
const { createCompetencyResourceLoader } = require('./competencyResources');
const { createPreparedCompetencyService } = require('./competencyService');
const { createCompetencyAuditWriter } = require('./competencyAudit');
const { randomUUID } = require('node:crypto');
const domainMethod = { create: 'createDraft', edit: 'editDraft' };
function resource(id, org, type = 'PROFILE_PROJECTION', authors = []) {
  return { id, organizationId: org, resourceType: type, scopeType: 'ORGANIZATION', scopeId: null, status: 'ACTIVE',
    distinctFromActorIds: authors, unitId: null, ancestorUnitIds: [], teamIds: [] };
}
function createPq1UiComposition(options) {
  const { sessionStore, sessionRegistry, authorityCoordinator: coordinator, authorizationCatalogs: catalogs,
    tenantRuntimeDependencies: dependencies, assurancePolicyVersion: policyVersion, recentMfaRequirement,
    mfaCategory, tokenKeys, tokenKeyId, clock = { now: () => new Date() } } = options;
  const tokens = createPq1UiTokens({ keys: tokenKeys, currentKeyId: tokenKeyId, clock: () => clock.now().getTime() });
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
    const queryModule = Object.freeze({ moduleCode: `${operationCode}_PQ1_UI`, requiresAuditWrite: true,
      async execute({ client, input }) { try { return await run(client, inputs.get(input)); }
        catch (error) { options.onFailure?.(error); throw tenantFailure(error.code || 'SERVICE_UNAVAILABLE', 'TENANT_OPERATION_UNAVAILABLE'); } },
      beforeCommit: ({ client }) => client.query('RESET ROLE'),
      authorityGuard: Object.freeze({ assert({ client, input }) { coordinator.assert(inputs.get(input).guard, client, preparedAuthorityBinding(client).transactionId); },
        async complete({ input, outcome }) { if (inputs.get(input).guard) await coordinator.complete(inputs.get(input).guard, outcome); } }) });
    adapters[operationCode] = Object.freeze({ operationCode, queryModule });
    return Object.freeze({ operationCode, ownerModule: 'F13_EDITORIAL_BASELINE', accessMode: operationCode === 'F13_PROFILE_READ' ? 'READ' : 'WRITE', workload: 'API', workloadClass: 'FUNCTIONAL', queryModule,
      compatibleSchemaVersions: Object.freeze(['018_f13_pq1_publication','019_f13_pq1_activation','020_f14_pq1_decisions','021_application_first_slice','022_application_team_tasks']), requiredCapabilities: Object.freeze(['F13_PQ1_PUBLICATION', 'F13_COMPETENCIES_AND_EXPERIENCE', 'F13_EDITORIAL_BASELINE_PUBLICATION', 'F13_PROFILE_AUTHORING', 'F7_AUDIT_LEDGER']),
      allowedCompatibilityStates: Object.freeze(['COMPATIBLE']), readOnlyEligible: false,
      inputSchema: Object.freeze({ validate: value => inputs.has(value) }), resultSchema: Object.freeze({ validate: value => value !== undefined }),
      requiredPermission: operationCode, limits: Object.freeze({ maxPageSize: 100, maxRows: 10000, maxBytes: 1048576 }), timeoutMs: 10000 });
  });
  const runtime = createTenantRuntime({ ...dependencies, operationCatalog: createAuthorizedTenantOperationCatalog(
    Object.freeze({ catalogVersion: 'f13-pq1-ui-v1', operations: Object.freeze(operations) }), catalogs.operationCatalog) });
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
      const repo = createPq1Repository({ organizationId: org, clock: () => clock.now(), auditWriter: createEditorialAuditWriter({ organizationId: org, tenantId: org, clock: () => clock.now() }) });
      const ui = createPq1UiRepository({ organizationId: org, tokens, clock: () => clock.now() });
      async function protect(operation, command, trusted, target, approvalEvidence = null, intention = null) {
        const extra = [...(state.additionalAuthorizations || [])];
        if (operationFor[method] && method !== 'create' && target.id !== id)
          extra.push({ operationCode: 'F13_PROFILE_READ', resource: resource(id, org) });
        const protectedDecision = await guardPort.protect(client, { handle: state.handle, operationCode: operation,
          resource: target, approvalEvidence, referenceDeadline: state.referenceDeadline || null,
          additionalAuthorizations: extra, intention: state.uiIntention || intention });
        state.guard = protectedDecision.token; return protectedDecision;
      }
      async function revocationResource(verificationId) {
        const v = (await client.query('SELECT * FROM organization_profile.competency_verification_result WHERE organization_id=$1 AND verification_id=$2',[org,verificationId])).rows[0];
        if (!v) fail('RESOURCE_NOT_AVAILABLE');
        const authors = (await client.query(`SELECT actor_subject_id FROM organization_profile.competency_assertion_version WHERE organization_id=$1 AND version_id=$2
          UNION SELECT actor_subject_id FROM organization_profile.competency_evidence_link WHERE organization_id=$1 AND assertion_version_id=$2
          UNION SELECT e.actor_subject_id FROM organization_profile.experience_evidence_version e JOIN organization_profile.competency_evidence_link l ON l.organization_id=e.organization_id AND l.experience_version_id=e.version_id WHERE l.organization_id=$1 AND l.assertion_version_id=$2`,[org,v.assertion_version_id])).rows.map(r=>r.actor_subject_id);
        return { verification:v,target:resource(v.assertion_version_id,org,'ASSERTION',authors) };
      }
      const requestResource = id || input.draftId;
      if (operationFor[method]) state.uiIntention = { operation: `PQ1_UI_${uiOperations[method]}`, key: input.idempotencyKey,
        digest: intentDigest({ organizationId: org, subjectId: context.actor.id, operation: uiOperations[method], resourceId: requestResource, input }) };
      async function finish(value) {
        await client.query(`INSERT INTO organization_profile.pq1_ui_receipt
          (organization_id,operation,idempotency_key,subject_id,resource_id,intention_digest,result_projection)
          VALUES($1,$2,$3,$4,$5,$6,$7)`, [org,uiOperations[method],input.idempotencyKey,context.actor.id,requestResource,state.uiIntention.digest,JSON.stringify(value)]);
        return value;
      }
      if (operationFor[method]) {
        const previous = (await client.query(`SELECT * FROM organization_profile.pq1_ui_receipt
          WHERE organization_id=$1 AND operation=$2 AND idempotency_key=$3`, [org,uiOperations[method],input.idempotencyKey])).rows[0];
        if (previous) {
          if (previous.subject_id !== context.actor.id || previous.resource_id !== requestResource
            || previous.intention_digest !== state.uiIntention.digest) fail('IDEMPOTENCY_CONFLICT');
          let target = resource(method === 'create' ? org : requestResource, org, catalogs.operationCatalog.resolve(operationFor[method]).resourceType);
          if (competencyMethods[method]) {
            const loaded = await createCompetencyResourceLoader({ organizationId: org }).load(client, competencyMethods[method], { ...input, draftId: id }, true);
            target = loaded.resource; state.additionalAuthorizations = loaded.additionalAuthorizations;
          } else if (method === 'revoke') {
            target = (await revocationResource(id)).target;
          } else if (['approve','publish'].includes(method)) {
            const loaded = await repo.resource(client, method, method === 'approve' ? { candidateId: id } : { versionId: id }, true);
            target = loaded.resource; state.additionalAuthorizations = loaded.additionalAuthorizations;
          }
          await protect(operationFor[method], null, context, target);
          return previous.result_projection;
        }
        if (state.reconciliation) fail('SERVICE_UNAVAILABLE');
      }
      if (!operationFor[method]) {
        if (['draft','revision'].includes(method)) {
          const revision = method === 'revision' ? Number(state.path.revision) : null;
          if (method === 'revision' && (!Number.isSafeInteger(revision) || revision < 1)) fail('INVALID_INPUT');
          const draft = await ui.draft(client, id, revision);
          state.additionalAuthorizations = await require('./pq1Source').documentAuthorizations(client, org, draft.links);
          await protect('F13_PROFILE_READ', null, context, resource(readId, org), null, { operation: 'PQ1_READ' });
          const blocked = draft.lifecycle !== 'DRAFT' || method === 'revision' ? 'STATE_CONFLICT' : null;
          const actions = await Promise.all(['EDIT','SUBMIT'].map(op => action(context, op, id, { blocked })));
          const verifications = [];
          for (const v of draft.verifications) {
            const revoked = (await client.query('SELECT event_id FROM organization_profile.pq1_verification_status_event WHERE organization_id=$1 AND verification_id=$2', [org,v.verificationId])).rows[0];
            const allowed = (await evaluate(context, 'F13_ASSERTION_REVOKE', (await revocationResource(v.verificationId)).target)).allowed;
            verifications.push({ ...v, revoke: allowed && !revoked ? tokens.issue(binding(context, 'REVOKE', v.verificationId, intentDigest({ verificationId:v.verificationId,sequence:0 }))) : null });
          }
          return { ...draft, verifications, actions };
        }
        if (['candidate','version'].includes(method)) {
          const loaded = await repo.resource(client, method === 'candidate' ? 'readCandidate' : 'readVersion', method === 'candidate' ? { candidateId:id } : { versionId:id }, false);
          state.additionalAuthorizations = loaded.additionalAuthorizations;
        }
        await protect('F13_PROFILE_READ', null, context, resource(readId, org), null, { operation: 'PQ1_READ' });
        if (method === 'context') {
          return { enabled: true, organization: { id: org, name: state.organizationName || org }, canCreateDraft: (await action(context, 'CREATE', org)).status === 'AVAILABLE', mfa: { category: mfaCategory, stepUpPath: '/api/auth/step-up' } };
        }
        const allowed = async (op, targetId, type) => (await evaluate(context,op,resource(targetId,org,type))).allowed;
        if (method === 'catalog') {
          if (['THEMATIC_AREA','STRATEGIC_PRIORITY'].includes(input.kind)) return ui.page(client,method,
            { ...input, domain:input.kind,locale:'pt-PT' },context,releaseId=>allowed('F13_TAXONOMY_READ',releaseId,'TAXONOMY_RELEASE'));
          return require('./pq1Selections').catalog({ client,organizationId:org,input,context,tokens,allowed });
        }
        if (method === 'documents') return require('./pq1Selections').documents({ client,organizationId:org,draftId:id,experienceId:state.path.experienceId,input,context,tokens,allowed });
        if (['drafts','candidates','versions'].includes(method)) return ui.page(client,method,input,context,candidateId=>readAllowed(context,candidateId));
        const domain = method === 'candidate' ? 'readCandidate' : 'readVersion', command = method === 'candidate' ? { candidateId: id } : { versionId: id };
        const loaded = await repo.resource(client, domain, command, false), raw = await repo.execute(client, domain, command, {}, loaded);
        const projected = await ui.editorial(client, method, loaded, raw);
        if (projected.versionId && method === 'candidate' && !await readAllowed(context, projected.versionId)) projected.versionId = null;
        const authors = loaded.candidate.identity_record.authors.map(a => a.subjectId);
        let blocked = method === 'candidate' ? (projected.versionId ? 'STATE_CONFLICT' : raw.completion.result !== 'COMPLETE' ? 'INCOMPLETE' : null) : raw.state === 'PUBLISHED' ? 'STATE_CONFLICT' : null;
        if (!blocked && projected.verifications.some(v => v.currentStatus !== v.effectiveStatusAtSubmission)) blocked = 'APPROVAL_STALE';
        if (method === 'version' && !blocked) {
          const evidence = loaded.version.approval_evidence;
          try { await coordinator.validateEpochs(evidence.scopeEpochs); if (evidence.validUntil !== null && (!Number.isSafeInteger(evidence.validUntil) || evidence.validUntil <= clock.now().getTime())) blocked = 'APPROVAL_STALE'; }
          catch { blocked = 'APPROVAL_STALE'; }
        }
        return { ...projected, actions: [await action(context, method === 'candidate' ? 'APPROVE' : 'PUBLISH', id,
          { authors, blocked, digest: method === 'candidate' ? loaded.candidate.candidate_digest : loaded.version.version_digest })] };
      }
      if (await pending(context, [id || input.draftId], input.idempotencyKey)) fail('STATE_CONFLICT');
      if (method === 'revoke') {
        const v = (await client.query('SELECT * FROM organization_profile.competency_verification_result WHERE organization_id=$1 AND verification_id=$2', [org,id])).rows[0];
        if (!v) fail('RESOURCE_NOT_AVAILABLE');
        const old = (await client.query('SELECT 1 FROM organization_profile.pq1_verification_status_event WHERE organization_id=$1 AND verification_id=$2',[org,id])).rowCount;
        if (old) fail('STATE_CONFLICT');
        tokens.verify(input.concurrencyToken,binding(context,'REVOKE',id,intentDigest({verificationId:id,sequence:0})));
        const target = (await revocationResource(id)).target;
        const protectedDecision = await protect(operationFor[method],input,context,target);
        const eventId = randomUUID();
        await client.query(`INSERT INTO organization_profile.pq1_verification_status_event
          (event_id,organization_id,profile_scope_id,verification_id,sequence,status,reason_code,actor_subject_id,membership_id,recorded_at)
          VALUES($1,$2,$3,$4,1,'REVOKED',$5,$6,$7,$8)`,[eventId,org,v.profile_scope_id,id,input.reasonCode,context.actor.id,context.actor.membershipId,clock.now()]);
        await createCompetencyAuditWriter({ organizationId:org,tenantId:org,clock:()=>clock.now() }).append(client,{
          eventCode:'ASSERTION_REVOKED',operationCode:operationFor[method],resourceType:'ASSERTION',resourceId:v.assertion_version_id,
          actor:context.actor,authorizationEvidence:protectedDecision.decision.evaluation,correlationId:context.correlationId,
          idempotencyKey:input.idempotencyKey,detailCode:input.reasonCode,previousVersion:'0',newVersion:eventId,
          semanticDigest:intentDigest({verificationId:id,eventId,reasonCode:input.reasonCode}) });
        return finish(receipt(method,{verificationId:id}));
      }
      if (competencyMethods[method]) {
        const repoCompetency = createCompetencyRepository({ organizationId: org, clock: () => clock.now(),
          auditWriter: createCompetencyAuditWriter({ organizationId: org, tenantId: org, clock: () => clock.now() }) });
        const command = { ...input, draftId: id };
        if (method === 'experiences') {
          const draft = (await client.query('SELECT profile_scope_id FROM organization_profile.profile_draft WHERE organization_id=$1 AND draft_id=$2', [org,id])).rows[0];
          if (!draft) fail('RESOURCE_NOT_AVAILABLE');
          command.experiences = [];
          for (const e of input.experiences) {
            const old = (await client.query(`SELECT provenance_id FROM organization_profile.pq1_provenance WHERE organization_id=$1
              AND profile_scope_id=$2 AND experience_version_id=$3`, [org,draft.profile_scope_id,e.versionId])).rows[0];
            const provenanceRef = old?.provenance_id || randomUUID();
            if (!old) await client.query(`INSERT INTO organization_profile.pq1_provenance
              (provenance_id,organization_id,profile_scope_id,experience_version_id,actor_subject_id,membership_id,source_type)
              VALUES($1,$2,$3,$4,$5,$6,'ORGANIZATION_MANUAL')`, [provenanceRef,org,draft.profile_scope_id,e.versionId,context.actor.id,context.actor.membershipId]);
            command.experiences.push({ ...e, provenanceRef });
          }
        }
        if (method === 'competencies') for (const a of input.assertions) if (a.conceptId)
          await require('./pq1Source').concept(client, org, a.conceptId);
        const loader = createCompetencyResourceLoader({ organizationId: org });
        const service = createPreparedCompetencyService({ repository: repoCompetency, contexts,
          loader: { async load(c, op, cmd, replay) {
            const loaded = await loader.load(c, op, cmd, replay);
            if (method === 'verify') {
              const descriptor = await require('./pq1Source').method(c, org, cmd.methodId);
              if (descriptor.documentRequired && !loaded.state.documents.length) fail('DOCUMENT_REQUIRED');
              state.referenceDeadline = cmd.validUntil === null ? null : Date.parse(cmd.validUntil);
            }
            return loaded;
          } }, revalidate: () => resolve(state.handle),
          async protectAuthorization(c, op, cmd, trusted, target, extra) {
            state.additionalAuthorizations = extra;
            return (await protect(operationFor[method], cmd, trusted, target)).decision;
          } });
        return finish(receipt(method, await service.execute(client, competencyMethods[method], command, context)));
      }
      if (domainMethod[method]) {
        const command = method === 'create' ? { ...input, scopeId: null } : { ...input, draftId: id };
        const authoring = createAuthoringRepository({ organizationId: org, materialExtension: require('./competencyMaterial'),
          auditWriter: createAuthoringAuditWriter({ organizationId: org, tenantId: org, clock: () => clock.now() }) });
        const service = createPreparedAuthoringService({ repository: authoring, contexts, loader: createAuthoringResourceLoader({ organizationId: org }), revalidate: () => resolve(state.handle),
          async protectAuthorization(prepared, operation, cmd, trusted, target) {
            const intention = authoring.intention(operation, cmd);
            return (await protect(operationFor[method], cmd, trusted, target, null, { ...intention, key: cmd.idempotencyKey })).decision;
          } });
        return finish(receipt(method, await service.execute(client, domainMethod[method], command, context, state.reconciliation)));
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
          state.additionalAuthorizations = loaded.additionalAuthorizations || [];
          const deadlines = loaded.content.verifications.filter(v => v.effectiveStatusAtSubmission === 'VERIFIED' && v.validUntil !== null).map(v => Date.parse(v.validUntil));
          state.referenceDeadline = deadlines.length ? Math.min(...deadlines) : null;
          return protect(operationFor[method], cmd, trusted, loaded.resource, method === 'publish' ? loaded.version.approval_evidence : null, { ...intention, key: cmd.idempotencyKey });
        } });
      return finish(receipt(method, await service.execute(client, method, command, context, state.reconciliation)));
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
  return Object.freeze({ async execute(method, input, id, request, correlationId, path = {}) {
    const handle = await authority.captureAuthenticatedRequest(request), context = await resolve(handle);
    coordinator.registerRecovery(context.organizationId, createTenantAuthorityRecovery(dependencies));
    if (method === 'lookup') return require('./pq1UiRecovery').lookup({ input, context, handle, authority, data, policy, catalogs, coordinator, dependencies, clock });
    const selected = request.organizationContext?.organization;
    const state = { method, input, id, handle, context, path, reconciliation: false, organizationName: selected?.displayName || selected?.display_name || selected?.name };
    const result = await attempt(state);
    if (!result?.uncertainCommit) return result;
    await coordinator.reconcile(state.guard);
    state.context = await resolve(handle); state.reconciliation = true; state.guard = null;
    const recovered = await attempt(state);
    if (!recovered || recovered.uncertainCommit) fail('SERVICE_UNAVAILABLE');
    return recovered;
  } });
}
module.exports = { createPq1UiComposition };
