'use strict';
const { SCHEMA, EXTRACTOR, POLICY, COVERAGE, digest } = require('./pq1Material');
const { canonicalClone, canonicalize } = require('./canonicalization');
const { OrganizationalProfileContractError } = require('./errors');
const VERSION = 'F13_PQ1_PUBLISH_BUNDLE_V1';
const policy = canonicalClone({ version: POLICY, slots: [
  { domain: 'THEMATIC_AREA', knowledge: ['KNOWN'], minimum: 1 },
  { domain: 'STRATEGIC_PRIORITY', knowledge: ['KNOWN', 'UNKNOWN'], minimum: 1, unknownExclusive: true },
  { domain: 'COMPETENCY', knowledge: ['KNOWN', 'UNKNOWN'], minimum: 1, unknownExclusive: true }
], currentVerificationRequired: false, historicalVerificationAllowed: ['EXPIRED', 'REVOKED'], maximumPerCollection: 100 });
const policyRef = Object.freeze({ id: '01800000-0000-4000-8000-000000000001', version: POLICY, digest: digest(policy) });
const definition = canonicalClone({ schema: SCHEMA, extractor: EXTRACTOR, wireSchema: 'F13_PQ1_PUBLICATION_V1',
  policy, coverage: COVERAGE, verificationDescriptor: 'F13_PQ1_VERIFICATION_DESCRIPTOR_V1',
  projection: 'F13_PQ1_PUBLICATION_READ_V1', purpose: 'PQ1_PUBLICATION',
  reasons: ['EVIDENCE_WITHDRAWN', 'VERIFICATION_ERROR'],
  identity: 'EXACT_CONCEPT_AND_RELEASE_IDS', consumer: 'F13_PQ1_PUBLICATION_READ_V1', f14Consumable: false });
const bundleRef = Object.freeze({ id: '01800000-0000-4000-8000-000000000003', version: VERSION, digest: digest(definition) });
const manifestRef = Object.freeze({ id: '01800000-0000-4000-8000-000000000002', version: VERSION, digest: digest({ bundles: [bundleRef] }) });
async function resolvePq1Release(client) {
  const rows = (await client.query('SELECT definition,definition_digest FROM organization_profile.pq1_release WHERE bundle_id=$1', [bundleRef.id])).rows;
  if (rows.length !== 1 || rows[0].definition_digest !== bundleRef.digest || canonicalize(rows[0].definition) !== canonicalize(definition))
    throw new OrganizationalProfileContractError('F13_POLICY_UNAVAILABLE');
  return { schemaRef: SCHEMA, policyRef, bundleRef, manifestRef };
}
module.exports = { VERSION, definition, policyRef, bundleRef, manifestRef, resolvePq1Release };
