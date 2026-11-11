'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

async function runEditorialTemporalProbes({ databases, central, actor }) {
  const [db] = databases;
  async function counts() {
    const result = {};
    for (const table of ['editorial_publication', 'editorial_idempotency_record']) {
      result[table] = (await db.pool.query(`SELECT count(*)::int n FROM organization_profile.${table}`)).rows[0].n;
    }
    result.events = (await db.pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code='PROFILE_VERSION_PUBLISHED'")).rows[0].n;
    return result;
  }
  for (const scenario of ['exact', 'after', 'already-expired', 'valid']) {
    const expiry = Date.now() + 60000;
    const approver = await actor(db, randomUUID(), new Date(expiry));
    const publisher = await actor(db);
    const draft = { ...db.draft, draftId: randomUUID(), idempotencyKey: randomUUID() };
    await db.authoring.service.createDraft(draft, db.maker.authoring);
    const candidate = await db.editorial.service.submit({ draftId: draft.draftId, expectedRevision: 1,
      idempotencyKey: randomUUID() }, db.submitter.editorial);
    const version = await db.editorial.service.approve({ candidateId: candidate.candidateId,
      expectedCandidateDigest: candidate.candidateDigest, idempotencyKey: randomUUID() }, approver.editorial);
    const evidence = (await db.pool.query('SELECT approval_evidence FROM organization_profile.editorial_version WHERE version_id=$1', [version.versionId])).rows[0].approval_evidence;
    assert.equal(evidence.validUntil, expiry);
    assert.notEqual(approver.id, publisher.id);
    const epochSql = 'SELECT scope_key,epoch::text FROM public.authority_scope_epoch ORDER BY scope_key';
    const epochs = (await central.pool.query(epochSql)).rows;
    const before = await counts();
    let hookCalled = false;
    central.temporalClock.set(scenario === 'already-expired' ? expiry : expiry - 1000);
    db.controls.beforeFinalValidation = async () => {
      hookCalled = true;
      // After actual INSERTs/seals, before the real F4 final authority assert.
      central.temporalClock.set(scenario === 'valid' ? expiry - 1 : expiry + (scenario === 'after' ? 1 : 0));
    };
    try {
      const work = () => db.editorial.service.publish({ versionId: version.versionId,
        expectedVersionDigest: version.versionDigest, idempotencyKey: randomUUID() }, publisher.editorial);
      if (scenario === 'valid') {
        assert.equal((await work()).state, 'PUBLISHED');
        const after = await counts();
        for (const key of Object.keys(before)) assert.equal(after[key], before[key] + 1);
      } else {
        await assert.rejects(work, { code: scenario === 'already-expired' ? 'F13_APPROVAL_STALE' : 'F13_PERSISTENCE_UNAVAILABLE' });
        assert.deepEqual(await counts(), before);
        assert.equal((await db.pool.query('SELECT count(*)::int n FROM organization_profile.editorial_publication WHERE version_id=$1', [version.versionId])).rows[0].n, 0);
      }
      assert.equal(hookCalled, scenario !== 'already-expired');
      assert.deepEqual((await central.pool.query(epochSql)).rows, epochs);
      const guard = (await central.pool.query(`SELECT state,deadline FROM public.authority_commit_guard
        WHERE subject_id=$1 AND protected_operations @> $2::jsonb ORDER BY created_at DESC LIMIT 1`,
      [publisher.id, JSON.stringify([{ operation: 'F13_PROFILE_PUBLISH', resourceId: version.versionId }])])).rows[0];
      if (scenario === 'already-expired') assert.equal(guard, undefined);
      else {
        assert.equal(new Date(guard.deadline).getTime(), expiry);
        assert.equal(guard.state, scenario === 'valid' ? 'TENANT_COMMITTED' : 'ABORTED');
      }
      process.stdout.write(`F13_EDITORIAL_TEMPORAL_${scenario.toUpperCase()}: PASS (epochs unchanged)\n`);
    } finally { db.controls.beforeFinalValidation = null; central.temporalClock.set(null); }
  }
}
module.exports = { runEditorialTemporalProbes };
