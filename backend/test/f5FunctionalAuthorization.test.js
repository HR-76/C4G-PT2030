const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuditCoordinator, AUDIT_CLASSES, EVENT_CATALOG, sanitizeAuditEvent } = require('../src/authorization/audit');
const { createAuthorizationService } = require('../src/authorization/authorizationService');
const { createChannelAdapter, createServiceActor, CHANNELS } = require('../src/authorization/channelAdapters');
const {
  PROFILE_CODES, SCOPE_TYPES, createOperationCatalog, createPermissionCatalog,
  createProductionCatalogs, createProfileCatalog
} = require('../src/authorization/catalogs');
const { createMetricsPort } = require('../src/authorization/metrics');
const { createPolicyEngine, scopeMatches } = require('../src/authorization/policyEngine');
const { validateProductionAuthorizationBootstrap } = require('../src/authorization/productionAuthorization');
const { MAX_SUPPORT_MS, evaluateSupportGrant } = require('../src/authorization/supportPolicy');
const {
  ACTOR_ID, ORGANIZATION_A, ORGANIZATION_B, actor, assurance, grant, membership,
  resource, snapshot, syntheticCatalogs
} = require('./support/f5AuthorizationFixtures');

const NOW = new Date('2030-01-15T12:00:00.000Z');
const nowSeconds = Math.floor(NOW.getTime() / 1000);
const recentMfaRequirement = Object.freeze({ maxAgeSeconds: 300, mfa: true,
  acceptedAcr: Object.freeze(['c4g-loa2']), acceptedAmr: Object.freeze(['otp']), amrMode: 'all' });

function harness(overrides = {}) {
  const catalogs = overrides.catalogs || syntheticCatalogs();
  const calls = [];
  const auditEvents = [];
  const metricEvents = [];
  const telemetryEvents = [];
  const currentMembership = overrides.membership || membership();
  const currentSnapshot = overrides.snapshot || snapshot();
  const currentResource = overrides.resource || resource();
  const auditPort = overrides.auditPort || { async accept(event) { auditEvents.push(event); return 'ACCEPTED'; } };
  const auditCoordinator = createAuditCoordinator({ port: auditPort, timeoutMs: 50 });
  const policyEngine = createPolicyEngine({ permissionCatalog: catalogs.permissionCatalog,
    profileCatalog: catalogs.profileCatalog, assurancePolicyVersion: 'c4g-assurance-v1', recentMfaRequirement });
  const service = createAuthorizationService({ operationCatalog: catalogs.operationCatalog,
    membershipPort: { async revalidate(value) { calls.push(['membership', value]); return currentMembership; } },
    authorizationDataPort: { async load(value) { calls.push(['snapshot', value]); return currentSnapshot; } },
    resourcePort: { async load(value) { calls.push(['resource', value]); return currentResource; } },
    policyEngine, auditCoordinator, clock: { now: () => NOW }, metricsPort: createMetricsPort(value => metricEvents.push(value)), telemetryPort: { record: (...value) => telemetryEvents.push(value) } });
  return { service, calls, auditEvents, metricEvents, telemetryEvents, catalogs };
}

function request(overrides = {}) {
  return { operationCode: 'SYNTHETIC_READ', actor: actor(), resourceId: 'resource-alpha',
    assuranceEvidence: null, correlationId: 'correlation-f5-001', ...overrides };
}

test('F10 common telemetry is emitted by the real F5 authorization path', async () => { const h=harness();await h.service.authorize(request({operationCode:'UNKNOWN'}));assert.equal(h.telemetryEvents[0][0],'F5');assert.equal(h.telemetryEvents[0][2].result,'DENY'); });

