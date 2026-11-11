'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { loadEditorialHistory, resolveEditorialReferences } = require('../../../backend/src/organizationalProfile/editorialSource');
const { manifest } = require('../../../backend/src/security/tenantMigrationManifest');
const { preflightTenant } = require('../../../backend/src/security/tenantMigrationPreflight');
const { createTenantMigrationRunner } = require('../../../backend/src/security/tenantMigrationRunner');

async function runEditorialSecurityProbes({ databases, central, actor }) {
  const [a, b] = databases;
  const tables = ['editorial_candidate','editorial_candidate_author','editorial_version','editorial_publication',
    'editorial_idempotency_record','profile_draft_revision','profile_revision_item','idempotency_record'];
  async function counts(db) {
    const result = {};
    for (const table of tables) result[table] = (await db.pool.query(`SELECT count(*)::int n FROM organization_profile.${table}`)).rows[0].n;
    result.events = (await db.pool.query('SELECT count(*)::int n FROM audit.event')).rows[0].n;
    return result;
  }
  async function denied(work, code) {
    const before = await counts(a);
    await assert.rejects(work, code ? { code } : undefined);
    assert.deepEqual(await counts(a), before);
  }
  const draft = (items = a.draft.items) => ({ draftId: randomUUID(), scopeId: null, idempotencyKey: randomUUID(), items });
  async function candidate(items = a.draft.items) {
    const command = draft(items);
    await a.authoring.service.createDraft(command, a.maker.authoring);
    const submit = { draftId: command.draftId, expectedRevision: 1, idempotencyKey: randomUUID() };
    return { command, submit, result: await a.editorial.service.submit(submit, a.submitter.editorial) };
  }
  const approve = result => ({ candidateId: result.candidateId, expectedCandidateDigest: result.candidateDigest, idempotencyKey: randomUUID() });
  const publish = version => ({ versionId: version.versionId, expectedVersionDigest: version.versionDigest, idempotencyKey: randomUUID() });
  // Incompleteness is persisted, never silently filled from absence.
  const incomplete = await candidate([]);
  assert.equal(incomplete.result.completion.result, 'INCOMPLETE');
  await denied(() => a.editorial.service.approve(approve(incomplete.result), a.checker.editorial), 'F13_COMPLETION_INCOMPLETE');
  await denied(() => a.authoring.service.editDraft({ draftId: incomplete.command.draftId, expectedRevision: 2,
    items: a.draft.items, idempotencyKey: randomUUID() }, a.maker.authoring), 'F13_STATE_CONFLICT');

  // One exact CAS, concurrent replay, different intentions and different keys.
  const concurrent = draft(); await a.authoring.service.createDraft(concurrent, a.maker.authoring);
  const command = { draftId: concurrent.draftId, expectedRevision: 1, idempotencyKey: randomUUID() };
  const submitted = await Promise.all([0, 1].map(() => a.editorial.service.submit(command, a.submitter.editorial)));
  assert.deepEqual(submitted[0], submitted[1]);
  await denied(() => a.editorial.service.submit({ ...command, expectedRevision: 2 }, a.submitter.editorial), 'F13_IDEMPOTENCY_CONFLICT');
  const approval = approve(submitted[0]);
  const approved = await Promise.all([0, 1].map(() => a.editorial.service.approve(approval, a.checker.editorial)));
  assert.deepEqual(approved[0], approved[1]);
  await denied(() => a.editorial.service.approve({ ...approval, idempotencyKey: randomUUID() }, a.checker.editorial), 'F13_STATE_CONFLICT');
  const publications = await Promise.allSettled([0, 1].map(() => a.editorial.service.publish(publish(approved[0]), a.checker.editorial)));
  assert.equal(publications.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(publications.find(result => result.status === 'rejected').reason.code, 'F13_STATE_CONFLICT');

  // Mixed draft: excluded-only revisions change source, not editorial content;
  // removals/reuse/no-op and material creators are distinguished from last editor.
  const editor = await actor(a), excludedEditor = await actor(a), noop = await actor(a);
  const mixed = draft(); await a.authoring.service.createDraft(mixed, a.maker.authoring);
  await a.authoring.service.editDraft({ draftId: mixed.draftId, expectedRevision: 1, items: [mixed.items[0]],
    idempotencyKey: randomUUID() }, editor.authoring);
  await a.authoring.service.editDraft({ draftId: mixed.draftId, expectedRevision: 2, items: mixed.items,
    idempotencyKey: randomUUID() }, editor.authoring);
  await a.authoring.service.editDraft({ draftId: mixed.draftId, expectedRevision: 3, items: mixed.items,
    idempotencyKey: randomUUID() }, noop.authoring);
  const before = (await loadEditorialHistory(a.pool, a.org, mixed.draftId, 4)).at(-1);
  const excludedHandle = await a.competency.captureAuthenticatedRequest(excludedEditor.request);
  const release = randomUUID(), concept = randomUUID(), experienceType = randomUUID(), method = randomUUID(), framework = randomUUID();
  await a.pool.query("INSERT INTO organization_profile.competency_catalog_release(release_id,release_version,lifecycle,semantic_digest) VALUES($1,'editorial-synthetic-only','PUBLISHED',$2)", [release, 'a'.repeat(64)]);
  for (const [id, kind] of [[concept,'COMPETENCY_CONCEPT'],[experienceType,'EXPERIENCE_TYPE'],[method,'VERIFICATION_METHOD']]) await a.pool.query(
    'INSERT INTO organization_profile.competency_catalog_entry(entry_id,release_id,kind,stable_code,framework_id,framework_version,max_validity_seconds) VALUES($1,$2,$3,$3,$4,$5,$6)',
    [id, release, kind, kind === 'COMPETENCY_CONCEPT' ? framework : null, kind === 'COMPETENCY_CONCEPT' ? 'synthetic-v1' : null, kind === 'VERIFICATION_METHOD' ? 3600 : null]);
  const assertionVersion = randomUUID(), experienceVersion = randomUUID(), verification = randomUUID();
  await a.competency.service.setCompetencies({ draftId: mixed.draftId, expectedRevision: 4,
    assertions: [{ assertionId: randomUUID(), versionId: assertionVersion, knowledgeStatus: 'KNOWN', conceptId: concept, levelId: null }],
    idempotencyKey: randomUUID() }, excludedHandle);
  await a.competency.service.setExperiences({ draftId: mixed.draftId, expectedRevision: 5, experiences: [{ experienceId: randomUUID(),
    versionId: experienceVersion, typeId: experienceType, observedFrom: '2025-01-01T00:00:00.000Z',
    observedUntil: '2025-02-01T00:00:00.000Z', provenanceRef: randomUUID() }], idempotencyKey: randomUUID() }, excludedHandle);
  await a.competency.service.attachEvidence({ draftId: mixed.draftId, expectedRevision: 6, linkId: randomUUID(),
    assertionVersionId: assertionVersion, experienceVersionId: experienceVersion, documentVersionId: null, idempotencyKey: randomUUID() }, excludedHandle);
  await a.competency.service.verifyCompetency({ draftId: mixed.draftId, expectedRevision: 7, verificationId: verification,
    assertionVersionId: assertionVersion, methodId: method, validUntil: new Date(Date.now() + 1800000).toISOString(),
    idempotencyKey: randomUUID() }, await a.competency.captureAuthenticatedRequest((await actor(a)).request));
  const after = (await loadEditorialHistory(a.pool, a.org, mixed.draftId, 8)).at(-1);
  assert.notEqual(before.digest, after.digest);
  assert.equal((await resolveEditorialReferences(a.pool, a.org, before)).editorialDigest,
    (await resolveEditorialReferences(a.pool, a.org, after)).editorialDigest);
  const members = async revision => (await a.pool.query(`SELECT kind,version_id FROM organization_profile.competency_revision_member
    WHERE organization_id=$1 AND draft_id=$2 AND revision=$3 ORDER BY kind,version_id`, [a.org, mixed.draftId, revision])).rows;
  const excluded = await members(8); assert.equal(excluded.length, 4);
  const verifiedBefore = (await a.pool.query('SELECT * FROM organization_profile.competency_verification_result WHERE verification_id=$1', [verification])).rows;
  assert.equal(verifiedBefore[0].status, 'VERIFIED');
  const mixedCandidate = await a.editorial.service.submit({ draftId: mixed.draftId, expectedRevision: 8, idempotencyKey: randomUUID() }, a.submitter.editorial);
  assert.deepEqual(await members(9), excluded);
  const authors = (await a.pool.query('SELECT subject_id FROM organization_profile.editorial_candidate_author WHERE candidate_id=$1 ORDER BY subject_id', [mixedCandidate.candidateId])).rows.map(row => row.subject_id);
  assert.deepEqual(authors, [a.maker.id, editor.id, a.submitter.id].sort());
  await denied(() => a.editorial.service.approve(approve(mixedCandidate), editor.editorial), 'F13_AUTHORIZATION_REQUIRED');
  const mixedVersion = await a.editorial.service.approve(approve(mixedCandidate), excludedEditor.editorial);
  await a.editorial.service.publish(publish(mixedVersion), excludedEditor.editorial);
  assert.deepEqual(await members(9), excluded);
  assert.deepEqual((await a.pool.query('SELECT * FROM organization_profile.competency_verification_result WHERE verification_id=$1', [verification])).rows, verifiedBefore);

  // New authenticated session, same stable human: no maker-checker bypass.
  const sid = 'synthetic-editorial-second-' + randomUUID();
  const stored = (await central.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1', [a.maker.sid])).rows[0].sess;
  await central.registry.rotateSession({ sid, globalUserId: a.maker.id, revocationVersion: 1,
    expiresAt: stored.auth.absoluteExpiresAt, organizationContext: stored.auth.organizationContext });
  await central.coordinator.write([central.coordinator.sessionKey(sid)], () => central.coordinator.pool.query(
    'INSERT INTO "public"."application_session_store" (sess, expire, sid) SELECT $1, to_timestamp($2), $3 ON CONFLICT (sid) DO UPDATE SET sess=$1, expire=to_timestamp($2) RETURNING sid',
    [stored, stored.auth.absoluteExpiresAt / 1000, sid]));
  const otherSession = await a.editorial.captureAuthenticatedRequest({ ...a.maker.request, sessionID: sid, authContext: { sessionId: sid } });
  await denied(() => a.editorial.service.approve(approve(mixedCandidate), otherSession), 'F13_AUTHORIZATION_REQUIRED');
  // Rotation correctly revoked the original session; subsequent fixture work
  // must use the new authenticated session rather than bypass that revocation.
  a.maker.sid = sid;
  a.maker.request = { ...a.maker.request, sessionID: sid, authContext: { sessionId: sid } };
  a.maker.editorial = otherSession;
  a.maker.authoring = await a.authoring.captureAuthenticatedRequest(a.maker.request);

  // F7 failure rolls back the source transition and all editorial effects.
  const auditDraft = draft(); await a.authoring.service.createDraft(auditDraft, a.maker.authoring);
  const auditSubmit = { draftId: auditDraft.draftId, expectedRevision: 1, idempotencyKey: randomUUID() };
  a.controls.failAudit = true;
  try { await denied(() => a.editorial.service.submit(auditSubmit, a.submitter.editorial), 'F13_PERSISTENCE_UNAVAILABLE'); }
  finally { a.controls.failAudit = false; }
  a.controls.loseCommit = 1;
  const recovered = await a.editorial.service.submit(auditSubmit, a.submitter.editorial);
  assert.deepEqual(await a.editorial.service.submit(auditSubmit, a.submitter.editorial), recovered);
  const approveRecovered = approve(recovered);
  a.controls.failAudit = true;
  try { await denied(() => a.editorial.service.approve(approveRecovered, a.checker.editorial), 'F13_PERSISTENCE_UNAVAILABLE'); }
  finally { a.controls.failAudit = false; }
  a.controls.loseCommit = 1;
  const recoveredVersion = await a.editorial.service.approve(approveRecovered, a.checker.editorial);
  const publishRecovered = publish(recoveredVersion);
  a.controls.failAudit = true;
  try { await denied(() => a.editorial.service.publish(publishRecovered, a.checker.editorial), 'F13_PERSISTENCE_UNAVAILABLE'); }
  finally { a.controls.failAudit = false; }
  a.controls.loseCommit = 1;
  await a.editorial.service.publish(publishRecovered, a.checker.editorial);
  assert.deepEqual(await a.editorial.service.publish(publishRecovered, a.checker.editorial), { versionId: recoveredVersion.versionId, state: 'PUBLISHED', active: false });

  // Both original and reconciliation commit acknowledgments may be lost.
  // Fail closed, then a new request recovers the same source-local effect.
  const doubleDraft = draft(); await a.authoring.service.createDraft(doubleDraft, a.maker.authoring);
  const doubleSubmit = { draftId: doubleDraft.draftId, expectedRevision: 1, idempotencyKey: randomUUID() };
  const beforeDouble = await counts(a);
  a.controls.loseAcknowledgments = 2;
  await assert.rejects(() => a.editorial.service.submit(doubleSubmit, a.submitter.editorial), { code: 'F13_PERSISTENCE_UNAVAILABLE' });
  assert.equal(a.controls.loseAcknowledgments, 0);
  const doubleResult = await a.editorial.service.submit(doubleSubmit, a.submitter.editorial);
  assert.deepEqual(await a.editorial.service.submit(doubleSubmit, a.submitter.editorial), doubleResult);
  const afterDouble = await counts(a);
  assert.equal(afterDouble.editorial_candidate, beforeDouble.editorial_candidate + 1);
  assert.equal(afterDouble.events, beforeDouble.events + 1);

  // MFA is evaluated from the stored session, not from caller-supplied claims.
  const staleMfa = await actor(a), pendingMfa = await candidate();
  const staleStored = (await central.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1', [staleMfa.sid])).rows[0].sess;
  staleStored.auth.evidence.authTime = Math.floor(Date.now() / 1000) - 301;
  await central.coordinator.write([central.coordinator.sessionKey(staleMfa.sid)], () => central.coordinator.pool.query(
    'INSERT INTO "public"."application_session_store" (sess, expire, sid) SELECT $1, to_timestamp($2), $3 ON CONFLICT (sid) DO UPDATE SET sess=$1, expire=to_timestamp($2) RETURNING sid',
    [staleStored, staleStored.auth.absoluteExpiresAt / 1000, staleMfa.sid]));
  staleMfa.editorial = await a.editorial.captureAuthenticatedRequest(staleMfa.request);
  await denied(() => a.editorial.service.approve(approve(pendingMfa.result), staleMfa.editorial), 'F13_AUTHORIZATION_REQUIRED');

  // Approval authority can be revoked independently of the publisher's session.
  const revocable = await actor(a), publisher = await actor(a), toRevoke = await candidate();
  const revokedVersion = await a.editorial.service.approve(approve(toRevoke.result), revocable.editorial);
  await central.data.change({ organizationId: a.org, membershipId: revocable.membershipId, expectedVersion: revocable.version,
    grants: [], assuranceRequirements: central.requirement });
  await denied(() => a.editorial.service.publish(publish(revokedVersion), publisher.editorial), 'F13_APPROVAL_STALE');
  await denied(() => a.editorial.service.approve(approve(toRevoke.result), revocable.editorial), 'F13_AUTHORIZATION_REQUIRED');
  const removed = await actor(a);
  await require('../../../backend/src/security/membershipRepository').createMembershipRepository(central.pool, central.coordinator)
    .changeStatus({ membershipId: removed.membershipId, status: 'REMOVED' });
  await denied(() => a.editorial.service.readVersion({ versionId: a.version.versionId }, removed.editorial), 'F13_AUTHORIZATION_REQUIRED');

  const crossed = draft([{ ...a.draft.items[0], itemId: randomUUID(), itemVersionId: randomUUID(), conceptId: b.concept }, a.draft.items[1]]);
  await denied(() => a.authoring.service.createDraft(crossed, a.maker.authoring));

  // Opposite ordering: a revocation writer cannot overtake a protected commit.
  const racing = await actor(a), toRace = await candidate();
  const raceVersion = await a.editorial.service.approve(approve(toRace.result), racing.editorial);
  let write, writeSettled = false;
  a.controls.beforeCommit = async () => {
    write = central.data.change({ organizationId: a.org, membershipId: racing.membershipId, expectedVersion: racing.version,
      grants: [], assuranceRequirements: central.requirement }).finally(() => { writeSettled = true; });
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(writeSettled, false);
  };
  assert.equal((await a.editorial.service.publish(publish(raceVersion), racing.editorial)).state, 'PUBLISHED');
  await write; assert.equal(writeSettled, true);
  await denied(() => a.editorial.service.publish(publish(raceVersion), racing.editorial), 'F13_AUTHORIZATION_REQUIRED');

  // Physical DB-local policy lookup: missing/unsupported B never falls back to A.
  const id = require('../../../backend/src/organizationalProfile/editorialRelease').IDS.policy;
  async function setPolicy(lifecycle) {
    const c = await b.pool.connect();
    try { await c.query('BEGIN'); await c.query('ALTER TABLE organization_profile.completion_policy DISABLE TRIGGER USER');
      await c.query('UPDATE organization_profile.completion_policy SET lifecycle=$1 WHERE completion_policy_id=$2', [lifecycle, id]);
      await c.query('ALTER TABLE organization_profile.completion_policy ENABLE TRIGGER USER'); await c.query('COMMIT');
    } finally { await c.query('ROLLBACK'); c.release(); }
  }
  await setPolicy('DRAFT');
  try {
    await assert.rejects(() => b.editorial.service.readVersion({ versionId: b.version.versionId }, b.maker.editorial), { code: 'F13_POLICY_UNAVAILABLE' });
    assert.equal((await a.editorial.service.readVersion({ versionId: a.version.versionId }, a.maker.editorial)).state, 'PUBLISHED');
  } finally { await setPolicy('PUBLISHED'); }

  // RLS and grants are tested by authorization failures, not bad data/constraints.
  const sql = await a.pool.connect();
  try {
    await sql.query('BEGIN'); await sql.query('SET LOCAL ROLE c4g_organization_profile_runtime');
    await sql.query("SELECT set_config('app.organization_id',$1,true)", [b.org]);
    for (const table of tables.filter(t => t.startsWith('editorial_'))) assert.equal((await sql.query(`SELECT * FROM organization_profile.${table}`)).rowCount, 0);
    await sql.query("SELECT set_config('app.organization_id',$1,true)", [a.org]);
    for (const table of tables.filter(t => t.startsWith('editorial_'))) for (const verb of ['UPDATE','DELETE','TRUNCATE']) {
      await sql.query('SAVEPOINT negative_acl');
      await assert.rejects(() => sql.query(verb === 'UPDATE' ? `UPDATE organization_profile.${table} SET organization_id=organization_id`
        : `${verb === 'DELETE' ? 'DELETE FROM' : 'TRUNCATE'} organization_profile.${table}`), { code: '42501' });
      await sql.query('ROLLBACK TO SAVEPOINT negative_acl');
    }
  } finally { await sql.query('ROLLBACK'); sql.release(); }
  const latestRunner=createTenantMigrationRunner({pool:a.pool,observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}});
  const migrationInput={tenantId:a.org,databaseGenerationId:a.gen,expectedRevision:3,correlationId:'editorial-protected-down',idempotencyKey:'editorial-protected-down'};
  // The canonical runner admits adjacent downgrades only. Later PQ1 tables
  // are empty in this thematic fixture; preserve the occupied 016 history.
  for(let index=manifest.length-1;manifest[index].ordinal>16;index--){
    const entries=Object.freeze(manifest.slice(0,index+1));
    await createTenantMigrationRunner({pool:a.pool,entries,observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}})
      .downgrade({...migrationInput,targetVersion:manifest[index-1].version});
  }
  await assert.rejects(()=>createTenantMigrationRunner({pool:a.pool,entries:Object.freeze(manifest.filter(e=>e.ordinal<=16)),observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}}).downgrade({...migrationInput,targetVersion:'015_f12_opportunity_xlsx_import'}));
  await latestRunner.migrate({...migrationInput,expectedRevision:4});
  assert.equal((await preflightTenant(a.pool, { tenantId: a.org, databaseGenerationId: a.gen }, manifest, { timeoutMs: 10000 })).schemaFingerprint, manifest.at(-1).schemaFingerprint);
  process.stdout.write('F13_EDITORIAL_SECURITY_MIXED_CAS_F7_RECOVERY: PASS\n');
}
module.exports = { runEditorialSecurityProbes };
