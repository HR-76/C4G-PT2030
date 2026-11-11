'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { intentDigest } = require('../src/security/tenantRepositorySupport');
const m = require('../src/organizationalProfile/editorialMaterial');
const commands = require('../src/organizationalProfile/editorialContracts');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const organizationId = id(1), maker = id(2), checker = id(3), submitter = id(4);
const reference = { conceptId: id(10), schemeId: id(11), releaseId: id(12), releaseVersion: 'test-v1',
  releaseDigest: 'a'.repeat(64), ownerOrganizationId: organizationId };
const policy = { id: id(20), version: m.POLICY, digest: 'b'.repeat(64) };
function item(n, domain = 'THEMATIC_AREA', known = true) {
  return { itemId: id(n), itemVersionId: id(n + 100), domain, knowledgeStatus: known ? 'KNOWN' : 'UNKNOWN',
    conceptId: known ? reference.conceptId : null, verificationStatus: 'UNVERIFIED', conflictStatus: 'CLEAR',
    confidentialityClass: 'INTERNAL', actorSubjectId: maker };
}
const items = () => [item(30), item(31, 'STRATEGIC_PRIORITY', false)];
function source(overrides = {}) {
  const s = { draftId: id(40), revision: 1, scopeType: 'ORGANIZATION', scopeId: null,
    producerContract: 'F13_AUTHORING_WITH_COMPETENCIES_V1', competencyMaterial: [], items: items(),
    actorSubjectId: maker, operation: 'CREATE', ...overrides };
  s.digest = intentDigest({ scopeType: s.scopeType, scopeId: s.scopeId,
    items: s.items.map(({ itemId, itemVersionId, domain, knowledgeStatus, conceptId }) =>
      ({ itemId, itemVersionId, domain, knowledgeStatus, conceptId })), competencyMaterial: s.competencyMaterial });
  return s;
}
const extract = s => m.extract(s, organizationId, [reference]);
const completion = s => m.complete(extract(s).content, policy).record;

test('fixed thematic cut preserves mixed source, states and explicit limited coverage', () => {
  const s = source({ competencyMaterial: [{ kind: 'ASSERTION', version_id: id(80) }] });
  const before = JSON.stringify(s), result = extract(s);
  assert.equal(JSON.stringify(s), before);
  assert.equal(result.content.items.length, 2);
  assert.equal(result.content.coverage.constraintsAssessed, false);
  assert.equal(result.content.coverage.f14Consumable, false);
  assert.equal(result.content.items[0].verificationStatus, 'UNVERIFIED');
  assert.ok(Object.isFrozen(result.content.items));
});
test('excluded material changes source identity but not editorial digest', () => {
  const a = source(), b = source({ competencyMaterial: [{ kind: 'VERIFICATION', version_id: id(81) }] });
  assert.notEqual(a.digest, b.digest);
  assert.equal(extract(a).editorialDigest, extract(b).editorialDigest);
});
test('canonical editorial order is independent of source ordering', () => {
  assert.equal(extract(source()).editorialDigest, extract(source({ items: items().reverse() })).editorialDigest);
});
test('unknown priority is explicit and allowed, unknown theme is incomplete', () => {
  assert.equal(completion(source()).result, 'COMPLETE');
  const r = completion(source({ items: [item(30, 'THEMATIC_AREA', false), item(31, 'STRATEGIC_PRIORITY', false)] }));
  assert.equal(r.result, 'INCOMPLETE'); assert.ok(r.findings.some(f => f.code === 'KNOWN_REQUIRED'));
});
test('absence and empty slots never infer UNKNOWN', () => {
  const result = completion(source({ items: [] }));
  assert.equal(result.result, 'INCOMPLETE'); assert.equal(result.findings.length, 2);
  assert.ok(result.findings.every(f => f.code === 'REQUIRED_SLOT_MISSING'));
});
test('mixed priority UNKNOWN and KNOWN and duplicate concepts are incomplete', () => {
  assert.equal(completion(source({ items: [...items(), item(32, 'STRATEGIC_PRIORITY')] })).result, 'INCOMPLETE');
  assert.ok(completion(source({ items: [...items(), item(32)] })).findings.some(f => f.code === 'DUPLICATE_CONCEPT'));
});
test('100-item combined bound is enforced', () => {
  assert.ok(completion(source({ items: Array.from({ length: 101 }, (_, n) => item(1000 + n)) }))
    .findings.some(f => f.slot === 'items' && f.code === 'INVALID_CARDINALITY'));
});
test('foreign references, missing metadata and unsupported states fail closed', () => {
  assert.throws(() => m.extract(source(), id(999), [reference]), { code: 'F13_REFERENCE_INCOMPATIBLE' });
  for (const override of [{ verificationStatus: undefined }, { confidentialityClass: 'RESTRICTED' }, { knowledgeStatus: 'NONE' }]) {
    assert.throws(() => extract(source({ items: [{ ...item(30), ...override }] })));
  }
});
test('source tampering and unknown producer fail closed', () => {
  assert.throws(() => extract({ ...source(), digest: '0'.repeat(64) }), { code: 'F13_SOURCE_INTEGRITY_UNAVAILABLE' });
  assert.throws(() => extract(source({ producerContract: 'GUESS' })), { code: 'F13_SOURCE_INTEGRITY_UNAVAILABLE' });
});
test('authors include selection lineage and submitter but not competency-only editor', () => {
  const history = [source(), source({ revision: 2, operation: 'COMPETENCY', actorSubjectId: checker,
    competencyMaterial: [{ kind: 'ASSERTION', version_id: id(90) }] }),
  source({ revision: 3, operation: 'SUBMIT', actorSubjectId: submitter,
    competencyMaterial: [{ kind: 'ASSERTION', version_id: id(90) }] })];
  const authors = m.deriveAuthors(history, submitter);
  assert.deepEqual(authors.map(a => a.subjectId), [maker, submitter]);
  assert.deepEqual(authors.find(a => a.subjectId === maker).reasons, ['MATERIAL', 'SELECTION']);
  assert.deepEqual(authors.find(a => a.subjectId === submitter).reasons, ['SUBMITTER']);
});
test('missing history, falsified operation and wrong submitter fail closed', () => {
  assert.throws(() => m.deriveAuthors([source({ revision: 2 })], submitter));
  assert.throws(() => m.deriveAuthors([source({ operation: 'COMPETENCY' })], submitter));
  assert.throws(() => m.deriveAuthors([source(), source({ revision: 2, operation: 'SUBMIT', actorSubjectId: maker })], submitter));
});

