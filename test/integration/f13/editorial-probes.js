'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
async function runEditorialProbes({ databases, central }) {
  const permissions = ['organization_profile.draft.create','organization_profile.draft.edit','organization_profile.submit',
    'organization_profile.approve','organization_profile.publish','organization_profile.read','profile_competency.verify','profile_evidence.attach'];
  async function actor(db, subject = randomUUID(), validUntil = null) {
    const user = await central.user(db.org, subject, randomUUID(), validUntil);
    user.version = await central.data.change({ organizationId: db.org, membershipId: user.membershipId, expectedVersion: 1,
      grants: permissions.map(permission => ({ permission, scope: { type: 'ORGANIZATION', id: db.org, organizationId: db.org } })),
      assuranceRequirements: central.requirement });
    user.editorial = await db.editorial.captureAuthenticatedRequest(user.request);
    user.authoring = await db.authoring.captureAuthenticatedRequest(user.request);
    return user;
  }
  async function concept(db) {
    const release = randomUUID(), scheme = randomUUID(), id = randomUUID();
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO organization_profile.catalog_release(release_id,organization_id,namespace,release_version,lifecycle,semantic_digest,provenance)
        VALUES($1,$2,'TENANT',$3,'DRAFT',$4,'{}')`, [release, db.org, 'synthetic-' + release, 'a'.repeat(64)]);
      await client.query(`INSERT INTO organization_profile.scheme(scheme_id,release_id,organization_id,scheme_code,relation_domain)
        VALUES($1,$2,$3,'THEMATIC_AREA','THEMATIC')`, [scheme, release, db.org]);
      await client.query(`INSERT INTO organization_profile.concept(concept_id,release_id,scheme_id,organization_id,stable_code,provenance)
        VALUES($1,$2,$3,$4,'SYNTHETIC','{}')`, [id, release, scheme, db.org]);
      await client.query(`UPDATE organization_profile.catalog_release SET lifecycle='PUBLISHED',published_at=clock_timestamp() WHERE release_id=$1`, [release]);
      await client.query('COMMIT');
      return id;
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  }
  for (const db of databases) {
    db.maker = await actor(db); db.submitter = await actor(db); db.checker = await actor(db);
    db.concept = await concept(db);
    const draft = { draftId: randomUUID(), scopeId: null, idempotencyKey: randomUUID(), items: [
      { itemId: randomUUID(), itemVersionId: randomUUID(), domain: 'THEMATIC_AREA', knowledgeStatus: 'KNOWN', conceptId: db.concept },
      { itemId: randomUUID(), itemVersionId: randomUUID(), domain: 'STRATEGIC_PRIORITY', knowledgeStatus: 'UNKNOWN', conceptId: null }
    ] };
    db.draft = draft;
    await db.authoring.service.createDraft(draft, db.maker.authoring);
    const submit = { draftId: draft.draftId, expectedRevision: 1, idempotencyKey: randomUUID() };
    const candidate = await db.editorial.service.submit(submit, db.submitter.editorial); db.candidate = candidate;
    assert.equal(candidate.completion.result, 'COMPLETE');
    assert.deepEqual(await db.editorial.service.submit(submit, db.submitter.editorial), candidate);
    const approve = { candidateId: candidate.candidateId, expectedCandidateDigest: candidate.candidateDigest, idempotencyKey: randomUUID() };
    for (const user of [db.maker, db.submitter]) await assert.rejects(() => db.editorial.service.approve(approve, user.editorial), { code: 'F13_AUTHORIZATION_REQUIRED' });
    const version = await db.editorial.service.approve(approve, db.checker.editorial); db.version = version;
    assert.deepEqual(await db.editorial.service.approve(approve, db.checker.editorial), version);
    const publish = { versionId: version.versionId, expectedVersionDigest: version.versionDigest, idempotencyKey: randomUUID() };
    for (const user of [db.maker, db.submitter]) await assert.rejects(() => db.editorial.service.publish(publish, user.editorial), { code: 'F13_AUTHORIZATION_REQUIRED' });
    const published = await db.editorial.service.publish(publish, db.checker.editorial);
    assert.deepEqual(published, { versionId: version.versionId, state: 'PUBLISHED', active: false });
    assert.deepEqual(await db.editorial.service.publish(publish, db.checker.editorial), published);
    const read = await db.editorial.service.readVersion({ versionId: version.versionId }, db.maker.editorial);
    assert.equal(read.state, 'PUBLISHED'); assert.equal(read.active, false);
    assert.equal(read.content.items[0].verificationStatus, 'UNVERIFIED');
    assert.equal(read.coverage.constraintsAssessed, false);
    assert.equal(read.sourceDigest, undefined); assert.equal(read.authors, undefined);
    assert.equal((await db.pool.query('SELECT count(*)::int n FROM organization_profile.editorial_version')).rows[0].n, 1);
    assert.equal((await db.pool.query('SELECT count(*)::int n FROM organization_profile.editorial_publication')).rows[0].n, 1);
    assert.equal((await db.pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code='PROFILE_VERSION_APPROVED'")).rows[0].n, 1);
    assert.equal((await db.pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code='PROFILE_VERSION_PUBLISHED'")).rows[0].n, 1);
  }
  const [a, b] = databases;
  for (const versionId of [b.version.versionId, randomUUID()]) await assert.rejects(() => a.editorial.service.readVersion({ versionId }, a.maker.editorial), { code: 'F13_RESOURCE_NOT_AVAILABLE' });
  await assert.rejects(() => a.editorial.service.readVersion({ versionId: a.version.versionId }, b.maker.editorial), { code: 'F13_AUTHORIZATION_REQUIRED' });
  await require('./editorial-security-probes').runEditorialSecurityProbes({ databases, central, actor });
  await require('./editorial-temporal-probes').runEditorialTemporalProbes({ databases, central, actor });
}
module.exports = { runEditorialProbes };
