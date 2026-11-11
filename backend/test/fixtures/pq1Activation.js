'use strict';
const m = require('../../src/organizationalProfile/pq1Material');
const { policyRef } = require('../../src/organizationalProfile/pq1Release');
const { intentDigest } = require('../../src/security/tenantRepositorySupport');
const thematic = require('../../src/organizationalProfile/editorialMaterial');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-16T12:00:00.000Z';
function fixture() {
  const org = id(1), author = id(2);
  const items = ['THEMATIC_AREA', 'STRATEGIC_PRIORITY'].map((domain, n) => ({ itemId: id(10 + n), itemVersionId: id(20 + n),
    domain, knowledgeStatus: n ? 'UNKNOWN' : 'KNOWN', conceptId: n ? null : id(30), actorSubjectId: author,
    verificationStatus: 'UNVERIFIED', conflictStatus: 'CLEAR', confidentialityClass: 'INTERNAL' }));
  const f = { organizationId: org, observedAt: at,
    thematicReferences: [{ conceptId: id(30), schemeId: id(31), releaseId: id(32), releaseVersion: 'fixture-v1', releaseDigest: 'a'.repeat(64), ownerOrganizationId: org }],
    source: { draftId: id(4), revision: 1, scopeType: 'ORGANIZATION', scopeId: null, items,
      producerContract: 'F13_AUTHORING_WITH_COMPETENCIES_V1', actorSubjectId: author, operation: 'CREATE' },
    assertions: [{ assertionId: id(40), versionId: id(41), organizationId: org, actorSubjectId: author,
      knowledgeStatus: 'KNOWN', conceptRef: { conceptId: id(42), schemeId: id(43), releaseId: id(44), frameworkId: null, frameworkVersion: null }, levelRef: null }],
    experiences: [{ experienceId: id(50), versionId: id(51), organizationId: org, actorSubjectId: author,
      typeRef: { entryId: id(52), releaseId: id(44) }, observedFrom: at, observedUntil: at,
      provenance: { provenanceId: id(53), organizationId: org, experienceVersionId: id(51), actorSubjectId: author, sourceType: 'ORGANIZATION_MANUAL', recordedAt: at } }],
    links: [{ linkId: id(60), organizationId: org, actorSubjectId: author, assertionVersionId: id(41), experienceVersionId: id(51), documentVersionId: null }],
    verifications: [] };
  return sync(f);
}
function sync(f) {
  f.source.competencyMaterial = [...f.assertions.map(r => ({ kind: 'ASSERTION', version_id: r.versionId })),
    ...f.experiences.map(r => ({ kind: 'EXPERIENCE', version_id: r.versionId })), ...f.links.map(r => ({ kind: 'LINK', version_id: r.linkId })),
    ...f.verifications.map(r => ({ kind: 'VERIFICATION', version_id: r.verificationId }))];
  f.source.digest = intentDigest({ scopeType: 'ORGANIZATION', scopeId: null,
    items: f.source.items.map(({ itemId, itemVersionId, domain, knowledgeStatus, conceptId }) => ({ itemId, itemVersionId, domain, knowledgeStatus, conceptId })), competencyMaterial: f.source.competencyMaterial });
  return f;
}
function verify(f) {
  f.verifications = [{ verificationId: id(70), organizationId: id(1), actorSubjectId: id(3), assertionVersionId: id(41),
    originalStatus: 'VERIFIED', verifiedAt: at, validUntil: '2026-10-16T13:00:00.000Z', revocation: null,
    method: { methodId: id(71), releaseId: id(44), documentRequired: false, maxValiditySeconds: 3600 },
    materialDigest: intentDigest({ assertion: id(41), links: [id(60)], method: id(71) }) }];
  return sync(f);
}

module.exports = { fixture, verify, sync, id, at };