test('authorship streams a large lineage without changing canonical material limits or authors', () => {
  const members = Array.from({length: 100}, (_, n) => ({kind: 'ASSERTION', version_id: id(2000 + n)}));
  const history = [source(), ...Array.from({length: 100}, (_, n) => source({revision: n + 2,
    operation: 'COMPETENCY', actorSubjectId: checker, competencyMaterial: members})),
  source({revision: 102, operation: 'SUBMIT', actorSubjectId: submitter, competencyMaterial: members})];
  assert(Buffer.byteLength(JSON.stringify(history)) > 262144);
  assert.throws(() => require('../src/organizationalProfile/canonicalization').canonicalClone(history), /structural limit/);
  const accumulator = m.createAuthorAccumulator(submitter);
  for (const revision of history) accumulator.accept(revision);
  assert.deepEqual(accumulator.finish(), m.deriveAuthors(history, submitter));
  assert.deepEqual(accumulator.finish().map(a => a.subjectId), [maker, submitter]);
  const broken = structuredClone(history); broken[50].digest = '0'.repeat(64);
  assert.throws(() => m.deriveAuthors(broken, submitter), {code: 'F13_SOURCE_INTEGRITY_UNAVAILABLE'});
  assert.throws(() => m.deriveAuthors(history.filter((_, n) => n !== 50), submitter), {code: 'F13_AUTHORSHIP_EVIDENCE_UNAVAILABLE'});
});
test('candidate identity binds origin without changing editorial digest', () => {
  const s = source(), cut = extract(s), c = m.complete(cut.content, policy);
  const input = { organizationId, profileScopeId: id(50), source: { draftId: s.draftId, revision: 1,
    digest: s.digest, producerContract: s.producerContract }, editorialDigest: cut.editorialDigest,
  schemaRef: m.SCHEMA, extractorVersion: m.EXTRACTOR, policyRef: policy, bundleRef: policy, manifestRef: policy,
  submitterSubjectId: submitter, authors: [{ subjectId: maker, reasons: ['MATERIAL'], evidenceRefs: [] }], completionDigest: c.completionDigest };
  assert.notEqual(m.candidateDigest(input), m.candidateDigest({ ...input, source: { ...input.source, revision: 2 } }));
  assert.notEqual(m.candidateDigest(input), m.candidateDigest({ ...input, organizationId: id(51) }));
});

test('commands are closed and never accept caller-selected policy, tenant, authors or extraction', () => {
  const submit = { draftId: id(40), expectedRevision: 1, idempotencyKey: id(90) };
  assert.deepEqual(commands.submit(submit), submit);
  for (const key of ['organizationId', 'tenantId', 'policyRef', 'authors', 'items', 'schema']) {
    assert.throws(() => commands.submit({ ...submit, [key]: id(91) }), { code: 'F13_INVALID_INPUT' });
  }
  for (const expectedRevision of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => commands.submit({ ...submit, expectedRevision }));
  }
  assert.doesNotThrow(() => commands.approve({ candidateId: id(1), expectedCandidateDigest: 'a'.repeat(64), idempotencyKey: id(2) }));
  assert.doesNotThrow(() => commands.publish({ versionId: id(1), expectedVersionDigest: 'a'.repeat(64), idempotencyKey: id(2) }));
  assert.doesNotThrow(() => commands.readCandidate({ candidateId: id(1) }));
  assert.doesNotThrow(() => commands.readVersion({ versionId: id(1) }));
});

test('selection removal keeps its author; no-op editor is not made an author', () => {
  const extra = item(32, 'STRATEGIC_PRIORITY');
  const history = [source({ items: [...items(), extra] }),
    source({ revision: 2, operation: 'EDIT', actorSubjectId: checker }),
    source({ revision: 3, operation: 'EDIT', actorSubjectId: id(95) }),
    source({ revision: 4, operation: 'SUBMIT', actorSubjectId: submitter })];
  const authors = m.deriveAuthors(history, submitter);
  assert.deepEqual(authors.map(a => a.subjectId), [maker, checker, submitter]);
  assert.deepEqual(authors.find(a => a.subjectId === checker).reasons, ['SELECTION']);
});
