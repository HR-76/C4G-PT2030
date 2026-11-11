'use strict';
const { canonicalize } = require('../organizationalProfile/canonicalization');
const producer = require('../organizationalProfile/pq1Material');
const { resolvePq1Release } = require('../organizationalProfile/pq1Release');
const { uuid, validatePublication } = require('./materializer');
const { fail } = require('./release');
// No permission bypass: use only inside the authorized tenant transaction.
// This validates historical identity, not current approval authority/F11/grants.
async function readPublication(client, organizationId, versionId) {
  uuid(organizationId); uuid(versionId);
  const rows = (await client.query(`SELECT c.*,v.version_id,v.version_digest,v.approval_evidence,
    v.approver_subject_id,v.approver_membership_id,p.publication_id,p.published_at
    FROM organization_profile.pq1_version v
    JOIN organization_profile.pq1_publication p USING(organization_id,version_id)
    JOIN organization_profile.pq1_candidate c USING(organization_id,candidate_id)
    WHERE v.organization_id=$1 AND v.version_id=$2`, [organizationId,versionId])).rows;
  if (rows.length !== 1) fail('RESOURCE_NOT_AVAILABLE');
  const c = rows[0], identity = c.identity_record;
  const refs = await resolvePq1Release(client);
  if (Object.entries(refs).some(([key, value]) => canonicalize(value) !== canonicalize(identity[key]))
    || producer.candidateDigest(identity) !== c.candidate_digest || c.version_digest !== c.candidate_digest
    || identity.organizationId !== organizationId || identity.profileScopeId !== c.profile_scope_id
    || identity.editorialDigest !== c.pq1_digest || identity.completionDigest !== c.completion_digest
    || identity.source.draftId !== c.draft_id || identity.source.revision !== Number(c.source_revision)
    || identity.source.digest !== c.source_digest || identity.submitterSubjectId !== c.submitter_subject_id) fail();
  const authors = (await client.query(`SELECT subject_id FROM organization_profile.pq1_candidate_author
    WHERE organization_id=$1 AND candidate_id=$2 ORDER BY subject_id`, [organizationId,c.candidate_id])).rows.map(r=>r.subject_id);
  if (!authors.length || canonicalize(authors) !== canonicalize(identity.authors.map(a=>a.subjectId))) fail();
  const revision = (await client.query(`SELECT r.semantic_digest,s.scope_type,s.scope_id FROM organization_profile.profile_draft_revision r
    JOIN organization_profile.profile_scope s USING(organization_id,profile_scope_id)
    WHERE r.organization_id=$1 AND r.draft_id=$2 AND r.revision=$3 AND r.profile_scope_id=$4`,
  [organizationId,c.draft_id,c.source_revision,c.profile_scope_id])).rows[0];
  if (!revision || revision.semantic_digest !== c.source_digest) fail();
  const items = (await client.query(`SELECT v.item_id AS "itemId",v.item_version_id AS "itemVersionId",v.domain,
    v.knowledge_status AS "knowledgeStatus",v.concept_id AS "conceptId",v.verification_status AS "verificationStatus",
    v.conflict_status AS "conflictStatus",v.confidentiality_class AS "confidentialityClass"
    FROM organization_profile.profile_revision_item i JOIN organization_profile.profile_item_version v
      ON (i.organization_id,i.profile_scope_id,i.item_version_id)=(v.organization_id,v.profile_scope_id,v.item_version_id)
    WHERE i.organization_id=$1 AND i.draft_id=$2 AND i.revision=$3 ORDER BY v.item_id`,
  [organizationId,c.draft_id,c.source_revision])).rows;
  const members = (await client.query(`SELECT kind,version_id FROM organization_profile.competency_revision_member
    WHERE organization_id=$1 AND draft_id=$2 AND revision=$3 ORDER BY kind,version_id`,
  [organizationId,c.draft_id,c.source_revision])).rows;
  const source = { draftId:c.draft_id,revision:Number(c.source_revision),scopeType:revision.scope_type,
    scopeId:revision.scope_id,digest:c.source_digest,producerContract:identity.source.producerContract,items,competencyMaterial:members };
  validatePublication({ organizationId,source,content:c.pq1_content,contentDigest:c.pq1_digest });
  const completion = producer.complete(c.pq1_content,refs.policyRef);
  if (completion.completionDigest !== c.completion_digest || canonicalize(completion.record) !== canonicalize(c.completion_record)) fail();
  return { source, content:c.pq1_content, contentDigest:c.pq1_digest, publicationId:c.publication_id,
    versionId:c.version_id, authors, approvalEvidence:c.approval_evidence,
    approverSubjectId:c.approver_subject_id, approverMembershipId:c.approver_membership_id };
}
module.exports = { readPublication };
