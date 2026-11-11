'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BILLING_TABLES, PREVIOUS_VERSION, TARGET_VERSION, assertExistingDataPreserved,
  assertRolloutTarget, main, normalizeTenantRestoreAcl
} = require('../scripts/localPlatform/platformBillingRollout');

const config = { host: 'localhost', port: 5432, user: 'postgres', password: 'synthetic',
  centralDatabase: 'c4g_central_dev', tenantDatabase: 'c4g_tenant_dev' };
const state = { phase: 'READY', tenantId: '10000000-0000-4000-8000-000000000001',
  generationId: '20000000-0000-4000-8000-000000000001',
  target: { host: 'localhost', port: 5432, centralDatabase: 'c4g_central_dev',
    tenantDatabase: 'c4g_tenant_dev' } };

test('billing rollout is pinned to the habitual local target and exact migration boundary', () => {
  assert.doesNotThrow(() => assertRolloutTarget(config, state));
  assert.equal(PREVIOUS_VERSION, '026_platform_logs');
  assert.equal(TARGET_VERSION, '027_platform_billing');
  assert.equal(BILLING_TABLES.length, 9);
  assert.throws(() => assertRolloutTarget({ ...config, host: 'db.example.com' }, state));
  assert.throws(() => assertRolloutTarget(config, { ...state, phase: 'INSTALLING' }));
});

test('billing rollout mode is closed and never defaults to applying the migration', async () => {
  await assert.rejects(() => main([]));
  await assert.rejects(() => main(['--unknown']));
  await assert.rejects(() => main(['--apply', '--force']));
});

test('post-upgrade preservation check rejects schema or existing-row drift', () => {
  const before = { schemas: ['public'], data: { '"public"."organization"': { count: 1, digest: 'a' } } };
  assert.doesNotThrow(() => assertExistingDataPreserved(before, structuredClone(before)));
  assert.throws(() => assertExistingDataPreserved(before, { ...before, schemas: ['public', 'other'] }));
  assert.throws(() => assertExistingDataPreserved(before, { schemas: ['public'],
    data: { '"public"."organization"': { count: 2, digest: 'b' } } }));
});

test('rollout apply source can safely resume after migration commit and before evidence persistence', () => {
  const source = require('node:fs').readFileSync(require('node:path').resolve(__dirname,
    '../scripts/localPlatform/platformBillingRollout.js'), 'utf8');
  assert.match(source, /\[PREVIOUS_VERSION, TARGET_VERSION\]\.includes\(current\.currentVersion\)/);
  assert.match(source, /current\.currentVersion === PREVIOUS_VERSION \? \[TARGET_VERSION\] : \[\]/);
});

test('tenant restore only normalizes missing explicit owner ACL entries from the captured contract', async () => {
  const rows = [
    { object_name: 'band_policy', grantee: 'c4g_organization_profile_owner',
      privilege_type: 'SELECT', is_grantable: false },
    { object_name: 'band_policy', grantee: 'c4g_organization_profile_owner',
      privilege_type: 'MAINTAIN', is_grantable: false }
  ];
  const calls = [];
  const restored = { async query(sql) { calls.push(sql); } };
  const expected = { organizationProfileSecurity: { authoringAcl: rows } };
  const observed = { organizationProfileSecurity: { authoringAcl: [] } };
  assert.equal(await normalizeTenantRestoreAcl(restored, expected, observed), 2);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /GRANT MAINTAIN,SELECT ON TABLE/);
  assert.match(calls[0], /"organization_profile"\."band_policy"/);

  const unsafe = { organizationProfileSecurity: { authoringAcl: [
    { ...rows[0], grantee: 'unexpected_role' }
  ] } };
  assert.equal(await normalizeTenantRestoreAcl(restored, unsafe, observed), 0);
  assert.equal(calls.length, 1);
});
