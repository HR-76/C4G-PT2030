'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalClone, canonicalize } = require('../src/organizationalProfile/canonicalization');
const { F13_AUDIT_EVENT_DEFINITIONS, F13_OPERATION_DEFINITIONS, resolveAuditEvent, resolveOperation } = require('../src/organizationalProfile/catalogs');
const { CURRENT_BUNDLE, MANIFEST, MANIFEST_DIGEST, assertWritableBundle, resolveReadableBundle } = require('../src/organizationalProfile/compatibility');
const {
  ALL_SCHEMES, CONFIDENTIALITY_CLASSES, CONFLICT_STATUSES, CONSTRAINT_TYPES,
  EDITORIAL_LIFECYCLE_STATUSES, EXTERNAL_MAPPING_RELATIONS_BY_SCHEME,
  KNOWLEDGE_STATUSES, PROFILE_SCOPE_TYPES, PROJECTION_MODES, PROJECTION_STATUSES,
  VERIFICATION_STATUSES, isExternalMappingRelationAllowed
} = require('../src/organizationalProfile/constants');
const contractsPath = require.resolve('../src/organizationalProfile/contracts');
const contracts = require(contractsPath);
const {
  resolveEnvelopePolicy, resolveProjectionPolicy, validateConceptReference,
  validateEpistemicEnvelope, validateScopeReference
} = contracts;
const { assertDigest, compatibilityDigest, projectionDigest, semanticDigest } = require('../src/organizationalProfile/digests');

const UUID_A = '018f2f32-6b43-7d84-8a5b-38ca89c12abc';
const UUID_B = '018f2f32-6b43-7d84-8a5b-38ca89c12abd';
const UUID_C = '018f2f32-6b43-7d84-8a5b-38ca89c12abe';
const ENVELOPE_POLICY_REFERENCE = Object.freeze({
  kind: 'EPISTEMIC_ENVELOPE', policyId: 'F13_DECLARED_FACT', policyVersion: 'f13-structural-v1'
});
const PROJECTION_POLICY_REFERENCE = Object.freeze({
  kind: 'EPISTEMIC_PROJECTION', policyId: 'F13_DISCLOSED_ONLY', policyVersion: 'f13-structural-v1'
});
const BUNDLE_REFERENCE = Object.freeze({ bundleVersion: 'f13-structural-v1', contractVersion: 1 });
const POLICY = resolveEnvelopePolicy(ENVELOPE_POLICY_REFERENCE);
const PROJECTION_POLICY = resolveProjectionPolicy(PROJECTION_POLICY_REFERENCE);
const BASE = Object.freeze({
  contractVersion: 1,
  knowledgeStatus: 'KNOWN',
  verificationStatus: 'UNVERIFIED',
  conflictStatus: 'CLEAR',
  lifecycleStatus: 'DRAFT',
  confidentialityClass: 'INTERNAL',
  projectionStatus: 'DISCLOSED',
  value: false
});

function validateEnvelope(input, policy = POLICY, projectionPolicy = PROJECTION_POLICY) {
  return validateEpistemicEnvelope(input, policy, projectionPolicy);
}

function semanticDigestInput(envelope = BASE) {
  return {
    bundle: BUNDLE_REFERENCE,
    envelopePolicyReference: ENVELOPE_POLICY_REFERENCE,
    projectionPolicyReference: PROJECTION_POLICY_REFERENCE,
    envelope
  };
}

function projectionDigestInput(envelope = BASE) {
  return { ...semanticDigestInput(envelope), mode: 'EXACT' };
}

function contractError(code = 'F13_INVALID_INPUT') {
  return error => error && error.code === code && error.message === 'Organizational profile contract rejected.';
}

function anyContractError(error) {
  return error && typeof error.code === 'string' && error.code.startsWith('F13_')
    && error.message === 'Organizational profile contract rejected.';
}

test('approved structural vocabularies are closed, frozen, and omit forbidden scope and preference concepts', () => {
  for (const catalog of [KNOWLEDGE_STATUSES, VERIFICATION_STATUSES, CONFLICT_STATUSES,
    EDITORIAL_LIFECYCLE_STATUSES, PROJECTION_STATUSES, CONFIDENTIALITY_CLASSES,
    PROJECTION_MODES, PROFILE_SCOPE_TYPES, CONSTRAINT_TYPES, ALL_SCHEMES]) {
    assert.equal(Object.isFrozen(catalog), true);
    assert.equal(new Set(catalog).size, catalog.length);
  }
  assert.deepEqual(PROFILE_SCOPE_TYPES, ['ORGANIZATION', 'UNIT', 'TEAM']);
  assert.deepEqual(CONSTRAINT_TYPES, ['PROHIBITED', 'UNAVAILABLE']);
  assert.equal(PROFILE_SCOPE_TYPES.includes('UNIT_SUBTREE'), false);
  assert.equal(CONSTRAINT_TYPES.includes('NOT_PREFERRED'), false);
  assert.equal(ALL_SCHEMES.includes('CUSTOM_AREA'), false);
  assert.equal(CONFIDENTIALITY_CLASSES.includes('PUBLIC'), false);
});

