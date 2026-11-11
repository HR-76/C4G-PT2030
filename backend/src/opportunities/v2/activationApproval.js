'use strict';
const { isDeepStrictEqual } = require('node:util');
const { cloneData, deepFreeze } = require('./data');
const { hash, loadVerifiedActivationArchive } = require('./activationArchive');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function input(raw, keys) {
  const value = cloneData(raw, { maxBytes: 8192 });
  if (!value || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
    || typeof value.requestId !== 'string' || !/^[A-Za-z0-9:_.-]{8,128}$/.test(value.requestId)
    || Object.hasOwn(value, 'planId') && !UUID.test(value.planId)
    || Object.hasOwn(value, 'planDigest') && !SHA.test(value.planDigest)
    || Object.hasOwn(value, 'fence') && (!Number.isSafeInteger(value.fence) || value.fence < 1)) fail('OPPORTUNITY_V2_ACTIVATION_INVALID');
  return deepFreeze(value);
}
function planBinding(row) {
  return { version: 'opportunity-activation-plan-v2.0', preparedBy: row.prepared_by, source: row.source_code,
    archive: row.archive_locator, archiveDigest: row.archive_digest, candidateId: row.candidate_id,
    mappingDigest: row.mapping_digest, snapshotDigest: row.snapshot_digest, expected: row.expected,
    preview: row.preview, previewDigest: row.preview_digest };
}
function verifyPlan(row) {
  if (!row || !UUID.test(row.plan_id) || hash(planBinding(row)) !== row.plan_digest
    || row.preview?.previewDigest !== row.preview_digest || row.preview?.items?.length !== 1
    || row.preview.items[0].candidateId !== row.candidate_id) fail('OPPORTUNITY_V2_PLAN_INVALID');
  return row;
}
function planView(row, replayed = false) {
  verifyPlan(row);
  return deepFreeze({ planId: row.plan_id, planDigest: row.plan_digest, source: row.source_code, state: row.state,
    fence: row.fence, expiresAt: new Date(row.expires_at).toISOString(), preview: row.preview, replayed });
}
function commandFor(row, archive, requestId) {
  return { requestId, candidateId: row.candidate_id, snapshot: archive.snapshot, mappingDigest: row.mapping_digest,
    expected: row.expected, approvalDigest: row.preview_digest };
}
async function verifyPlanArchive(client, row, { allowLegacyPrearchive = false } = {}) {
  verifyPlan(row);
  const archived = await loadVerifiedActivationArchive(client, row.archive_locator, { allowLegacyPrearchive });
  if (archived.source !== row.source_code || archived.candidateId !== row.candidate_id || archived.payloadDigest !== row.archive_digest
    || archived.mappingDigest !== row.mapping_digest || archived.snapshotDigest !== row.snapshot_digest) fail('OPPORTUNITY_V2_PLAN_ARCHIVE_CHANGED');
  return archived;
}
async function lockedPlan(client, planId, { exclusive = false } = {}) {
  const row = (await client.query(`SELECT *,expires_at>clock_timestamp() AS unexpired FROM opportunity_catalog.activation_plan_v2 WHERE plan_id=$1 FOR ${exclusive ? 'UPDATE' : 'SHARE'}`, [planId])).rows[0];
  return verifyPlan(row);
}
async function verifyActivationApproval(client, { input: accepted, context }) {
  if (!context || !UUID.test(context.planId) || !Number.isSafeInteger(context.fence)) return false;
  const row = await lockedPlan(client, context.planId);
  if (row.state !== 'APPROVED' || row.unexpired !== true || row.fence !== context.fence || row.approved_by !== context.actor?.id) return false;
  if(Object.hasOwn(context,'executor11145Digest'))await require('./executor11145Scope').verifyExecutor11145Plan(client,row,context.executor11145Digest);
  await require('./euSourceControl').assertEuQuiescent(client, row.source_code, context.sourceFence);
  const archive = await verifyPlanArchive(client, row, { allowLegacyPrearchive: context.legacyPrearchiveAcceptance === true });
  return isDeepStrictEqual(commandFor(row, archive, accepted.requestId), accepted);
}
module.exports = { input, fail, planBinding, verifyPlan, planView, commandFor, verifyPlanArchive, lockedPlan, verifyActivationApproval };
