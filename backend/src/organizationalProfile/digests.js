'use strict';

const crypto = require('node:crypto');
const { canonicalClone, canonicalize } = require('./canonicalization');
const { OrganizationalProfileContractError } = require('./errors');

const DOMAINS = Object.freeze({
  semantic: 'C4G:F13:SEMANTIC:v1\0',
  projection: 'C4G:F13:PROJECTION:v1\0',
  compatibility: 'C4G:F13:COMPATIBILITY:v1\0'
});
const DIGEST = /^[a-f0-9]{64}$/;
const CONTENT_INPUT_KEYS = Object.freeze([
  'bundle', 'envelopePolicyReference', 'projectionPolicyReference', 'envelope'
]);
const PROJECTION_INPUT_KEYS = Object.freeze([...CONTENT_INPUT_KEYS, 'mode']);
const PROJECTION_FIELDS = Object.freeze([
  'projectionStatus', 'projectionReasonCode', 'projectionProvenanceRef'
]);

function digest(domain, value) {
  return crypto.createHash('sha256').update(domain).update(canonicalize(value)).digest('hex');
}

function semanticDigest(input) {
  const validated = validateDigestInput(input, CONTENT_INPUT_KEYS);
  return digest(DOMAINS.semantic, {
    bundle: validated.bundle,
    envelopePolicyReference: validated.envelopePolicyReference,
    internalContent: semanticContent(validated.envelope)
  });
}

function projectionDigest(input) {
  const validated = validateDigestInput(input, PROJECTION_INPUT_KEYS);
  if (validated.mode !== 'EXACT') fail();
  return digest(DOMAINS.projection, {
    bundle: validated.bundle,
    envelopePolicyReference: validated.envelopePolicyReference,
    mode: validated.mode,
    projection: validated.envelope,
    projectionPolicyReference: validated.projectionPolicyReference
  });
}

function compatibilityDigest(manifest) {
  return digest(DOMAINS.compatibility, manifest);
}

function equalDigest(left, right) {
  return typeof left === 'string' && typeof right === 'string'
    && DIGEST.test(left) && DIGEST.test(right)
    && crypto.timingSafeEqual(Buffer.from(left, 'ascii'), Buffer.from(right, 'ascii'));
}

function assertDigest(actual, expected) {
  if (!equalDigest(actual, expected)) {
    throw new OrganizationalProfileContractError('F13_DIGEST_MISMATCH');
  }
  return true;
}

function validateDigestInput(input, keys) {
  let candidate;
  try {
    candidate = canonicalClone(input);
  } catch {
    fail();
  }
  if (!isExactObject(candidate, keys)) fail();
  const { resolveReadableBundle } = require('./compatibility');
  const {
    resolveEnvelopePolicy, resolveProjectionPolicy, validateEpistemicEnvelope
  } = require('./contracts');
  const bundle = resolveReadableBundle(candidate.bundle);
  const envelopePolicy = resolveEnvelopePolicy(candidate.envelopePolicyReference);
  const projectionPolicy = resolveProjectionPolicy(candidate.projectionPolicyReference);
  const envelope = validateEpistemicEnvelope(candidate.envelope, envelopePolicy, projectionPolicy);
  return {
    bundle,
    envelope,
    envelopePolicyReference: candidate.envelopePolicyReference,
    mode: candidate.mode,
    projectionPolicyReference: candidate.projectionPolicyReference
  };
}

function semanticContent(envelope) {
  const content = {};
  for (const [key, value] of Object.entries(envelope)) {
    if (!PROJECTION_FIELDS.includes(key)) content[key] = value;
  }
  return canonicalClone(content);
}

function isExactObject(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function fail() {
  throw new OrganizationalProfileContractError();
}

module.exports = { DOMAINS, assertDigest, compatibilityDigest, equalDigest, projectionDigest, semanticDigest };