test('external mapping relations are closed per approved scheme domain', () => {
  const thematic = ['EXACT', 'CLOSE', 'BROADER', 'NARROWER'];
  const territory = [...thematic, 'OVERLAPS'];
  const mappedSchemes = [
    'THEMATIC_AREA', 'STRATEGIC_PRIORITY', 'COUNTRY_TERRITORY',
    'ADMINISTRATIVE_AREA', 'STATISTICAL_REGION', 'TRANSNATIONAL_AREA'
  ];

  assert.equal(Object.isFrozen(EXTERNAL_MAPPING_RELATIONS_BY_SCHEME), true);
  assert.deepEqual(Object.keys(EXTERNAL_MAPPING_RELATIONS_BY_SCHEME), mappedSchemes);
  for (const scheme of ['THEMATIC_AREA', 'STRATEGIC_PRIORITY']) {
    assert.deepEqual(EXTERNAL_MAPPING_RELATIONS_BY_SCHEME[scheme], thematic);
    assert.equal(Object.isFrozen(EXTERNAL_MAPPING_RELATIONS_BY_SCHEME[scheme]), true);
    for (const relation of thematic) assert.equal(isExternalMappingRelationAllowed(scheme, relation), true);
    assert.equal(isExternalMappingRelationAllowed(scheme, 'OVERLAPS'), false);
  }
  for (const scheme of mappedSchemes.slice(2)) {
    assert.deepEqual(EXTERNAL_MAPPING_RELATIONS_BY_SCHEME[scheme], territory);
    for (const relation of territory) assert.equal(isExternalMappingRelationAllowed(scheme, relation), true);
  }

  for (const scheme of [
    'LEGAL_NATURE', 'INSTITUTION_TYPE', 'CONTROL_STATUS', 'NON_PROFIT_STATUS',
    'ECONOMIC_SIZE_CLASS', 'SERVED_POPULATION_GROUP', 'COMPETENCY', 'CUSTOM_AREA'
  ]) {
    assert.equal(isExternalMappingRelationAllowed(scheme, 'EXACT'), false);
  }
  for (const relation of ['RELATED', 'OVERLAP', 'EXACT_MATCH', '', null, undefined]) {
    assert.equal(isExternalMappingRelationAllowed('COUNTRY_TERRITORY', relation), false);
  }
  assert.equal(isExternalMappingRelationAllowed(null, 'EXACT'), false);
  assert.equal(isExternalMappingRelationAllowed('__proto__', 'EXACT'), false);
  assert.throws(() => { EXTERNAL_MAPPING_RELATIONS_BY_SCHEME.THEMATIC_AREA.push('OVERLAPS'); }, TypeError);
});

test('KNOWN uses a trusted declarative policy and rejects empty representations by default', () => {
  for (const value of [false, 0, 'value', [false], { present: false }]) {
    const validated = validateEnvelope({ ...BASE, value });
    assert.equal(Object.hasOwn(validated, 'value'), true);
    assert.deepEqual(validated.value, value);
    assert.equal(Object.isFrozen(validated), true);
  }
  for (const value of [null, '', [], {}]) {
    assert.throws(() => validateEnvelope({ ...BASE, value }), contractError());
  }
  const missing = { ...BASE };
  delete missing.value;
  assert.throws(() => validateEnvelope(missing), contractError());
  assert.throws(() => validateEnvelope({ ...BASE, knowledgeStatus: 'UNKNOWN', verificationStatus: 'NOT_REQUIRED', value: undefined }), contractError());
});

test('conflict requires distinct identified assertions and never a resolved single value', () => {
  const withoutValue = { ...BASE, knowledgeStatus: 'UNKNOWN', conflictStatus: 'CONFLICTED' };
  delete withoutValue.value;
  const valid = validateEpistemicEnvelope({
    ...withoutValue,
    conflictAssertions: [
      { assertionRef: UUID_A, provenanceRef: UUID_B },
      { assertionRef: UUID_C, provenanceRef: UUID_A }
    ]
  }, POLICY, PROJECTION_POLICY);
  assert.equal(valid.conflictStatus, 'CONFLICTED');
  assert.equal(valid.conflictAssertions.length, 2);
  assert.throws(() => validateEpistemicEnvelope({
    ...withoutValue, conflictAssertions: [{ assertionRef: UUID_A, provenanceRef: UUID_B }]
  }, POLICY, PROJECTION_POLICY), contractError());
  assert.throws(() => validateEpistemicEnvelope({
    ...withoutValue,
    conflictAssertions: [
      { assertionRef: UUID_A, provenanceRef: UUID_B },
      { assertionRef: UUID_A, provenanceRef: UUID_C }
    ]
  }, POLICY, PROJECTION_POLICY), contractError());
  assert.throws(() => validateEpistemicEnvelope({
    ...BASE, conflictStatus: 'CONFLICTED', conflictAssertions: [
      { assertionRef: UUID_A, provenanceRef: UUID_B },
      { assertionRef: UUID_C, provenanceRef: UUID_A }
    ]
  }, POLICY, PROJECTION_POLICY), contractError());

});

