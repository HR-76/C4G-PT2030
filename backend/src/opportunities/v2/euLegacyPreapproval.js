'use strict';
// An OIDC approval for archiving exactly one legacy EU candidate. This module
// deliberately has no candidate, revision, run or source-control write path.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { createActivationAuthorityV2, humanContext } = require('./activationAuthority');
const { readSafe } = require('./euWriterWindowPlan');
const { implementationDigest } = require('./activationArchive');
const { previewReconciliation } = require('./reconciliation');
const { contentDigestV2 } = require('./digests');
const { adaptEuOpportunityV2 } = require('../../fundingTenders/adapterV2');
const { verifyEvidence } = require('../../fundingTenders/sourceEvidence');
const { euWriterConfiguration } = require('../../fundingTenders/euWriter');
const { createAuditEvent } = require('../../audit/event');
const { createAppendService } = require('../../audit/appendService');
const { PostgresAppendRepository } = require('../../audit/postgresAppendRepository');
const { isUuidV7 } = require('../../audit/uuidV7');
const { cloneData, deepFreeze } = require('./data');

const ROOT = path.resolve(__dirname, '../../../..');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function fail(code = 'OPPORTUNITY_V2_LEGACY_PREAPPROVAL_INVALID') {
  throw Object.assign(new Error(code), { code });
}
function requestTime(id) { return parseInt(id.replaceAll('-', '').slice(0, 12), 16); }
function reference(value) {
  return exact(value, ['path', 'sha256']) && /^output\/[a-zA-Z0-9_./-]+\.json$/.test(value.path)
    && !value.path.split('/').some(part => part === '.' || part === '..') && SHA.test(value.sha256);
}
function verifiedJson(root, ref, limit = 16 * 1024 * 1024) {
  if (!reference(ref)) fail();
  let bytes;
  try { bytes = readSafe(root, ref.path, limit); } catch { fail('OPPORTUNITY_V2_LEGACY_PREAPPROVAL_CHANGED'); }
  if (sha(bytes) !== ref.sha256) fail('OPPORTUNITY_V2_LEGACY_PREAPPROVAL_CHANGED');
  try { return JSON.parse(bytes.toString('utf8')); } catch { fail(); }
}
function validatePreviewEvidence(preview, manifest, inventory, plan, created, generated, observed) {
  if (preview.kind !== 'eu-legacy-migration-preview-v1' || preview.readOnly !== true
    || preview.databaseWrites !== 0 || preview.writerMappingAligned !== true
    || preview.scope?.expected !== 398 || preview.scope?.matchedCurrentHeads !== 398
    || preview.entries?.length !== 398 || manifest.kind !== 'eu-legacy-official-evidence-v1'
    || manifest.readOnly !== true || manifest.databaseWrites !== 0 || manifest.entries?.length !== 398
    || preview.evidenceManifest?.path !== plan.manifest.path
    || preview.evidenceManifest?.sha256 !== plan.manifest.sha256
    || preview.sourceControl?.state !== 'QUIESCED' || preview.sourceControl?.fence !== 7
    || preview.sourceControl?.eu_writer_mode !== 'CANONICAL_V2'
    || !Number.isFinite(generated) || !Number.isFinite(observed)
    || new Date(generated).toISOString() !== preview.generatedAt
    || new Date(observed).toISOString() !== manifest.createdAt
    || generated < observed || generated > created + 5000 || created - generated > 3600000
    || new Set(preview.entries.map(entry => entry.externalIdentifier)).size !== 398
    || new Set(manifest.entries.map(entry => entry.externalIdentifier)).size !== 398
    || inventory.sourceControl?.state !== 'QUIESCED' || inventory.sourceControl?.fence !== 7
    || inventory.items?.filter(entry => entry.proposedPath === 'FRESH_SOURCE_EVIDENCE_AND_REVIEW').length !== 398) fail();
}
function validateApprovalItem(item) {
  if (!item || item.action !== 'CHANGE_REQUIRES_APPROVAL' || item.outcome !== 'FOUND'
    || typeof item.externalIdentifier !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(item.externalIdentifier)
    || item.approvalState !== 'NOT_REQUESTED' || !item.reasonCodes?.includes('LEGACY_MIGRATION_REQUIRES_REVIEW')
    || !UUID.test(item.expected?.opportunityId) || !UUID.test(item.expected?.revisionId)
    || !Number.isSafeInteger(item.expected?.rowVersion) || item.expected.rowVersion < 1
    || !SHA.test(item.previewDigest) || !SHA.test(item.contentDigest)
    || !SHA.test(item.mappingDigest) || !SHA.test(item.evidenceFingerprint)
    || !reference(item.artifact)) fail();
}
function validateEvidenceBinding(evidenceEntry, target, item) {
  if (!evidenceEntry || evidenceEntry.outcome !== 'FOUND'
    || target?.proposedPath !== 'FRESH_SOURCE_EVIDENCE_AND_REVIEW'
    || target.schemaVersion !== 1 || target.candidateArchives !== 0 || target.reviewDecisions !== 0
    || !isDeepStrictEqual(item.expected, { opportunityId: target.opportunityId,
      revisionId: target.currentRevisionId, rowVersion: target.rowVersion })
    || !isDeepStrictEqual(evidenceEntry.expected, item.expected)
    || !isDeepStrictEqual(evidenceEntry.artifact, item.artifact)
    || evidenceEntry.contentDigest !== item.contentDigest
    || evidenceEntry.evidenceFingerprint !== item.evidenceFingerprint) fail();
}
function validateApprovalArtifact(artifact, item, snapshot, evidenceEntry, amounts, deadlines, awarders) {
  if (artifact.outcome !== 'FOUND' || artifact.externalIdentifier !== item.externalIdentifier
    || !verifyEvidence(artifact.evidence) || artifact.evidence.fingerprint !== item.evidenceFingerprint
    || !isDeepStrictEqual(artifact.snapshot,
      adaptEuOpportunityV2(artifact.evidence, { observedAt: artifact.observedAt }))
    || contentDigestV2(artifact.snapshot) !== item.contentDigest
    || implementationDigest('EU_FUNDING_TENDERS', artifact.snapshot.provenance.mappingVersion) !== item.mappingDigest
    || item.title !== snapshot.description.title.value
    || item.status !== snapshot.status.published.value
    || item.opening !== (snapshot.schedule.opening.value?.value || null)
    || item.projectAcronym !== snapshot.relatedProject.acronym.value
    || item.grantAgreementNumber !== snapshot.relatedProject.grantAgreementNumber.value
    || !isDeepStrictEqual(item.programmeCodes, snapshot.programmes.state === 'PRESENT'
      ? snapshot.programmes.value.map(value => value.code || value.sourceId) : [])
    || !isDeepStrictEqual(item.amount, evidenceEntry.amount)
    || !isDeepStrictEqual(item.amount, amounts)
    || item.deadlineCount !== evidenceEntry.deadlineCount || item.deadlineCount !== deadlines
    || !isDeepStrictEqual(item.directAwarders, evidenceEntry.directAwarders)
    || !isDeepStrictEqual(item.directAwarders, awarders)) fail();
}
function loadPackage(root, packageId, itemDigest, now = Date.now()) {
  if (!UUID.test(packageId) || !SHA.test(itemDigest)) fail();
  const plan = verifiedJson(root, { path: `output/eu-legacy-preapproval-${packageId}/plan.json`,
    sha256: sha(readSafe(root, `output/eu-legacy-preapproval-${packageId}/plan.json`, 4096)) }, 4096);
  if (!exact(plan, ['kind', 'packageId', 'createdAt', 'expiresAt', 'preview', 'manifest'])
    || plan.kind !== 'eu-legacy-preapproval-package-v1' || plan.packageId !== packageId
    || !reference(plan.preview) || !reference(plan.manifest)) fail();
  const created = Date.parse(plan.createdAt), expires = Date.parse(plan.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires)
    || new Date(created).toISOString() !== plan.createdAt || new Date(expires).toISOString() !== plan.expiresAt
    || created > now + 5000 || expires <= created || expires - created > 3600000) fail();
  if (expires <= now) fail('OPPORTUNITY_V2_LEGACY_PREAPPROVAL_EXPIRED');
  const preview = verifiedJson(root, plan.preview, 8 * 1024 * 1024);
  const manifest = verifiedJson(root, plan.manifest, 2 * 1024 * 1024);
  const inventory = verifiedJson(root, { path: manifest.inventory?.path,
    sha256: manifest.inventory?.sha256 }, 8 * 1024 * 1024);
  const generated = Date.parse(preview.generatedAt), observed = Date.parse(manifest.createdAt);
  validatePreviewEvidence(preview, manifest, inventory, plan, created, generated, observed);
  const item = preview.entries.find(entry => entry.itemDigest === itemDigest);
  validateApprovalItem(item);
  const evidenceEntry = manifest.entries.find(entry => entry.externalIdentifier === item.externalIdentifier);
  const target = inventory.items.find(entry => entry.externalIdentifier === item.externalIdentifier);
  validateEvidenceBinding(evidenceEntry, target, item);
  const artifact = verifiedJson(root, item.artifact);
  const snapshot = artifact.snapshot;
  const amounts = snapshot?.financing?.allocations?.state === 'PRESENT'
    ? snapshot.financing.allocations.value.map(value => ({ amount: value.money.amount,
      currencyState: value.money.currency.state, scope: value.scope })) : [];
  const deadlines = snapshot?.schedule?.deadlines?.value?.length || 0;
  const awarders = snapshot?.parties?.state === 'PRESENT'
    ? snapshot.parties.value.filter(value => value.role === 'DIRECT_AWARDER').map(value => value.name) : [];
  validateApprovalArtifact(artifact, item, snapshot, evidenceEntry, amounts, deadlines, awarders);
  const writer = euWriterConfiguration();
  if (preview.sourceControl.eu_writer_mapping_digest !== writer.mappingDigest
    || preview.sourceControl.eu_writer_policy !== writer.policyVersion) fail('OPPORTUNITY_V2_LEGACY_PREAPPROVAL_CHANGED');
  const binding = deepFreeze({ packageId, externalIdentifier: item.externalIdentifier,
    expected: item.expected, itemDigest, previewDigest: item.previewDigest,
    evidenceFingerprint: item.evidenceFingerprint, artifactSha256: item.artifact.sha256,
    contentDigest: item.contentDigest, mappingDigest: item.mappingDigest,
    sourceFence: preview.sourceControl.fence, expiresAt: plan.expiresAt });
  return deepFreeze({ plan, item, artifact, binding, bindingDigest: sha(JSON.stringify(binding)) });
}
function listPackage(root, packageId, now = Date.now()) {
  if (!UUID.test(packageId)) fail();
  const planPath = `output/eu-legacy-preapproval-${packageId}/plan.json`;
  let plan;
  try { plan = JSON.parse(readSafe(root, planPath, 4096).toString('utf8')); }
  catch { fail('OPPORTUNITY_V2_LEGACY_PREAPPROVAL_CHANGED'); }
  if (!exact(plan, ['kind', 'packageId', 'createdAt', 'expiresAt', 'preview', 'manifest'])
    || plan.kind !== 'eu-legacy-preapproval-package-v1' || plan.packageId !== packageId
    || !reference(plan.preview) || !reference(plan.manifest)) fail();
  const preview = verifiedJson(root, plan.preview, 8 * 1024 * 1024);
  const eligible = preview.entries?.filter(item => item.action === 'CHANGE_REQUIRES_APPROVAL');
  if (!Array.isArray(eligible) || eligible.length !== 391
    || preview.entries.length !== 398 || preview.scope?.actions?.NO_CANDIDATE !== 7
    || new Set(eligible.map(item => item.itemDigest)).size !== 391) fail();
  // The per-item loader verifies the plan, manifest, inventory, current mapping
  // and a real official artifact. Each later GET/POST repeats that full check.
  loadPackage(root, packageId, eligible[0].itemDigest, now);
  return deepFreeze({ packageId, createdAt: plan.createdAt, expiresAt: plan.expiresAt,
    eligibleCount: 391, conflictCount: 7, sourceFence: preview.sourceControl.fence,
    items: eligible.map(item => ({ externalIdentifier: item.externalIdentifier,
      itemDigest: item.itemDigest, title: item.title, programmeCodes: item.programmeCodes,
      status: item.status, opening: item.opening, amount: item.amount,
      deadlineCount: item.deadlineCount, directAwarders: item.directAwarders,
      reasonCodes: item.reasonCodes })) });
}
async function assertCurrent(client, loaded) {
  await require('./euSourceControl').assertEuQuiescent(client, 'EU_FUNDING_TENDERS', loaded.binding.sourceFence);
  const state = (await client.query("SELECT state,fence,eu_writer_mode,eu_writer_policy,eu_writer_mapping_digest FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS' FOR SHARE")).rows[0];
  const configured = euWriterConfiguration();
  if (!state || state.state !== 'QUIESCED' || state.fence !== loaded.binding.sourceFence
    || state.eu_writer_mode !== 'CANONICAL_V2' || state.eu_writer_policy !== configured.policyVersion
    || state.eu_writer_mapping_digest !== configured.mappingDigest) fail('OPPORTUNITY_V2_LEGACY_PREAPPROVAL_CHANGED');
  const row = (await client.query(`SELECT o.opportunity_id,o.current_revision_id,o.row_version,o.current_schema_version,o.lifecycle_state,
      r.snapshot,f.corrections,f.conflicts,
      (SELECT count(*)::int FROM opportunity_catalog.funding_resolution d WHERE d.opportunity_id=o.opportunity_id) AS resolution_count
      FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id)
      JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id
      WHERE f.external_identifier=$1 FOR SHARE OF o`, [loaded.item.externalIdentifier])).rows[0];
  if (!row || row.opportunity_id !== loaded.item.expected.opportunityId
    || row.current_revision_id !== loaded.item.expected.revisionId
    || Number(row.row_version) !== loaded.item.expected.rowVersion || row.current_schema_version !== 1
    || row.lifecycle_state !== 'ACTIVE') fail('OPPORTUNITY_V2_LEGACY_PREAPPROVAL_CHANGED');
  const existing = (await client.query(`SELECT
    (SELECT count(*)::int FROM opportunity_catalog.funding_candidate_v2 WHERE external_identifier=$1) AS candidates,
    (SELECT count(*)::int FROM opportunity_catalog.eu_writer_decision_v2 WHERE external_identifier=$1 AND decision='REVIEW') AS reviews`,
  [loaded.item.externalIdentifier])).rows[0];
  if (!existing || existing.candidates !== 0 || existing.reviews !== 0) fail('OPPORTUNITY_V2_LEGACY_PREAPPROVAL_CHANGED');
  const candidateId = 'offline:' + sha(loaded.item.externalIdentifier);
  const accepted = { opportunityId: row.opportunity_id, revisionId: row.current_revision_id,
    rowVersion: Number(row.row_version), snapshot: row.snapshot,
    identities: [{ namespace: 'EU_FUNDING_TENDERS', externalId: loaded.item.externalIdentifier }],
    mappingDigest: null, corrections: row.corrections || {}, resolutions: row.resolution_count ? [{ count: row.resolution_count }] : [],
    privateReferences: [] };
  const current = previewReconciliation({ accepted: [accepted], candidates: [{
    candidateId, snapshot: loaded.artifact.snapshot, mappingDigest: loaded.item.mappingDigest }] });
  if (current.previewDigest !== loaded.item.previewDigest || current.items.length !== 1
    || current.items[0].itemDigest !== loaded.item.itemDigest
    || current.items[0].action !== 'CHANGE_REQUIRES_APPROVAL') fail('OPPORTUNITY_V2_LEGACY_PREAPPROVAL_CHANGED');
  return true;
}
function validateApproval(raw, loaded, now = Date.now()) {
  let input;
  try { input = cloneData(raw, { maxBytes: 4096 }); } catch { fail(); }
  if (!exact(input, ['packageId', 'itemDigest', 'requestId', 'bindingDigest'])
    || input.packageId !== loaded.plan.packageId || input.itemDigest !== loaded.item.itemDigest
    || input.bindingDigest !== loaded.bindingDigest || !isUuidV7(input.requestId)) fail();
  const at = requestTime(input.requestId);
  if (at < Date.parse(loaded.plan.createdAt) || at > now + 5000) fail();
  return deepFreeze(input);
}
function approvalEvent(loaded, input, actorId) {
  return createAuditEvent({ trustedContext: { scope: 'PLATFORM', organizationId: null, tenantId: null,
    operationAuthority: 'CENTRAL', operationCode: 'OPPORTUNITY_CENTRAL_MANAGE',
    source: 'EU_LEGACY_PREARCHIVE', channel: 'APPLICATION', synchronous: false },
  input: { eventCode: 'SENSITIVE_ACTION_ALLOWED',
    actor: { type: 'HUMAN', id: actorId, membershipId: null, serviceActorCode: null, supportGrantId: null },
    subject: { type: 'EU_EVIDENCE_CONTENT',
      id: sha(loaded.item.contentDigest + ':' + loaded.item.evidenceFingerprint) },
    resource: { type: 'EU_LEGACY_PREARCHIVE', id: loaded.item.externalIdentifier },
    decision: 'ACCEPT', outcome: 'SUCCESS', observedAt: new Date(requestTime(input.requestId)).toISOString(),
    correlationId: input.requestId, causationId: null,
    idempotencyKey: sha('eu-legacy-prearchive\0' + input.requestId),
    streamType: 'OPERATIONS', payload: { detailCode: 'EU_LEGACY_PREARCHIVE_APPROVED',
      policyVersion: 'eu-legacy-prearchive-v1', catalogVersion: 'f12-events-v2',
      scopeType: 'EU_LEGACY_PREARCHIVE', scopeDigest: loaded.bindingDigest,
      semanticDigest: loaded.item.itemDigest } }, uuid: () => input.requestId });
}
function createEuLegacyPreapproval({ pool, policyVersion, recentMfaRequirement, workspaceRoot = ROOT }) {
  if (!pool?.connect) throw new TypeError('Central pool is required.');
  const authority = createActivationAuthorityV2({ policyVersion, recentMfaRequirement });
  const append = createAppendService({ appendPort: new PostgresAppendRepository() });
  async function transaction(packageId, itemDigest, context, work) {
    if (!humanContext(context)) fail('OPPORTUNITY_V2_AUTHORITY_DENIED');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE c4g_opportunity_central_runtime');
      const actorId = await authority.assertAdministrator(client, context);
      const selectedDigest = typeof itemDigest === 'function' ? itemDigest() : itemDigest;
      const loaded = loadPackage(workspaceRoot, packageId, selectedDigest);
      await assertCurrent(client, loaded);
      const result = await work(client, loaded, actorId);
      if (!isDeepStrictEqual(loaded, loadPackage(workspaceRoot, packageId, selectedDigest))) fail('OPPORTUNITY_V2_LEGACY_PREAPPROVAL_CHANGED');
      await authority.assertAdministrator(client, context);
      await client.query('COMMIT');
      return deepFreeze(result);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code?.startsWith('OPPORTUNITY_V2_')) throw error;
      if (error.code === '23505' || error.message === 'AUDIT_DIGEST_MISMATCH') fail('OPPORTUNITY_V2_IDEMPOTENCY_CONFLICT');
      fail('OPPORTUNITY_V2_LEGACY_PREAPPROVAL_UNAVAILABLE');
    } finally { client.release(); }
  }
  const get = (packageId, itemDigest, context) => transaction(packageId, itemDigest, context,
    async (_client, loaded) => ({ scope: 'PREARCHIVE_ONLY', binding: loaded.binding,
      bindingDigest: loaded.bindingDigest, action: loaded.item.action,
      title: loaded.item.title, amount: loaded.item.amount, deadlineCount: loaded.item.deadlineCount,
      reasonCodes: loaded.item.reasonCodes, approvalState: 'RECEIPT_REQUIRED' }));
  const list = async (packageId, context) => {
    let queue;
    return transaction(packageId, () => {
      queue = listPackage(workspaceRoot, packageId);
      return queue.items[0].itemDigest;
    }, context, async () => queue);
  };
  const approve = (raw, context) => transaction(raw?.packageId, raw?.itemDigest, context,
    async (client, loaded, actorId) => {
      const input = validateApproval(raw, loaded);
      const platform = { query(sql, values) { return client.query(sql.replace('audit.prepare_append_v1',
        'audit.prepare_platform_append_v1').replace('audit.append_event_v1', 'audit.append_platform_event_v1'), values); } };
      const result = await append.append(approvalEvent(loaded, input, actorId), platform);
      if (!result || !['APPENDED', 'DUPLICATE'].includes(result.status)) fail('OPPORTUNITY_V2_LEGACY_PREAPPROVAL_UNAVAILABLE');
      return { scope: 'PREARCHIVE_ONLY', packageId: loaded.plan.packageId,
        externalIdentifier: loaded.item.externalIdentifier, itemDigest: loaded.item.itemDigest,
        bindingDigest: loaded.bindingDigest, requestId: input.requestId, actorId,
        eventId: result.eventId, eventHash: result.eventHash,
        expiresAt: loaded.plan.expiresAt, replayed: result.status === 'DUPLICATE' };
    });
  return Object.freeze({ list, get, approve });
}
module.exports = { loadPackage, listPackage, assertCurrent, validateApproval, approvalEvent, createEuLegacyPreapproval };
