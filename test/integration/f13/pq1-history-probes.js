'use strict';
const assert = require('node:assert/strict');
const { randomUUID: id } = require('node:crypto');

async function run({ a, b, call, ok, root, evaluationId }) {
  const path = '/api/opportunities/prequalifications/' + evaluationId + '/decisions';
  let head = (await ok(path, a.checker)).head;
  async function decide() {
    head = await ok(path, a.checker, { decision: 'KEEP_UNDER_REVIEW', reasonCode: 'FURTHER_REVIEW',
      justification: 'Pagination proof ' + (head.generation + 1), criterionIds: [],
      expectedDecisionId: head.decisionId, expectedGeneration: head.generation, idempotencyKey: id() });
  }
  while (head.generation < 53) await decide();
  const expected = (await a.pool.query('SELECT decision_id FROM organization_profile.pq1_decision WHERE organization_id=$1 AND evaluation_id=$2 ORDER BY generation DESC', [a.org, evaluationId])).rows.map(r => r.decision_id);
  const first = await ok(path, a.checker);
  assert.equal(first.items.length, 25);
  // A newer append must not move the cursor or duplicate/omit older rows.
  await decide();
  const seen = first.items.map(r => r.decisionId);
  let cursor = first.nextCursor, pages = 1;
  while (cursor) {
    assert.equal((await call(path + '?cursor=' + encodeURIComponent(cursor), b.checker)).status, 404);
    const page = await ok(path + '?cursor=' + encodeURIComponent(cursor), a.checker);
    seen.push(...page.items.map(r => r.decisionId)); cursor = page.nextCursor; pages++;
  }
  assert.deepEqual(seen, expected); assert.equal(new Set(seen).size, 53); assert.equal(pages, 3);
  assert.equal((await ok(path, a.checker)).head.generation, 54);
  console.log('PQ1_DECISION_HISTORY_3_PAGES_CONCURRENT_APPEND_AB PASS');

  let active = (await ok(root + '/active', a.checker)).active;
  async function activate() {
    const preview = await ok(root + '/preview', a.checker, { versionId: a.versionId });
    active = await ok(root + '/activate', a.checker, { versionId: a.versionId,
      previewToken: preview.concurrencyToken, expectedActivationId: active.activationId,
      expectedGeneration: active.generation, reason: 'History pagination proof', idempotencyKey: id() });
  }
  for (let n = 0; n < 27; n++) await activate();
  const expectedActivations = (await a.pool.query('SELECT activation_id FROM organization_profile.pq1_activation WHERE organization_id=$1 ORDER BY generation DESC', [a.org])).rows.map(r => r.activation_id);
  const initial = await ok(root + '/activations', a.checker);
  await activate();
  const activations = [...initial.items]; cursor = initial.nextCursor;
  while (cursor) {
    const page = await ok(root + '/activations?cursor=' + encodeURIComponent(cursor), a.checker);
    activations.push(...page.items); cursor = page.nextCursor;
  }
  assert.deepEqual(activations.map(r => r.activationId), expectedActivations);
  const oldest = activations.at(-1);
  assert.equal((await ok(root + '/snapshots/' + oldest.snapshotId, a.checker)).isActive, false);
  assert.equal((await call(root + '/snapshots/' + oldest.snapshotId, b.checker)).status, 404);
  const foreign = await call(root + '/activations?cursor=' + encodeURIComponent(initial.nextCursor), b.checker);
  assert.equal(foreign.status, 400);
  assert.equal((await ok('/api/opportunities/prequalifications/' + evaluationId, a.checker)).freshness, 'REVIEW_REQUIRED');
  console.log('PQ1_ACTIVATION_HISTORY_PAGES_CONCURRENT_APPEND_OLD_SNAPSHOT_AB PASS');
}
module.exports = { run };
