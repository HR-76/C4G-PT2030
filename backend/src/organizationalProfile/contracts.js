'use strict';

const { types: { isProxy } } = require('node:util');
const { canonicalClone, canonicalize } = require('./canonicalization');
const {
  ALL_SCHEMES, CONFIDENTIALITY_CLASSES, CONFLICT_STATUSES, CONTRACT_VERSION,
  EDITORIAL_LIFECYCLE_STATUSES, KNOWLEDGE_STATUSES, PROFILE_SCOPE_TYPES,
  PROJECTION_STATUSES, VERIFICATION_STATUSES
} = require('./constants');
const { OrganizationalProfileContractError } = require('./errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const VERSION = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ENVELOPE_KEYS = Object.freeze([
  'contractVersion', 'knowledgeStatus', 'verificationStatus', 'conflictStatus',
  'lifecycleStatus', 'confidentialityClass', 'projectionStatus', 'value', 'valueRef',
  'reasonCode', 'authorityRef', 'provenanceRef', 'validFrom', 'validUntil',
  'verificationMethod', 'verifierSubjectId', 'verifiedAt', 'verificationProvenanceRef',
  'assertionRef', 'verificationReasonCode', 'assertionValidFrom', 'assertionValidUntil',
  'conflictAssertions', 'projectionReasonCode', 'projectionProvenanceRef'
]);
const ENVELOPE_REQUIRED = Object.freeze([
  'contractVersion', 'knowledgeStatus', 'verificationStatus', 'conflictStatus',
  'lifecycleStatus', 'confidentialityClass', 'projectionStatus'
]);
const POLICY_KEYS = Object.freeze([
  'policySchemaVersion', 'policyVersion', 'allowedKnowledgeStatuses', 'allowedVerificationStatuses',
  'allowedValueKinds', 'allowNull', 'allowEmptyString', 'allowEmptyArray', 'allowEmptyObject',
  'noneReasonCodes', 'notApplicableReasonCodes', 'disputeReasonCodes', 'revocationReasonCodes',
  'verificationRequired'
]);
const PROJECTION_POLICY_KEYS = Object.freeze([
  'policySchemaVersion', 'policyVersion', 'allowedProjectionStatuses', 'withheldReasonCodes'
]);
const VALUE_KINDS = Object.freeze(['BOOLEAN', 'SAFE_INTEGER', 'STRING', 'ARRAY', 'OBJECT', 'VALUE_REF']);
const CONFLICT_ENTRY_KEYS = Object.freeze(['assertionRef', 'provenanceRef']);
const POLICY_REFERENCE_KEYS = Object.freeze(['kind', 'policyId', 'policyVersion']);
const TRUSTED_ENVELOPE_POLICIES = new WeakSet();
const TRUSTED_PROJECTION_POLICIES = new WeakSet();
const ENVELOPE_POLICY_DEFINITIONS = Object.freeze([
  Object.freeze({
    reference: Object.freeze({
      kind: 'EPISTEMIC_ENVELOPE',
      policyId: 'F13_DECLARED_FACT',
      policyVersion: 'f13-structural-v1'
    }),
    definition: Object.freeze({
      policySchemaVersion: 1,
      policyVersion: 'f13-structural-v1',
      allowedKnowledgeStatuses: Object.freeze(['KNOWN', 'UNKNOWN']),
      allowedVerificationStatuses: Object.freeze(['UNVERIFIED', 'VERIFIED', 'EXPIRED']),
      allowedValueKinds: Object.freeze(['BOOLEAN', 'SAFE_INTEGER', 'STRING', 'ARRAY', 'OBJECT', 'VALUE_REF']),
      allowNull: false,
      allowEmptyString: false,
      allowEmptyArray: false,
      allowEmptyObject: false,
      noneReasonCodes: Object.freeze([]),
      notApplicableReasonCodes: Object.freeze([]),
      disputeReasonCodes: Object.freeze([]),
      revocationReasonCodes: Object.freeze([]),
      verificationRequired: false
    })
  })
]);
const PROJECTION_POLICY_DEFINITIONS = Object.freeze([
  Object.freeze({
    reference: Object.freeze({
      kind: 'EPISTEMIC_PROJECTION',
      policyId: 'F13_DISCLOSED_ONLY',
      policyVersion: 'f13-structural-v1'
    }),
    definition: Object.freeze({
      policySchemaVersion: 1,
      policyVersion: 'f13-structural-v1',
      allowedProjectionStatuses: Object.freeze(['DISCLOSED']),
      withheldReasonCodes: Object.freeze([])
    })
  })
]);
const ENVELOPE_POLICY_CATALOG = initializePolicyCatalog(
  ENVELOPE_POLICY_DEFINITIONS, 'EPISTEMIC_ENVELOPE', validateEnvelopePolicy, TRUSTED_ENVELOPE_POLICIES
);
const PROJECTION_POLICY_CATALOG = initializePolicyCatalog(
  PROJECTION_POLICY_DEFINITIONS, 'EPISTEMIC_PROJECTION', validateProjectionPolicy, TRUSTED_PROJECTION_POLICIES
);

