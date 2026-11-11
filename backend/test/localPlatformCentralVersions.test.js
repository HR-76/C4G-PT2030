'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { supportsCentralVersion } = require('../scripts/localPlatform/centralVersions');

test('local capabilities remain available after the platform billing migration', () => {
  assert.equal(supportsCentralVersion('027_platform_billing', '017_funding_programmes'), true);
  assert.equal(supportsCentralVersion('027_platform_billing', '021_platform_members'), true);
  assert.equal(supportsCentralVersion('027_platform_billing', '024_organization_registration'), true);
  assert.equal(supportsCentralVersion('027_platform_billing', '025_entity_admission_completion'), true);
  assert.equal(supportsCentralVersion('027_platform_billing', '026_platform_logs'), true);
});

test('local capability checks fail closed for unknown and earlier versions', () => {
  assert.equal(supportsCentralVersion('025_entity_admission_completion', '026_platform_logs'), false);
  assert.equal(supportsCentralVersion('unknown', '026_platform_logs'), false);
  assert.equal(supportsCentralVersion('027_platform_billing', 'unknown'), false);
});
