'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const preflight = require('../src/security/tenantMigrationPreflight');
const { tenantMigrationFailure } = require('../src/security/tenantMigrationErrors');
const { safeEvidence } = require('../../test/integration/partner-portal/gate');

test('outer tenant preflight uses the existing 15s statement budget and releases resources after a real preflight refusal', async () => {
  const filename = path.resolve(__dirname, '../../test/integration/partner-portal/environment.js');
  const instance = new Module(filename, module), local = Module.createRequire(filename);
  const pools = [], statements = [], updates = [], calls = [], order = [];
  const primary = tenantMigrationFailure('DATABASE_CONFIGURATION_MISMATCH');
  primary.detail = 'PRIVATE_CANARY';
  let connects = 0, releases = 0, centralCloses = 0;
  class Pool {
    constructor() { this.index = pools.length; this.closed = 0; pools.push(this); }
    async query() { return { rows: [] }; } // Synthetic role setup, never a socket.
    async connect() {
      assert.equal(this.index, 1, 'only the owner pool enters the outer preflight');
      connects++;
      return {
        async query(sql, values) {
          statements.push({ sql, values });
          if (sql === 'BEGIN TRANSACTION READ ONLY' || sql === 'ROLLBACK' || sql.includes("set_config('statement_timeout'")) return { rows: [] };
          throw primary; // Real preflight path after transaction and timeout setup.
        },
        release(error) { assert.equal(error, undefined); releases++; order.push('release'); }
      };
    }
    async end() { this.closed++; order.push(`end-${this.index}`); }
  }
  const replacements = {
    '../../../backend/node_modules/pg': { Pool },
    '../f13/central-authority-fixture': { async centralAuthorityFixture() {
      return { pool: {}, async user() { return { id: '30000000-0000-4000-8000-000000000003', membershipId: '40000000-0000-4000-8000-000000000004', request: {} }; },
        data: { async change() {} }, async close() { centralCloses++; } };
    } },
    './provisioningDiagnostic': { createObservedProvisioner(options) {
      return {
        async ensure(input) { await options.journal.reserve(input.operationId, {}, () => ({ generationId: '50000000-0000-4000-8000-000000000005' })); },
        async project() {},
        async apiCredentials() { return { database: 'synthetic_gate', login: 'synthetic_reader', password: 'SYNTHETIC_CANARY' }; }
      };
    } },
    '../../../backend/src/security/tenantMigrationPreflight': { ...preflight, preflightTenant(...args) {
      calls.push(args); return preflight.preflightTenant(...args);
    } }
  };
  instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
  instance.require = name => Object.hasOwn(replacements, name) ? replacements[name] : local(name);
  instance._compile(fs.readFileSync(filename, 'utf8'), filename);
  let observed;
  try {
    await instance.exports.createEnvironment({ adminUrl: 'postgresql://partner_gate_admin:SYNTHETIC_CANARY@127.0.0.1:55591/postgres',
      runId: 'a'.repeat(32), onSetupDiagnostic: value => updates.push(value) });
  } catch (error) { observed = error; }
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], undefined, 'keep the current default migration manifest');
  assert.deepEqual(calls[0][3], { timeoutMs: 15000 });
  assert.equal(observed, primary, 'the original branded preflight failure remains primary');
  assert.equal(connects, 1);
  assert.equal(statements[0].sql, 'BEGIN TRANSACTION READ ONLY');
  assert.deepEqual(statements[1], { sql: "SELECT set_config('statement_timeout', $1, true)", values: ['15000ms'] });
  assert.equal(statements.at(-1).sql, 'ROLLBACK');
  assert.equal(releases, 1);
  assert.equal(pools.length, 3);
  assert.ok(pools.every(pool => pool.closed === 1));
  assert.equal(centralCloses, 1);
  assert.equal(order[0], 'release');
  assert.equal(updates.at(-1).phase, 'TENANT_PREFLIGHT');
  assert.equal(updates.at(-1).errorCode, 'DATABASE_CONFIGURATION_MISMATCH');
  assert.equal(updates.at(-1).localCleanup, 'COMPLETED');
  assert.doesNotMatch(JSON.stringify(safeEvidence(updates)), /CANARY/);
});
