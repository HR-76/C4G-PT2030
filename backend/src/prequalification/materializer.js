'use strict';
const { canonicalClone, canonicalize } = require('../organizationalProfile/canonicalization');
const published = require('../organizationalProfile/pq1Material');
const publication = require('../organizationalProfile/pq1Release');
const { tuple, limits, bounded, fail, assertTuple } = require('./release');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) fail(); }
function instant(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail();
  return Date.parse(value);
}
function collections(content) {
  for (const name of ['items', 'assertions', 'experiences', 'links', 'verifications']) {
    if (!Array.isArray(content[name]) || content[name].length > (name === 'items' ? limits.maxItems : limits.maxCollection)) fail('LIMIT_EXCEEDED');
  }
}
// Pure reconstruction from the EXACT immutable source revision. Callers must
// load that revision, never latest draft heads. Current status is NOT an input.
function validatePublication({ organizationId, source, content, contentDigest }) {
  uuid(organizationId); bounded(content); collections(content);
  if (published.digest(content) !== contentDigest) fail();
  const references = [...new Map(content.items.filter(i => i.conceptRef).map(i => [i.conceptRef.conceptId, i.conceptRef])).values()];
  const reconstructed = published.extract({ organizationId, source, thematicReferences: references,
    assertions: content.assertions, experiences: content.experiences, links: content.links,
    verifications: content.verifications, observedAt: content.observedAt });
  if (canonicalize(reconstructed.content) !== canonicalize(content)) fail();
  if (published.complete(content, publication.policyRef).record.result !== 'COMPLETE') fail('INCOMPLETE');
  return canonicalClone(content);
}
function materialize({ organizationId, source, publicationId, versionId, content, contentDigest, materializedAt, admittedTuple }) {
  assertTuple(admittedTuple); uuid(publicationId); uuid(versionId); instant(materializedAt);
  if (instant(content.observedAt) > instant(materializedAt)) fail();
  const material = validatePublication({ organizationId, source, content, contentDigest });
  const value = { schema: tuple.snapshot, tuple, organizationId, state: 'READY',
    materializedAt, origin: { publicationId, versionId, draftId: source.draftId, revision: source.revision },
    coverage: { scopeType: 'ORGANIZATION', includedDomains: [...published.COVERAGE.includedDomains], constraintsAssessed: false },
    material };
  bounded(value);
  const snapshot = canonicalClone(value);
  return { snapshot, snapshotDigest: published.digest(snapshot) };
}
function assertSnapshot(snapshot, expectedDigest, organizationId) {
  uuid(organizationId); bounded(snapshot); assertTuple(snapshot.tuple);
  if (snapshot.organizationId !== organizationId) fail('RESOURCE_NOT_AVAILABLE');
  if (snapshot.state !== 'READY' || snapshot.schema !== tuple.snapshot || published.digest(snapshot) !== expectedDigest) fail();
  collections(snapshot.material);
  if (snapshot.coverage.scopeType !== 'ORGANIZATION' || snapshot.coverage.constraintsAssessed !== false
    || canonicalize(snapshot.coverage.includedDomains) !== canonicalize(published.COVERAGE.includedDomains)) fail();
  return snapshot;
}
module.exports = { materialize, validatePublication, assertSnapshot, instant, uuid };
