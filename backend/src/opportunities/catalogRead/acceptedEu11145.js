'use strict';
// The preserved corpus keeps EU 11145 exactly as derived under mapping v2.0 and
// published on 02/11/2026 (same content digest as the normative v2.0 example).
// Later adapter or taxonomy versions must not re-derive it: a different digest
// would no longer match the published generation and the publisher would,
// correctly, demand a review before the API can start.
const { createHash } = require('node:crypto');
const { contentDigestV2 } = require('../v2/digests');
const frozen = require('./storedEvidence.eu-11145.v2.0.json');
// Hash of the parsed document, so line-ending conversion cannot break the pin.
const DOCUMENT_SHA256 = '6fbdf3a463f1ae6f9bc71f6c4f36ec206e064cda9ea65776c850c1e6278e092b';
const CONTENT_DIGEST = '355df5dc59a25556d9103fa276921d7e43d66a1087630481b0c4867460a96ce6';
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = () => { throw Object.assign(new Error('STORED_EVIDENCE_ACCEPTED_SNAPSHOT_MISMATCH'), { code: 'STORED_EVIDENCE_ACCEPTED_SNAPSHOT_MISMATCH' }); };

// Returns the accepted snapshot only when it still describes the given evidence.
function acceptedEu11145(envelope, metadata) {
  const snapshot = structuredClone(frozen);
  const source = snapshot.sourceRecords?.[0], observation = snapshot.provenance?.observations?.[0];
  if (sha(JSON.stringify(snapshot)) !== DOCUMENT_SHA256 || contentDigestV2(snapshot) !== CONTENT_DIGEST
    || source?.externalId !== metadata.externalIdentifier || observation?.observedAt !== metadata.observedAt
    || observation?.artifactSha256 !== sha(JSON.stringify(envelope))) fail();
  return snapshot;
}
module.exports = { acceptedEu11145, CONTENT_DIGEST };
