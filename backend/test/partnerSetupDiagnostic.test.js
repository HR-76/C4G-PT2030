'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { safeEvidence } = require('../../test/integration/partner-portal/gate');
const { tenantMigrationFailure } = require('../src/security/tenantMigrationErrors');

// Compile the real setup locally, replacing only infrastructure dependencies.
function fixture(primary, cleanupFailure = false, failAt = 'central') {
  const filename = path.resolve(__dirname, '../../test/integration/partner-portal/environment.js');
  const instance = new Module(filename, module), local = Module.createRequire(filename);
  const updates = []; let closes = 0;
  instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
  instance.require = name => name === '../../../backend/node_modules/pg' ? { Pool: class {
    async query() { return { rows: [] }; }
    async end() { closes++; if (cleanupFailure) throw new Error('CLEANUP_CANARY'); }
  } } : name === '../f13/central-authority-fixture' ? { async centralAuthorityFixture() {
    if (failAt === 'central') throw primary;
    return { pool: {}, async user() { return { id: 'ID_CANARY', membershipId: 'MEMBERSHIP_CANARY', request: {} }; },
      data: { async change() {} }, async close() {} };
  } } : name === '../../../backend/src/platformOnboarding/postgresProvisioner' ? {
    createPostgresProvisioner() { return { async ensure() { throw primary; } }; }
  } : name === './provisioningDiagnostic' ? {
    createObservedProvisioner(_options, observe) { return { async ensure() {
      observe({ substep: 'MIGRATION', substepStatus: 'FAILED', substepFailure: { classification: 'TENANT_MIGRATION', errorCode: 'TENANT_LEDGER_MISMATCH' } });
      throw primary;
    } }; }
  } : local(name);
  instance._compile(fs.readFileSync(filename, 'utf8'), filename);
  return { run: () => instance.exports.createEnvironment({
    adminUrl: 'postgresql://partner_gate_admin:SYNTHETIC_CANARY@127.0.0.1:55591/postgres',
    runId: 'a'.repeat(32), onSetupDiagnostic: value => updates.push(value)
  }), updates, closes: () => closes };
}

test('setup failure preserves primary error and reports safe phase and SQLSTATE classification', async () => {
  const primary = Object.assign(new Error('MESSAGE_CANARY'), { code: '42501', detail: 'DETAIL_CANARY', query: 'SQL_CANARY' });
  const env = fixture(primary);
  await assert.rejects(env.run(), error => error === primary);
  assert.equal(env.closes(), 1);
  const diagnostic = env.updates.at(-1);
  assert.equal(diagnostic?.phase, 'CENTRAL_FIXTURE');
  assert.equal(diagnostic.status, 'FAILED');
  assert.equal(diagnostic.classification, 'POSTGRESQL');
  assert.equal(diagnostic.errorCode, '42501');
  assert.equal(diagnostic.localCleanup, 'COMPLETED');
  assert.equal(diagnostic.tenant, null);
  assert.doesNotMatch(JSON.stringify(safeEvidence(env.updates)), /CANARY|postgresql:|stack|detail|query/i);
  assert.equal(env.updates.find(row => row.phase === 'CENTRAL_FIXTURE').status, 'RUNNING');
});

test('secondary cleanup failure never replaces setup failure or claims cleanup success', async () => {
  const primary = new TypeError('PRIVATE_CANARY'), env = fixture(primary, true);
  await assert.rejects(env.run(), error => error === primary);
  assert.equal(env.updates.at(-1)?.localCleanup, 'FAILED');
  assert.equal(env.updates.at(-1).classification, 'TYPE_ERROR');
  assert.doesNotMatch(JSON.stringify(env.updates), /CANARY/);
});

test('unknown codes and error names are not copied to diagnostics', async () => {
  const primary = Object.assign(new Error('PRIVATE_CANARY'), { name: 'NAME_CANARY', code: 'TOKEN_CANARY' });
  const env = fixture(primary);
  await assert.rejects(env.run(), error => error === primary);
  assert.equal(env.updates.at(-1)?.classification, 'UNKNOWN');
  assert.equal(env.updates.at(-1).errorCode, null);
  assert.doesNotMatch(JSON.stringify(env.updates), /CANARY/);
});

