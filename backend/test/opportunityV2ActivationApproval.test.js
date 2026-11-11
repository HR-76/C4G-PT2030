'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadVerifiedActivationArchive, locator, hash } = require('../src/opportunities/v2/activationArchive');
const { createCandidateArchiveV2 } = require('../src/fundingTenders/candidateRepositoryV2');
const { buildEvidence } = require('../src/fundingTenders/sourceEvidence');
const { adaptEuOpportunityV2 } = require('../src/fundingTenders/adapterV2');
const { previewReconciliation } = require('../src/opportunities/v2/reconciliation');
const p = require('../src/opportunities/v2/activationApproval');
const { createAcceptedOpportunityV2Repository } = require('../src/opportunities/v2/acceptedRepository');

async function fixture() {
  const observedAt = '2026-10-30T22:45:39.461Z';
  const evidence = buildEvidence('CASCADE:11145', JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../context/references/opportunity-v2/evidence/eu-11145.json'), 'utf8')).results);
  const run = { run_id: randomUUID(), source_code: 'EU_FUNDING_TENDERS', observed_at: observedAt, status: 'SUCCESS', limited: false, canonical_v2_required: true };
  const snapshot = adaptEuOpportunityV2(evidence, { observedAt });
  const state = { run, archive: null, plan: null, sql: [] };
  const client = { async query(sql, values = []) {
    state.sql.push(sql);
    if (sql.includes('assert_eu_quiescent_v2')) return { rows: [] };
    if (sql.startsWith('INSERT INTO opportunity_catalog.funding_candidate_v2')) {
      state.archive = { run_id: values[0], external_identifier: values[1], source_selection: values[2], observed_at: values[3], snapshot_schema_version: 2,
        mapping_version: values[4], content_digest: values[5], payload_digest: values[6], canonical_snapshot: JSON.parse(values[7]), source_evidence: JSON.parse(values[8]), evidence_fingerprint: values[9], evidence_sha256: values[10] };
      return { rowCount: 1, rows: [{ payload_digest: values[6] }] };
    }
    if (sql.includes('FROM opportunity_catalog.funding_candidate_v2')) return { rows: state.archive ? [state.archive] : [] };
    if (sql.includes('FROM opportunity_catalog.funding_run')) return { rows: state.run ? [state.run] : [] };
    if (sql.includes('FROM opportunity_catalog.activation_plan_v2')) return { rows: state.plan ? [state.plan] : [] };
    throw Error('Unexpected query');
  } };
  await createCandidateArchiveV2().stage(client, { run, batch: { outcome: 'FOUND', received: 1, observedAt, record: { externalIdentifier: 'CASCADE:11145' }, evidence, canonicalSnapshot: snapshot } });
  const archive = { kind: 'FUNDING', runId: run.run_id, externalIdentifier: 'CASCADE:11145' };
  const loaded = await loadVerifiedActivationArchive(client, archive);
  const preview = previewReconciliation({ accepted: [], candidates: [{ candidateId: loaded.candidateId, snapshot: loaded.snapshot, mappingDigest: loaded.mappingDigest }] });
  const actor = randomUUID();
  state.plan = { plan_id: randomUUID(), prepared_by: actor, source_code: loaded.source, archive_locator: archive, archive_digest: loaded.payloadDigest, candidate_id: loaded.candidateId,
    mapping_digest: loaded.mappingDigest, snapshot_digest: loaded.snapshotDigest, expected: null, preview, preview_digest: preview.previewDigest, state: 'APPROVED', fence: 2, approved_by: actor, unexpired: true };
  state.plan.plan_digest = hash(p.planBinding(state.plan));
  return { client, state, archive, loaded, context: { actor: { type: 'HUMAN', id: actor }, sessionId: 'server-session-id', planId: state.plan.plan_id, fence: 2, sourceFence: 3 } };
}

test('activation archive rederives 11145 bytes and requires a completed canonical source run', async () => {
  const f = await fixture();
  assert.equal(f.loaded.snapshot.financing.allocations.value[0].money.amount, '120000');
  assert.equal(f.loaded.snapshot.schedule.deadlines.value.length, 7);
  assert.match(f.loaded.mappingDigest, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(f.loaded));
  for (const mutation of [{ status: 'RUNNING' }, { limited: true }, { canonical_v2_required: false }]) {
    const original = { ...f.state.run }; Object.assign(f.state.run, mutation);
    await assert.rejects(loadVerifiedActivationArchive(f.client, f.archive), { code: 'OPPORTUNITY_V2_SOURCE_RUN_NOT_COMPLETE' });
    f.state.run = original;
  }
});

test('activation archive refuses missing archives and forged facts even when a caller supplies the same identity', async () => {
  const f = await fixture();
  f.state.archive.canonical_snapshot.financing.allocations.value[0].money.amount = '120001';
  await assert.rejects(loadVerifiedActivationArchive(f.client, f.archive), { code: 'FUNDING_V2_CANDIDATE_INVALID' });
  f.state.archive = null;
  await assert.rejects(loadVerifiedActivationArchive(f.client, f.archive), { code: 'FUNDING_V2_CANDIDATE_INVALID' });
});

test('activation input cannot substitute client snapshots or bypass the PT2030 document chain', () => {
  assert.throws(() => locator({ kind: 'PORTUGAL2030_PLAN', candidateId: randomUUID() }), { code: 'OPPORTUNITY_V2_DOCUMENT_PIPELINE_REQUIRED' });
  assert.throws(() => locator({ kind: 'FUNDING', runId: randomUUID(), externalIdentifier: 'CASCADE:11145', snapshot: {} }), { code: 'OPPORTUNITY_V2_ARCHIVE_INVALID' });
  assert.throws(() => p.input({ requestId: 'request-1', planId: randomUUID(), fence: 2, authority: true }, ['requestId', 'planId', 'fence']), { code: 'OPPORTUNITY_V2_ACTIVATION_INVALID' });
});

test('durable approval binds archive, mapping, exact snapshot, candidate, preview, expected revision and actor', async () => {
  const f = await fixture(), accepted = p.commandFor(f.state.plan, f.loaded, 'request-accepted');
  assert.equal(await p.verifyActivationApproval(f.client, { input: accepted, context: f.context }), true);
  for (const key of ['candidateId', 'mappingDigest', 'approvalDigest']) {
    assert.equal(await p.verifyActivationApproval(f.client, { input: { ...accepted, [key]: key === 'candidateId' ? 'other' : 'a'.repeat(64) }, context: f.context }), false);
  }
  const changed = structuredClone(accepted); changed.snapshot.description.summary.value = 'Different summary';
  assert.equal(await p.verifyActivationApproval(f.client, { input: changed, context: f.context }), false);
  assert.equal(await p.verifyActivationApproval(f.client, { input: accepted, context: { ...f.context, actor: { type: 'HUMAN', id: randomUUID() } } }), false);
  const snapshot = f.state.plan.snapshot_digest; f.state.plan.snapshot_digest = 'f'.repeat(64);
  await assert.rejects(p.verifyActivationApproval(f.client, { input: accepted, context: f.context }), { code: 'OPPORTUNITY_V2_PLAN_INVALID' });
  f.state.plan.snapshot_digest = snapshot;
  const mapping = f.state.plan.mapping_digest; f.state.plan.mapping_digest = 'f'.repeat(64); f.state.plan.plan_digest = hash(p.planBinding(f.state.plan));
  await assert.rejects(p.verifyActivationApproval(f.client, { input: accepted, context: f.context }), { code: 'OPPORTUNITY_V2_PLAN_ARCHIVE_CHANGED' });
  f.state.plan.mapping_digest = mapping;
});

test('revoked, draft, expired and stale fence plans cannot authorize acceptance or replay', async () => {
  const f = await fixture(), accepted = p.commandFor(f.state.plan, f.loaded, 'request-accepted');
  for (const mutation of [{ state: 'REVOKED' }, { state: 'DRAFT' }, { unexpired: false }, { fence: 3 }]) {
    const original = { ...f.state.plan }; Object.assign(f.state.plan, mutation);
    assert.equal(await p.verifyActivationApproval(f.client, { input: accepted, context: f.context }), false);
    f.state.plan = original;
  }
  assert.ok(f.state.sql.some(sql => sql.includes('activation_plan_v2') && sql.endsWith('FOR SHARE')));
});

test('an approved EU plan alone cannot replace the current source quiescence proof', async () => {
  const f = await fixture(), accepted = p.commandFor(f.state.plan, f.loaded, 'request-accepted');
  const { sourceFence, ...withoutSourceProof } = f.context;
  await assert.rejects(p.verifyActivationApproval(f.client, { input: accepted, context: withoutSourceProof }), { code: 'OPPORTUNITY_V2_SOURCE_FENCE_STALE' });
});

test('transactional accepted preview reuses the caller connection and checks authority at both boundaries', async () => {
  let checked = 0;
  const f = await fixture();
  const client = { async query() { return { rows: [] }; } };
  const repository = createAcceptedOpportunityV2Repository({ pool: { connect() { throw Error('No nested checkout'); } }, authorize: async actual => { assert.equal(actual, client); checked++; return true; }, verifyApproval: async () => false, audit: async () => {} });
  const result = await repository.previewInTransaction(client, { requestId: 'request-preview', candidateId: f.loaded.candidateId, snapshot: f.loaded.snapshot, mappingDigest: f.loaded.mappingDigest, expected: null }, f.context);
  assert.equal(result.items[0].action, 'NEW'); assert.equal(checked, 2);
});

test('operational receipt replay is bound to the exact plan, fence and actor even for identical candidate bytes', async () => {
  const f = await fixture(); let receipt = null, audits = 0;
  const client = { release() {}, async query(sql, values = []) {
    if (sql.startsWith('SELECT * FROM opportunity_catalog.accepted_receipt_v2')) return { rows: receipt ? [receipt] : [] };
    if (sql.startsWith('INSERT INTO opportunity_catalog.accepted_receipt_v2')) receipt = { request_id: values[0], intent_digest: values[1], result: values[6] };
    if (sql.startsWith('SELECT opportunity_id FROM opportunity_catalog.source_identity_v2') && receipt === null && insertedId) return { rows: [{ opportunity_id: insertedId }] };
    if (sql.startsWith('INSERT INTO opportunity_catalog.source_identity_v2')) insertedId = values[2];
    return { rows: [], rowCount: 1 };
  } };
  let insertedId = null;
  const repository = createAcceptedOpportunityV2Repository({ pool: { connect: async () => client }, authorize: async () => true, verifyApproval: async () => true, audit: async () => { audits++; } });
  const command = p.commandFor(f.state.plan, f.loaded, 'receipt-plan-binding');
  const result = await repository.accept(command, f.context);
  assert.deepEqual(await repository.accept(command, f.context), result);
  for (const context of [{ ...f.context, planId: randomUUID() }, { ...f.context, fence: 3 }, { ...f.context, sourceFence: 6 }, { ...f.context, actor: { type: 'HUMAN', id: randomUUID() } }]) {
    await assert.rejects(repository.accept(command, context), { code: 'OPPORTUNITY_V2_IDEMPOTENCY_CONFLICT' });
  }
  assert.equal(audits, 1);
});
