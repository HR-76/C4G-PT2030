'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { createUuidV7 } = require('../src/audit/uuidV7');
const { previewReconciliation } = require('../src/opportunities/v2/reconciliation');
const { euWriterConfiguration } = require('../src/fundingTenders/euWriter');
const { validateApproval, approvalEvent, assertCurrent } = require('../src/opportunities/v2/euLegacyPreapproval');
const snapshot = require('../../context/references/opportunity-v2/examples/eu-11145.json');
const sha = value => createHash('sha256').update(value).digest('hex');
const id = n => '01900000-0000-7000-8000-' + String(n).padStart(12, '0');
function fixture() {
  const externalIdentifier = 'CASCADE:11145', expected = { opportunityId: id(1), revisionId: id(2), rowVersion: 3 };
  const legacy = { schemaVersion: 1, title: 'Legacy', funderName: 'European Commission',
    provenanceId: id(4), lifecycleState: 'ACTIVE', validationState: 'PENDING_REVIEW',
    normalizationVersion: 'opportunity-normalization-v1', qualityRuleVersion: 'opportunity-quality-v1',
    fundingAmountMin: '0', fundingAmountMax: '120000', currencyCode: 'EUR' };
  const mappingDigest = 'a'.repeat(64), candidateId = 'offline:' + sha(externalIdentifier);
  const accepted = { ...expected, snapshot: legacy, identities: [{ namespace: 'EU_FUNDING_TENDERS', externalId: externalIdentifier }],
    mappingDigest: null, corrections: {}, resolutions: [], privateReferences: [] };
  const preview = previewReconciliation({ accepted: [{ ...accepted, rowVersion: expected.rowVersion,
    opportunityId: expected.opportunityId, revisionId: expected.revisionId }], candidates: [{ candidateId, snapshot, mappingDigest }] });
  const item = { externalIdentifier, expected, mappingDigest, contentDigest: sha('canonical-content'),
    evidenceFingerprint: sha('source-evidence'), previewDigest: preview.previewDigest,
    itemDigest: preview.items[0].itemDigest };
  const plan = { packageId: randomUUID(), createdAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 1800000).toISOString() };
  const binding = { sourceFence: 7 };
  const loaded = { item, artifact: { snapshot }, binding, bindingDigest: 'b'.repeat(64), plan };
  return { loaded, legacy, expected };
}
test('prearchive approval is a deterministic, individual critical audit intent', () => {
  const { loaded } = fixture(), now = Date.now(), requestId = createUuidV7({ now: () => now });
  const input = { packageId: loaded.plan.packageId, itemDigest: loaded.item.itemDigest,
    requestId, bindingDigest: loaded.bindingDigest };
  assert.deepEqual(validateApproval(input, loaded, now), input);
  const actor = id(5), event = approvalEvent(loaded, input, actor);
  assert.equal(event.event.auditClass, 'CRITICAL_PRE_EFFECT');
  assert.equal(event.event.resource.type, 'EU_LEGACY_PREARCHIVE');
  assert.equal(event.event.resource.id, 'CASCADE:11145');
  assert.deepEqual(event.event.subject, { type: 'EU_EVIDENCE_CONTENT',
    id: sha(loaded.item.contentDigest + ':' + loaded.item.evidenceFingerprint) });
  assert.equal(event.event.payload.scopeDigest, loaded.bindingDigest);
  assert.equal(event.event.payload.semanticDigest, loaded.item.itemDigest);
  assert.deepEqual(event, approvalEvent(loaded, input, actor));
  assert.notEqual(event.digest, approvalEvent(loaded, input, id(6)).digest);
  for (const changed of [{ ...input, actorId: actor }, { ...input, bindingDigest: 'c'.repeat(64) },
    { ...input, itemDigest: 'c'.repeat(64) }, { ...input, requestId: randomUUID() }])
    assert.throws(() => validateApproval(changed, loaded, now));
});
test('prearchive live gate requires current source fence, v1 CAS and zero prior archives', async () => {
  const { loaded, legacy, expected } = fixture(), config = euWriterConfiguration();
  const state = { state: 'QUIESCED', fence: 7, eu_writer_mode: 'CANONICAL_V2',
    eu_writer_policy: config.policyVersion, eu_writer_mapping_digest: config.mappingDigest };
  const row = { opportunity_id: expected.opportunityId, current_revision_id: expected.revisionId,
    row_version: expected.rowVersion, current_schema_version: 1, lifecycle_state: 'ACTIVE',
    snapshot: legacy, corrections: {}, conflicts: [], resolution_count: 0 };
  const existing = { candidates: 0, reviews: 0 }, queries = [];
  const client = { async query(sql) {
    queries.push(sql);
    if (sql.includes('assert_eu_quiescent_v2')) return { rows: [{}] };
    if (sql.includes('eu_source_control_v2')) return { rows: [state] };
    if (sql.includes('FROM opportunity_catalog.funding_identity')) return { rows: [row] };
    if (sql.includes(' AS candidates')) return { rows: [existing] };
    throw Error('Unexpected SQL');
  } };
  assert.equal(await assertCurrent(client, loaded), true);
  assert.equal(queries.some(sql => /^(INSERT|UPDATE|DELETE)/.test(sql)), false);
  state.fence = 8;
  await assert.rejects(assertCurrent(client, loaded), { code: 'OPPORTUNITY_V2_LEGACY_PREAPPROVAL_CHANGED' });
  state.fence = 7; row.row_version++;
  await assert.rejects(assertCurrent(client, loaded), { code: 'OPPORTUNITY_V2_LEGACY_PREAPPROVAL_CHANGED' });
  row.row_version--; existing.candidates = 1;
  await assert.rejects(assertCurrent(client, loaded), { code: 'OPPORTUNITY_V2_LEGACY_PREAPPROVAL_CHANGED' });
});