test('cataloged verification states remain closed and preserve governed historical metadata', () => {
  const expired = validateEpistemicEnvelope({
    ...BASE, verificationStatus: 'EXPIRED', assertionRef: UUID_A,
    verificationProvenanceRef: UUID_B,
    assertionValidFrom: '2025-01-01T00:00:00.000Z',
    assertionValidUntil: '2025-12-31T23:59:59.000Z'
  }, POLICY, PROJECTION_POLICY);
  assert.equal(expired.verificationStatus, 'EXPIRED');
  for (const status of ['DISPUTED', 'REVOKED']) {
    assert.throws(() => validateEnvelope({ ...BASE, verificationStatus: status }), contractError());
  }
  for (const missing of ['assertionRef', 'verificationProvenanceRef', 'assertionValidFrom', 'assertionValidUntil']) {
    const incomplete = {
      ...BASE, verificationStatus: 'EXPIRED', assertionRef: UUID_A,
      verificationProvenanceRef: UUID_B,
      assertionValidFrom: '2025-01-01T00:00:00.000Z',
      assertionValidUntil: '2025-12-31T23:59:59.000Z'
    };
    delete incomplete[missing];
    assert.throws(() => validateEnvelope(incomplete), contractError());
  }
});

test('WITHHELD fails closed until a governed catalog tuple is approved', () => {
  const input = {
    ...BASE, projectionStatus: 'WITHHELD', projectionReasonCode: 'UNAPPROVED_REASON',
    projectionProvenanceRef: UUID_B
  };
  assert.throws(() => validateEpistemicEnvelope(input, POLICY), contractError());
  assert.throws(() => validateEpistemicEnvelope(input, POLICY, PROJECTION_POLICY), contractError());
  assert.throws(() => validateEpistemicEnvelope(input, POLICY, { ...PROJECTION_POLICY }), contractError());
  const absent = { ...input, knowledgeStatus: 'UNKNOWN' };
  delete absent.value;
  assert.throws(() => validateEpistemicEnvelope(absent, POLICY, PROJECTION_POLICY), contractError());
});

test('public policy API resolves only exact catalog tuples and exposes no issuer or registry', () => {
  assert.deepEqual(Object.keys(contracts).sort(), [
    'resolveEnvelopePolicy', 'resolveProjectionPolicy', 'validateConceptReference',
    'validateEpistemicEnvelope', 'validateScopeReference'
  ]);
  assert.equal(Object.isFrozen(POLICY), true);
  assert.equal(Object.isFrozen(POLICY.allowedValueKinds), true);
  assert.equal(Object.isFrozen(PROJECTION_POLICY), true);
  for (const reference of [
    { ...ENVELOPE_POLICY_REFERENCE, policyId: 'UNKNOWN_POLICY' },
    { ...ENVELOPE_POLICY_REFERENCE, policyVersion: 'f13-structural-v2' },
    { ...ENVELOPE_POLICY_REFERENCE, policyVersion: 'f13-structural-v0' },
    { ...ENVELOPE_POLICY_REFERENCE, kind: 'EPISTEMIC_PROJECTION' },
    { kind: 'EPISTEMIC_ENVELOPE', policyId: 'F13_DECLARED_FACT' },
    { ...ENVELOPE_POLICY_REFERENCE, reasonCodes: ['CALLER_REASON'] },
    { ...ENVELOPE_POLICY_REFERENCE, allowedValueKinds: ['NULL'] }
  ]) assert.throws(() => resolveEnvelopePolicy(reference), anyContractError);
  assert.throws(() => resolveProjectionPolicy({
    ...PROJECTION_POLICY_REFERENCE, policyId: 'UNKNOWN_POLICY'
  }), anyContractError);
  assert.throws(() => resolveProjectionPolicy(ENVELOPE_POLICY_REFERENCE), anyContractError);
});

