'use strict';

const { SCHEMA, EXTRACTOR, POLICY, COVERAGE, digest } = require('./editorialMaterial');
const { canonicalClone, canonicalize } = require('./canonicalization');
const { OrganizationalProfileContractError } = require('./errors');

// Technical release, installed by the owner migration. No institutional data,
// request-selected policy or runtime policy administration is supported.
const IDS = Object.freeze({ policy: '01600000-0000-4000-8000-000000000001',
  manifest: '01600000-0000-4000-8000-000000000002', bundle: '01600000-0000-4000-8000-000000000003',
  projection: '01600000-0000-4000-8000-000000000004' });
const VERSION = 'f13-editorial-v1';
const slots = canonicalClone([
  { slot_code: 'STRATEGIC_PRIORITIES', allowed_knowledge_states: ['KNOWN', 'UNKNOWN'],
    verification_requirement: 'UNVERIFIED_ALLOWED', reason_codes: ['UNKNOWN_EXPLICIT'] },
  { slot_code: 'THEMATIC_AREAS', allowed_knowledge_states: ['KNOWN'],
    verification_requirement: 'UNVERIFIED_ALLOWED', reason_codes: [] }
]);
const rules = canonicalClone([
  { rule_code: 'MAXIMUM_ITEMS', rule_kind: 'FORBID_COMBINATION', operands: { maximumItems: 100 } },
  { rule_code: 'PRIORITIES_REQUIRED', rule_kind: 'REQUIRE_SLOT', operands: { slot: 'STRATEGIC_PRIORITIES', minimum: 1, unknownExclusive: true } },
  { rule_code: 'THEMES_REQUIRED', rule_kind: 'REQUIRE_SLOT', operands: { slot: 'THEMATIC_AREAS', minimum: 1 } }
]);
const policy = canonicalClone({ policy_version: POLICY, profile_schema_version: SCHEMA.version,
  scope_type: 'ORGANIZATION', domain_code: 'EDITORIAL_BASELINE', slots, rules });
const policyRef = canonicalClone({ id: IDS.policy, version: POLICY, digest: digest(policy) });
const projection = canonicalClone({ version: VERSION, operation: 'F13_PROFILE_READ', purpose: 'EDITORIAL_BASELINE',
  classification: 'INTERNAL', mode: 'EXACT', schema: SCHEMA });
const reasons = canonicalClone({ version: VERSION, entries: ['DUPLICATE_CONCEPT','INVALID_CARDINALITY','KNOWN_REQUIRED',
  'NON_CURRENT_MATERIAL','REFERENCE_INCOMPATIBLE','REQUIRED_SLOT_MISSING','STATE_NOT_ALLOWED','UNKNOWN_EXPLICIT']
  .map(reason_code => ({ reason_code, operation_code: 'F13_PROFILE_SUBMIT', lifecycle: 'PUBLISHED' })) });
const purposes = canonicalClone({ version: VERSION, entries: [{ purpose_code: 'EDITORIAL_BASELINE', operation_code: 'F13_PROFILE_READ', lifecycle: 'PUBLISHED' }] });
const tuple = canonicalClone({ schema: SCHEMA, extractor: EXTRACTOR, wireSchema: 'F13_EDITORIAL_VERSION_V1',
  completion: policyRef, projection: { id: IDS.projection, version: VERSION, digest: digest(projection) },
  coverage: COVERAGE, taxonomy: 'F13_PINNED_THEMATIC_REFERENCES_V1',
  operationCatalog: 'f13-taxonomy-operations-v1', permissionCatalog: 'f13-taxonomy-permissions-v1',
  eventSchema: 'f13-editorial-events-v1', reasonCatalog: { version: VERSION, digest: digest(reasons) }, purposeCatalog: { version: VERSION, digest: digest(purposes) },
  jobs: [], adapters: [], consumer: { contract: 'F13_EDITORIAL_READ_V1', f14Consumable: false } });
const bundleRef = canonicalClone({ id: IDS.bundle, version: VERSION, digest: digest(tuple) });
const manifest = canonicalClone({ version: VERSION, bundles: [bundleRef] });
const manifestRef = canonicalClone({ id: IDS.manifest, version: VERSION, digest: digest(manifest) });
function unavailable() { throw new OrganizationalProfileContractError('F13_POLICY_UNAVAILABLE'); }

