'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const release = require('../src/organizationalProfile/editorialRelease');
const { digest } = require('../src/organizationalProfile/editorialMaterial');
function fixture(change = () => {}) {
  const r = release, state = structuredClone({
    policy: [{ completion_policy_id: r.IDS.policy, policy_version: r.policyRef.version, profile_schema_version: '1.0.0',
      scope_type: 'ORGANIZATION', domain_code: 'EDITORIAL_BASELINE', policy_digest: r.policyRef.digest }],
    slots: r.slots, rules: r.rules,
    bundles: [{ bundle_id: r.IDS.bundle, bundle_version: r.VERSION, profile_schema_version: '1.0.0', snapshot_schema_version: r.tuple.wireSchema,
      tuple_definition: r.tuple, bundle_digest: r.bundleRef.digest, manifest_id: r.IDS.manifest,
      manifest_version: r.VERSION, manifest_digest: r.manifestRef.digest }],
    members: [r.bundleRef], projections: [{ projection_policy_id: r.IDS.projection, policy_digest: digest(r.projection), projection_mode: 'EXACT', classification: 'INTERNAL' }],
    reason: [{ catalog_digest: digest(r.reasons) }], reasons: r.reasons.entries,
    purpose: [{ catalog_digest: digest(r.purposes) }], purposes: r.purposes.entries });
  change(state);
  return { async query(sql) {
    let key;
    if (sql.includes('completion_policy WHERE')) key = 'policy';
    else if (sql.includes('completion_slot')) key = 'slots';
    else if (sql.includes('completion_rule')) key = 'rules';
    else if (sql.includes('JOIN organization_profile.compatibility_manifest')) key = 'bundles';
    else if (sql.includes('release_bundle WHERE')) key = 'members';
    else if (sql.includes('projection_policy')) key = 'projections';
    else if (sql.includes('reason_catalog_release')) key = 'reason';
    else if (sql.includes('reason_catalog_entry')) key = 'reasons';
    else if (sql.includes('purpose_catalog_release')) key = 'purpose';
    else if (sql.includes('purpose_catalog_entry')) key = 'purposes';
    else throw new Error('Unexpected resolver query');
    return { rows: structuredClone(state[key]) };
  } };
}
test('editorial resolver selects exactly the installed supported tuple', async () => {
  assert.deepEqual(await release.resolveEditorialRelease(fixture()), { schemaRef: release.tuple.schema,
    policyRef: release.policyRef, bundleRef: release.bundleRef, manifestRef: release.manifestRef });
});
for (const [name, change] of [
  ['missing policy', s => { s.policy = []; }],
  ['ambiguous policy', s => { s.policy.push(s.policy[0]); }],
  ['unsupported fixture policy', s => { s.policy[0].policy_version = 'TEST_ONLY_POLICY'; }],
  ['modified slots', s => { s.slots[1].allowed_knowledge_states.push('UNKNOWN'); }],
  ['modified rules', s => { s.rules[0].operands.maximumItems = 101; }],
  ['crossed bundle', s => { s.bundles[0].tuple_definition.completion.digest = '0'.repeat(64); }],
  ['ambiguous bundle', s => { s.bundles.push(s.bundles[0]); }],
  ['manifest extra member', s => { s.members.push(s.members[0]); }],
  ['classification drift', s => { s.projections[0].classification = 'PUBLIC'; }],
  ['missing reason catalog', s => { s.reason = []; }],
  ['purpose drift', s => { s.purposes[0].operation_code = 'F14_MATCH'; }]
]) test(`editorial resolver fails closed: ${name}`, async () => {
  await assert.rejects(() => release.resolveEditorialRelease(fixture(change)), { code: 'F13_POLICY_UNAVAILABLE' });
});
test('resolver never caches a different tenant result or falls back after refusal', async () => {
  const a = fixture(), b = fixture(s => { s.policy = []; });
  await release.resolveEditorialRelease(a);
  await assert.rejects(() => release.resolveEditorialRelease(b), { code: 'F13_POLICY_UNAVAILABLE' });
  await release.resolveEditorialRelease(a);
});