test('trusted policies cannot be forged, cloned, mutated, or reconstructed', () => {
  assert.throws(() => validateEpistemicEnvelope(BASE, {
    policySchemaVersion: 1, policyVersion: 'caller-v1', allowedKnowledgeStatuses: ['KNOWN']
  }), contractError());
  assert.throws(() => validateEpistemicEnvelope(BASE, { ...POLICY }), contractError());
  assert.throws(() => validateEpistemicEnvelope(BASE, JSON.parse(JSON.stringify(POLICY))), contractError());
  assert.throws(() => validateEpistemicEnvelope(BASE, structuredClone(POLICY)), contractError());
  assert.throws(() => { POLICY.policyVersion = 'mutated'; }, TypeError);
  assert.throws(() => POLICY.allowedValueKinds.push('NULL'), TypeError);
  assert.equal(resolveEnvelopePolicy(ENVELOPE_POLICY_REFERENCE), POLICY);
  let getterCalled = false;
  const accessorReference = { ...ENVELOPE_POLICY_REFERENCE };
  Object.defineProperty(accessorReference, 'policyVersion', {
    enumerable: true,
    get() { getterCalled = true; return 'forged-v1'; }
  });
  assert.throws(() => resolveEnvelopePolicy(accessorReference), contractError());
  assert.equal(getterCalled, false);
  let callbackCalled = false;
  assert.throws(() => resolveEnvelopePolicy({
    ...ENVELOPE_POLICY_REFERENCE, callback() { callbackCalled = true; }
  }), contractError());
  assert.equal(callbackCalled, false);
});

test('policy trust is module-instance local and reload does not preserve authority', () => {
  const cachedModule = require.cache[contractsPath];
  delete require.cache[contractsPath];
  try {
    const freshContracts = require(contractsPath);
    assert.throws(() => freshContracts.validateEpistemicEnvelope(BASE, POLICY), contractError());
    const freshPolicy = freshContracts.resolveEnvelopePolicy(ENVELOPE_POLICY_REFERENCE);
    const freshProjectionPolicy = freshContracts.resolveProjectionPolicy(PROJECTION_POLICY_REFERENCE);
    assert.notEqual(freshPolicy, POLICY);
    assert.equal(freshContracts.validateEpistemicEnvelope(BASE, freshPolicy, freshProjectionPolicy).value, false);
  } finally {
    delete require.cache[contractsPath];
    require.cache[contractsPath] = cachedModule;
  }
});

test('cataloged projection tuple is immutable and arbitrary projection policies remain untrusted', () => {
  assert.equal(resolveProjectionPolicy(PROJECTION_POLICY_REFERENCE), PROJECTION_POLICY);
  assert.equal(Object.isFrozen(PROJECTION_POLICY.allowedProjectionStatuses), true);
  assert.equal(validateEpistemicEnvelope(BASE, POLICY, PROJECTION_POLICY).projectionStatus, 'DISCLOSED');
  for (const projectionPolicy of [
    undefined,
    null,
    { ...PROJECTION_POLICY },
    JSON.parse(JSON.stringify(PROJECTION_POLICY)),
    structuredClone(PROJECTION_POLICY),
    POLICY,
    {
      policySchemaVersion: 1,
      policyVersion: 'f13-structural-v1',
      allowedProjectionStatuses: ['DISCLOSED'],
      withheldReasonCodes: []
    }
  ]) {
    assert.throws(
      () => validateEpistemicEnvelope(BASE, POLICY, projectionPolicy),
      contractError()
    );
  }
  assert.throws(() => validateEpistemicEnvelope({
    ...BASE, projectionStatus: 'WITHHELD', projectionReasonCode: 'CALLER_REASON',
    projectionProvenanceRef: UUID_B
  }, POLICY, {
    policySchemaVersion: 1, policyVersion: 'caller-v1',
    allowedProjectionStatuses: ['WITHHELD'], withheldReasonCodes: ['CALLER_REASON']
  }), contractError());
});

test('DISCLOSED authorization depends on the trusted policy status allowlist', { concurrency: false }, () => {
  const originalIncludes = Array.prototype.includes;
  let allowlistConsulted = false;
  Array.prototype.includes = function includes(value, ...fromIndex) {
    if (this === PROJECTION_POLICY.allowedProjectionStatuses && value === 'DISCLOSED') {
      allowlistConsulted = true;
      return false;
    }
    return Reflect.apply(originalIncludes, this, [value, ...fromIndex]);
  };
  try {
    assert.throws(
      () => validateEpistemicEnvelope(BASE, POLICY, PROJECTION_POLICY),
      contractError()
    );
    assert.equal(allowlistConsulted, true);
  } finally {
    Array.prototype.includes = originalIncludes;
  }
  assert.equal(validateEpistemicEnvelope(BASE, POLICY, PROJECTION_POLICY).projectionStatus, 'DISCLOSED');
});

