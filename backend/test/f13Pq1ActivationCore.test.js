'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, verify, sync, id, at } = require('./fixtures/pq1Activation');
const publication = require('../src/organizationalProfile/pq1Material');
const { tuple, bounded, limits } = require('../src/prequalification/release');
const { materialize } = require('../src/prequalification/materializer');
const { evaluate, freshness } = require('../src/prequalification/evaluator');
const { observeVerifications } = require('../src/prequalification/admissibility');
const later = '2026-10-16T13:00:00.000Z';
test('read envelope has its own approved bound, without changing material canonicalization', () => {
  const {boundedEnvelope}=require('../src/prequalification/release');
  const value={material:'x'.repeat(262130),observation:'current'};
  assert.throws(()=>bounded(value),{code:'LIMIT_EXCEEDED'});
  assert(Buffer.byteLength(boundedEnvelope(value))>262144);
  assert.equal(boundedEnvelope({a:1}),bounded({a:1}));
  assert.throws(()=>boundedEnvelope({a:'x'.repeat(1048576)}),{code:'LIMIT_EXCEEDED'});
  assert.throws(()=>boundedEnvelope({a:Infinity}),{code:'INTEGRITY_UNAVAILABLE'});
});
test('snapshot wrapper counts toward the exact canonical bound and excess is a controlled refusal', () => {
  const f = fixture();
  f.experiences[0].provenance.note = '';
  const build = () => {
    const {content, editorialDigest} = publication.extract(f);
    return materialize({organizationId: id(1), source: f.source, content, contentDigest: editorialDigest,
      publicationId: id(80), versionId: id(81), materializedAt: at, admittedTuple: tuple});
  };
  const initial = build();
  const bytes = Buffer.byteLength(require('../src/organizationalProfile/canonicalization').canonicalize(initial.snapshot));
  f.experiences[0].provenance.note = 'x'.repeat(262144 - bytes);
  assert.equal(Buffer.byteLength(bounded(build().snapshot)), 262144);
  f.experiences[0].provenance.note += 'x';
  assert.throws(build, {code: 'LIMIT_EXCEEDED'});
  f.experiences[0].provenance.note += 'x'.repeat(4096);
  assert.throws(build, {code: 'F13_LIMIT_EXCEEDED'});
});
function prepared(f = verify(fixture()), evaluatedAt = at, revocation = null) {
  const { content, editorialDigest } = publication.extract(f);
  const built = materialize({ organizationId: id(1), source: f.source, content, contentDigest: editorialDigest,
    publicationId: id(80), versionId: id(81), materializedAt: at, admittedTuple: tuple });
  const observation = { organizationId: id(1), observedAt: evaluatedAt, verifications: content.verifications.map(v => ({
    verificationId: v.verificationId, assertionVersionId: v.assertionVersionId, validUntil: v.validUntil,
    status: publication.verificationState(v, evaluatedAt, revocation), revocation })) };
  const sourceId = id(90), criteria = { sources: [{ sourceId, label: 'Fixture', sourceKind: 'SYNTHETIC', reference: 'fixture:criteria', versionLabel: 'v1', capturedText: 'Evidence' }],
    criteria: [{ criterionId: id(91), kind: 'COMPETENCY_REQUIREMENT', interpretationText: 'Competência exata',
      conceptRef: { conceptId: id(42), schemeId: id(43), releaseId: id(44) }, temporalBasis: 'EVALUATION_INSTANT',
      evidence: { sourceId, locator: '1', excerpt: 'Evidence', justification: 'Fixture' } }] };
  return { organizationId: id(1), ...built, observation, criteria,
    identity: { opportunityId: id(92), opportunityRevisionId: id(93), criteriaRevisionId: id(94), snapshotId: id(95), activationId: id(96), generation: 1 } };
}
test('exact frozen source produces deterministic READY without changing inactive publication', () => {
  const f = verify(fixture()), before = JSON.stringify(f), a = prepared(f), b = prepared(f);
  assert.equal(a.snapshotDigest, b.snapshotDigest); assert.equal(a.snapshot.state, 'READY');
  assert.equal(a.snapshot.material.coverage.f14Consumable, false); assert.equal(JSON.stringify(f), before);
});
test('materializer rejects foreign organization, wrong source revision, digest and tuple', () => {
  const f = verify(fixture()), out = publication.extract(f);
  const args = { organizationId: id(1), source: f.source, content: out.content, contentDigest: out.editorialDigest,
    publicationId: id(80), versionId: id(81), materializedAt: at, admittedTuple: tuple };
  for (const delta of [{ organizationId: id(999) }, { contentDigest: 'a'.repeat(64) },
    { admittedTuple: { ...tuple, rules: 'future' } }, { source: { ...f.source, digest: 'a'.repeat(64) } }])
    assert.throws(() => materialize({ ...args, ...delta }));
});
test('declared unverified is READY and UNKNOWN, never negative proof', () => {
  const input = prepared(fixture()); const out = evaluate(input);
  assert.equal(out.result.lines[0].reason, 'NO_VERIFICATION'); assert.equal(out.result.lines[0].result, 'UNKNOWN');
  assert.equal(out.result.globalResult, 'INDETERMINATE'); assert.equal(out.evidenceDeadline, null);
});
test('A1 expired and revoked history remains READY; current use gives UNKNOWN', () => {
  for (const revoked of [false, true]) {
    const f = verify(fixture()); f.observedAt = later;
    if (revoked) f.verifications[0].revocation = { eventId: id(99), verificationId: id(70), status: 'REVOKED', recordedAt: at };
    const content = publication.extract(f).content;
    const snapshot = materialize({ organizationId: id(1), source: f.source, content, contentDigest: publication.digest(content),
      publicationId: id(80), versionId: id(81), materializedAt: later, admittedTuple: tuple });
    assert.equal(snapshot.snapshot.state, 'READY');
    const input = prepared(verify(fixture()), later, revoked ? f.verifications[0].revocation : null);
    const out = evaluate(input); assert.equal(out.result.lines[0].result, 'UNKNOWN');
    assert.equal(out.result.lines[0].reason, revoked ? 'VERIFICATION_REVOKED' : 'VERIFICATION_EXPIRED');
    assert.equal(input.snapshot.material.verifications[0].effectiveStatusAtSubmission, 'VERIFIED');
  }
});
test('validity is half-open and SATISFIED pins a strict evidence deadline', () => {
  const input = prepared(); const out = evaluate(input);
  assert.equal(out.result.lines[0].result, 'SATISFIED'); assert.equal(out.evidenceDeadline, Date.parse(later));
  assert.equal(evaluate(prepared(verify(fixture()), later)).result.lines[0].result, 'UNKNOWN');
});
test('null expiry only accepted when the exact method allows it', () => {
  const f = verify(fixture()); f.verifications[0].validUntil = null;
  assert.throws(() => prepared(f)); f.verifications[0].method.maxValiditySeconds = null;
  assert.equal(evaluate(prepared(f)).evidenceDeadline, null);
});
test('no matching competency and explicit unknown have distinct explanations', () => {
  const input = prepared(); input.criteria.criteria[0].conceptRef.conceptId = id(999);
  assert.equal(evaluate(input).result.lines[0].reason, 'COMPETENCY_NOT_DECLARED');
  const f = fixture(); f.assertions[0].knowledgeStatus = 'UNKNOWN'; f.assertions[0].conceptRef = null;
  f.experiences = []; f.links = []; sync(f);
  assert.equal(evaluate(prepared(f)).result.lines[0].reason, 'COMPETENCY_KNOWLEDGE_UNKNOWN');
});
test('affinity is exact concept/scheme/release matching, never eligibility', () => {
  const input = prepared(); const base = input.criteria.criteria[0];
  input.criteria.criteria = [{ ...base, kind: 'THEMATIC_AFFINITY', temporalBasis: null,
    conceptRef: { conceptId: id(30), schemeId: id(31), releaseId: id(32) } }];
  assert.equal(evaluate(input).result.lines[0].result, 'AFFINITY_OBSERVED');
  input.criteria.criteria[0].conceptRef.releaseId = id(999);
  assert.equal(evaluate(input).result.lines[0].result, 'AFFINITY_NOT_OBSERVED');
  input.criteria.criteria[0].kind = 'STRATEGIC_PRIORITY_AFFINITY';
  assert.equal(evaluate(input).result.lines[0].result, 'UNKNOWN');
});
test('forged, missing or foreign observations refuse instead of becoming UNKNOWN', () => {
  for (const change of [o => { o.organizationId = id(999); }, o => { o.verifications = []; },
    o => { o.verifications[0].status = 'EXPIRED'; }, o => { o.observedAt = later; }]) {
    const input = prepared(); change(input.observation); assert.throws(() => evaluate(input));
  }
});
test('historical SATISFIED is immutable and loses current usability on expiry/revocation', () => {
  const input = prepared(), out = evaluate(input), before = JSON.stringify(out.result);
  assert.equal(freshness({ result: out.result, currentIdentity: input.identity, observation: input.observation, referencesAvailable: true }), 'CURRENT');
  const expired = prepared(verify(fixture()), later);
  assert.equal(freshness({ result: out.result, currentIdentity: { ...input.identity, generation: 2 }, observation: expired.observation, referencesAvailable: true }), 'UNAVAILABLE');
  assert.equal(JSON.stringify(out.result), before);
  const freshUnknown = evaluate(expired);
  assert.equal(freshness({ result: freshUnknown.result, currentIdentity: input.identity, observation: expired.observation, referencesAvailable: true }), 'CURRENT');
});
test('new activation generation and missing references preserve freshness precedence', () => {
  const input = prepared(), { result } = evaluate(input);
  const args = { result, currentIdentity: { ...input.identity, generation: 2 }, observation: input.observation };
  assert.equal(freshness({ ...args, referencesAvailable: true }), 'REVIEW_REQUIRED');
  assert.equal(freshness({ ...args, referencesAvailable: false }), 'UNAVAILABLE');
});
test('joint thematic cardinality is 100 total, not 100 per domain', () => {
  const f = fixture(); f.source.items = Array.from({ length: 101 }, (_, n) => ({ ...f.source.items[0],
    itemId: id(1000 + n), itemVersionId: id(2000 + n), domain: n < 51 ? 'THEMATIC_AREA' : 'STRATEGIC_PRIORITY' })); sync(f);
  const { content, editorialDigest } = publication.extract(f);
  assert.throws(() => materialize({ organizationId: id(1), source: f.source, content, contentDigest: editorialDigest,
    publicationId: id(80), versionId: id(81), materializedAt: at, admittedTuple: tuple }), { code: 'LIMIT_EXCEEDED' });
});
test('byte ceiling rejects instead of silently truncating', () => {
  bounded({ value: 'a'.repeat(limits.maxCanonicalBytes - 12) });
  assert.throws(() => bounded({ value: 'a'.repeat(limits.maxBytes) }), { code: 'LIMIT_EXCEEDED' });
});
test('authoritative reader takes existing lock before grouped ledger read and compares immutable support', async () => {
  const f = verify(fixture()), v = f.verifications[0], queries = [];
  const row = { organization_id: id(1), verification_id: id(70), assertion_version_id: id(41), method_id: id(71),
    material_digest: v.materialDigest, status: 'VERIFIED', actor_subject_id: id(3), verified_at: new Date(at), valid_until: new Date(later),
    event_id: id(99), sequence: '1', revocation_status: 'REVOKED', revoked_at: new Date(at) };
  const client = { async query(sql) { queries.push(sql); return { rows: sql.startsWith('SHOW') ? [{ transaction_isolation: 'read committed' }] : sql.includes('LEFT JOIN') ? [row] : [{ transaction_id: '1' }] }; } };
  const observation = await observeVerifications(client, id(1), publication.extract(f).content, () => new Date(at));
  assert.match(queries[0], /F13-P1:/); assert.equal(queries.filter(s => s.includes('LEFT JOIN')).length, 1);
  assert.equal(observation.verifications[0].status, 'REVOKED');
  row.material_digest = 'f'.repeat(64);
  await assert.rejects(observeVerifications(client, id(1), publication.extract(f).content, () => new Date(at)), { code: 'INTEGRITY_UNAVAILABLE' });
});