function resolveEnvelopePolicy(reference) {
  return resolvePolicy(reference, 'EPISTEMIC_ENVELOPE', ENVELOPE_POLICY_CATALOG);
}

function resolveProjectionPolicy(reference) {
  return resolvePolicy(reference, 'EPISTEMIC_PROJECTION', PROJECTION_POLICY_CATALOG);
}

function initializePolicyCatalog(entries, expectedKind, validate, trustedPolicies) {
  const keys = new Set();
  const catalog = [];
  for (const entry of entries) {
    assertCanonicalInput(entry);
    exact(entry, ['reference', 'definition'], ['reference', 'definition']);
    assertDeepFrozen(entry);
    assertPolicyReference(entry.reference, expectedKind);
    const key = policyKey(entry.reference);
    if (keys.has(key)) fail('F13_INCOMPATIBLE_VERSION');
    keys.add(key);
    const policy = validate(entry.definition);
    if (!Object.isFrozen(policy)) fail('F13_INCOMPATIBLE_VERSION');
    trustedPolicies.add(policy);
    catalog.push(Object.freeze({ key, policy }));
  }
  return Object.freeze(catalog);
}

function resolvePolicy(reference, expectedKind, catalog) {
  assertPolicyReference(reference, expectedKind);
  const entry = catalog.find(candidate => candidate.key === policyKey(reference));
  if (!entry) fail('F13_INCOMPATIBLE_VERSION');
  return entry.policy;
}

function assertPolicyReference(reference, expectedKind) {
  assertCanonicalInput(reference);
  exact(reference, POLICY_REFERENCE_KEYS, POLICY_REFERENCE_KEYS);
  if (reference.kind !== expectedKind || !CODE.test(reference.policyId)
      || !VERSION.test(reference.policyVersion)) fail('F13_INCOMPATIBLE_VERSION');
}

function policyKey(reference) {
  return `${reference.kind}\u0000${reference.policyId}\u0000${reference.policyVersion}`;
}

function validateEnvelopePolicy(input) {
  assertCanonicalInput(input);
  exact(input, POLICY_KEYS, POLICY_KEYS);
  if (input.policySchemaVersion !== 1 || !VERSION.test(input.policyVersion)
      || !closedList(input.allowedKnowledgeStatuses, KNOWLEDGE_STATUSES, false)
      || !closedList(input.allowedVerificationStatuses, VERIFICATION_STATUSES, false)
      || !closedList(input.allowedValueKinds, VALUE_KINDS, false)
      || typeof input.allowNull !== 'boolean'
      || typeof input.allowEmptyString !== 'boolean'
      || typeof input.allowEmptyArray !== 'boolean'
      || typeof input.allowEmptyObject !== 'boolean'
      || !codeList(input.noneReasonCodes)
      || !codeList(input.notApplicableReasonCodes)
      || !codeList(input.disputeReasonCodes)
      || !codeList(input.revocationReasonCodes)
      || typeof input.verificationRequired !== 'boolean') fail();
  if (input.verificationRequired && input.allowedVerificationStatuses.includes('NOT_REQUIRED')) fail();
  if ((input.allowedKnowledgeStatuses.includes('NONE') && input.noneReasonCodes.length === 0)
      || (input.allowedKnowledgeStatuses.includes('NOT_APPLICABLE') && input.notApplicableReasonCodes.length === 0)
      || (input.allowedVerificationStatuses.includes('DISPUTED') && input.disputeReasonCodes.length === 0)
      || (input.allowedVerificationStatuses.includes('REVOKED') && input.revocationReasonCodes.length === 0)) fail();
  return canonicalClone(input);
}

function validateProjectionPolicy(input) {
  assertCanonicalInput(input);
  exact(input, PROJECTION_POLICY_KEYS, PROJECTION_POLICY_KEYS);
  if (input.policySchemaVersion !== 1 || !VERSION.test(input.policyVersion)
      || !closedList(input.allowedProjectionStatuses, PROJECTION_STATUSES, false)
      || !codeList(input.withheldReasonCodes)) fail();
  if (input.allowedProjectionStatuses.includes('WITHHELD') && input.withheldReasonCodes.length === 0) fail();
  return canonicalClone(input);
}

function assertDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  if (!Object.isFrozen(value)) fail('F13_INCOMPATIBLE_VERSION');
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) assertDeepFrozen(descriptor.value);
  }
}

