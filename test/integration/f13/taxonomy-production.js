'use strict';
const assert = require('node:assert/strict');
const { createProductionCatalogs } = require('../../../backend/src/authorization/catalogs');
const { preflightTenant } = require('../../../backend/src/security/tenantMigrationPreflight');
const { manifest } = require('../../../backend/src/security/tenantMigrationManifest');
const { createTaxonomyProductionComposition } = require('../../../backend/src/organizationalProfile/taxonomyComposition');
const { centralAuthorityFixture } = require('./central-authority-fixture');
const { createTaxonomyTelemetry } = require('../../../backend/src/organizationalProfile/taxonomyTelemetry');
const { createTaxonomySessions } = require('../../../backend/test/support/f13TaxonomySessions');
const { OPS } = require('../../../backend/src/organizationalProfile/taxonomyService');
const { runtimeFixture } = require('./runtime-fixture');
const { verifyDagConcurrency } = require('./dag-concurrency');

async function verifyTaxonomyProduction({ pool, otherPool, organizationId, generationId, globalRelease }) {
  const id = number => `71300000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
  const central=await centralAuthorityFixture(process.env.F13_S2_ADMIN_URL);
  const sessions = createTaxonomySessions({ organizationId,authorityCoordinator:central.coordinator }), decisions = [], metrics = [];
  const counters = { sql: 0, f7: 0, allows: 0 };
  let functionalStatements = 0;
  let loseCommit = false, auditFailure = false, afterLock = null, afterUncertainCommit = null, beforeFinalVerification = null;
  let destination = pool;
  const preparedPool = { async connect() {
    const client = await destination.connect();
    return { async query(sql, values) {
      if (sql.includes('organization_profile.')) functionalStatements++;
      if (/^\s*(INSERT|UPDATE|DELETE)\s+.*organization_profile\./i.test(sql)) counters.sql++;
      if (sql.includes('audit.append_event_v1')) { counters.f7++; if (auditFailure) throw new Error('SYNTHETIC_F7_FAILURE'); }
      const result = await client.query(sql, values);
      if (afterLock && sql.includes('FROM organization_profile.catalog_release') && sql.includes('FOR UPDATE')) {
        const hook = afterLock; afterLock = null; await hook();
      }
      if (sql === 'RESET ROLE' && beforeFinalVerification) { const hook = beforeFinalVerification; beforeFinalVerification = null; await hook(); }
      if (sql === 'COMMIT' && loseCommit) {
        loseCommit = false; if (afterUncertainCommit) { const hook = afterUncertainCommit; afterUncertainCommit = null; hook(); }
        throw new Error('SYNTHETIC_COMMIT_CONFIRMATION_LOST');
      }
      return result;
    }, release: error => client.release(error) };
  } };
  const evidence = await preflightTenant(preparedPool, { tenantId: organizationId, databaseGenerationId: generationId }, manifest, { timeoutMs: 10000 });
  const catalogs = createProductionCatalogs({ catalogVersion: 'f13' });
  const fixture = await runtimeFixture({ pool: preparedPool, evidence, sessions });
  try {
  // Historical synthetic F3 adversarial harness. The final root-composition
  // proof uses real Central sources in authority-commit-gate.js.
  const composition = createTaxonomyProductionComposition({ authorizationCatalogs: catalogs,sessionAuthority:sessions.authority,
    authorityCoordinator:central.coordinator,assurancePolicyVersion: 'c4g-assurance-v1',
    telemetry: createTaxonomyTelemetry({ metrics: { record(name, value, labels) { metrics.push(labels); } } }) });
  const binding = { pool: preparedPool, organizationId, tenantId: organizationId, tenantCapabilityEvidence: evidence,
    membershipPort: sessions.membershipPort, authorizationDataPort: sessions.authorizationDataPort, tenantRuntimeDependencies: fixture.dependencies,
    authorizationAuditPort: { async accept(event) { decisions.push(event); if (event.result === 'ALLOW') counters.allows++; return 'ACCEPTED'; } } };
  const bound = {service:composition.bindTenant(binding),captureAuthenticatedRequest:request=>sessions.authority.captureAuthenticatedRequest(request)}, service = bound.service;
  assert.deepEqual(Object.keys(service).sort(), Object.keys(OPS).sort());
  assert.equal(require('../../../backend/src/organizationalProfile/taxonomyRepository').createTaxonomyTransactionService, undefined);
  const users = [];
  for (let n = 0; n < 5; n++) {
    const user = await sessions.user(id(0x201 + n), id(0x211 + n));
    user.handle = await bound.captureAuthenticatedRequest(user.request); users.push(user);
  }
  const [creator, conceptAuthor, approver, materialAuthor, publisher] = users;
  const allGrants = catalogs.permissionCatalog.permissions.filter(entry => entry.code.startsWith('profile_taxonomy.')).map(entry => ({ permission: entry.code }));
  for (const user of users) sessions.grants(user, allGrants);
  const provenance = { sourceType: 'ORGANIZATION_MANUAL', observedAt: new Date().toISOString() };
  const release = { releaseId: id(0x220), thematicSchemeId: id(0x221), prioritySchemeId: id(0x222), releaseVersion: 'governed-v1',
    semanticDigest: 'd'.repeat(64), defaultLocale: 'pt-PT', idempotencyKey: id(0x230), provenance };
  // Actual client residency: the same pool object can now acquire from another DB.
  const cleanSnapshot = structuredClone(fixture.snapshot);
  const physicalCommand = { ...release, releaseId: id(0x290), thematicSchemeId: id(0x291), prioritySchemeId: id(0x292),
    releaseVersion: 'physical-refusal-v1', idempotencyKey: id(0x293) };
  async function persistedCounts(database) {
    return (await database.query(`SELECT
      (SELECT count(*)::int FROM organization_profile.catalog_release WHERE release_id=$1) AS mutations,
      (SELECT count(*)::int FROM audit.event WHERE event_data#>>'{resource,id}'=$1::text) AS events,
      (SELECT count(*)::int FROM organization_profile.taxonomy_idempotency_record WHERE idempotency_key=$2) AS results`,
    [physicalCommand.releaseId, physicalCommand.idempotencyKey])).rows[0];
  }
  async function physicallyRefused(configure, early = false) {
    fixture.snapshot = structuredClone(cleanSnapshot); destination = pool;
    reset();
    await configure();
    await assert.rejects(() => service.createRelease(physicalCommand, creator.handle));
    if (early) assert.deepEqual(counters, { sql: 0, f7: 0, allows: 0 });
    assert.deepEqual(await persistedCounts(pool), { mutations: 0, events: 0, results: 0 });
    assert.deepEqual(await persistedCounts(otherPool), { mutations: 0, events: 0, results: 0 });
    destination = pool; fixture.snapshot = structuredClone(cleanSnapshot);
  }
  await physicallyRefused(async () => { destination = otherPool; }, true);
  await physicallyRefused(async () => { destination = otherPool; fixture.snapshot.bindingDigest = 'f'.repeat(64); }, true);
  await physicallyRefused(async () => { fixture.snapshot.bindingDigest = 'f'.repeat(64); }, true);
  await physicallyRefused(async () => { fixture.snapshot.databaseGenerationId = id(0x999); }, true);
  await physicallyRefused(async () => { beforeFinalVerification = () => { sessions.memberships.get(creator.membershipId).status = 'REVOKED'; }; });
  sessions.memberships.get(creator.membershipId).status = 'ACTIVE';
  await physicallyRefused(async () => { beforeFinalVerification = () => { destination = otherPool; fixture.snapshot.connectionRevision++; }; });
  await physicallyRefused(async () => { beforeFinalVerification = () => { fixture.manager.synchronizeFence({ tenantId: organizationId, workload: 'API', fence: 1, connectionVersion: 1 }); }; });
  cleanSnapshot.fence = 1; fixture.snapshot.fence = 1;
  // Changed generation/binding/capability during the transaction must discard all effects.
  for (const change of [() => { fixture.snapshot.bindingDigest = 'f'.repeat(64); },
    () => { fixture.snapshot.databaseGenerationId = id(0x999); },
    () => { fixture.snapshot.schema.verifiedCapabilities.F13_PROFILE_CATALOG_FOUNDATION = false; }]) {
    await physicallyRefused(async () => { beforeFinalVerification = change; });
  }
  const concept = { releaseId: release.releaseId, schemeId: release.thematicSchemeId, schemeCode: 'THEMATIC_AREA', conceptId: id(0x223),
    stableCode: 'GOVERNED', labels: [{ locale: 'pt-PT', kind: 'PREFERRED', label: 'Synthetic governed' }],
    idempotencyKey: release.idempotencyKey, provenance };
  const approve = { releaseId: release.releaseId, conceptId: concept.conceptId, idempotencyKey: id(0x232) };
  const relation = { relationId: id(0x225), releaseId: release.releaseId, schemeId: release.thematicSchemeId,
    sourceConceptId: concept.conceptId, targetConceptId: id(0x224), relationType: 'PARENT', idempotencyKey: id(0x237), provenance };
  const mapping = { mappingId: id(0x226), releaseId: release.releaseId, schemeId: release.thematicSchemeId,
    schemeCode: 'THEMATIC_AREA', conceptId: concept.conceptId, authority: 'SYNTHETIC', externalScheme: 'SYNTHETIC_SCHEME',
    externalVersion: 'v1', externalCode: 'EXT_1', relationType: 'EXACT', idempotencyKey: id(0x238), provenance };
  const publish = { releaseId: release.releaseId, expectedDigest: release.semanticDigest, defaultLocale: 'pt-PT', idempotencyKey: id(0x234) };
  function reset() { counters.sql = 0; counters.f7 = 0; counters.allows = 0; }
  async function refused(work) {
    reset(); await assert.rejects(work); assert.deepEqual(counters, { sql: 0, f7: 0, allows: 0 });
  }
  async function refusedBeforeSql(work) {
    const before = functionalStatements; await refused(work); assert.equal(functionalStatements, before);
  }
  async function grantMatrix(method, command, user) {
    const operation = catalogs.operationCatalog.resolve(OPS[method]);
    for (const permission of allGrants) if (permission.permission !== operation.permission) {
      sessions.grants(user, [permission]); await refused(() => service[method](command, user.handle));
    }
    sessions.grants(user, [{ permission: operation.permission, resourceId: id(0x999) }]);
    await refused(() => service[method](command, user.handle));
    const resourceId = command.relationId || command.mappingId || command.conceptId || command.releaseId;
    sessions.grants(user, [{ permission: operation.permission, resourceId, resourceType: operation.resourceType }]);
    const result = await service[method](command, user.handle);
    sessions.grants(user, allGrants); return result;
  }
  // Authority refusals occur before even acquiring a tenant SQL client.
  for (const field of ['actor', 'membershipId', 'organizationId', 'resourceId', 'correlationId', 'assurance', 'assuranceEvidence']) {
    await refusedBeforeSql(() => service.createRelease({ ...release, [field]: id(0x999) }, creator.handle));
  }
  for (const handle of [{}, { ...creator.handle }, { actor: { id: creator.id } }]) await refusedBeforeSql(() => service.createRelease(release, handle));
  const membership = sessions.memberships.get(creator.membershipId), snapshot = sessions.snapshots.get(creator.membershipId);
  for (const [object, property, bad] of [[membership, 'organizationId', id(0x999)], [membership, 'globalUserId', publisher.id],
    [membership, 'status', 'REMOVED'], [membership, 'membershipVersion', 2], [snapshot, 'authorizationVersion', 2],
    [snapshot, 'membershipVersion', 2], [snapshot, 'organizationId', id(0x999)]]) {
    const old = object[property]; object[property] = bad; await refusedBeforeSql(() => service.createRelease(release, creator.handle)); object[property] = old;
  }
  const stored = sessions.sessions.get(creator.sid).auth;
  const expiry = stored.absoluteExpiresAt; stored.absoluteExpiresAt = 0; await refusedBeforeSql(() => service.createRelease(release, creator.handle)); stored.absoluteExpiresAt = expiry;
  const record = sessions.registry.sessions.get(creator.sid); record.status = 'REVOKED'; await refusedBeforeSql(() => service.createRelease(release, creator.handle)); record.status = 'ACTIVE';
  const other = await sessions.user(id(0x208), id(0x218), id(0x999)); sessions.grants(other, allGrants);
  other.handle = await bound.captureAuthenticatedRequest(other.request);
  await refusedBeforeSql(() => service.createRelease(release, other.handle));
  reset(); assert.throws(() => composition.bindTenant({ ...binding, tenantCapabilityEvidence: { ...evidence } }));
  assert.throws(() => composition.bindTenant({ ...binding, pool }));
  assert.throws(() => composition.bindTenant({ ...binding, tenantId: id(0x999), organizationId: id(0x999) }));
  assert.deepEqual(counters, { sql: 0, f7: 0, allows: 0 });
  // Wrong operation and wrong target grants cannot authorize a mutation.
  sessions.grants(creator, [{ permission: 'profile_taxonomy.local_concept.create' }]);
  await refused(() => service.createRelease(release, creator.handle));
  sessions.grants(creator, [{ permission: 'profile_taxonomy.release.create', resourceId: id(0x999) }]);
  await refused(() => service.createRelease(release, creator.handle)); sessions.grants(creator, allGrants);
  const created = await grantMatrix('createRelease', release, creator);
  reset(); assert.deepEqual(await service.createRelease(release, creator.handle), created);
  assert.deepEqual(counters, { sql: 0, f7: 0, allows: 1 });
  await assert.rejects(() => service.createRelease({ ...release, releaseVersion: 'divergent-v1' }, creator.handle), error => error.code === 'F13_IDEMPOTENCY_CONFLICT');
  const secondRelease = { ...release, releaseId: '81300000-0000-4000-8000-000000000220',
    thematicSchemeId: '81300000-0000-4000-8000-000000000221', prioritySchemeId: '81300000-0000-4000-8000-000000000222',
    releaseVersion: 'concurrent-idempotency-v1', idempotencyKey: id(0x253) };
  const replay = await Promise.all([service.createRelease(secondRelease, creator.handle), service.createRelease(secondRelease, creator.handle)]);
  assert.deepEqual(replay[0], replay[1]);
  assert.equal((await pool.query('SELECT count(DISTINCT scheme_id)::int count FROM organization_profile.scheme WHERE release_id=ANY($1::uuid[])',
    [[release.releaseId, secondRelease.releaseId]])).rows[0].count, 4);
  sessions.grants(conceptAuthor, [{ permission: 'profile_taxonomy.local_concept.create', resourceId: id(0x999) }]);
  await refused(() => service.createConcept(concept, conceptAuthor.handle)); sessions.grants(conceptAuthor, allGrants);
  afterLock = () => { sessions.registry.sessions.get(conceptAuthor.sid).status = 'REVOKED'; };
  await refused(() => service.createConcept(concept, conceptAuthor.handle));
  sessions.registry.sessions.get(conceptAuthor.sid).status = 'ACTIVE';
  await grantMatrix('createConcept', concept, conceptAuthor);
  await refused(() => service.approveConcept(approve, conceptAuthor.handle));
  const evidenceInput = sessions.sessions.get(approver.sid).auth;
  for (const bad of [{ authTime: 0, acr: 'c4g-loa2', amr: ['otp'], policyVersion: 'c4g-assurance-v1' },
    { authTime: Math.floor(Date.now() / 1000), acr: 'c4g-loa2', amr: null, policyVersion: 'c4g-assurance-v1' },
    { authTime: Math.floor(Date.now() / 1000), acr: 'c4g-loa2', amr: ['otp'], policyVersion: 'other-policy' }]) {
    const old = evidenceInput.evidence; evidenceInput.evidence = bad;
    await refused(() => service.approveConcept(approve, approver.handle)); evidenceInput.evidence = old;
  }
  await grantMatrix('approveConcept', approve, approver);
  await service.createConcept({ ...concept, conceptId: relation.targetConceptId, stableCode: 'GOVERNED_SECOND', idempotencyKey: id(0x235) }, conceptAuthor.handle);
  await service.approveConcept({ ...approve, conceptId: relation.targetConceptId, idempotencyKey: id(0x236) }, approver.handle);
  await grantMatrix('createRelation', relation, materialAuthor); await grantMatrix('createMapping', mapping, materialAuthor);
  for (const blocked of [creator, conceptAuthor, approver, materialAuthor]) await refused(() => service.publishRelease(publish, blocked.handle));
  await grantMatrix('publishRelease', publish, publisher);
  reset(); assert.equal((await service.publishRelease(publish, publisher.handle)).lifecycle, 'PUBLISHED');
  assert.deepEqual(counters, { sql: 0, f7: 0, allows: 1 });
  for (const blocked of [creator, conceptAuthor, approver, materialAuthor]) await refused(() => service.publishRelease(publish, blocked.handle));
  // Revocation and both authoritative version changes deny stored results too.
  sessions.grants(publisher, []); await refused(() => service.publishRelease(publish, publisher.handle)); sessions.grants(publisher, allGrants);
  const publisherSnapshot = sessions.snapshots.get(publisher.membershipId), publisherMembership = sessions.memberships.get(publisher.membershipId);
  publisherSnapshot.authorizationVersion++; await refused(() => service.publishRelease(publish, publisher.handle)); publisherSnapshot.authorizationVersion--;
  publisherMembership.membershipVersion++; await refused(() => service.publishRelease(publish, publisher.handle)); publisherMembership.membershipVersion--;
  publisherMembership.status = 'REMOVED'; await refused(() => service.publishRelease(publish, publisher.handle)); publisherMembership.status = 'ACTIVE';
  const cross = { ...concept, releaseId: globalRelease, idempotencyKey: id(0x299) };
  await refused(() => service.createConcept(cross, conceptAuthor.handle));
  await refused(() => service.createMapping({ ...mapping, conceptId: id(0x112), idempotencyKey: id(0x298) }, materialAuthor.handle));
  assert.equal((await service.readRelease({ releaseId: globalRelease }, creator.handle)).namespace, 'GLOBAL');
  assert.equal((await grantMatrix('readRelease', { releaseId: release.releaseId }, creator)).lifecycle, 'PUBLISHED');
  await refused(() => service.readRelease({ releaseId: release.releaseId }, other.handle));
  const events = (await pool.query("SELECT event_code,event_data FROM audit.event WHERE event_code LIKE 'TAXONOMY_%' AND organization_id=$1 ORDER BY sequence", [organizationId])).rows;
  assert.equal(events.length, 9);
  for (const code of ['TAXONOMY_RELEASE_CREATED', 'TAXONOMY_LOCAL_CONCEPT_CREATED', 'TAXONOMY_LOCAL_CONCEPT_APPROVED',
    'TAXONOMY_RELATION_CREATED', 'TAXONOMY_MAPPING_CREATED', 'TAXONOMY_RELEASE_PUBLISHED']) assert.ok(events.some(row => row.event_code === code));
  for (const row of events) {
    const event = row.event_data, decision = decisions.find(value => value.result === 'ALLOW' && value.correlationId === event.correlationId);
    assert.ok(decision); assert.equal(event.actor.id, decision.actorId); assert.equal(event.actor.membershipId, decision.membershipId);
    assert.equal(event.organizationId, organizationId); assert.equal(event.tenantId, organizationId);
    assert.equal(event.operationCode, decision.operationCode); assert.equal(event.resource.id, decision.resourceId);
    assert.equal(event.payload.membershipVersion, decision.membershipVersion); assert.equal(event.payload.authorizationVersion, decision.authorizationVersion);
    assert.equal(event.payload.operationCatalogVersion, decision.catalogVersion);
    assert.equal(event.payload.permissionCatalogVersion, catalogs.permissionCatalog.version);
    assert.equal(event.payload.policyVersion, 'c4g-assurance-v1');
    assert.equal(event.payload.policyVersion, decision.policyVersion);
    assert.equal(event.payload.assuranceLevel, catalogs.permissionCatalog.resolve(decision.permissionCode).sensitive ? 'RECENT_MFA' : 'SESSION');
    assert.equal(event.payload.assuranceLevel, decision.assuranceLevel);
    assert.equal(event.payload.scopeType, 'ORGANIZATION'); assert.equal(event.payload.semanticDigest, release.semanticDigest);
  }
  // Real F7 append failure rolls back each of the six mutation kinds.
  const failed = { ...release, releaseId: id(0x240), thematicSchemeId: id(0x241), prioritySchemeId: id(0x242),
    releaseVersion: 'rollback-v1', idempotencyKey: id(0x243) };
  auditFailure = true; await assert.rejects(() => service.createRelease(failed, creator.handle)); auditFailure = false;
  assert.equal((await pool.query('SELECT count(*)::int count FROM organization_profile.catalog_release WHERE release_id=$1', [failed.releaseId])).rows[0].count, 0);
  await service.createRelease(failed, creator.handle);
  const failedConcept = { ...concept, releaseId: failed.releaseId, schemeId: failed.thematicSchemeId, conceptId: id(0x244), idempotencyKey: id(0x245) };
  auditFailure = true; await assert.rejects(() => service.createConcept(failedConcept, conceptAuthor.handle)); auditFailure = false;
  assert.equal((await pool.query('SELECT count(*)::int count FROM organization_profile.concept WHERE concept_id=$1', [failedConcept.conceptId])).rows[0].count, 0);
  await service.createConcept(failedConcept, conceptAuthor.handle);
  const failedApprove = { releaseId: failed.releaseId, conceptId: failedConcept.conceptId, idempotencyKey: id(0x246) };
  auditFailure = true; await assert.rejects(() => service.approveConcept(failedApprove, approver.handle)); auditFailure = false;
  assert.equal((await pool.query("SELECT provenance#>>'{governance,approval,approvedBySubjectId}' AS approval FROM organization_profile.concept WHERE concept_id=$1", [failedConcept.conceptId])).rows[0].approval, null);
  await service.approveConcept(failedApprove, approver.handle);
  const failedConcept2 = { ...failedConcept, conceptId: id(0x247), stableCode: 'SECOND', idempotencyKey: id(0x248) };
  await service.createConcept(failedConcept2, conceptAuthor.handle);
  await service.approveConcept({ ...failedApprove, conceptId: failedConcept2.conceptId, idempotencyKey: id(0x249) }, approver.handle);
  const failedRelation = { ...relation, relationId: id(0x260), releaseId: failed.releaseId, schemeId: failed.thematicSchemeId,
    sourceConceptId: failedConcept.conceptId, targetConceptId: failedConcept2.conceptId, idempotencyKey: id(0x261) };
  const failedMapping = { ...mapping, mappingId: id(0x262), releaseId: failed.releaseId, schemeId: failed.thematicSchemeId,
    conceptId: failedConcept.conceptId, idempotencyKey: id(0x263) };
  for (const [method, command, table, key, target] of [['createRelation', failedRelation, 'concept_relation', 'relation_id', failedRelation.relationId],
    ['createMapping', failedMapping, 'external_mapping', 'mapping_id', failedMapping.mappingId]]) {
    auditFailure = true; await assert.rejects(() => service[method](command, materialAuthor.handle)); auditFailure = false;
    assert.equal((await pool.query(`SELECT count(*)::int count FROM organization_profile.${table} WHERE ${key}=$1`, [target])).rows[0].count, 0);
  }
  auditFailure = true; await assert.rejects(() => service.publishRelease({ ...publish, releaseId: failed.releaseId, idempotencyKey: id(0x264) }, publisher.handle)); auditFailure = false;
  assert.equal((await pool.query('SELECT lifecycle FROM organization_profile.catalog_release WHERE release_id=$1', [failed.releaseId])).rows[0].lifecycle, 'DRAFT');
  const pendingKeys = [id(0x261), id(0x263), id(0x264)];
  assert.equal((await pool.query('SELECT count(*)::int count FROM organization_profile.taxonomy_idempotency_record WHERE idempotency_key=ANY($1::uuid[])', [pendingKeys])).rows[0].count, 0);
  const uncertain = { ...release, releaseId: id(0x270), thematicSchemeId: id(0x271), prioritySchemeId: id(0x272),
    releaseVersion: 'uncertain-v1', idempotencyKey: id(0x273) };
  loseCommit = true; reset(); const reconciled = await service.createRelease(uncertain, creator.handle);
  assert.equal(reconciled.releaseId, uncertain.releaseId); assert.equal(counters.f7, 1); assert.equal(counters.allows, 2);
  assert.equal((await pool.query('SELECT count(*)::int count FROM organization_profile.taxonomy_idempotency_record WHERE organization_id=$1 AND operation=$2 AND idempotency_key=$3',
    [organizationId, 'RELEASE_CREATE', uncertain.idempotencyKey])).rows[0].count, 1);
  const revokedUncertain = { ...uncertain, releaseId: id(0x280), thematicSchemeId: id(0x281), prioritySchemeId: id(0x282),
    releaseVersion: 'uncertain-revoked-v1', idempotencyKey: id(0x283) };
  afterUncertainCommit = () => { sessions.snapshots.get(creator.membershipId).authorizationVersion++; };
  loseCommit = true; reset(); await assert.rejects(() => service.createRelease(revokedUncertain, creator.handle));
  assert.equal(counters.f7, 1); assert.equal(counters.allows, 1);
  sessions.snapshots.get(creator.membershipId).authorizationVersion--;
  reset(); assert.equal((await service.createRelease(revokedUncertain, creator.handle)).releaseId, revokedUncertain.releaseId);
  assert.deepEqual(counters, { sql: 0, f7: 0, allows: 1 });
  await verifyDagConcurrency({ pool, service, creator, author: materialAuthor, organizationId,
    setAfterLock: hook => { afterLock = hook; } });
  for (const labels of metrics) assert.deepEqual(Object.keys(labels).sort(), ['operation', 'resultClass']);
  return { trustedProductionComposition: true, sevenRealF5Operations: true, authorityRefusalsBeforeSql: true,
    replayReauthorized: true, approverPublicationDenied: true, normalizedPersistedAssurance: true,
    allSixF7FailuresRollback: true, productionCommitUncertaintyReconciled: true, physicalTwoDatabaseFencing: true, deterministicDagLockOrder: true };
  } finally { await fixture.manager.closeAll();await central.close(); }
}
module.exports = { verifyTaxonomyProduction };