async function resolveEditorialRelease(client) {
  const policies = (await client.query(`SELECT completion_policy_id,policy_version,profile_schema_version,scope_type,domain_code,policy_digest
    FROM organization_profile.completion_policy WHERE lifecycle='PUBLISHED'
    AND profile_schema_version=$1 AND scope_type='ORGANIZATION' AND domain_code='EDITORIAL_BASELINE'`, [SCHEMA.version])).rows;
  if (policies.length !== 1) unavailable();
  const row = policies[0];
  if (row.completion_policy_id !== IDS.policy || row.policy_version !== POLICY || row.policy_digest !== policyRef.digest) unavailable();
  const actualSlots = (await client.query(`SELECT slot_code,allowed_knowledge_states,verification_requirement,reason_codes
    FROM organization_profile.completion_slot WHERE completion_policy_id=$1 ORDER BY slot_code COLLATE "C"`, [IDS.policy])).rows;
  const actualRules = (await client.query(`SELECT rule_code,rule_kind,operands
    FROM organization_profile.completion_rule WHERE completion_policy_id=$1 ORDER BY rule_code COLLATE "C"`, [IDS.policy])).rows;
  if (digest({ policy_version: row.policy_version, profile_schema_version: row.profile_schema_version,
    scope_type: row.scope_type, domain_code: row.domain_code, slots: actualSlots, rules: actualRules }) !== policyRef.digest) unavailable();
  const bundles = (await client.query(`SELECT b.bundle_id,b.bundle_version,b.profile_schema_version,b.snapshot_schema_version,
    b.tuple_definition,b.bundle_digest,m.manifest_id,m.manifest_version,m.manifest_digest
    FROM organization_profile.release_bundle b JOIN organization_profile.compatibility_manifest m USING(manifest_id)
    WHERE m.lifecycle='PUBLISHED' AND b.profile_schema_version=$1 AND b.snapshot_schema_version=$2`,
  [SCHEMA.version, tuple.wireSchema])).rows;
  if (bundles.length !== 1) unavailable();
  const bundle = bundles[0];
  if (bundle.bundle_id !== IDS.bundle || bundle.bundle_version !== VERSION || bundle.bundle_digest !== bundleRef.digest
    || digest(bundle.tuple_definition) !== bundleRef.digest || canonicalize(bundle.tuple_definition) !== canonicalize(tuple)
    || bundle.manifest_id !== IDS.manifest || bundle.manifest_version !== VERSION || bundle.manifest_digest !== manifestRef.digest) unavailable();
  const members = (await client.query(`SELECT bundle_id AS id,bundle_version AS version,bundle_digest AS digest
    FROM organization_profile.release_bundle WHERE manifest_id=$1 ORDER BY bundle_id`, [IDS.manifest])).rows;
  if (digest({ version: VERSION, bundles: members }) !== manifestRef.digest) unavailable();
  const projections = (await client.query(`SELECT projection_policy_id,policy_digest,projection_mode,classification
    FROM organization_profile.projection_policy WHERE policy_version=$1 AND operation_code='F13_PROFILE_READ'
    AND purpose_code='EDITORIAL_BASELINE' AND lifecycle='PUBLISHED'`, [VERSION])).rows;
  if (projections.length !== 1 || projections[0].projection_policy_id !== IDS.projection
    || projections[0].policy_digest !== digest(projection) || projections[0].projection_mode !== 'EXACT'
    || projections[0].classification !== 'INTERNAL') unavailable();
  for (const [kind, definition] of [['reason', reasons], ['purpose', purposes]]) {
    const release = (await client.query(`SELECT catalog_digest FROM organization_profile.${kind}_catalog_release
      WHERE catalog_version=$1 AND lifecycle='PUBLISHED'`, [VERSION])).rows;
    const entries = (await client.query(`SELECT ${kind}_code,operation_code,lifecycle FROM organization_profile.${kind}_catalog_entry
      WHERE catalog_version=$1 ORDER BY ${kind}_code COLLATE "C",operation_code COLLATE "C"`, [VERSION])).rows;
    if (release.length !== 1 || release[0].catalog_digest !== digest(definition)
      || digest({ version: VERSION, entries }) !== digest(definition)) unavailable();
  }
  return Object.freeze({ schemaRef: SCHEMA, policyRef, bundleRef, manifestRef });
}

module.exports = { IDS, VERSION, slots, rules, policy, policyRef, projection, reasons, purposes, tuple, bundleRef, manifest, manifestRef, resolveEditorialRelease };
