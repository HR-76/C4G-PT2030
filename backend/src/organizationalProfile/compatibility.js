'use strict';

const { canonicalClone } = require('./canonicalization');
const { CONTRACT_VERSION } = require('./constants');
const { compatibilityDigest } = require('./digests');
const { OrganizationalProfileContractError } = require('./errors');

const CURRENT_BUNDLE = canonicalClone({
  auditEventCodeCatalogVersion: 'f13-audit-event-codes-v1',
  authorizationCatalogVersion: 'f13-authorization-definitions-v1',
  bundleVersion: 'f13-structural-v1',
  canonicalizationVersion: 'f13-canonical-json-v1',
  contractVersion: CONTRACT_VERSION,
  digestContractVersion: 'f13-digests-v1',
  vocabularyCatalogVersion: 'f13-structural-vocabulary-v1'
});

const MANIFEST = canonicalClone({
  manifestVersion: 'f13-compatibility-manifest-v1',
  currentBundleVersion: CURRENT_BUNDLE.bundleVersion,
  readableBundles: [CURRENT_BUNDLE],
  writableBundleVersion: CURRENT_BUNDLE.bundleVersion
});
const MANIFEST_DIGEST = compatibilityDigest(MANIFEST);

function resolveReadableBundle(input) {
  let reference;
  try {
    reference = canonicalClone(input);
  } catch {
    throw new OrganizationalProfileContractError('F13_INCOMPATIBLE_VERSION');
  }
  if (!exact(reference, ['bundleVersion', 'contractVersion'])
      || reference.bundleVersion !== CURRENT_BUNDLE.bundleVersion
      || reference.contractVersion !== CONTRACT_VERSION) {
    throw new OrganizationalProfileContractError('F13_INCOMPATIBLE_VERSION');
  }
  return CURRENT_BUNDLE;
}

function assertWritableBundle(input) {
  const bundle = resolveReadableBundle(input);
  if (bundle.bundleVersion !== MANIFEST.writableBundleVersion) {
    throw new OrganizationalProfileContractError('F13_INCOMPATIBLE_VERSION');
  }
  return bundle;
}

function exact(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

module.exports = { CURRENT_BUNDLE, MANIFEST, MANIFEST_DIGEST, assertWritableBundle, resolveReadableBundle };