test('DISCLOSED rejects projection authority from another module instance without reading caller properties', () => {
  const cachedModule = require.cache[contractsPath];
  delete require.cache[contractsPath];
  try {
    const freshContracts = require(contractsPath);
    const foreignProjectionPolicy = freshContracts.resolveProjectionPolicy(PROJECTION_POLICY_REFERENCE);
    assert.throws(
      () => validateEpistemicEnvelope(BASE, POLICY, foreignProjectionPolicy),
      contractError()
    );
  } finally {
    delete require.cache[contractsPath];
    require.cache[contractsPath] = cachedModule;
  }

  let getterCalled = false;
  const accessorPolicy = {};
  Object.defineProperty(accessorPolicy, 'allowedProjectionStatuses', {
    enumerable: true,
    get() { getterCalled = true; return ['DISCLOSED']; }
  });
  assert.throws(
    () => validateEpistemicEnvelope(BASE, POLICY, accessorPolicy),
    contractError()
  );
  assert.equal(getterCalled, false);
  assert.throws(
    () => validateEpistemicEnvelope(BASE, POLICY, new Proxy({}, {
      get() { throw new Error('projection policy proxy was read'); }
    })),
    contractError()
  );
});

test('validated envelopes are deeply immutable and retain semantic state metadata canonically', () => {
  const input = { ...BASE, value: { nested: [false, 0, 'value'] } };
  const validated = validateEnvelope(input);
  input.value.nested[0] = true;
  assert.deepEqual(validated.value, { nested: [false, 0, 'value'] });
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(Object.isFrozen(validated.value.nested), true);
  assert.match(canonicalize(validated), /"knowledgeStatus":"KNOWN"/);
});

test('uninstantiated reason-bearing states fail closed while cataloged VERIFIED remains governed', () => {
  const baseWithoutValue = { ...BASE };
  delete baseWithoutValue.value;
  assert.throws(() => validateEpistemicEnvelope({
    ...baseWithoutValue, knowledgeStatus: 'NONE', verificationStatus: 'NOT_REQUIRED',
    reasonCode: 'DECLARED_NONE', authorityRef: UUID_A, provenanceRef: UUID_B,
    validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2026-12-31T23:59:59.000Z'
  }, POLICY, PROJECTION_POLICY), contractError());
  assert.throws(() => validateEpistemicEnvelope({
    ...baseWithoutValue, knowledgeStatus: 'NOT_APPLICABLE', verificationStatus: 'NOT_REQUIRED',
    reasonCode: 'DOMAIN_NOT_APPLICABLE'
  }, POLICY, PROJECTION_POLICY), contractError());
  assert.equal(validateEpistemicEnvelope({
    ...BASE, verificationStatus: 'VERIFIED', verificationMethod: 'DOCUMENT_REVIEW',
    verifierSubjectId: UUID_A, verifiedAt: '2026-10-10T08:30:00.000Z', verificationProvenanceRef: UUID_B
  }, POLICY, PROJECTION_POLICY).verificationStatus, 'VERIFIED');
  assert.throws(() => validateEpistemicEnvelope({
    ...baseWithoutValue, knowledgeStatus: 'UNKNOWN', verificationStatus: 'UNVERIFIED', authorityRef: UUID_A
  }, POLICY, PROJECTION_POLICY), contractError());
});

test('invalid state combinations, fields, policies, and implicit defaults fail closed', () => {
  const cases = [
    [{ ...BASE, knowledgeStatus: 'UNKNOWN' }, POLICY],
    [{ ...BASE, knowledgeStatus: 'FUTURE_STATE' }, POLICY],
    [{ ...BASE, projectionStatus: 'OMITTED' }, POLICY],
    [{ ...BASE, scopeType: 'ORGANIZATION' }, POLICY],
    [{ ...BASE, verificationStatus: 'VERIFIED' }, POLICY],
    [{ ...BASE, verificationStatus: 'NOT_REQUIRED' }, POLICY],
    [{ ...BASE, valueRef: UUID_A }, POLICY]
  ];
  for (const [input, policy] of cases) assert.throws(() => validateEpistemicEnvelope(input, policy, PROJECTION_POLICY), anyContractError);
  assert.throws(() => validateEpistemicEnvelope({ ...BASE, extra: true }, POLICY, PROJECTION_POLICY), contractError('F13_UNKNOWN_FIELD'));
  assert.throws(() => validateEpistemicEnvelope(Object.assign(Object.create({ polluted: true }), BASE), POLICY, PROJECTION_POLICY), contractError());
  assert.throws(() => validateEpistemicEnvelope({ ...BASE, value: undefined }, POLICY, PROJECTION_POLICY), contractError());
});

