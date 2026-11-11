'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createEuWriterReadV2, reviewCursor } = require('../src/opportunities/v2/euWriterRead');
const actor = '01900000-0000-7000-8000-000000000001', runId = '01900000-0000-7000-8000-000000000002';
const policyVersion = 'c4g-user-mfa-v1';
function fixture() {
  const state = { authorized: true, calls: [], rows: [] };
  const client = { release() {}, async query(sql, values = []) {
    state.calls.push({ sql, values });
    if (sql.includes('opportunity_v2_administrator')) return { rows: state.authorized ? [{ authority: {
      userId: actor, storedUserId: actor, revocationVersion: 1, storedRevocationVersion: 1, policyVersion,
      absoluteExpiresAt: 2000000, expiresAt: 2000000, nowSeconds: 1000, cookieExpires: null,
      evidence: { authTime: 950, acr: 'c4g-loa1', amr: ['pwd'], policyVersion } } }] : [] };
    if (sql.includes('FROM opportunity_catalog.eu_writer_decision_v2')) return { rows: state.rows };
    return { rows: [] };
  } };
  const service = createEuWriterReadV2({ pool: { connect: async () => client }, policyVersion,
    recentMfaRequirement: require('../src/security/authConfig').RECOGNIZED_ASSURANCE_POLICIES[policyVersion].policy['recent-auth'] });
  return { state, service, context: { actor: { type: 'HUMAN', id: actor }, sessionId: 'unit-review-session' } };
}
test('review queue binds persisted decisions to an archive and expected revision without granting acceptance', async () => {
  const f = fixture(); f.state.rows = Array.from({ length: 26 }, (_, i) => ({ run_id: runId, external_identifier: 'CASCADE:' + (11000 + i),
    policy_version: 'eu-existing-v2.0', mapping_digest: 'a'.repeat(64), payload_digest: 'b'.repeat(64), reason_codes: ['NEW_REQUIRES_REVIEW'],
    expected: null, result: { decision: 'REVIEW' }, recorded_at: '2026-10-31T00:00:00Z', run_status: 'SUCCESS', limited: false }));
  const value = await f.service.list({}, f.context);
  assert.equal(value.items.length, 25); assert.equal(value.items[0].decision, 'REVIEW');
  assert.deepEqual(value.items[0].archive, { kind: 'FUNDING', runId, externalIdentifier: 'CASCADE:11000' });
  assert.equal(value.items[0].canPrepare, true); assert.equal(value.items[0].expected, null);
  assert.deepEqual(reviewCursor(value.nextCursor), { runId, externalIdentifier: 'CASCADE:11024' });
  assert.equal(f.state.calls.filter(x => x.sql.includes('opportunity_v2_administrator')).length, 2);
  assert.equal(f.state.calls.some(x => /^(INSERT|UPDATE|DELETE)/.test(x.sql)), false);
});
test('review queue rejects authority loss, unbounded parameters and forged or noncanonical cursors', async () => {
  const f = fixture(); f.state.authorized = false;
  await assert.rejects(f.service.list({}, f.context), { code: 'OPPORTUNITY_V2_AUTHORITY_DENIED' });
  assert.equal(f.state.calls.at(-1).sql, 'ROLLBACK');
  for (const query of [{ limit: 1000 }, { cursor: 'x'.repeat(600) }, { cursor: 'eyJ1bnRydXN0ZWQiOnRydWV9' }, { cursor: null }]) {
    await assert.rejects(f.service.list(query, f.context), { code: 'OPPORTUNITY_V2_ACTIVATION_INVALID' });
  }
});
