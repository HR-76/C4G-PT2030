'use strict';

const thematic = require('./editorialMaterial');
const thematicRelease = require('./editorialRelease');
const { canonicalClone, canonicalize } = require('./canonicalization');
const { OrganizationalProfileContractError } = require('./errors');
const { digest } = thematic;
const SCHEMA = Object.freeze({ id: 'F13_ORG_PQ1_PUBLICATION', version: '1.0.0' });
const EXTRACTOR = 'F13_PQ1_MULTIDOMAIN_V1';
const POLICY = 'F13_PQ1_PUBLICATION_COMPLETION_V1';
const COVERAGE = Object.freeze({ scopeType: 'ORGANIZATION', includedDomains: Object.freeze([
  'THEMATIC_AREA', 'STRATEGIC_PRIORITY', 'COMPETENCY', 'EXPERIENCE']),
  constraintsAssessed: false, effectiveSnapshot: false, f14Consumable: false });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail = (code = 'F13_SOURCE_INTEGRITY_UNAVAILABLE') => { throw new OrganizationalProfileContractError(code); };
const uuid = v => { if (typeof v !== 'string' || !UUID.test(v)) fail(); };
const instant = v => { if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail(); return Date.parse(v); };
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function boundedClone(value) {
  try { return canonicalClone(value); } catch (error) {
    if (error instanceof TypeError && error.message === 'F13 canonical value exceeds the structural limit.') fail('F13_LIMIT_EXCEEDED');
    throw error;
  }
}
function unique(rows, key) {
  if (!Array.isArray(rows)) fail();
  if (rows.length > 100) fail('F13_LIMIT_EXCEEDED');
  const ids = new Set();
  for (const row of rows) { uuid(row[key]); if (ids.has(row[key])) fail(); ids.add(row[key]); }
  return new Map(rows.map(row => [row[key], row]));
}
function verificationState(verification, observedAt, revocation = null) {
  const now = instant(observedAt), start = instant(verification.verifiedAt);
  if (verification.originalStatus !== 'VERIFIED') fail();
  const end = verification.validUntil === null ? null : instant(verification.validUntil);
  if (start > now || (end !== null && end <= start)) fail();
  if (revocation) {
    uuid(revocation.eventId);
    if (revocation.verificationId !== verification.verificationId || revocation.status !== 'REVOKED'
      || instant(revocation.recordedAt) > now) fail();
    return 'REVOKED';
  }
  return end !== null && now >= end ? 'EXPIRED' : 'VERIFIED';
}