test('concept and exact scope references reject labels, free text, unknown schemes and UNIT_SUBTREE', () => {
  assert.deepEqual(validateConceptReference({ contractVersion: 1, schemeId: 'LEGAL_NATURE', conceptId: UUID_A, taxonomyVersion: 'legal-nature-v1' }), {
    conceptId: UUID_A, contractVersion: 1, schemeId: 'LEGAL_NATURE', taxonomyVersion: 'legal-nature-v1'
  });
  assert.deepEqual(validateScopeReference({ contractVersion: 1, scopeType: 'UNIT', scopeId: UUID_B }), {
    contractVersion: 1, scopeId: UUID_B, scopeType: 'UNIT'
  });
  assert.throws(() => validateConceptReference({ contractVersion: 1, schemeId: 'CUSTOM_AREA', conceptId: UUID_A, taxonomyVersion: 'v1' }), contractError());
  assert.throws(() => validateConceptReference({ contractVersion: 1, schemeId: 'LEGAL_NATURE', conceptId: UUID_A, taxonomyVersion: 'v1', label: 'University' }), contractError('F13_UNKNOWN_FIELD'));
  assert.throws(() => validateScopeReference({ contractVersion: 1, scopeType: 'UNIT_SUBTREE', scopeId: UUID_B }), contractError());
});

test('validated semantic and projection digests bind exact bundle and policy tuples deterministically', () => {
  const firstEnvelope = { ...BASE, value: { alpha: 1, beta: { x: false, y: [0, 'value'] } } };
  const secondEnvelope = { ...BASE, value: { beta: { y: [0, 'value'], x: false }, alpha: 1 } };
  const firstSemantic = semanticDigest(semanticDigestInput(firstEnvelope));
  const secondSemantic = semanticDigest({
    envelope: secondEnvelope,
    projectionPolicyReference: { ...PROJECTION_POLICY_REFERENCE },
    envelopePolicyReference: { ...ENVELOPE_POLICY_REFERENCE },
    bundle: { ...BUNDLE_REFERENCE }
  });
  const firstProjection = projectionDigest(projectionDigestInput(firstEnvelope));
  const secondProjection = projectionDigest({
    mode: 'EXACT',
    envelope: secondEnvelope,
    projectionPolicyReference: { ...PROJECTION_POLICY_REFERENCE },
    envelopePolicyReference: { ...ENVELOPE_POLICY_REFERENCE },
    bundle: { ...BUNDLE_REFERENCE }
  });
  assert.equal(firstSemantic, secondSemantic);
  assert.equal(firstProjection, secondProjection);
  assert.notEqual(firstSemantic, firstProjection);
  assert.notEqual(firstSemantic, semanticDigest(semanticDigestInput({ ...BASE, value: true })));
});

test('digests reject unvalidated content, missing versions and unsupported projection modes', () => {
  for (const input of [
    { arbitrary: 'content' },
    { ...semanticDigestInput(), envelope: { arbitrary: 'content' } },
    { ...semanticDigestInput(), bundle: { bundleVersion: 'f13-structural-v0', contractVersion: 0 } },
    { ...semanticDigestInput(), envelopePolicyReference: { ...ENVELOPE_POLICY_REFERENCE, policyVersion: 'f13-structural-v2' } },
    { ...semanticDigestInput(), projectionPolicyReference: { ...PROJECTION_POLICY_REFERENCE, policyVersion: 'f13-structural-v0' } },
    { ...semanticDigestInput(), callerVersion: 'untrusted' }
  ]) assert.throws(() => semanticDigest(input), anyContractError);

  for (const mode of ['DERIVED', 'REDACTED', 'OMITTED']) {
    assert.throws(() => projectionDigest({ ...projectionDigestInput(), mode }), contractError());
  }
  assert.throws(() => projectionDigest({ ...projectionDigestInput(), projection: BASE }), contractError());
  assert.throws(() => projectionDigest({ ...projectionDigestInput(), projectionPolicyReference: ENVELOPE_POLICY_REFERENCE }), anyContractError);
});

test('canonicalization rejects ambiguous and adversarial representations', () => {
  const sparse = [];
  sparse[1] = 'value';
  const symbol = { value: 1 };
  symbol[Symbol('hidden')] = true;
  let getterCalled = false;
  const accessor = {};
  Object.defineProperty(accessor, 'value', { enumerable: true, get() { getterCalled = true; return 1; } });
  for (const value of [{ value: 1.5 }, { value: Number.NaN }, { value: undefined }, sparse, symbol,
    accessor, new Proxy({ value: 1 }, {}), Object.assign(Object.create(null), { value: 1 })]) {
    assert.throws(() => canonicalize(value), TypeError);
  }
  assert.equal(getterCalled, false);
  assert.throws(() => canonicalize({ value: 'e\u0301' }), TypeError);
  const polluted = JSON.parse('{"__proto__":{"admin":true}}');
  assert.equal(Object.prototype.admin, undefined);
  assert.throws(() => validateEpistemicEnvelope({ ...BASE, ...polluted }, POLICY, PROJECTION_POLICY), contractError('F13_UNKNOWN_FIELD'));
});