test('F5-AC-01/05/19 productive F13 catalog extends permissions without implicit profile grants', () => {
  const catalogs = validateProductionAuthorizationBootstrap();
  assert.equal(catalogs.permissionCatalog.size, 99);
  assert.equal(catalogs.operationCatalog.size, 113);
  assert.deepEqual(catalogs.operationCatalog.resolve('ORGANIZATION_MEMBERSHIP_READ'), {
    code: 'ORGANIZATION_MEMBERSHIP_READ', permission: 'organization_membership.read',
    resourceType: 'ORGANIZATION', effect: 'READ', auditEvent: 'AUTHORIZATION_ALLOWED'
  });
  assert.deepEqual(catalogs.permissionCatalog.permissions.map(item => item.code), ['billing.read','notification.read','organization_notice.manage',
    'audit_event.read', 'audit_event.verify', 'audit_event.export', 'audit_event.read_cross_organization',
    'document.upload.initiate', 'document.upload.confirm', 'document.read', 'document.version.create',
    'document.version.list', 'document.download.request', 'document.quarantine.manage',
    'async_job.replay', 'async_job.replay_approve',
    'opportunity.criteria.read','opportunity.criteria.edit','opportunity.criteria.confirm',
    'opportunity.read', 'opportunity.private.create', 'opportunity.private.update', 'opportunity.archive',
    'opportunity.restore', 'opportunity.duplicate.review', 'opportunity.duplicate.scan',
    'opportunity.catalog.reconcile', 'opportunity.central.manage',
    'opportunity_import.upload','opportunity_import.preview','opportunity_import.confirm','opportunity_import.read',
    'opportunity_import.cancel','opportunity_import.review','opportunity_import.download_report',
    'organizational_scope.read', 'organizational_scope.create', 'organizational_scope.rename',
    'organizational_scope.reparent', 'organizational_scope.archive',
    'profile_taxonomy.read', 'profile_taxonomy.release.create', 'profile_taxonomy.local_concept.create',
    'profile_taxonomy.local_concept.approve', 'profile_taxonomy.relation.create',
    'profile_taxonomy.mapping.create', 'profile_taxonomy.release.publish',
    'organization_profile.read','organization_profile.approve','organization_profile.activate','prequalification.evaluate','prequalification.decide','prequalification.read','organization_profile.publish',
    'organization_profile.draft.create', 'organization_profile.draft.edit', 'organization_profile.submit',
    'profile_evidence.attach', 'profile_evidence.link.read', 'profile_assertion.revoke', 'profile_competency.verify',
    'profile_financial.create','profile_financial.edit','profile_financial.read','profile_financial.submit',
    'profile_financial.verify','profile_financial.reject','profile_financial.dispute','profile_financial.revoke',
    'profile_operational.create','profile_operational.edit','profile_operational.read','profile_operational.submit',
    'profile_operational.verify','profile_operational.reject','profile_operational.dispute','profile_operational.revoke',
    'profile_population.create','profile_population.edit','profile_population.read','profile_population.submit',
    'profile_population.verify','profile_population.reject','profile_population.dispute','profile_population.revoke',
    'opportunity_interest.read','opportunity_interest.register','opportunity_interest.manage',
    'application.read','application.create','application.edit','application.transition','application.review.decide',
    'organization_directory.read','organization_directory.edit','organization_membership.read','organization_membership.manage','personal_profile.read','personal_profile.edit'
  ]);
  assert.deepEqual(catalogs.profileCatalog.profiles.map(item => item.code), PROFILE_CODES);
  assert.ok(catalogs.profileCatalog.profiles.every(item => item.permissions.length === 0));
  assert.throws(() => catalogs.permissionCatalog.permissions.push('legacy.admin'), TypeError);
});

test('F5-AC-01/16 catalogs reject wildcard, duplicates, unknown permissions and extra fields', () => {
  assert.throws(() => createPermissionCatalog(Object.freeze({ version: 'v1', permissions: Object.freeze([
    Object.freeze({ code: 'resource.*', scopes: Object.freeze(['ORGANIZATION']), sensitive: false, sodRule: null, auditEvent: 'AUTHORIZATION_ALLOWED' })
  ]) })), /invalid/);
  const permissions = syntheticCatalogs().permissionCatalog;
  assert.throws(() => createProfileCatalog(Object.freeze({ version: 'v1', profiles: Object.freeze([
    ...PROFILE_CODES.map(code => Object.freeze({ code, permissions: Object.freeze(code === 'VIEWER' ? ['missing.read'] : []) }))
  ]) }), permissions), /invalid/);
  assert.throws(() => createOperationCatalog(Object.freeze({ version: 'v1', operations: Object.freeze([
    Object.freeze({ code: 'BAD', permission: 'missing.read', resourceType: 'RESOURCE', effect: 'READ', auditEvent: 'AUTHORIZATION_ALLOWED' })
  ]) }), permissions), /invalid/);
});

test('F5-AC-02 unknown operation is denied before membership, policy data or resource access', async () => {
  const h = harness();
  const result = await h.service.authorize(request({ operationCode: 'UNKNOWN_OPERATION' }));
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, 'OPERATION_NOT_REGISTERED');
  assert.deepEqual(h.calls, []);
});

