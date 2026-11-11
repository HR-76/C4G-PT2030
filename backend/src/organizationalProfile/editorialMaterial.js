'use strict';

const { createHash } = require('node:crypto');
const { canonicalClone, canonicalize } = require('./canonicalization');
const { intentDigest } = require('../security/tenantRepositorySupport');
const { OrganizationalProfileContractError } = require('./errors');

const SCHEMA = Object.freeze({ id: 'F13_ORG_EDITORIAL_BASELINE', version: '1.0.0' });
const EXTRACTOR = 'F13_THEMATIC_CUT_V1';
const POLICY = 'F13_EDITORIAL_THEME_REQUIRED_V1';
const COVERAGE = canonicalClone({
  includedDomains: ['STRATEGIC_PRIORITY', 'THEMATIC_AREA'],
  excludedDomains: ['COMPETENCY', 'CONSTRAINT', 'EXPERIENCE', 'FINANCIAL', 'OPERATIONAL',
    'SERVED_POPULATION', 'TARGET_GROUP', 'TERRITORY'],
  scopeType: 'ORGANIZATION', constraintsAssessed: false, effectiveSnapshot: false, f14Consumable: false
});
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const ordinal = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function fail(code = 'F13_INVALID_INPUT') { throw new OrganizationalProfileContractError(code); }
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) fail(); }
function hash(value) { if (typeof value !== 'string' || !HASH.test(value)) fail(); }
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail();
}
function digest(value) { return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex'); }
function sourceDigestItem(item) {
  return { itemId: item.itemId, itemVersionId: item.itemVersionId, domain: item.domain,
    knowledgeStatus: item.knowledgeStatus, conceptId: item.conceptId };
}

// Input is repository-loaded material, never an HTTP payload. Historical source
// order and hash algorithm belong to the producer, not to the new extractor.
function verifySource(raw) {
  const source = canonicalClone(raw);
  if (source.scopeType !== 'ORGANIZATION' || source.scopeId !== null
      || !Number.isSafeInteger(source.revision) || source.revision < 1 || !Array.isArray(source.items)) fail();
  uuid(source.draftId); hash(source.digest);
  const material = { scopeType: source.scopeType, scopeId: source.scopeId, items: source.items.map(sourceDigestItem) };
  if (source.producerContract === 'F13_AUTHORING_WITH_COMPETENCIES_V1') {
    if (!Array.isArray(source.competencyMaterial)) fail('F13_SOURCE_INTEGRITY_UNAVAILABLE');
    material.competencyMaterial = source.competencyMaterial;
  } else if (source.producerContract !== 'F13_AUTHORING_V1' || source.competencyMaterial !== null) {
    fail('F13_SOURCE_INTEGRITY_UNAVAILABLE');
  }
  if (intentDigest(material) !== source.digest) fail('F13_SOURCE_INTEGRITY_UNAVAILABLE');
  return source;
}

function extract(rawSource, organizationId, rawReferences) {
  uuid(organizationId);
  const source = verifySource(rawSource);
  const references = canonicalClone(rawReferences);
  if (!Array.isArray(references)) fail();
  const byConcept = new Map();
  for (const reference of references) {
    exact(reference, ['conceptId', 'schemeId', 'releaseId', 'releaseVersion', 'releaseDigest', 'ownerOrganizationId']);
    for (const key of ['conceptId', 'schemeId', 'releaseId']) uuid(reference[key]);
    hash(reference.releaseDigest);
    if (typeof reference.releaseVersion !== 'string' || !reference.releaseVersion
        || (reference.ownerOrganizationId !== null && reference.ownerOrganizationId !== organizationId)
        || byConcept.has(reference.conceptId)) fail('F13_REFERENCE_INCOMPATIBLE');
    byConcept.set(reference.conceptId, reference);
  }
  const identities = new Set(), versions = new Set();
  const items = source.items.map(item => {
    uuid(item.itemId); uuid(item.itemVersionId);
    if (!COVERAGE.includedDomains.includes(item.domain) || identities.has(item.itemId)
        || versions.has(item.itemVersionId)) fail('F13_SOURCE_INTEGRITY_UNAVAILABLE');
    identities.add(item.itemId); versions.add(item.itemVersionId);
    // These are the exact states representable by migration 008. Never fill
    // absent metadata or downgrade a future state to fit this schema.
    if (!['KNOWN', 'UNKNOWN'].includes(item.knowledgeStatus) || item.verificationStatus !== 'UNVERIFIED'
        || item.conflictStatus !== 'CLEAR' || item.confidentialityClass !== 'INTERNAL') fail('F13_REFERENCE_INCOMPATIBLE');
    const conceptRef = item.knowledgeStatus === 'KNOWN' ? byConcept.get(item.conceptId) : null;
    if ((item.knowledgeStatus === 'KNOWN' && !conceptRef)
        || (item.knowledgeStatus === 'UNKNOWN' && item.conceptId !== null)) fail('F13_REFERENCE_INCOMPATIBLE');
    return { itemId: item.itemId, itemVersionId: item.itemVersionId, domain: item.domain,
      knowledgeStatus: item.knowledgeStatus, verificationStatus: item.verificationStatus,
      conflictStatus: item.conflictStatus, confidentialityClass: item.confidentialityClass, conceptRef };
  }).sort((a, b) => ordinal(a.domain, b.domain) || ordinal(a.itemId, b.itemId) || ordinal(a.itemVersionId, b.itemVersionId));
  const content = canonicalClone({ kind: 'F13_EDITORIAL_CONTENT_V1', schema: SCHEMA,
    extractorVersion: EXTRACTOR, scopeType: 'ORGANIZATION', coverage: COVERAGE, items });
  return Object.freeze({ content, editorialDigest: digest(content) });
}

function complete(content, policyRef) {
  // Selection/authorization of the persisted policy belongs to the repository.
  // This evaluator implements one closed policy, not caller-supplied rules.
  exact(policyRef, ['id', 'version', 'digest']); uuid(policyRef.id); hash(policyRef.digest);
  if (policyRef.version !== POLICY || content.kind !== 'F13_EDITORIAL_CONTENT_V1'
      || canonicalize(content.schema) !== canonicalize(SCHEMA)
      || canonicalize(content.coverage) !== canonicalize(COVERAGE)) fail('F13_POLICY_UNAVAILABLE');
  const findings = [];
  const add = (slot, code, itemId = null, severity = 'ERROR') => findings.push({ slot, itemId, code, severity });
  if (content.items.length > 100) add('items', 'INVALID_CARDINALITY');
  for (const [domain, slot] of [['THEMATIC_AREA', 'thematicAreas'], ['STRATEGIC_PRIORITY', 'strategicPriorities']]) {
    const items = content.items.filter(item => item.domain === domain);
    if (!items.length) { add(slot, 'REQUIRED_SLOT_MISSING'); continue; }
    const unknown = items.filter(item => item.knowledgeStatus === 'UNKNOWN');
    if (domain === 'THEMATIC_AREA') unknown.forEach(item => add(slot, 'KNOWN_REQUIRED', item.itemId));
    else if (unknown.length) {
      if (items.length !== 1) add(slot, 'INVALID_CARDINALITY');
      else add(slot, 'UNKNOWN_EXPLICIT', unknown[0].itemId, 'INFO');
    }
    const concepts = new Set();
    for (const item of items) if (item.conceptRef) {
      const key = `${item.conceptRef.conceptId}:${item.conceptRef.releaseId}`;
      if (concepts.has(key)) add(slot, 'DUPLICATE_CONCEPT', item.itemId);
      concepts.add(key);
    }
  }
  findings.sort((a, b) => ordinal(a.slot, b.slot) || ordinal(a.itemId || '', b.itemId || '') || ordinal(a.code, b.code));
  const record = canonicalClone({ schema: SCHEMA, policyRef, editorialDigest: digest(content),
    references: content.items.filter(item => item.conceptRef).map(item => item.conceptRef),
    result: findings.some(finding => finding.severity === 'ERROR') ? 'INCOMPLETE' : 'COMPLETE', findings });
  return Object.freeze({ record, completionDigest: digest(record) });
}

function createAuthorAccumulator(submitterSubjectId) {
  uuid(submitterSubjectId);
  const authors = new Map();
  const add = (subjectId, reason, evidence) => {
    uuid(subjectId);
    if (!authors.has(subjectId)) authors.set(subjectId, { subjectId, reasons: new Set(), evidenceRefs: new Map() });
    const row = authors.get(subjectId); row.reasons.add(reason); row.evidenceRefs.set(canonicalize(evidence), evidence);
  };
  let previous = new Map(), index = 0, draftId, last;
  function accept(rawRevision) {
    const revision = verifySource(rawRevision);
    if (index === 0) draftId = revision.draftId;
    if (revision.revision !== index + 1 || revision.draftId !== draftId
        || !['CREATE', 'EDIT', 'SUBMIT', 'COMPETENCY'].includes(revision.operation)) fail('F13_AUTHORSHIP_EVIDENCE_UNAVAILABLE');
    uuid(revision.actorSubjectId);
    const current = new Map(revision.items.map(item => [item.itemId, item.itemVersionId]));
    if (current.size !== revision.items.length) fail('F13_AUTHORSHIP_EVIDENCE_UNAVAILABLE');
    const changed = [...new Set([...previous.keys(), ...current.keys()])]
      .filter(id => previous.get(id) !== current.get(id)).sort(ordinal);
    if (changed.length && !['CREATE', 'EDIT'].includes(revision.operation)) fail('F13_AUTHORSHIP_EVIDENCE_UNAVAILABLE');
    if (changed.length) add(revision.actorSubjectId, 'SELECTION', { beforeRevision: index, afterRevision: index + 1,
      changes: changed.map(itemId => ({ itemId, beforeVersion: previous.get(itemId) || null, afterVersion: current.get(itemId) || null })) });
    previous = current;
    last = revision;
    index++;
  }
  function finish() {
    if (!last) fail('F13_AUTHORSHIP_EVIDENCE_UNAVAILABLE');
    if (last.operation !== 'SUBMIT' || last.actorSubjectId !== submitterSubjectId) fail('F13_AUTHORSHIP_EVIDENCE_UNAVAILABLE');
    for (const item of last.items) add(item.actorSubjectId, 'MATERIAL', { itemId: item.itemId, itemVersionId: item.itemVersionId });
    add(submitterSubjectId, 'SUBMITTER', { revision: last.revision });
    return canonicalClone([...authors.values()].sort((a, b) => ordinal(a.subjectId, b.subjectId)).map(row => ({
      subjectId: row.subjectId, reasons: [...row.reasons].sort(ordinal),
      evidenceRefs: [...row.evidenceRefs.entries()].sort(([a], [b]) => ordinal(a, b)).map(([, value]) => value)
    })));
  }
  return { accept, finish };
}

function deriveAuthors(history, submitterSubjectId) {
  if (!Array.isArray(history)) fail('F13_AUTHORSHIP_EVIDENCE_UNAVAILABLE');
  const accumulator = createAuthorAccumulator(submitterSubjectId);
  for (const revision of history) accumulator.accept(revision);
  return accumulator.finish();
}

function candidateDigest(raw) {
  const input = canonicalClone(raw);
  exact(input, ['organizationId', 'profileScopeId', 'source', 'editorialDigest', 'schemaRef', 'extractorVersion',
    'policyRef', 'bundleRef', 'manifestRef', 'submitterSubjectId', 'authors', 'completionDigest']);
  for (const key of ['organizationId', 'profileScopeId', 'submitterSubjectId']) uuid(input[key]);
  for (const key of ['editorialDigest', 'completionDigest']) hash(input[key]);
  if (canonicalize(input.schemaRef) !== canonicalize(SCHEMA) || input.extractorVersion !== EXTRACTOR) fail();
  exact(input.source, ['draftId', 'revision', 'digest', 'producerContract']);
  uuid(input.source.draftId); hash(input.source.digest);
  if (!Number.isSafeInteger(input.source.revision) || input.source.revision < 1
      || !['F13_AUTHORING_V1', 'F13_AUTHORING_WITH_COMPETENCIES_V1'].includes(input.source.producerContract)) fail();
  for (const key of ['policyRef', 'bundleRef', 'manifestRef']) {
    exact(input[key], ['id', 'version', 'digest']); uuid(input[key].id); hash(input[key].digest);
    if (typeof input[key].version !== 'string' || !input[key].version) fail();
  }
  if (!Array.isArray(input.authors) || !input.authors.length) fail();
  return digest({ kind: 'F13_EDITORIAL_CANDIDATE_V1', ...input });
}

module.exports = { SCHEMA, EXTRACTOR, POLICY, COVERAGE, digest, verifySource, extract, complete, deriveAuthors, createAuthorAccumulator, candidateDigest };
