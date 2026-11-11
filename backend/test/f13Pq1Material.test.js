'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/organizationalProfile/pq1Material');
const { policyRef } = require('../src/organizationalProfile/pq1Release');
const { intentDigest } = require('../src/security/tenantRepositorySupport');
const thematic = require('../src/organizationalProfile/editorialMaterial');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-16T12:00:00.000Z';
test('oversized material collections are explicit limit refusals, not integrity outages', () => {
  for (const name of ['assertions','experiences','links','verifications']) {
    const f=fixture();f[name]=Array.from({length:101},()=>({}));
    assert.throws(()=>m.extract(f),{code:'F13_LIMIT_EXCEEDED'});
  }
});
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
const complete = f => m.complete(m.extract(f).content, policyRef).record;
test('PQ1 publication permits declared knowledge without verification and stays inactive/non-consumable', () => {
  const f = fixture(), before = JSON.stringify(f), result = m.extract(f);
  assert.equal(complete(f).result, 'COMPLETE'); assert.equal(JSON.stringify(f), before);
  assert.equal(result.content.coverage.f14Consumable, false); assert.equal(result.content.coverage.effectiveSnapshot, false);
  assert.equal(result.content.assertions[0].knowledgeStatus, 'KNOWN');
});
test('explicit UNKNOWN is complete; missing or mixed knowledge is not', () => {
  const f = fixture(); f.assertions[0] = { ...f.assertions[0], knowledgeStatus: 'UNKNOWN', conceptRef: null };
  f.links = []; f.experiences = []; sync(f); assert.equal(complete(f).result, 'COMPLETE');
  f.assertions.push({ ...fixture().assertions[0], assertionId: id(80), versionId: id(81) }); sync(f);
  assert.equal(complete(f).result, 'INCOMPLETE');
  f.assertions = []; sync(f); assert.equal(complete(f).result, 'INCOMPLETE');
});
test('real producer verification digest and half-open validity are preserved', () => {
  const f = verify(fixture()); assert.equal(complete(f).result, 'COMPLETE');
  assert.equal(m.extract(f).content.verifications[0].effectiveStatusAtSubmission, 'VERIFIED');
  f.observedAt = f.verifications[0].validUntil;
  const result = m.extract(f).content;
  assert.equal(result.verifications[0].effectiveStatusAtSubmission, 'EXPIRED');
  assert.equal(result.assertions[0].knowledgeStatus, 'KNOWN'); assert.equal(m.complete(result, policyRef).record.result, 'COMPLETE');
});
test('revocation preserves the original factual record without renewal or UNKNOWN', () => {
  const f = verify(fixture()); f.verifications[0].revocation = { eventId: id(90), verificationId: id(70), status: 'REVOKED', recordedAt: at };
  const c = m.extract(f).content; assert.equal(c.verifications[0].originalStatus, 'VERIFIED');
  assert.equal(c.verifications[0].effectiveStatusAtSubmission, 'REVOKED'); assert.equal(c.assertions[0].knowledgeStatus, 'KNOWN');
});
test('method descriptor controls documents and no-expiry, without universal document requirement', () => {
  const f = verify(fixture()); f.verifications[0].method.documentRequired = true;
  assert.throws(() => m.extract(f), { code: 'F13_DOCUMENT_REQUIRED' });
  f.links[0].documentVersionId = id(91); assert.equal(complete(f).result, 'COMPLETE');
  f.verifications[0].validUntil = null; assert.throws(() => m.extract(f));
  f.verifications[0].method.maxValiditySeconds = null; assert.equal(complete(f).result, 'COMPLETE');
});
test('foreign, orphan, unresolved provenance and changed verification material fail closed', () => {
  for (const change of [f => { f.assertions[0].organizationId = id(999); }, f => { f.links[0].experienceVersionId = id(998); },
    f => { f.experiences[0].provenance = null; }, f => { f.verifications[0].materialDigest = 'b'.repeat(64); }]) {
    const f = verify(fixture()); change(f); assert.throws(() => m.extract(f));
  }
});
test('mixed source changes do not change the closed thematic cut', () => {
  const a = fixture(), b = verify(fixture());
  const cut = f => thematic.extract(f.source, f.organizationId, f.thematicReferences).editorialDigest;
  assert.equal(cut(a), cut(b)); assert.notEqual(m.extract(a).editorialDigest, m.extract(b).editorialDigest);
});

test('PQ1 authorship includes material editors and excludes verification-only checker without mutating history', () => {
  const first=fixture(), verified=verify(fixture());
  const history=[first.source,{...verified.source,revision:2,operation:'COMPETENCY',actorSubjectId:id(3)},
    {...verified.source,revision:3,operation:'SUBMIT',actorSubjectId:id(2)}];
  const before=JSON.stringify(history), content=m.extract(verified).content;
  assert.deepEqual(m.deriveAuthors(history,id(2),content).map(a=>a.subjectId),[id(2)]);
  assert.equal(JSON.stringify(history),before);
  const editor={...first.source,revision:2,operation:'COMPETENCY',actorSubjectId:id(5),competencyMaterial:[]};
  editor.digest=intentDigest({scopeType:'ORGANIZATION',scopeId:null,items:editor.items.map(({itemId,itemVersionId,domain,knowledgeStatus,conceptId})=>({itemId,itemVersionId,domain,knowledgeStatus,conceptId})),competencyMaterial:[]});
  const edited=[first.source,editor,{...editor,revision:3,operation:'SUBMIT',actorSubjectId:id(2)}];
  assert.deepEqual(m.deriveAuthors(edited,id(2),{assertions:[],experiences:[],links:[]}).map(a=>a.subjectId),[id(2),id(5)]);
});