test('F5-AC-03 membership and organization context are mandatory and revalidated', async () => {
  for (const bad of [membership({ status: 'SUSPENDED' }), membership({ organizationId: ORGANIZATION_B })]) {
    const h = harness({ membership: bad });
    const result = await h.service.authorize(request());
    assert.equal(result.allowed, false);
    assert.equal(h.calls.filter(call => call[0] === 'resource').length, 0);
  }
});

test('F5-AC-04/12/20 cross-organization IDOR is uniform and cannot reach another tenant resource', async () => {
  const h = harness({ resource: resource({ id: 'resource-beta', organizationId: ORGANIZATION_B }) });
  const result = await h.service.authorize(request({ resourceId: 'resource-beta' }));
  assert.deepEqual(result, { allowed: false, reasonCode: 'RESOURCE_NOT_AVAILABLE', publicCode: 'RESOURCE_NOT_AVAILABLE' });
  assert.deepEqual(h.calls.find(call => call[0] === 'resource')[1], {
    organizationId: ORGANIZATION_A, resourceType: 'SYNTHETIC_RESOURCE', resourceId: 'resource-beta'
  });
});

test('F5-AC-06 supports only the five closed scope types and evaluates each deterministically', () => {
  assert.deepEqual(SCOPE_TYPES, ['ORGANIZATION', 'UNIT', 'UNIT_SUBTREE', 'TEAM', 'RESOURCE']);
  const r = resource();
  const scope = (type, id) => ({ type, id, organizationId: ORGANIZATION_A });
  assert.equal(scopeMatches(scope('ORGANIZATION', ORGANIZATION_A), r, ORGANIZATION_A), true);
  assert.equal(scopeMatches(scope('UNIT', 'unit-child'), r, ORGANIZATION_A), true);
  assert.equal(scopeMatches(scope('UNIT_SUBTREE', 'unit-root'), r, ORGANIZATION_A), true);
  assert.equal(scopeMatches(scope('TEAM', 'team-alpha'), r, ORGANIZATION_A), true);
  assert.equal(scopeMatches(scope('RESOURCE', 'resource-alpha'), r, ORGANIZATION_A), true);
  assert.equal(scopeMatches(scope('TEAM', 'team-beta'), r, ORGANIZATION_A), false);
});

test('F5-AC-05/07 profile is not permission and positive grants compose without DENY', async () => {
  const withoutGrant = harness({ snapshot: snapshot({ grants: Object.freeze([]) }) });
  assert.equal((await withoutGrant.service.authorize(request())).reasonCode, 'PERMISSION_NOT_GRANTED');
  const withGrant = harness();
  assert.equal((await withGrant.service.authorize(request())).allowed, true);
});

test('F5-AC-08/09 SoD and RECENT_MFA enforce distinct actor and 300 second freshness', async () => {
  const updateGrant = grant('synthetic_resource.update');
  const validSnapshot = snapshot({ grants: Object.freeze([updateGrant]),
    sodRules: Object.freeze([Object.freeze({ code: 'TWO_PERSON', distinctFromActorIds: Object.freeze(['approver-synthetic']) })]) });
  const valid = harness({ snapshot: validSnapshot });
  assert.equal((await valid.service.authorize(request({ operationCode: 'SYNTHETIC_UPDATE', assuranceEvidence: assurance(nowSeconds - 300) }))).allowed, true);
  const stale = harness({ snapshot: validSnapshot });
  assert.equal((await stale.service.authorize(request({ operationCode: 'SYNTHETIC_UPDATE', assuranceEvidence: assurance(nowSeconds - 301) }))).reasonCode, 'AUTH_EVIDENCE_EXPIRED');
  const selfApproval = harness({ snapshot: snapshot({ grants: Object.freeze([updateGrant]),
    sodRules: Object.freeze([Object.freeze({ code: 'TWO_PERSON', distinctFromActorIds: Object.freeze([ACTOR_ID]) })]) }) });
  assert.equal((await selfApproval.service.authorize(request({ operationCode: 'SYNTHETIC_UPDATE', assuranceEvidence: assurance(nowSeconds) }))).reasonCode, 'SOD_VIOLATION');
});

