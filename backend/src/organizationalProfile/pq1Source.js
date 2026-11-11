'use strict';
const { resolveEditorialReferences } = require('./editorialSource');
const material = require('./pq1Material');
const { OrganizationalProfileContractError } = require('./errors');
function fail(code = 'F13_REFERENCE_INCOMPATIBLE') { throw new OrganizationalProfileContractError(code); }
const iso = value => value instanceof Date ? value.toISOString() : value;
async function catalogEntry(client, org, id, kind) {
  const row = (await client.query(`SELECT e.*,r.release_version FROM organization_profile.competency_catalog_entry e
    JOIN organization_profile.competency_catalog_release r ON r.release_id=e.release_id
    AND r.organization_id IS NOT DISTINCT FROM e.organization_id
    WHERE e.entry_id=$1 AND e.kind=$2 AND r.lifecycle='PUBLISHED' AND (e.organization_id IS NULL OR e.organization_id=$3)`, [id, kind, org])).rows[0];
  if (!row) fail();
  return row;
}
async function concept(client, org, id) {
  const e = await catalogEntry(client, org, id, 'COMPETENCY_CONCEPT');
  const c = (await client.query(`SELECT c.scheme_id,r.release_version FROM organization_profile.concept c
    JOIN organization_profile.scheme s ON s.scheme_id=c.scheme_id AND s.release_id=c.release_id
    JOIN organization_profile.catalog_release r ON r.release_id=c.release_id
    WHERE c.concept_id=$1 AND c.release_id=$2 AND s.scheme_code='COMPETENCY' AND c.deprecated_at IS NULL
    AND r.lifecycle='PUBLISHED' AND c.organization_id IS NOT DISTINCT FROM $3::uuid`, [id, e.release_id, e.organization_id])).rows[0];
  if (!c) fail();
  return { conceptId: id, schemeId: c.scheme_id, releaseId: e.release_id, releaseVersion: c.release_version,
    frameworkId: e.framework_id, frameworkVersion: e.framework_version };
}
async function method(client, org, id) {
  const e = await catalogEntry(client, org, id, 'VERIFICATION_METHOD');
  const d = (await client.query(`SELECT * FROM organization_profile.pq1_method_descriptor WHERE method_id=$1
    AND release_id=$2 AND organization_id IS NOT DISTINCT FROM $3::uuid`, [id, e.release_id, e.organization_id])).rows[0];
  if (!d || d.descriptor_version !== 'F13_PQ1_VERIFICATION_DESCRIPTOR_V1') fail();
  return { methodId: id, releaseId: e.release_id, releaseVersion: e.release_version,
    maxValiditySeconds: e.max_validity_seconds === null ? null : Number(e.max_validity_seconds), documentRequired: d.document_required };
}
async function documentAuthorizations(client, org, links) {
  const result = [];
  for (const link of links) if (link.documentVersionId) {
    const d = (await client.query('SELECT * FROM document_storage.load_competency_reference($1,$2)', [org, link.documentVersionId])).rows[0];
    if (!d || d.state !== 'AVAILABLE' || d.scan_state !== 'CLEAN' || d.resource_type !== 'EXPERIENCE_EVIDENCE'
      || d.resource_id !== link.experienceId) fail('F13_RESOURCE_NOT_AVAILABLE');
    if (!result.some(r => r.resource.id === d.document_id)) result.push({ operationCode: 'DOCUMENT_READ', resource: {
      id: d.document_id, resourceType: 'DOCUMENT', organizationId: org, scopeType: 'ORGANIZATION', scopeId: null,
      status: 'ACTIVE', distinctFromActorIds: [], unitId: null, teamIds: [], ancestorUnitIds: [] } });
  }
  return result;
}
async function loadPq1Material(client, org, source, observedAt) {
  const thematic = await resolveEditorialReferences(client, org, source);
  const thematicReferences = thematic.content.items.filter(i => i.conceptRef).map(i => i.conceptRef)
    .filter((r, i, all) => all.findIndex(v => v.conceptId === r.conceptId) === i);
  const ids = kind => (source.competencyMaterial || []).filter(r => r.kind === kind).map(r => r.version_id);
  const query = async (table, column, kind) => (await client.query(`SELECT r.* FROM organization_profile.${table} r
    JOIN organization_profile.profile_draft d ON d.organization_id=r.organization_id AND d.profile_scope_id=r.profile_scope_id
    WHERE r.organization_id=$1 AND d.draft_id=$2 AND r.${column}=ANY($3::uuid[]) ORDER BY r.${column}`, [org, source.draftId, ids(kind)])).rows;
  const assertions = [];
  for (const r of await query('competency_assertion_version', 'version_id', 'ASSERTION')) {
    let levelRef = null;
    if (r.level_id) { const l = await catalogEntry(client, org, r.level_id, 'FRAMEWORK_LEVEL');
      levelRef = { entryId: l.entry_id, releaseId: l.release_id, frameworkId: l.framework_id, frameworkVersion: l.framework_version }; }
    assertions.push({ assertionId: r.assertion_id, versionId: r.version_id, organizationId: org,
      actorSubjectId: r.actor_subject_id, knowledgeStatus: r.knowledge_status,
      conceptRef: r.concept_id ? await concept(client, org, r.concept_id) : null, levelRef });
  }
  const experiences = [];
  for (const r of await query('experience_evidence_version', 'version_id', 'EXPERIENCE')) {
    const t = await catalogEntry(client, org, r.type_id, 'EXPERIENCE_TYPE');
    const p = (await client.query(`SELECT * FROM organization_profile.pq1_provenance
      WHERE organization_id=$1 AND profile_scope_id=$2 AND provenance_id=$3 AND experience_version_id=$4`,
    [org, r.profile_scope_id, r.provenance_ref, r.version_id])).rows[0];
    if (!p) fail('F13_PROVENANCE_UNRESOLVED');
    experiences.push({ experienceId: r.experience_id, versionId: r.version_id, organizationId: org, actorSubjectId: r.actor_subject_id,
      typeRef: { entryId: t.entry_id, releaseId: t.release_id, releaseVersion: t.release_version },
      observedFrom: iso(r.observed_from), observedUntil: iso(r.observed_until), provenance: {
        provenanceId: p.provenance_id, organizationId: org, experienceVersionId: r.version_id,
        sourceType: p.source_type, actorSubjectId: p.actor_subject_id, recordedAt: iso(p.recorded_at) } });
  }
  const links = (await query('competency_evidence_link', 'version_id', 'LINK')).map(r => ({ linkId: r.version_id,
    organizationId: org, actorSubjectId: r.actor_subject_id, assertionVersionId: r.assertion_version_id,
    experienceVersionId: r.experience_version_id,
    experienceId: experiences.find(e => e.versionId === r.experience_version_id)?.experienceId,
    documentVersionId: r.document_version_id }));
  if (links.some(l => !l.experienceId)) fail('F13_SOURCE_INTEGRITY_UNAVAILABLE');
  const additionalAuthorizations = await documentAuthorizations(client, org, links);
  const verifications = [];
  for (const r of await query('competency_verification_result', 'verification_id', 'VERIFICATION')) {
    const revoked = (await client.query(`SELECT * FROM organization_profile.pq1_verification_status_event
      WHERE organization_id=$1 AND verification_id=$2`, [org, r.verification_id])).rows[0];
    verifications.push({ verificationId: r.verification_id, organizationId: org, actorSubjectId: r.actor_subject_id,
      assertionVersionId: r.assertion_version_id, originalStatus: r.status, verifiedAt: iso(r.verified_at), validUntil: iso(r.valid_until),
      materialDigest: r.material_digest, method: await method(client, org, r.method_id), revocation: revoked ? {
        eventId: revoked.event_id, verificationId: r.verification_id, status: revoked.status, reasonCode: revoked.reason_code,
        actorSubjectId: revoked.actor_subject_id, recordedAt: iso(revoked.recorded_at) } : null });
  }
  return { ...material.extract({ source, thematicReferences, organizationId: org, assertions, experiences, links,
    verifications, observedAt }), additionalAuthorizations };
}
module.exports = { loadPq1Material, documentAuthorizations, catalogEntry, concept, method };
