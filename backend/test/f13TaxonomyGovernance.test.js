'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProductionCatalogs } = require('../src/authorization/catalogs');
const { F13_TAXONOMY_EVENTS, resolveEvent } = require('../src/audit/eventCatalog');
const contracts = require('../src/organizationalProfile/taxonomyContracts');
const { OPS, createPreparedTaxonomyService } = require('../src/organizationalProfile/taxonomyService');
const { createTaxonomyAuthorization } = require('../src/organizationalProfile/taxonomyAuthorization');
const { createTaxonomyProductionComposition } = require('../src/organizationalProfile/taxonomyComposition');
const { createTaxonomySessions } = require('./support/f13TaxonomySessions');
const { createTaxonomyTelemetry } = require('../src/organizationalProfile/taxonomyTelemetry');
const { isUuidV7 } = require('../src/audit/uuidV7');
const U = { org: '01890f3e-7b12-7abc-8def-012345678901', actor: '01890f3e-7b12-7abc-8def-012345678902',
  member: '01890f3e-7b12-7abc-8def-012345678903', release: '01890f3e-7b12-7abc-8def-012345678904',
  scheme: '01890f3e-7b12-7abc-8def-012345678905', concept: '01890f3e-7b12-7abc-8def-012345678906', key: '01890f3e-7b12-7abc-8def-012345678907' };
const clock = { now: () => new Date('2026-10-11T12:00:00.000Z') };
const command = () => ({ releaseId: U.release, schemeId: U.scheme, schemeCode: 'THEMATIC_AREA', conceptId: U.concept,
  stableCode: 'CLIMATE', labels: [{ locale: 'pt-PT', kind: 'PREFERRED', label: 'Clima' }], idempotencyKey: U.key,
  provenance: { sourceType: 'ORGANIZATION_MANUAL', observedAt: clock.now().toISOString() } });

