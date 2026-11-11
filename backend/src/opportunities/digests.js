'use strict';
const crypto = require('node:crypto');
const { canonicalize } = require('./canonicalization');
const DOMAINS = Object.freeze({ content: 'C4G:OPPORTUNITY:CONTENT:v1\0', provenance: 'C4G:OPPORTUNITY:PROVENANCE:v1\0', idempotency: 'C4G:OPPORTUNITY:IDEMPOTENCY:v1\0' });
function digest(domain, value) { return crypto.createHash('sha256').update(domain).update(canonicalize(value)).digest('hex'); }
function contentDigest(projection) { return digest(DOMAINS.content, projection); }
function provenanceDigest(projection) { return digest(DOMAINS.provenance, projection); }
function idempotencyDigest({ authority, residence, operation, requestId, content, ...intent }) { const contentDigestValue=content===undefined?crypto.createHash('sha256').update(canonicalize(intent)).digest('hex'):content;return digest(DOMAINS.idempotency, { authority, residence, operation, requestId, contentDigest: contentDigestValue }); }
function equalDigest(left, right) { return typeof left === 'string' && typeof right === 'string' && /^[a-f0-9]{64}$/.test(left) && /^[a-f0-9]{64}$/.test(right) && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right)); }
// Target and CAS are part of the intention, not merely normalized searchable content.
// Server-generated provenance identity/time do not change an HTTP retry's intention.
function updateIntentionDigest(command, authority, residence) {
  const { provenanceId, ...snapshot } = command.snapshot;
  const { observedAt, ...provenance } = command.provenance;
  return idempotencyDigest({ authority, residence, operation: 'UPDATE', requestId: command.requestId,
    opportunityId: command.opportunityId, expectedRowVersion: command.expectedRowVersion, snapshot, provenance });
}
function createIntentionDigest(command,authority,residence){
  const {provenanceId,...snapshot}=command.snapshot;
  const {observedAt,...provenance}=command.provenance;
  return idempotencyDigest({authority,residence,operation:'CREATE',requestId:command.requestId,snapshot,provenance});
}
function lifecycleIntentionDigest(command,authority,residence){
  return idempotencyDigest({authority,residence,operation:command.action,requestId:command.requestId,
    opportunityId:command.opportunityId,expectedRowVersion:command.expectedRowVersion,target:command.action==='ARCHIVE'?'ARCHIVED':'ACTIVE'});
}
module.exports = { DOMAINS, contentDigest, equalDigest, idempotencyDigest, provenanceDigest, updateIntentionDigest, createIntentionDigest, lifecycleIntentionDigest };