test('invalid target is classified before constructing any pool without exposing the target', async () => {
  const { createEnvironment } = require('../../test/integration/partner-portal/environment');
  const updates = [];
  await assert.rejects(createEnvironment({ adminUrl: 'PRIVATE_CANARY', runId: 'a'.repeat(32), onSetupDiagnostic: row => updates.push(row) }));
  assert.equal(updates.at(-1)?.phase, 'TARGET_VALIDATION');
  assert.equal(updates.at(-1).status, 'FAILED');
  assert.doesNotMatch(JSON.stringify(updates), /CANARY/);
});

test('later tenant setup failure identifies phase and synthetic label without resource identifiers', async () => {
  const primary = Object.assign(new Error('PRIVATE_CANARY'), { code: 'MODULE_NOT_FOUND' });
  const env = fixture(primary, false, 'ensure');
  await assert.rejects(env.run(), error => error === primary);
  assert.equal(env.updates.at(-1).phase, 'TENANT_ENSURE');
  assert.equal(env.updates.at(-1).tenant, 'A');
  assert.equal(env.updates.at(-1).classification, 'DEPENDENCY');
  assert.equal(env.closes(), 1);
  assert.doesNotMatch(JSON.stringify(env.updates), /CANARY/);
});

test('runner keeps setup classification but never copies an arbitrary primary error code', () => {
  const { recordExecutionError } = require('../../test/integration/partner-portal/gate');
  const report = { setupDiagnostic: { status: 'FAILED', phase: 'CENTRAL_FIXTURE', classification: 'UNKNOWN', errorCode: null } };
  recordExecutionError(report, { code: 'TOKEN_CANARY', message: 'PRIVATE_CANARY' });
  assert.equal(report.errorCode, 'ENVIRONMENT_SETUP_FAILED');
  assert.doesNotMatch(JSON.stringify(safeEvidence(report)), /CANARY/);
  const timeout = { setupDiagnostic: { status: 'RUNNING', phase: 'CENTRAL_FIXTURE' } };
  recordExecutionError(timeout, { code: 'ENVIRONMENT_SETUP_TIMEOUT' });
  assert.equal(timeout.errorCode, 'ENVIRONMENT_SETUP_TIMEOUT');
  assert.equal(timeout.setupDiagnostic.status, 'RUNNING');
});

test('setup deadline remains visible when local cleanup is still running after a primary failure', () => {
  const { recordExecutionError } = require('../../test/integration/partner-portal/gate');
  const report = { setupDiagnostic: { status: 'FAILED', phase: 'CENTRAL_FIXTURE', localCleanup: 'RUNNING', classification: 'POSTGRESQL', errorCode: '42501' } };
  recordExecutionError(report, { code: 'ENVIRONMENT_SETUP_TIMEOUT' });
  assert.equal(report.errorCode, 'ENVIRONMENT_SETUP_TIMEOUT');
  assert.equal(report.setupDiagnostic.errorCode, '42501');
  assert.equal(report.setupDiagnostic.localCleanup, 'RUNNING');
});

test('environment retains branded migration classification and safe ensure substep through local cleanup', async () => {
  const primary = tenantMigrationFailure('TENANT_LEDGER_MISMATCH'), f = fixture(primary, false, 'ensure');
  await assert.rejects(f.run(), error => error === primary);
  const diagnostic = f.updates.at(-1);
  assert.equal(diagnostic.classification, 'TENANT_MIGRATION');
  assert.equal(diagnostic.errorCode, 'TENANT_LEDGER_MISMATCH');
  assert.equal(diagnostic.substep, 'MIGRATION');
  assert.equal(diagnostic.substepStatus, 'FAILED');
  assert.equal(diagnostic.localCleanup, 'COMPLETED');
  assert.doesNotMatch(JSON.stringify(safeEvidence(f.updates)), /CANARY/);
});