function validateEpistemicEnvelope(input, trustedPolicy, trustedProjectionPolicy) {
  assertCanonicalInput(input);
  exact(input, ENVELOPE_KEYS, ENVELOPE_REQUIRED);
  if (!TRUSTED_ENVELOPE_POLICIES.has(trustedPolicy)) fail('F13_UNTRUSTED_POLICY');
  const policy = trustedPolicy;
  if (input.contractVersion !== CONTRACT_VERSION
      || !policy.allowedKnowledgeStatuses.includes(input.knowledgeStatus)
      || !policy.allowedVerificationStatuses.includes(input.verificationStatus)
      || !CONFLICT_STATUSES.includes(input.conflictStatus)
      || !EDITORIAL_LIFECYCLE_STATUSES.includes(input.lifecycleStatus)
      || !CONFIDENTIALITY_CLASSES.includes(input.confidentialityClass)
      || !PROJECTION_STATUSES.includes(input.projectionStatus)) fail();

  const hasValue = Object.hasOwn(input, 'value');
  const hasValueRef = Object.hasOwn(input, 'valueRef');
  if (input.knowledgeStatus === 'KNOWN') {
    if (hasValue === hasValueRef) fail();
    if (hasValueRef) {
      if (!policy.allowedValueKinds.includes('VALUE_REF')) fail();
      uuid(input.valueRef);
    } else {
      validateKnownValue(input.value, policy);
    }
  } else if (hasValue || hasValueRef) fail();

  if (input.knowledgeStatus === 'NONE') {
    requireCode(input.reasonCode, policy.noneReasonCodes);
    requireUuidFields(input, ['authorityRef', 'provenanceRef']);
    requirePeriod(input);
  } else if (input.knowledgeStatus === 'NOT_APPLICABLE') {
    requireCode(input.reasonCode, policy.notApplicableReasonCodes);
    if (['authorityRef', 'provenanceRef', 'validFrom', 'validUntil']
      .some(key => Object.hasOwn(input, key))) fail();
  } else if (['reasonCode', 'authorityRef', 'provenanceRef', 'validFrom', 'validUntil']
    .some(key => Object.hasOwn(input, key))) {
    fail();
  }

  if (input.verificationStatus === 'VERIFIED') {
    requireCode(input.verificationMethod);
    requireUuidFields(input, ['verifierSubjectId', 'verificationProvenanceRef']);
    instant(input.verifiedAt);
  } else if (['verificationMethod', 'verifierSubjectId', 'verifiedAt']
    .some(key => Object.hasOwn(input, key))) fail();
  validateNonCurrentVerification(input, policy);
  if (input.verificationStatus === 'NOT_REQUIRED' && policy.verificationRequired) fail();
  validateConflict(input);
  validateProjection(input, trustedProjectionPolicy);
  return canonicalClone(input);
}

function validateKnownValue(value, policy) {
  if (value === undefined) fail();
  const kind = value === null ? 'NULL'
    : Array.isArray(value) ? 'ARRAY'
      : typeof value === 'object' ? 'OBJECT'
        : typeof value === 'number' ? 'SAFE_INTEGER'
          : typeof value === 'boolean' ? 'BOOLEAN'
            : typeof value === 'string' ? 'STRING' : null;
  if (kind === 'NULL') {
    if (!policy.allowNull) fail();
    return;
  }
  if (!kind || !policy.allowedValueKinds.includes(kind)) fail();
  if (kind === 'STRING' && value.length === 0 && !policy.allowEmptyString) fail();
  if (kind === 'ARRAY' && value.length === 0 && !policy.allowEmptyArray) fail();
  if (kind === 'OBJECT' && Reflect.ownKeys(value).length === 0 && !policy.allowEmptyObject) fail();
}

function validateNonCurrentVerification(input, policy) {
  const stateFields = ['assertionRef', 'verificationReasonCode', 'assertionValidFrom', 'assertionValidUntil'];
  if (input.verificationStatus === 'VERIFIED') {
    if (stateFields.some(key => Object.hasOwn(input, key))) fail();
    return;
  }
  const fields = [...stateFields, 'verificationProvenanceRef'];
  if (input.verificationStatus === 'DISPUTED' || input.verificationStatus === 'REVOKED') {
    requireUuidFields(input, ['assertionRef', 'verificationProvenanceRef']);
    requireCode(input.verificationReasonCode, input.verificationStatus === 'DISPUTED'
      ? policy.disputeReasonCodes : policy.revocationReasonCodes);
    if (Object.hasOwn(input, 'assertionValidFrom') || Object.hasOwn(input, 'assertionValidUntil')) fail();
    return;
  }
  if (input.verificationStatus === 'EXPIRED') {
    requireUuidFields(input, ['assertionRef', 'verificationProvenanceRef']);
    requireNamedPeriod(input, 'assertionValidFrom', 'assertionValidUntil');
    if (Object.hasOwn(input, 'verificationReasonCode')) fail();
    return;
  }
  if (fields.some(key => Object.hasOwn(input, key))) fail();
}