// Repository-loaded immutable rows only. Never accept this structure from HTTP.
function extract({ source, thematicReferences, assertions, experiences, links, verifications,
  observedAt, organizationId }) {
  uuid(organizationId); instant(observedAt);
  thematic.verifySource(source);
  const base = thematic.extract(source, organizationId, thematicReferences);
  const assertionMap = unique(assertions, 'versionId');
  const experienceMap = unique(experiences, 'versionId');
  unique(links, 'linkId'); unique(verifications, 'verificationId');
  const members = [...assertions.map(r => ({ kind: 'ASSERTION', version_id: r.versionId })),
    ...experiences.map(r => ({ kind: 'EXPERIENCE', version_id: r.versionId })),
    ...links.map(r => ({ kind: 'LINK', version_id: r.linkId })),
    ...verifications.map(r => ({ kind: 'VERIFICATION', version_id: r.verificationId }))];
  const sortMembers = rows => [...rows].sort((a, b) => order(a.kind, b.kind) || order(a.version_id, b.version_id));
  if (canonicalize(sortMembers(members)) !== canonicalize(sortMembers(source.competencyMaterial || []))) fail();
  for (const row of [...assertions, ...experiences, ...links, ...verifications]) {
    if (row.organizationId !== organizationId) fail('F13_RESOURCE_NOT_AVAILABLE');
    uuid(row.actorSubjectId);
  }
  for (const a of assertions) {
    uuid(a.assertionId);
    if (!['KNOWN', 'UNKNOWN'].includes(a.knowledgeStatus)) fail();
    if (a.knowledgeStatus === 'UNKNOWN') {
      if (a.conceptRef !== null || a.levelRef !== null) fail();
    } else {
      if (!a.conceptRef) fail('F13_REFERENCE_INCOMPATIBLE');
      for (const k of ['conceptId', 'schemeId', 'releaseId']) uuid(a.conceptRef[k]);
      if (a.levelRef && (a.levelRef.releaseId !== a.conceptRef.releaseId
        || a.levelRef.frameworkId !== a.conceptRef.frameworkId
        || a.levelRef.frameworkVersion !== a.conceptRef.frameworkVersion)) fail('F13_REFERENCE_INCOMPATIBLE');
    }
  }
  for (const e of experiences) {
    uuid(e.experienceId); uuid(e.typeRef.entryId); uuid(e.typeRef.releaseId);
    if (instant(e.observedUntil) < instant(e.observedFrom)) fail();
    const p = e.provenance;
    if (!p || p.organizationId !== organizationId || p.experienceVersionId !== e.versionId
      || p.sourceType !== 'ORGANIZATION_MANUAL') fail('F13_PROVENANCE_UNRESOLVED');
    uuid(p.provenanceId); uuid(p.actorSubjectId); instant(p.recordedAt);
  }
  for (const l of links) {
    if (!assertionMap.has(l.assertionVersionId) || !experienceMap.has(l.experienceVersionId)) fail();
    if (l.documentVersionId !== null) uuid(l.documentVersionId);
  }
  const seen = new Set();
  const verificationRows = verifications.map(v => {
    const assertion = assertionMap.get(v.assertionVersionId);
    const support = links.filter(l => l.assertionVersionId === v.assertionVersionId);
    if (!assertion || assertion.knowledgeStatus !== 'KNOWN' || !support.length || seen.has(v.assertionVersionId)) fail();
    seen.add(v.assertionVersionId);
    const d = v.method;
    if (!d || typeof d.documentRequired !== 'boolean') fail('F13_REFERENCE_INCOMPATIBLE');
    uuid(d.methodId); uuid(d.releaseId);
    if (d.documentRequired && !support.some(l => l.documentVersionId !== null)) fail('F13_DOCUMENT_REQUIRED');
    if (v.validUntil === null ? d.maxValiditySeconds !== null : !Number.isSafeInteger(d.maxValiditySeconds)
      || instant(v.validUntil) - instant(v.verifiedAt) > d.maxValiditySeconds * 1000) fail('F13_REFERENCE_INCOMPATIBLE');
    const expected = digest({ assertion: v.assertionVersionId, links: support.map(l => l.linkId).sort(), method: d.methodId });
    if (v.materialDigest !== expected) fail();
    return { ...v, effectiveStatusAtSubmission: verificationState(v, observedAt, v.revocation) };
  });
  const sorted = (rows, key) => [...rows].sort((a, b) => order(a[key], b[key]));
  const content = boundedClone({ kind: 'F13_PQ1_PUBLICATION_V1', schema: SCHEMA, extractorVersion: EXTRACTOR,
    scopeType: 'ORGANIZATION', coverage: COVERAGE, observedAt, items: base.content.items,
    assertions: sorted(assertions, 'versionId'), experiences: sorted(experiences, 'versionId'),
    links: sorted(links, 'linkId'), verifications: sorted(verificationRows, 'verificationId') });
  return { content, editorialDigest: digest(content) };
}
function complete(content, policyRef) {
  if (content.kind !== 'F13_PQ1_PUBLICATION_V1' || canonicalize(content.schema) !== canonicalize(SCHEMA)
    || canonicalize(content.coverage) !== canonicalize(COVERAGE) || policyRef.version !== POLICY) fail('F13_POLICY_UNAVAILABLE');
  const base = { kind: 'F13_EDITORIAL_CONTENT_V1', schema: thematic.SCHEMA,
    extractorVersion: thematic.EXTRACTOR, scopeType: 'ORGANIZATION', coverage: thematic.COVERAGE, items: content.items };
  const findings = [...thematic.complete(base, thematicRelease.policyRef).record.findings];
  const add = (code, itemId = null, severity = 'ERROR') => findings.push({ slot: 'competencies', code, itemId, severity });
  if (!content.assertions.length) add('REQUIRED_SLOT_MISSING');
  const unknown = content.assertions.filter(a => a.knowledgeStatus === 'UNKNOWN');
  if (unknown.length) {
    if (content.assertions.length !== 1) add('INVALID_CARDINALITY');
    else add('UNKNOWN_EXPLICIT', unknown[0].assertionId, 'INFO');
  }
  const concepts = new Set();
  for (const a of content.assertions) if (a.conceptRef) {
    const key = canonicalize(a.conceptRef);
    if (concepts.has(key)) add('DUPLICATE_CONCEPT', a.assertionId);
    concepts.add(key);
  }
  for (const v of content.verifications) if (v.effectiveStatusAtSubmission !== 'VERIFIED')
    add(`VERIFICATION_${v.effectiveStatusAtSubmission}`, v.assertionVersionId, 'INFO');
  findings.sort((a, b) => order(a.slot, b.slot) || order(a.itemId || '', b.itemId || '') || order(a.code, b.code));
  const record = canonicalClone({ schema: SCHEMA, policyRef, editorialDigest: digest(content),
    result: findings.some(f => f.severity === 'ERROR') ? 'INCOMPLETE' : 'COMPLETE', findings });
  return { record, completionDigest: digest(record) };
}
function createAuthorAccumulator(submitterSubjectId, content) {
  const thematicAuthors = thematic.createAuthorAccumulator(submitterSubjectId);
  const contributions = [];
  let previousMaterial = [];
  function accept(revision) {
    thematicAuthors.accept(revision);
    const current = (revision.competencyMaterial || []).filter(row => row.kind !== 'VERIFICATION');
    if (revision.operation === 'COMPETENCY' && canonicalize(current) !== canonicalize(previousMaterial))
      contributions.push({ subjectId: revision.actorSubjectId, evidence: { revision: revision.revision } });
    previousMaterial = current;
  }
  function finish() {
    const authors = new Map(thematicAuthors.finish().map(a => [a.subjectId, { ...a,reasons:[...a.reasons],evidenceRefs:[...a.evidenceRefs] }]));
    const add = (subjectId, evidence) => {
      uuid(subjectId);
      const row = authors.get(subjectId) || { subjectId, reasons: [], evidenceRefs: [] };
      if (!row.reasons.includes('MATERIAL')) row.reasons.push('MATERIAL');
      row.evidenceRefs.push(evidence); authors.set(subjectId, row);
    };
    for (const row of contributions) add(row.subjectId, row.evidence);
    for (const row of [...content.assertions, ...content.experiences, ...content.links])
      add(row.actorSubjectId, { versionId: row.versionId || row.linkId });
    return [...authors.values()].sort((a, b) => order(a.subjectId, b.subjectId)).map(a => ({ ...a,
      reasons: a.reasons.sort(), evidenceRefs: a.evidenceRefs.sort((x, y) => order(canonicalize(x), canonicalize(y))) }));
  }
  return { accept, finish };
}
function deriveAuthors(history, submitterSubjectId, content) {
  if (!Array.isArray(history)) fail('F13_AUTHORSHIP_EVIDENCE_UNAVAILABLE');
  const accumulator = createAuthorAccumulator(submitterSubjectId, content);
  for (const revision of history) accumulator.accept(revision);
  return accumulator.finish();
}
function candidateDigest(identity) {
  if (canonicalize(identity.schemaRef) !== canonicalize(SCHEMA) || identity.extractorVersion !== EXTRACTOR) fail();
  return digest({ kind: 'F13_PQ1_CANDIDATE_V1', ...identity });
}
module.exports = { SCHEMA, EXTRACTOR, POLICY, COVERAGE, digest, extract, complete, deriveAuthors, createAuthorAccumulator, candidateDigest, verificationState };