test('F5-AC-10 support requires dual approval, opaque ticket, valid scope and maximum four hours', () => {
  const base = { status: 'ACTIVE', operatorId: 'support-1', organizationId: ORGANIZATION_A,
    ticketRef: 'ticket-ref-opaque', reasonCode: 'CUSTOMER_REQUEST', organizationApproverId: 'org-approver',
    c4gApproverId: 'c4g-approver', approvedAt: '2030-01-15T10:00:00.000Z', startsAt: '2030-01-15T11:00:00.000Z',
    expiresAt: '2030-01-15T15:00:00.000Z', scopeType: 'RESOURCE', scopeId: 'resource-alpha' };
  assert.equal(evaluateSupportGrant(base, { actorId: 'support-1', organizationId: ORGANIZATION_A,
    resource: resource(), now: NOW }).allowed, true);
  assert.equal(Date.parse(base.expiresAt) - Date.parse(base.startsAt), MAX_SUPPORT_MS);
  assert.equal(evaluateSupportGrant({ ...base, c4gApproverId: 'org-approver' }, { actorId: 'support-1',
    organizationId: ORGANIZATION_A, resource: resource(), now: NOW }).allowed, false);
  assert.equal(evaluateSupportGrant({ ...base, autoRenew: true }, { actorId: 'support-1',
    organizationId: ORGANIZATION_A, resource: resource(), now: NOW }).reasonCode, 'SUPPORT_GRANT_INVALID');
});

test('F5-AC-11 stale authoritative versions deny the next request and no cache exists', async () => {
  const h = harness({ snapshot: snapshot({ authorizationVersion: 8 }) });
  assert.equal((await h.service.authorize(request())).reasonCode, 'AUTHORIZATION_VERSION_STALE');
  assert.equal(Object.keys(require.cache).some(key => /authorization.*cache/i.test(key)), false);
});

test('F5-AC-13 common adapters produce the same result and never execute effects after deny', async () => {
  const operationByChannel = { API: 'SYNTHETIC_READ', JOB: 'SYNTHETIC_JOB', REPORTING: 'SYNTHETIC_REPORT',
    EXPORT: 'SYNTHETIC_EXPORT', DOCUMENT: 'SYNTHETIC_DOCUMENT' };
  for (const channel of CHANNELS) {
    let effects = 0;
    const h = harness();
    const adapter = createChannelAdapter({ channel, operationCode: operationByChannel[channel], authorizationService: h.service,
      effect: async () => { effects += 1; return channel; } });
    const allowed = await adapter.execute({ actor: actor(), resourceId: 'resource-alpha', assuranceEvidence: null,
      correlationId: `correlation-${channel}`, payload: null });
    assert.equal(allowed.allowed, true);
    assert.equal(effects, 1);
    const deniedHarness = harness({ membership: membership({ status: 'SUSPENDED' }) });
    const denied = createChannelAdapter({ channel, operationCode: operationByChannel[channel], authorizationService: deniedHarness.service,
      effect: async () => { effects += 1; } });
    assert.equal((await denied.execute({ actor: actor(), resourceId: 'resource-alpha', assuranceEvidence: null,
      correlationId: `deny-${channel}`, payload: null })).allowed, false);
    assert.equal(effects, 1);
  }
});

test('F5-AC-14/17 audit allowlist sanitizes and critical failure aborts while deny remains deny', async () => {
  assert.equal(EVENT_CATALOG.SUPPORT_USED, AUDIT_CLASSES.CRITICAL);
  assert.throws(() => sanitizeAuditEvent({ eventId: 'event-1', schemaVersion: 'v1', occurredAt: NOW.toISOString(),
    eventType: 'AUTHORIZATION_DENIED', actorType: 'HUMAN', actorId: ACTOR_ID, organizationId: ORGANIZATION_A,
    operationCode: 'SYNTHETIC_READ', permissionCode: 'synthetic_resource.read', result: 'DENY',
    reasonCode: 'TEST', correlationId: 'correlation-1', token: 'forbidden' }), /forbidden/);
  const failing = harness({ snapshot: snapshot({ grants: Object.freeze([grant('synthetic_resource.update')]),
    sodRules: Object.freeze([Object.freeze({ code: 'TWO_PERSON', distinctFromActorIds: Object.freeze(['approver']) })]) }),
    auditPort: { async accept() { return 'REJECTED'; } } });
  const critical = await failing.service.authorize(request({ operationCode: 'SYNTHETIC_UPDATE', assuranceEvidence: assurance(nowSeconds) }));
  assert.equal(critical.allowed, false);
  assert.equal(critical.reasonCode, 'AUDIT_CRITICAL_UNAVAILABLE');
  const denied = harness({ membership: membership({ status: 'SUSPENDED' }), auditPort: { async accept() { throw new Error('offline'); } } });
  assert.equal((await denied.service.authorize(request())).allowed, false);
});