test('seven taxonomy F5 operations have independent permissions and empty profile bundles', () => {
  const catalogs = createProductionCatalogs({ catalogVersion: 'f13' });
  const permissions = Object.values(OPS).map(code => catalogs.operationCatalog.resolve(code).permission);
  assert.equal(new Set(permissions).size, 7);
  for (const profile of catalogs.profileCatalog.profiles) assert.deepEqual(profile.permissions, []);
});
test('six functional F7 taxonomy events remain critical and source local', () => {
  assert.equal(Object.keys(F13_TAXONOMY_EVENTS).length, 6);
  for (const code of Object.keys(F13_TAXONOMY_EVENTS)) {
    assert.equal(resolveEvent(code).auditClass, 'CRITICAL_PRE_EFFECT');
    assert.equal(resolveEvent(code).residencyRule, 'OPERATION_AUTHORITY');
  }
});
test('closed functional contracts reject every authority field and accessors before evaluation', () => {
  for (const key of ['actor', 'membershipId', 'organizationId', 'resourceId', 'correlationId', 'assurance', 'assuranceEvidence']) {
    assert.throws(() => contracts.validateCreateConcept({ ...command(), [key]: U.actor }), error => error.code === 'F13_INVALID_INPUT');
  }
  let reads = 0; const forged = command(); Object.defineProperty(forged, 'conceptId', { get() { reads++; return U.concept; } });
  assert.throws(() => contracts.validateCreateConcept(forged)); assert.equal(reads, 0);
});
test('prepared service rejects reconstructed internal contexts before any repository access', async () => {
  let calls = 0;
  const prepared = createPreparedTaxonomyService({ repository: { lockIntention() { calls++; } }, contexts: new WeakSet() });
  await assert.rejects(() => prepared.execute({}, 'createConcept', command(), {})); assert.equal(calls, 0);
});
test('session handles cannot be forged, cloned, or used after membership/session/version changes', async () => {
  const fixture = createTaxonomySessions({ organizationId: U.org, clock });
  const user = await fixture.user(U.actor, U.member);
  for (const fake of [{}, { actor: { id: U.actor } }, { ...user.handle }]) await assert.rejects(() => fixture.authority.resolve(fake));
  const resolved = await fixture.authority.resolve(user.handle); assert.equal(resolved.actor.id, U.actor);
  assert.equal(isUuidV7(resolved.correlationId), true);
  assert.notEqual(resolved.correlationId, (await fixture.authority.resolve(user.handle)).correlationId);
  fixture.memberships.get(U.member).status = 'REMOVED'; await assert.rejects(() => fixture.authority.resolve(user.handle));
  fixture.memberships.get(U.member).status = 'ACTIVE'; fixture.snapshots.get(U.member).authorizationVersion++;
  await assert.rejects(() => fixture.authority.resolve(user.handle)); fixture.snapshots.get(U.member).authorizationVersion--;
  await fixture.registry.revokeSession(user.sid); await assert.rejects(() => fixture.authority.resolve(user.handle));
});
test('composition rejects fabricated session authorities and fabricated capability evidence', async () => {
  const catalogs = createProductionCatalogs({ catalogVersion: 'f13' }), telemetry = createTaxonomyTelemetry({ metrics: { record() {} } });
  assert.throws(() => createTaxonomyProductionComposition({ authorizationCatalogs: catalogs, telemetry, sessionAuthority: { resolve() {} } }));
  const fixture = createTaxonomySessions({ organizationId: U.org, clock });
  const composition = createTaxonomyProductionComposition({ authorizationCatalogs: catalogs, telemetry, sessionAuthority: fixture.authority });
  let connections = 0;
  assert.throws(() => composition.bindTenant({ pool: { connect() { connections++; } }, organizationId: U.org, tenantId: U.org,
    tenantCapabilityEvidence: { tenantId: U.org, capabilities: ['F13_PROFILE_CATALOG_FOUNDATION'] }, ...fixture }));
  assert.equal(connections, 0);
});
test('real F5 evaluates a 7 by 7 asymmetric grant matrix and resource restrictions', async () => {
  const catalogs = createProductionCatalogs({ catalogVersion: 'f13' }), fixture = createTaxonomySessions({ organizationId: U.org, clock });
  const user = await fixture.user(U.actor, U.member), decisions = [];
  const authorization = createTaxonomyAuthorization({ catalogs, ...fixture, authorizationAuditPort: { async accept(event) { decisions.push(event); return 'ACCEPTED'; } },
    assurancePolicyVersion: 'c4g-assurance-v1', recentMfaRequirement: { maxAgeSeconds: 300, mfa: true, acceptedAcr: ['c4g-loa2'], acceptedAmr: ['otp'], amrMode: 'all' }, clock });
  for (const granted of Object.values(OPS)) for (const requested of Object.values(OPS)) {
    const operation = catalogs.operationCatalog.resolve(requested);
    fixture.grants(user, [{ permission: catalogs.operationCatalog.resolve(granted).permission, resourceId: U.concept }]);
    const resource = { id: U.concept, organizationId: U.org, resourceType: operation.resourceType,
      scopeType: 'ORGANIZATION', status: 'ACTIVE', distinctFromActorIds: [] };
    const decision = await authorization.authorize(requested, await fixture.authority.resolve(user.handle), resource);
    assert.equal(decision.allowed, granted === requested);
    if (decision.allowed) assert.equal(decision.evaluation.assuranceLevel, catalogs.permissionCatalog.resolve(operation.permission).sensitive ? 'RECENT_MFA' : 'SESSION');
  }
  fixture.grants(user, [{ permission: 'profile_taxonomy.read', resourceId: U.release }]);
  assert.equal((await authorization.authorize(OPS.readRelease, await fixture.authority.resolve(user.handle), {
    id: U.concept, organizationId: U.org, resourceType: 'TAXONOMY_RELEASE', scopeType: 'ORGANIZATION', status: 'ACTIVE', distinctFromActorIds: [] })).allowed, false);
  assert.equal(decisions.filter(event => event.result === 'ALLOW').length, 7);
});
test('taxonomy telemetry has only bounded operation and resultClass dimensions', async () => {
  const labels = [], telemetry = createTaxonomyTelemetry({ metrics: { record(name, value, dimensions) { labels.push(dimensions); } } });
  await telemetry.observe('taxonomy.read', async () => true);
  for (const dimensions of labels) assert.deepEqual(Object.keys(dimensions).sort(), ['operation', 'resultClass']);
});
test('taxonomy telemetry reaches the productive F10 registry', async () => {
  const { MetricRegistry } = require('../src/observability/metrics');
  const metrics = new MetricRegistry();
  await createTaxonomyTelemetry({ metrics }).observe('taxonomy.release.create', async () => true);
  assert.deepEqual(metrics.snapshot().records.map(row => row.name),
    ['c4g.profile_taxonomy.operation', 'c4g.profile_taxonomy.duration']);
});
test('scheme IDs are independent validated UUIDs', () => {
  const base = { releaseId: U.release, thematicSchemeId: U.scheme, prioritySchemeId: U.concept, releaseVersion: 'v1',
    semanticDigest: 'a'.repeat(64), defaultLocale: 'pt-PT', idempotencyKey: U.key, provenance: command().provenance };
  assert.ok(contracts.validateCreateRelease(base)); assert.throws(() => contracts.validateCreateRelease({ ...base, prioritySchemeId: U.scheme }));
});
