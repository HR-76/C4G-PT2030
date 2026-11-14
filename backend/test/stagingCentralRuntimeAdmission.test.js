'use strict';

// Context: context/features/staging-central-runtime-login.md. The admission stays exact, staging-only and invisible to production.
const test = require('node:test');
const assert = require('node:assert/strict');
const admission = require('../src/security/stagingCentralRuntimeAdmission');
const memberEmail = require('../src/security/memberEmailAdmission');

const ON = { C4G_STAGING_CENTRAL_RUNTIME_LOGINS: 'admitted-v1' };
const SCHEMA = admission.fingerprints.schema;
const AUTHORITY = admission.fingerprints.authority;

test('admits exactly the pinned 052 staging variant when the staging flag is set', () => {
  assert.equal(admission.version, '052_central_runtime_read');
  assert.equal(admission.admits(admission.version, 'schema', SCHEMA, ON), true);
  assert.equal(admission.admits(admission.version, 'authority', AUTHORITY, ON), true);
});

test('production (no flag, or another value) admits nothing', () => {
  assert.equal(admission.admits(admission.version, 'schema', SCHEMA, {}), false);
  assert.equal(admission.admits(admission.version, 'authority', AUTHORITY, { C4G_STAGING_CENTRAL_RUNTIME_LOGINS: 'true' }), false);
});

test('any other version, kind or fingerprint still drifts', () => {
  assert.equal(admission.admits('051_email_templates', 'schema', SCHEMA, ON), false);
  assert.equal(admission.admits(admission.version, 'schema', AUTHORITY, ON), false);
  assert.equal(admission.admits(admission.version, 'catalog', SCHEMA, ON), false);
  assert.equal(admission.admits(admission.version, 'schema', 'f'.repeat(64), ON), false);
});

test('the admission does not widen the existing member-email admissions', () => {
  assert.equal(memberEmail.admits(admission.version, 'schema', SCHEMA), false);
});
