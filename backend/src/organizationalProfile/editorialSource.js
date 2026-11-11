'use strict';

const { verifySource, extract } = require('./editorialMaterial');
const { members } = require('./competencyMaterial');
const { OrganizationalProfileContractError } = require('./errors');
function fail(code) { throw new OrganizationalProfileContractError(code); }

async function loadRevisionRange(client, organizationId, draftId, firstRevision, lastRevision) {
  if (!Number.isSafeInteger(firstRevision) || !Number.isSafeInteger(lastRevision)
      || firstRevision < 1 || lastRevision < firstRevision) fail('F13_AUTHORSHIP_EVIDENCE_UNAVAILABLE');
  const revisions = (await client.query(`SELECT r.revision,r.semantic_digest,r.actor_subject_id,s.scope_type,s.scope_id
    FROM organization_profile.profile_draft_revision r JOIN organization_profile.profile_scope s USING(organization_id,profile_scope_id)
    WHERE r.organization_id=$1 AND r.draft_id=$2 AND r.revision BETWEEN $3 AND $4 ORDER BY r.revision`,
  [organizationId, draftId, firstRevision, lastRevision])).rows;
  if (revisions.length !== lastRevision - firstRevision + 1) fail('F13_AUTHORSHIP_EVIDENCE_UNAVAILABLE');
  const history = [];
  for (const row of revisions) {
    const revision = Number(row.revision);
    const items = (await client.query(`SELECT v.item_id AS "itemId",v.item_version_id AS "itemVersionId",v.domain,
      v.knowledge_status AS "knowledgeStatus",v.concept_id AS "conceptId",v.verification_status AS "verificationStatus",
      v.conflict_status AS "conflictStatus",v.confidentiality_class AS "confidentialityClass",v.actor_subject_id AS "actorSubjectId"
      FROM organization_profile.profile_revision_item i JOIN organization_profile.profile_item_version v
      ON (i.organization_id,i.profile_scope_id,i.item_version_id)=(v.organization_id,v.profile_scope_id,v.item_version_id)
      WHERE i.organization_id=$1 AND i.draft_id=$2 AND i.revision=$3 ORDER BY v.item_id`, [organizationId, draftId, revision])).rows;
    const intentions = (await client.query(`SELECT operation FROM organization_profile.idempotency_record
      WHERE organization_id=$1 AND draft_id=$2 AND revision=$3`, [organizationId, draftId, revision])).rows;
    let operation;
    if (intentions.length === 1) operation = { PROFILE_DRAFT_CREATE: 'CREATE', PROFILE_DRAFT_EDIT: 'EDIT', PROFILE_SUBMIT: 'SUBMIT' }[intentions[0].operation];
    else if (intentions.length === 0) {
      const proof = (await client.query(`SELECT operation FROM organization_profile.competency_idempotency_record
        WHERE organization_id=$1 AND draft_id=$2 AND revision=$3 AND operation<>'EVIDENCE_LINK_READ'`,
      [organizationId, draftId, revision])).rows;
      if (proof.length === 1 && ['COMPETENCY_SET', 'EXPERIENCE_SET', 'EVIDENCE_ATTACH', 'COMPETENCY_VERIFY'].includes(proof[0].operation)) operation = 'COMPETENCY';
    }
    if (!operation) fail('F13_AUTHORSHIP_EVIDENCE_UNAVAILABLE');
    const base = { draftId, revision, scopeType: row.scope_type, scopeId: row.scope_id,
      items, digest: row.semantic_digest, actorSubjectId: row.actor_subject_id, operation };
    const competencyMaterial = await members(client, organizationId, draftId, revision);
    const candidates = [];
    // The two historical producers have distinct serialized inputs. Accept
    // only a uniquely reproducible persisted digest; never default the producer.
    for (const extra of [{ producerContract: 'F13_AUTHORING_WITH_COMPETENCIES_V1', competencyMaterial },
      ...(competencyMaterial.length ? [] : [{ producerContract: 'F13_AUTHORING_V1', competencyMaterial: null }])]) {
      try { candidates.push(verifySource({ ...base, ...extra })); } catch (error) {
        if (error.code !== 'F13_SOURCE_INTEGRITY_UNAVAILABLE') throw error;
      }
    }
    if (candidates.length !== 1) fail('F13_SOURCE_INTEGRITY_UNAVAILABLE');
    history.push(candidates[0]);
  }
  return history;
}

async function loadEditorialRevision(client, organizationId, draftId, revision) {
  return (await loadRevisionRange(client, organizationId, draftId, revision, revision))[0];
}

// Authorship requires the complete lineage, but not an aggregate canonical
// value containing every revision. The immutable upper revision is pinned by
// the caller's transaction; each source and the final identity retain limits.
async function* editorialRevisions(client, organizationId, draftId, lastRevision) {
  if (!Number.isSafeInteger(lastRevision) || lastRevision < 1) fail('F13_AUTHORSHIP_EVIDENCE_UNAVAILABLE');
  for (let first = 1; first <= lastRevision; first += 25) {
    yield* await loadRevisionRange(client, organizationId, draftId, first, Math.min(first + 24, lastRevision));
  }
}
async function loadEditorialAuthors(client, organizationId, draftId, lastRevision, accumulator) {
  for await (const revision of editorialRevisions(client, organizationId, draftId, lastRevision)) accumulator.accept(revision);
  return accumulator.finish();
}
// Compatibility for diagnostic callers; production uses exact revisions or
// streaming authorship, never this aggregate history.
async function loadEditorialHistory(client, organizationId, draftId, lastRevision) {
  const history = [];
  for await (const revision of editorialRevisions(client, organizationId, draftId, lastRevision)) history.push(revision);
  return history;
}

async function resolveEditorialReferences(client, organizationId, source) {
  const ids = source.items.filter(item => item.knowledgeStatus === 'KNOWN').map(item => item.conceptId);
  const references = (await client.query(`SELECT c.concept_id AS "conceptId",c.scheme_id AS "schemeId",c.release_id AS "releaseId",
    r.release_version AS "releaseVersion",r.semantic_digest AS "releaseDigest",c.organization_id AS "ownerOrganizationId"
    FROM organization_profile.concept c JOIN organization_profile.catalog_release r USING(release_id)
    JOIN organization_profile.scheme s ON (s.scheme_id,s.release_id)=(c.scheme_id,c.release_id)
    WHERE c.concept_id=ANY($1::uuid[]) AND (c.organization_id IS NULL OR c.organization_id=$2)
    AND r.lifecycle='PUBLISHED' AND c.deprecated_at IS NULL AND s.scheme_code IN ('THEMATIC_AREA','STRATEGIC_PRIORITY')`,
  [ids, organizationId])).rows;
  // extract enforces exact ownership, state and presence for every KNOWN item.
  return extract(source, organizationId, references);
}

module.exports = { loadEditorialHistory, loadEditorialRevision, loadEditorialAuthors, editorialRevisions, resolveEditorialReferences };