test('publication reader pins the published revision without reconstructing current draft heads', async () => {
  const { readPublication } = require('../src/prequalification/publicationReader');
  const release = require('../src/organizationalProfile/pq1Release');
  const f = verify(fixture()), { content, editorialDigest } = publication.extract(f);
  const completion = publication.complete(content, release.policyRef);
  const identity = { organizationId:id(1),profileScopeId:id(200),source:{draftId:f.source.draftId,revision:1,
    digest:f.source.digest,producerContract:f.source.producerContract},editorialDigest,
    schemaRef:publication.SCHEMA,policyRef:release.policyRef,bundleRef:release.bundleRef,manifestRef:release.manifestRef,
    extractorVersion:publication.EXTRACTOR,submitterSubjectId:id(2),authors:[{subjectId:id(2)}],completionDigest:completion.completionDigest };
  const candidate = { identity_record:identity,candidate_id:id(82),candidate_digest:publication.candidateDigest(identity),
    version_digest:publication.candidateDigest(identity),profile_scope_id:id(200),pq1_digest:editorialDigest,
    completion_digest:completion.completionDigest,completion_record:completion.record,source_digest:f.source.digest,
    draft_id:f.source.draftId,source_revision:'1',submitter_subject_id:id(2),pq1_content:content,
    publication_id:id(80),version_id:id(81),approval_evidence:{},approver_subject_id:id(3),approver_membership_id:id(83) };
  const queries = [];
  const client = { async query(sql, values) {
    queries.push({sql,values});
    if (sql.includes('FROM organization_profile.pq1_version')) return {rows:[candidate]};
    if (sql.includes('FROM organization_profile.pq1_release')) return {rows:[{definition:release.definition,definition_digest:release.bundleRef.digest}]};
    if (sql.includes('pq1_candidate_author')) return {rows:[{subject_id:id(2)}]};
    if (sql.includes('FROM organization_profile.profile_draft_revision')) return {rows:[{semantic_digest:f.source.digest,scope_type:'ORGANIZATION',scope_id:null}]};
    if (sql.includes('FROM organization_profile.profile_revision_item')) return {rows:f.source.items};
    if (sql.includes('FROM organization_profile.competency_revision_member')) return {rows:f.source.competencyMaterial};
    throw Error('Unexpected SQL');
  } };
  const out = await readPublication(client,id(1),id(81));
  assert.equal(out.contentDigest,editorialDigest); assert.equal(out.source.revision,1);
  assert.equal(queries.some(q=>q.sql.includes('head_revision')),false);
  assert.equal(queries.filter(q=>q.sql.includes('revision=$3')).every(q=>Number(q.values[2])===1),true);
  candidate.version_digest='f'.repeat(64);
  await assert.rejects(readPublication(client,id(1),id(81)),{code:'INTEGRITY_UNAVAILABLE'});
});