test('canonicalization preserves own __proto__ data without prototype mutation or digest collision', () => {
  const value = JSON.parse('{"__proto__":{"admin":true}}');
  const comparison = { admin: true };
  const arrayValue = [value];

  assert.equal(Object.hasOwn(value, '__proto__'), true);
  assert.equal(canonicalize(value), '{"__proto__":{"admin":true}}');
  assert.notEqual(canonicalize(value), canonicalize({}));
  assert.notEqual(canonicalize(value), canonicalize(comparison));
  assert.equal(canonicalize(arrayValue), '[{"__proto__":{"admin":true}}]');

  const clone = canonicalClone(value);
  assert.equal(Object.hasOwn(clone, '__proto__'), true);
  assert.deepEqual(clone.__proto__, { admin: true });
  assert.equal(Object.getPrototypeOf(clone), Object.prototype);
  assert.equal(Object.prototype.admin, undefined);

  const validated = validateEnvelope({ ...BASE, value });
  assert.equal(Object.hasOwn(validated.value, '__proto__'), true);
  assert.deepEqual(validated.value.__proto__, { admin: true });
  assert.equal(Object.isFrozen(validated.value), true);
  assert.equal(Object.isFrozen(validated.value.__proto__), true);

  assert.notEqual(
    semanticDigest(semanticDigestInput({ ...BASE, value })),
    semanticDigest(semanticDigestInput({ ...BASE, value: comparison }))
  );
  assert.notEqual(
    projectionDigest(projectionDigestInput({ ...BASE, value })),
    projectionDigest(projectionDigestInput({ ...BASE, value: comparison }))
  );
});

test('public structural boundaries reject accessors and proxies before executing caller code', () => {
  function hostileProxy(target = {}) {
    let trapCount = 0;
    const trapped = new Proxy(target, {
      get() { trapCount += 1; throw new Error('caller get trap executed'); },
      getOwnPropertyDescriptor() { trapCount += 1; throw new Error('caller descriptor trap executed'); },
      getPrototypeOf() { trapCount += 1; throw new Error('caller prototype trap executed'); },
      ownKeys() { trapCount += 1; throw new Error('caller ownKeys trap executed'); }
    });
    return { trapped, trapCount: () => trapCount };
  }

  for (const invoke of [
    proxy => canonicalize(proxy),
    proxy => resolveReadableBundle(proxy),
    proxy => validateConceptReference(proxy),
    proxy => validateScopeReference(proxy),
    proxy => semanticDigest(proxy),
    proxy => projectionDigest(proxy)
  ]) {
    const specimen = hostileProxy();
    assert.throws(() => invoke(specimen.trapped));
    assert.equal(specimen.trapCount(), 0);
  }

  const nested = hostileProxy({ hidden: true });
  assert.throws(() => semanticDigest(semanticDigestInput({ ...BASE, value: nested.trapped })), contractError());
  assert.equal(nested.trapCount(), 0);

  let getterCalled = false;
  const accessorBundle = {};
  Object.defineProperty(accessorBundle, 'bundleVersion', {
    enumerable: true,
    get() { getterCalled = true; return 'f13-structural-v1'; }
  });
  Object.defineProperty(accessorBundle, 'contractVersion', {
    enumerable: true,
    value: 1
  });
  assert.throws(() => resolveReadableBundle(accessorBundle), contractError('F13_INCOMPATIBLE_VERSION'));
  assert.equal(getterCalled, false);

  const accessorDigestInput = { ...semanticDigestInput() };
  Object.defineProperty(accessorDigestInput, 'envelope', {
    enumerable: true,
    get() { getterCalled = true; return BASE; }
  });
  assert.throws(() => semanticDigest(accessorDigestInput), contractError());
  assert.equal(getterCalled, false);
});

test('canonical arrays contain only dense canonical indices and length', () => {
  assert.equal(canonicalize([]), '[]');
  assert.equal(canonicalize([0, false, null, '']), '[0,false,null,""]');

  const invalidArrays = [];
  for (const key of ['01', '00', '+1', '-0', '1.0', '1e0', 'foo', '4294967295']) {
    const value = ['kept', 'also-kept'];
    Object.defineProperty(value, key, { configurable: true, enumerable: true, value: 'must-not-be-omitted', writable: true });
    invalidArrays.push(value);
  }
  const symbolProperty = ['kept'];
  symbolProperty[Symbol('hidden')] = 'must-not-be-omitted';
  invalidArrays.push(symbolProperty);

  const nonEnumerableIndex = new Array(1);
  Object.defineProperty(nonEnumerableIndex, '0', { configurable: true, enumerable: false, value: 'hidden', writable: true });
  invalidArrays.push(nonEnumerableIndex);

  const nonEnumerableExtra = ['kept'];
  Object.defineProperty(nonEnumerableExtra, 'hidden', { configurable: true, enumerable: false, value: 'hidden', writable: true });
  invalidArrays.push(nonEnumerableExtra);

  const sparse = new Array(2);
  sparse[1] = 'present';
  invalidArrays.push(sparse);

  let getterCalled = false;
  const accessorIndex = new Array(1);
  Object.defineProperty(accessorIndex, '0', {
    configurable: true,
    enumerable: true,
    get() { getterCalled = true; return 'must-not-run'; }
  });
  invalidArrays.push(accessorIndex);

  for (const value of invalidArrays) assert.throws(() => canonicalize(value), TypeError);
  assert.equal(getterCalled, false);
});