function validateConflict(input) {
  if (input.conflictStatus === 'CLEAR') {
    if (Object.hasOwn(input, 'conflictAssertions')) fail();
    return;
  }
  if (input.knowledgeStatus !== 'UNKNOWN' || !Object.hasOwn(input, 'conflictAssertions')
      || !Array.isArray(input.conflictAssertions) || input.conflictAssertions.length < 2) fail();
  const assertionRefs = new Set();
  for (const entry of input.conflictAssertions) {
    exact(entry, CONFLICT_ENTRY_KEYS, CONFLICT_ENTRY_KEYS);
    uuid(entry.assertionRef);
    uuid(entry.provenanceRef);
    if (assertionRefs.has(entry.assertionRef)) fail();
    assertionRefs.add(entry.assertionRef);
  }
}

function validateProjection(input, trustedProjectionPolicy) {
  const fields = ['projectionReasonCode', 'projectionProvenanceRef'];
  if (!TRUSTED_PROJECTION_POLICIES.has(trustedProjectionPolicy)) fail('F13_UNTRUSTED_POLICY');
  if (!trustedProjectionPolicy.allowedProjectionStatuses.includes(input.projectionStatus)) {
    fail('F13_UNTRUSTED_POLICY');
  }
  if (input.projectionStatus === 'DISCLOSED') {
    if (fields.some(key => Object.hasOwn(input, key))) fail();
    return;
  }
  if (input.knowledgeStatus !== 'KNOWN') fail();
  requireCode(input.projectionReasonCode, trustedProjectionPolicy.withheldReasonCodes);
  requireUuidFields(input, ['projectionProvenanceRef']);
}

function assertCanonicalInput(input) {
  try {
    canonicalize(input);
  } catch {
    fail();
  }
}

function validateConceptReference(input) {
  exact(input, ['contractVersion', 'schemeId', 'conceptId', 'taxonomyVersion'], ['contractVersion', 'schemeId', 'conceptId', 'taxonomyVersion']);
  if (input.contractVersion !== CONTRACT_VERSION || !ALL_SCHEMES.includes(input.schemeId)
      || !VERSION.test(input.taxonomyVersion)) fail();
  uuid(input.conceptId);
  return canonicalClone(input);
}

function validateScopeReference(input) {
  exact(input, ['contractVersion', 'scopeType', 'scopeId'], ['contractVersion', 'scopeType', 'scopeId']);
  if (input.contractVersion !== CONTRACT_VERSION || !PROFILE_SCOPE_TYPES.includes(input.scopeType)) fail();
  uuid(input.scopeId);
  return canonicalClone(input);
}

function exact(value, allowed, required) {
  if (!plain(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => {
    const descriptor = typeof key === 'string' ? Object.getOwnPropertyDescriptor(value, key) : null;
    return typeof key !== 'string' || !allowed.includes(key) || !descriptor
      || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value');
  })) {
    fail('F13_UNKNOWN_FIELD');
  }
  if (required.some(key => !Object.hasOwn(value, key))) fail();
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && !isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function closedList(value, catalog, allowEmpty = true) {
  return Array.isArray(value) && !isProxy(value) && (allowEmpty || value.length > 0)
    && value.every(item => catalog.includes(item)) && new Set(value).size === value.length;
}

function codeList(value) {
  return Array.isArray(value) && !isProxy(value) && value.every(item => typeof item === 'string' && CODE.test(item))
    && new Set(value).size === value.length;
}

function requireCode(value, allowed) {
  if (typeof value !== 'string' || !CODE.test(value) || (allowed && !allowed.includes(value))) fail();
}

function requireUuidFields(input, fields) {
  for (const field of fields) {
    if (!Object.hasOwn(input, field)) fail();
    uuid(input[field]);
  }
}

function requirePeriod(input) {
  requireNamedPeriod(input, 'validFrom', 'validUntil');
}

function requireNamedPeriod(input, fromField, untilField) {
  if (!Object.hasOwn(input, fromField) || !Object.hasOwn(input, untilField)) fail();
  const from = instant(input[fromField]);
  const until = instant(input[untilField]);
  if (until < from) fail();
}

function instant(value) {
  if (typeof value !== 'string' || !INSTANT.test(value) || Number.isNaN(Date.parse(value))) fail();
  return new Date(value).toISOString();
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail();
  return value;
}

function fail(code) {
  throw new OrganizationalProfileContractError(code);
}

module.exports = {
  resolveEnvelopePolicy,
  resolveProjectionPolicy,
  validateConceptReference,
  validateEpistemicEnvelope,
  validateScopeReference
};
