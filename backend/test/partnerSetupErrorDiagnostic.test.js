'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifySetupError } = require('../../test/integration/partner-portal/setupErrorDiagnostic');
const { tenantMigrationFailure, aggregateTenantMigrationFailures } = require('../src/security/tenantMigrationErrors');

test('branded migration failures expose only permitted non-enumerable internal codes', () => {
  const error = tenantMigrationFailure('DATABASE_CONFIGURATION_MISMATCH');
  error.message = 'MESSAGE_CANARY'; error.detail = 'DETAIL_CANARY';
  assert.equal(Object.keys(error).includes('internalCode'), false);
  assert.deepEqual(classifySetupError(error), { classification: 'TENANT_MIGRATION', errorCode: 'DATABASE_CONFIGURATION_MISMATCH' });
  assert.deepEqual(classifySetupError({ name: 'TenantMigrationError', internalCode: 'DATABASE_CONFIGURATION_MISMATCH' }),
    { classification: 'UNKNOWN', errorCode: null });
  assert.deepEqual(classifySetupError(tenantMigrationFailure('TOKEN_CANARY')), { classification: 'TENANT_MIGRATION', errorCode: null });
});

test('migration aggregates retain primary then cleanup classifications without payloads', () => {
  const primary = tenantMigrationFailure('TENANT_MIGRATION_DATABASE_CONTRACT_FAILED');
  const cleanup = tenantMigrationFailure('TENANT_MIGRATION_ROLLBACK_FAILED');
  const result = classifySetupError(aggregateTenantMigrationFailures(primary, [cleanup]));
  assert.deepEqual(result, { classification: 'TENANT_MIGRATION_AGGREGATE', errorCode: null,
    causes: [classifySetupError(primary), classifySetupError(cleanup)], causesTruncated: false });
  assert.deepEqual(classifySetupError(new AggregateError([primary], 'MESSAGE_CANARY')), { classification: 'UNKNOWN', errorCode: null });
});

test('migration aggregate traversal is bounded for cycles, width and depth', () => {
  const leaf = tenantMigrationFailure('LOCK_CONFLICT');
  const cycle = aggregateTenantMigrationFailures(leaf, []); cycle.errors.push(cycle);
  const cyclic = classifySetupError(cycle);
  assert.equal(cyclic.causesTruncated, true); assert.equal(cyclic.causes.length, 1);
  const wide = classifySetupError(aggregateTenantMigrationFailures(leaf, Array(30).fill(leaf)));
  assert.equal(wide.causesTruncated, true); assert.equal(wide.causes.length, 8);
  let deep = leaf;
  for (let index = 0; index < 10; index++) deep = aggregateTenantMigrationFailures(deep, []);
  assert.match(JSON.stringify(classifySetupError(deep)), /"causesTruncated":true/);
  assert.ok(JSON.stringify(classifySetupError(deep)).length < 1000);
});

test('known provisioning and directory codes are classified without copying other error fields', () => {
  for (const [code, classification] of [
    ['ONBOARDING_INPUT_INVALID', 'PROVISIONING'], ['PROVISIONING_OWNERSHIP_CONFLICT', 'PROVISIONING'],
    ['PROVISIONING_DIRECTORY_MISMATCH', 'PROVISIONING'], ['TRANSITION_CONFLICT', 'TENANT_DIRECTORY'],
    ['COMMITTED_CLEANUP_FAILED', 'TENANT_DIRECTORY']
  ]) assert.deepEqual(classifySetupError(Object.assign(new Error('MESSAGE_CANARY'), { code, detail: 'DETAIL_CANARY' })), { classification, errorCode: code });
  assert.deepEqual(classifySetupError({ code: 'PROVISIONING_TOKEN_CANARY' }), { classification: 'UNKNOWN', errorCode: null });
});

test('legacy fixed identity and workload messages are lookup keys, never free text output', () => {
  for (const [message, classification] of [
    ['LOCAL_IDENTITY_ATTRIBUTE_DRIFT', 'LOCAL_IDENTITY'], ['CROSS_WORKLOAD_MEMBERSHIP', 'LOCAL_IDENTITY'],
    ['F44_CANDIDATE_CONFLICT', 'WORKLOAD_DIRECTORY'], ['F44_PUBLISH_CONFLICT', 'WORKLOAD_DIRECTORY']
  ]) assert.deepEqual(classifySetupError(new Error(message)), { classification, errorCode: message });
  for (const value of [new Error('LOCAL_IDENTITY_ATTRIBUTE_DRIFT TOKEN_CANARY'), { message: 'F44_PUBLISH_CONFLICT' }]) {
    assert.deepEqual(classifySetupError(value), { classification: 'UNKNOWN', errorCode: null });
  }
});

test('getters and proxies are never invoked while classifying diagnostics', () => {
  let called = 0;
  const dangerous = {};
  for (const key of ['code', 'internalCode', 'message', 'name', 'errors']) Object.defineProperty(dangerous, key, { get() { called++; throw new Error('CANARY'); } });
  assert.deepEqual(classifySetupError(dangerous), { classification: 'UNKNOWN', errorCode: null });
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { called++; throw new Error('CANARY'); }, getPrototypeOf() { called++; throw new Error('CANARY'); } });
  assert.deepEqual(classifySetupError(proxy), { classification: 'UNKNOWN', errorCode: null });
  const aggregate = aggregateTenantMigrationFailures(tenantMigrationFailure('LOCK_CONFLICT'), []);
  Object.defineProperty(aggregate, 'errors', { get() { called++; throw new Error('CANARY'); } });
  assert.equal(classifySetupError(aggregate).causesTruncated, true);
  assert.equal(called, 0);
});

test('existing SQLSTATE, network, dependency, assertion and error type classifications remain stable', () => {
  for (const [code, classification] of [['42501','POSTGRESQL'],['ECONNRESET','CONNECTION'],['MODULE_NOT_FOUND','DEPENDENCY'],['ERR_ASSERTION','ASSERTION']]) {
    assert.deepEqual(classifySetupError({ code }), { classification, errorCode: code });
  }
  assert.deepEqual(classifySetupError(new TypeError('CANARY')), { classification: 'TYPE_ERROR', errorCode: null });
  assert.deepEqual(classifySetupError(new RangeError('CANARY')), { classification: 'RANGE_ERROR', errorCode: null });
  assert.deepEqual(classifySetupError(null), { classification: 'UNKNOWN', errorCode: null });
  assert.deepEqual(classifySetupError({ code: 'TOKEN_CANARY' }), { classification: 'UNKNOWN', errorCode: null });
});
