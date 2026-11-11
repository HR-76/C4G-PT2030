'use strict';
const { canonicalClone, canonicalize, canonicalizeEnvelope, MAX_CANONICAL_BYTES } = require('../organizationalProfile/canonicalization');
const publication = require('../organizationalProfile/pq1Release');
const { digest } = require('../organizationalProfile/pq1Material');
const tuple = canonicalClone({
  manifest: 'F13_F14_PQ1_MANIFEST_V1', producer: publication.VERSION,
  producerDigest: publication.bundleRef.digest,
  snapshot: 'F13_ORG_PQ1_EFFECTIVE_V1', materializer: 'F13_PQ1_MATERIALIZER_V1',
  readiness: 'F13_PQ1_READINESS_V1', snapshotProjection: 'F13_PQ1_EFFECTIVE_READ_V1',
  activationBundle: 'F13_PQ1_ACTIVATION_BUNDLE_V1', consumer: 'F14_PQ1_CONSUMER_V1',
  rules: 'F14_PQ1_RULES_V1', admissibility: 'F14_PQ1_EVIDENCE_ADMISSIBILITY_V1',
  result: 'F14_PQ1_RESULT_V1', resultProjection: 'F14_PQ1_RESULT_READ_V1', reasons: 'F14_PQ1_REASONS_V1'
});
const limits = Object.freeze({ maxItems: 100, maxCollection: 100, maxBytes: 1048576, maxCanonicalBytes: MAX_CANONICAL_BYTES,
  maxRows: 10000, maxPageSize: 100, timeoutMs: 10000 });
function fail(code = 'INTEGRITY_UNAVAILABLE') { throw Object.assign(new Error('Prequalification refused'), { code }); }
function assertTuple(value) { if (canonicalize(value) !== canonicalize(tuple)) fail('TUPLE_INCOMPATIBLE'); }
function bounded(value) {
  let encoded;
  try { encoded = canonicalize(value); } catch (error) {
    if (error.message.includes('structural limit')) fail('LIMIT_EXCEEDED');
    fail();
  }
  if (Buffer.byteLength(encoded, 'utf8') > limits.maxBytes) fail('LIMIT_EXCEEDED');
  return encoded;
}
function boundedEnvelope(value) {
  try { return canonicalizeEnvelope(value); } catch (error) {
    if (error.message.includes('structural limit')) fail('LIMIT_EXCEEDED');
    fail();
  }
}
module.exports = { tuple, tupleDigest: digest(tuple), limits, fail, assertTuple, bounded, boundedEnvelope };
