'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { createActivationAuthorityV2 } = require('./activationAuthority');
const { createOpportunityActivationV2 } = require('./activationComposition');
const ROOT = path.resolve(__dirname, '../../../..');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const PROFILES = Object.freeze({
  'eu-legacy-acceptance-package-v1': Object.freeze({ kind: 'eu-legacy-acceptance-preview-v1',
    file: /^output\/eu-legacy-acceptance-preview-[a-f0-9-]{36}\.json$/, heads: 398,
    candidates: 391, excluded: 7, review: false, label: 'EU_LEGACY_391' }),
  'eu-review-acceptance-package-v1': Object.freeze({ kind: 'eu-review-acceptance-preview-v1',
    file: /^output\/eu-review-acceptance-preview-[a-f0-9-]{36}\.json$/, heads: 137,
    candidates: 137, excluded: 7, review: true, label: 'EU_REVIEW_137' })
});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fail(code = 'OPPORTUNITY_V2_LEGACY_ACCEPTANCE_INVALID') {
  throw Object.assign(Error(code), { code });
}
function load(root, packageId, itemDigest = null) {
  if (!UUID.test(packageId) || itemDigest !== null && !SHA.test(itemDigest)) fail();
  const folder = path.join(root, 'output', `eu-legacy-acceptance-${packageId}`);
  let plan, bytes, preview, profile;
  try {
    plan = JSON.parse(fs.readFileSync(path.join(folder, 'plan.json')));
    profile = PROFILES[plan.kind];
    if (!profile || !profile.file.test(plan.preview?.path)) fail();
    bytes = fs.readFileSync(path.join(root, plan.preview.path));
    preview = JSON.parse(bytes);
  } catch { fail('OPPORTUNITY_V2_LEGACY_ACCEPTANCE_CHANGED'); }
  if (plan.packageId !== packageId
    || !SHA.test(plan.preview.sha256) || sha(bytes) !== plan.preview.sha256
    || !Number.isFinite(Date.parse(plan.expiresAt)) || Date.parse(plan.expiresAt) <= Date.now()
    || preview.kind !== profile.kind || preview.status !== 'REVIEW_ONLY'
    || preview.readOnly !== true || preview.databaseWrites !== 0
    || preview.scope?.heads !== profile.heads || preview.scope.candidates !== profile.candidates
    || preview.scope.conflictsExcluded !== profile.excluded
    || preview.sourceControl?.state !== 'QUIESCED' || preview.sourceControl.fence !== 7
    || preview.entries?.length !== profile.heads
    || preview.entries.filter(e => e.action === 'CHANGE_REQUIRES_APPROVAL').length !== profile.candidates
    || preview.entries.filter(e => e.action === 'NO_CANDIDATE').length !== profile.heads - profile.candidates) fail('OPPORTUNITY_V2_LEGACY_ACCEPTANCE_CHANGED');
  const eligible = preview.entries.filter(e => e.action === 'CHANGE_REQUIRES_APPROVAL');
  if (new Set(eligible.map(e => e.itemDigest)).size !== profile.candidates
    || new Set(preview.entries.map(e => e.externalIdentifier)).size !== profile.heads) fail();
  const item = itemDigest === null ? null : eligible.find(e => e.itemDigest === itemDigest);
  if (itemDigest !== null && (!item || item.archive?.kind !== 'FUNDING'
    || !UUID.test(item.archive.runId) || item.archive.externalIdentifier !== item.externalIdentifier
    || !UUID.test(item.expected?.opportunityId) || !UUID.test(item.expected?.revisionId)
    || !Number.isSafeInteger(item.expected?.rowVersion) || item.expected.rowVersion < 1)) fail();
  return { plan, preview, eligible, item, profile };
}
function createEuLegacyAcceptance({ pool, policyVersion, recentMfaRequirement, workspaceRoot = ROOT } = {}) {
  if (!pool?.connect || !path.isAbsolute(workspaceRoot)) throw new TypeError('Legacy acceptance dependencies invalid.');
  const authority = createActivationAuthorityV2({ policyVersion, recentMfaRequirement });
  const activation = createOpportunityActivationV2({ pool, policyVersion, recentMfaRequirement });
  async function authorized(context, work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE c4g_opportunity_central_runtime');
      await authority.assertAdministrator(client, context);
      const result = await work(client);
      await authority.assertAdministrator(client, context);
      await client.query('ROLLBACK');
      return result;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async function current(client, loaded) {
    const source = (await client.query("SELECT state,fence FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS'")).rows[0];
    if (source?.state !== 'QUIESCED' || Number(source.fence) !== 7) fail('OPPORTUNITY_V2_LEGACY_ACCEPTANCE_CHANGED');
    if (loaded.item) {
      const row = (await client.query(`SELECT o.opportunity_id,o.current_revision_id,o.row_version,o.current_schema_version
        FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id)
        WHERE f.external_identifier=$1`, [loaded.item.externalIdentifier])).rows[0];
      if (!row || row.opportunity_id !== loaded.item.expected.opportunityId
        || row.current_revision_id !== loaded.item.expected.revisionId
        || Number(row.row_version) !== loaded.item.expected.rowVersion
        || row.current_schema_version !== 1) fail('OPPORTUNITY_V2_LEGACY_ACCEPTANCE_CHANGED');
    }
  }
  async function boundPlan(client, loaded, planId, planDigest) {
    const row = (await client.query('SELECT * FROM opportunity_catalog.activation_plan_v2 WHERE plan_id=$1', [planId])).rows[0];
    if (!row || row.plan_digest !== planDigest || row.source_code !== 'EU_FUNDING_TENDERS'
      || !isDeepStrictEqual(row.archive_locator, loaded.item.archive)
      || !isDeepStrictEqual(row.expected, loaded.item.expected)
      || row.preview_digest !== loaded.item.previewDigest) fail('OPPORTUNITY_V2_LEGACY_ACCEPTANCE_CHANGED');
    return row;
  }
  const list = (packageId, context) => authorized(context, async client => {
    const loaded = load(workspaceRoot, packageId); await current(client, loaded);
    const states = (await client.query(`SELECT f.external_identifier,o.current_schema_version,o.content_digest
      FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id)
      WHERE f.external_identifier=ANY($1::text[])`, [loaded.eligible.map(e => e.externalIdentifier)])).rows;
    if (states.length !== loaded.profile.candidates) fail('OPPORTUNITY_V2_LEGACY_ACCEPTANCE_CHANGED');
    const byId = new Map(states.map(row => [row.external_identifier, row]));
    if (loaded.eligible.some(e => { const row = byId.get(e.externalIdentifier);
      return !row || ![1, 2].includes(row.current_schema_version)
        || row.current_schema_version === 2 && row.content_digest !== e.contentDigest;
    })) fail('OPPORTUNITY_V2_LEGACY_ACCEPTANCE_CHANGED');
    return { packageId, profile: loaded.profile.label, expiresAt: loaded.plan.expiresAt,
      eligibleCount: loaded.profile.candidates, conflictCount: loaded.profile.excluded,
      sourceFence: 7, items: loaded.eligible.map(e => ({ externalIdentifier: e.externalIdentifier,
        itemDigest: e.itemDigest, title: e.title, amount: e.amount, deadlineCount: e.deadlineCount,
        reasonCodes: e.reasonCodes, status: e.status, programmeCodes: e.programmeCodes,
        accepted: byId.get(e.externalIdentifier)?.current_schema_version === 2
          && byId.get(e.externalIdentifier)?.content_digest === e.contentDigest })) };
  });
  const get = (packageId, itemDigest, context) => authorized(context, async client => {
    const loaded = load(workspaceRoot, packageId, itemDigest); await current(client, loaded);
    return { packageId, item: loaded.item, expiresAt: loaded.plan.expiresAt };
  });
  async function prepare(raw, context) {
    const loaded = load(workspaceRoot, raw.packageId, raw.itemDigest);
    await authorized(context, client => current(client, loaded));
    const prepare = loaded.profile.review ? activation.prepare : activation.prepareLegacy;
    const result = await prepare({ requestId: raw.requestId,
      archive: loaded.item.archive, expected: loaded.item.expected }, context, loaded.item.previewDigest);
    if (result.preview.previewDigest !== loaded.item.previewDigest
      || result.preview.items[0].action !== 'CHANGE_REQUIRES_APPROVAL') fail('OPPORTUNITY_V2_LEGACY_ACCEPTANCE_CHANGED');
    return result;
  }
  async function approve(raw, context) {
    const loaded = load(workspaceRoot, raw.packageId, raw.itemDigest);
    await authorized(context, async client => { await current(client, loaded);
      await boundPlan(client, loaded, raw.planId, raw.planDigest); });
    return (loaded.profile.review ? activation.approve : activation.approveLegacy)({ requestId: raw.requestId,
      planId: raw.planId, planDigest: raw.planDigest }, context);
  }
  async function accept(raw, context) {
    const loaded = load(workspaceRoot, raw.packageId, raw.itemDigest);
    await authorized(context, async client => {
      const prior = (await client.query('SELECT request_id FROM opportunity_catalog.accepted_receipt_v2 WHERE request_id=$1',
        [raw.requestId])).rows[0];
      if (!prior) await current(client, loaded);
      await boundPlan(client, loaded, raw.planId, raw.planDigest);
    });
    return (loaded.profile.review ? activation.accept : activation.acceptLegacy)({ requestId: raw.requestId, planId: raw.planId,
      fence: raw.fence, sourceFence: 7 }, context);
  }
  return Object.freeze({ list, get, prepare, approve, accept });
}
module.exports = { load, createEuLegacyAcceptance };