test('F5-AC-15 A/B and multi-membership never merge grants across organizations', async () => {
  const h = harness({ snapshot: snapshot({ organizationId: ORGANIZATION_B }) });
  assert.equal((await h.service.authorize(request())).allowed, false);
  const otherActor = actor({ organizationId: ORGANIZATION_B, membershipId: 'membership-beta' });
  const other = harness({ membership: membership({ id: 'membership-beta', organizationId: ORGANIZATION_B }),
    snapshot: snapshot({ organizationId: ORGANIZATION_B }), resource: resource({ organizationId: ORGANIZATION_B }) });
  assert.equal((await other.service.authorize(request({ actor: otherActor }))).allowed, false);
});

test('F5-AC-16 closed inputs reject caller supplied permission, policy, tenant, scope or SQL', async () => {
  const h = harness();
  for (const field of ['permission', 'policy', 'tenant', 'scope', 'sql']) {
    await assert.rejects(() => h.service.authorize({ ...request(), [field]: 'caller-controlled' }), /not closed/);
  }
});

test('F5-AC-17 unavailable ports fail closed with no effect', async () => {
  const h = harness();
  h.service = createAuthorizationService;
  for (const failure of ['membership', 'snapshot', 'resource']) {
    const base = harness();
    const service = createAuthorizationService({ operationCatalog: base.catalogs.operationCatalog,
      membershipPort: { async revalidate() { if (failure === 'membership') throw new Error(); return membership(); } },
      authorizationDataPort: { async load() { if (failure === 'snapshot') throw new Error(); return snapshot(); } },
      resourcePort: { async load() { if (failure === 'resource') throw new Error(); return resource(); } },
      policyEngine: createPolicyEngine({ permissionCatalog: base.catalogs.permissionCatalog,
        profileCatalog: base.catalogs.profileCatalog, assurancePolicyVersion: 'c4g-assurance-v1', recentMfaRequirement }),
      auditCoordinator: createAuditCoordinator({ port: { async accept() { return 'ACCEPTED'; } }, timeoutMs: 20 }),
      clock: { now: () => NOW }, metricsPort: createMetricsPort(() => {}) });
    assert.equal((await service.authorize(request())).allowed, false);
  }
});