test('semantic and projection digests reject arrays whose own properties would be omitted', () => {
  const invalid = ['visible'];
  Object.defineProperty(invalid, '01', { configurable: true, enumerable: true, value: 'omitted-before-fix', writable: true });
  assert.throws(() => semanticDigest(semanticDigestInput({ ...BASE, value: invalid })), contractError());
  assert.throws(() => projectionDigest(projectionDigestInput({ ...BASE, value: invalid })), contractError());
  assert.doesNotThrow(() => semanticDigest(semanticDigestInput({ ...BASE, value: ['visible'] })));
  assert.doesNotThrow(() => projectionDigest(projectionDigestInput({ ...BASE, value: ['visible'] })));
});

test('digest verification is constant-shape and never reveals content in errors', () => {
  const digest = semanticDigest(semanticDigestInput({ ...BASE, value: 123456 }));
  assert.equal(assertDigest(digest, digest), true);
  assert.throws(() => assertDigest(digest, '0'.repeat(64)), error => {
    assert.equal(error.code, 'F13_DIGEST_MISMATCH');
    assert.equal(error.message.includes('123456'), false);
    assert.equal(error.message.includes(digest), false);
    return true;
  });
  assert.throws(() => projectionDigest({ ...projectionDigestInput(), mode: 'FUTURE' }), contractError());
  assert.throws(() => projectionDigest({ ...projectionDigestInput(), semanticDigest: digest }), contractError());
});

test('structural compatibility is an exact current tuple and rejects N-2, future, missing and cross tuples', () => {
  assert.equal(resolveReadableBundle({ bundleVersion: 'f13-structural-v1', contractVersion: 1 }), CURRENT_BUNDLE);
  assert.equal(assertWritableBundle({ bundleVersion: 'f13-structural-v1', contractVersion: 1 }), CURRENT_BUNDLE);
  for (const input of [
    { bundleVersion: 'f13-structural-v0', contractVersion: 0 },
    { bundleVersion: 'f13-structural-v2', contractVersion: 2 },
    { bundleVersion: 'f13-structural-v1' },
    { bundleVersion: 'f13-structural-v1', contractVersion: 2 },
    { bundleVersion: 'f13-structural-v1', contractVersion: 1, adapter: 'caller' }
  ]) assert.throws(() => resolveReadableBundle(input), contractError('F13_INCOMPATIBLE_VERSION'));
  assert.equal(compatibilityDigest(MANIFEST), MANIFEST_DIGEST);
  assert.equal(Object.isFrozen(MANIFEST.readableBundles[0]), true);
});

test('initial F5 and F7 structural catalogs contain exactly the approved 29+1 operations without implicit grants', () => {
  assert.equal(F13_OPERATION_DEFINITIONS.length, 33);
  assert.equal(new Set(F13_OPERATION_DEFINITIONS.map(item => item.code)).size, 33);
  assert.equal(resolveOperation('F13_PROFILE_READ').permission, 'organization_profile.read');
  assert.equal(resolveOperation('F13_PROFILE_CONFIDENTIALITY_RECLASSIFY').assurance, 'RECENT_MFA');
  assert.equal(resolveOperation('F13_PROFILE_CONFIDENTIALITY_RECLASSIFY').reasonRequired, true);
  assert.equal(resolveOperation('F13_PROFILE_COHORT_ACTIVATE').scopes.includes('UNIT'), false);
  assert.equal(resolveOperation('F13_RESTRICTED_VALUE_READ').purposeRequired, true);
  assert.equal(resolveOperation('F13_UNKNOWN_OPERATION'), null);
  assert.equal(resolveAuditEvent('PROFILE_CONFIDENTIALITY_RECLASSIFIED').eventVersion, 1);
  assert.equal(resolveAuditEvent('PROFILE_ACCESSED', 2), null);
  assert.equal(F13_OPERATION_DEFINITIONS.some(item => item.scopes.includes('UNIT_SUBTREE')), false);
  assert.equal(F13_OPERATION_DEFINITIONS.some(item => /UBI|PROFESSOR|FACULTY/.test(item.code)), false);
  assert.equal(F13_AUDIT_EVENT_DEFINITIONS.some(item => Object.hasOwn(item, 'payload')), false);
});

test('canonical clone is immutable and cannot be changed after validation', () => {
  const value = canonicalClone({ nested: { list: [1, 2] } });
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.nested), true);
  assert.equal(Object.isFrozen(value.nested.list), true);
  assert.throws(() => value.nested.list.push(3), TypeError);
});