test('F5-AC-18 uses only synthetic in-memory ports and F5-AC-19 has no legacy fallback', () => {
  const sources = ['catalogs', 'policyEngine', 'authorizationService', 'channelAdapters', 'supportPolicy']
    .map(name => require('node:fs').readFileSync(require.resolve(`../src/authorization/${name}`), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /DATABASE_URL|CENTRAL_DATABASE_URL|authorizeRoles|platformRoles|PROFESSOR|\bADMIN\b|postgresql:\/\//);
  assert.doesNotMatch(sources, /permission\s*:\s*['"]\*|\.\*['"]/);
});

test('service actors are immutable and fixed to organization and operation', () => {
  const value = createServiceActor({ serviceId: 'service-export', organizationId: ORGANIZATION_A,
    operationCode: 'SYNTHETIC_READ', executionId: 'execution-1', authorizationVersion: 7 });
  assert.equal(value.organizationId, ORGANIZATION_A);
  assert.equal(value.operationCode, 'SYNTHETIC_READ');
  assert.ok(Object.isFrozen(value));
});

test('F5-AC-10 support use is authorized only inside its grant and requires critical audit acceptance', async () => {
  const supportActor = actor({ type: 'SUPPORT', id: 'support-1' });
  const supportGrant = Object.freeze({ status: 'ACTIVE', operatorId: 'support-1', organizationId: ORGANIZATION_A,
    ticketRef: 'opaque-ticket-reference', reasonCode: 'CUSTOMER_REQUEST', organizationApproverId: 'org-approver',
    c4gApproverId: 'c4g-approver', approvedAt: '2030-01-15T10:00:00.000Z', startsAt: '2030-01-15T11:00:00.000Z',
    expiresAt: '2030-01-15T15:00:00.000Z', scopeType: 'RESOURCE', scopeId: 'resource-alpha' });
  const accepted = harness({ snapshot: snapshot({ supportGrant }) });
  assert.equal((await accepted.service.authorize(request({ actor: supportActor,
    assuranceEvidence: assurance(nowSeconds) }))).allowed, true);
  assert.equal(accepted.auditEvents.at(-1).eventType, 'SUPPORT_USED');
  const unavailable = harness({ snapshot: snapshot({ supportGrant }), auditPort: { async accept() { return 'REJECTED'; } } });
  assert.equal((await unavailable.service.authorize(request({ actor: supportActor,
    assuranceEvidence: assurance(nowSeconds) }))).reasonCode, 'AUDIT_CRITICAL_UNAVAILABLE');
  const noMfa = harness({ snapshot: snapshot({ supportGrant }) });
  assert.equal((await noMfa.service.authorize(request({ actor: supportActor }))).reasonCode, 'AUTH_EVIDENCE_MISSING');
});

test('F5-AC-13/16 service actor binding fixes organization and operation and cannot be widened on replay', async () => {
  const serviceActor = createServiceActor({ serviceId: 'service-report', organizationId: ORGANIZATION_A,
    operationCode: 'SYNTHETIC_JOB', executionId: 'execution-1', authorizationVersion: 7 });
  const h = harness({ membership: membership({ id: 'service:execution-1' }),
    snapshot: snapshot({ membershipVersion: 1 }) });
  assert.equal((await h.service.authorize(request({ actor: serviceActor, operationCode: 'SYNTHETIC_JOB' }))).allowed, true);
  await assert.rejects(() => h.service.authorize(request({ actor: serviceActor, operationCode: 'SYNTHETIC_UPDATE' })), /not closed/);
  assert.throws(() => createServiceActor({ serviceId: 'service-report', organizationId: '',
    operationCode: 'SYNTHETIC_READ', executionId: 'execution-2', authorizationVersion: 7 }), /invalid/);
});

test('F5-AC-13/14 critical job, export and document audit failures abort before their effect', async () => {
  for (const [channel, operationCode] of [['JOB', 'SYNTHETIC_JOB'], ['EXPORT', 'SYNTHETIC_EXPORT'], ['DOCUMENT', 'SYNTHETIC_DOCUMENT']]) {
    let effects = 0;
    const h = harness({ auditPort: { async accept(event) {
      return ['SERVICE_JOB_DISPATCHED', 'EXPORT_ALLOWED', 'DOCUMENT_ALLOWED'].includes(event.eventType)
        ? 'REJECTED' : 'ACCEPTED';
    } } });
    const adapter = createChannelAdapter({ channel, operationCode, authorizationService: h.service,
      effect: async () => { effects += 1; } });
    const result = await adapter.execute({ actor: actor(), resourceId: 'resource-alpha', assuranceEvidence: null,
      correlationId: `critical-${channel}`, payload: null });
    assert.equal(result.allowed, false);
    assert.equal(result.reasonCode, 'AUDIT_CRITICAL_UNAVAILABLE');
    assert.equal(effects, 0);
  }
});

test('F5-AC-14 audit taxonomy is closed across critical, deny, observational and outside-F5 classes', () => {
  assert.deepEqual(new Set(Object.values(AUDIT_CLASSES)), new Set([
    'CRITICAL_PRE_EFFECT', 'DENY_PRESERVING', 'OBSERVATIONAL_RECONCILABLE', 'OUTSIDE_F5'
  ]));
  for (const required of ['GRANT_CHANGED', 'PROFILE_CHANGED', 'SOD_CHANGED', 'SENSITIVE_ACTION_ALLOWED',
    'SUPPORT_GRANTED', 'SUPPORT_STARTED', 'SUPPORT_USED', 'SUPPORT_REVOKED', 'SUPPORT_EXPIRED',
    'AUTHORIZATION_ALLOWED', 'AUTHORIZATION_DENIED', 'AUTHORIZATION_MFA_REQUIRED',
    'SERVICE_JOB_DISPATCHED', 'SERVICE_JOB_COMPLETED', 'EXPORT_ALLOWED', 'EXPORT_COMPLETED',
    'DOCUMENT_ALLOWED', 'DOCUMENT_COMPLETED']) assert.ok(EVENT_CATALOG[required]);
});

test('F5-AC-17 malformed policy snapshots fail closed instead of throwing or accessing effects', async () => {
  const h = harness({ snapshot: Object.freeze({ organizationId: ORGANIZATION_A, membershipVersion: 3,
    authorizationVersion: 7, profileCode: 'VIEWER' }) });
  const result = await h.service.authorize(request());
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, 'POLICY_INVALID');
});

test('metrics reject tenant, user and resource labels', () => {
  const metrics = createMetricsPort(() => {});
  metrics.record({ result: 'ALLOW', reasonCode: 'AUTHORIZED', category: 'AUTHORIZATION' });
  for (const key of ['tenantId', 'userId', 'resourceId']) assert.throws(() => metrics.record({ result: 'DENY', [key]: 'x' }), /invalid/);
});
