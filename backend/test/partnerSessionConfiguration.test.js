'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { Client } = require('pg');
const migration = require('../src/security/tenantMigrationRunner');
const { validateDatabaseContract } = require('../src/security/tenantMigrationPreflight');
const { tenantMigrationFailure, isTenantMigrationFailure } = require('../src/security/tenantMigrationErrors');
const { createObservedProvisioner } = require('../../test/integration/partner-portal/provisioningDiagnostic');

// Model only the server/session boundary. The environment, provisioner,
// migration runner, driver startup parser and strict validator remain real.
async function exercise({ withoutStartupOption = false, settingsOverride = {} } = {}) {
  const pools = [], observations = [], statements = [], updates = [];
  const afterContract = tenantMigrationFailure('SYNTHETIC_STOP_AFTER_DATABASE_CONTRACT');
  let databaseDefault = 'Etc/UTC', contractsPassed = 0, capturedOptions, centralClosed = 0;
  class ControlledPool {
    constructor(config) { this.config = config; this.session = null; this.acquisitions = 0; this.releases = 0; this.ends = 0; pools.push(this); }
    async connect() {
      this.acquisitions++;
      if (!this.session) {
        // Without a supplied option, model the server default directly; never
        // let host PGOPTIONS configure the negative control. Explicit options
        // still go through the installed driver's real startup parser.
        const startup = this.config.options === undefined ? {} : new Client(this.config).getStartupConf(); // No connect/socket.
        const timezone = startup.options === '-c timezone=UTC' ? 'UTC' : databaseDefault;
        const owner = this;
        this.session = { timezone, async query(sql, values) {
          statements.push({ sql, values });
          if (!owner.config.database) { // Isolated bootstrap/admin doubles.
            if (sql.startsWith('CREATE DATABASE ')) {
              assert.match(sql, /ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0/);
            }
            return { rows: [] };
          }
          if (/^ALTER DATABASE .* SET timezone TO 'UTC'$/.test(sql)) databaseDefault = 'UTC';
          if (sql.includes("current_setting('server_version_num')")) return { rows: [{ server_version_num: '170006' }] };
          if (sql.includes("current_setting('server_encoding')")) {
            observations.push({ timezone: owner.session.timezone, databaseDefault });
            return { rows: [{ server_encoding: 'UTF8', database_encoding: 'UTF8', timezone: owner.session.timezone,
              locale_provider: 'i', icu_locale: 'und', collation_version: 'synthetic-icu-version', ...settingsOverride }] };
          }
          if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: true }] };
          if (sql.includes("to_regclass('c4g_system.tenant_identity')")) return { rows: [{ marker_exists: false, ledger_exists: false }] };
          return { rows: [] };
        }, release() { owner.releases++; } };
      }
      return this.session;
    }
    async query(...args) { const client = await this.connect(); try { return await client.query(...args); } finally { client.release(); } }
    async end() { this.ends++; }
  }
  const filename = path.resolve(__dirname, '../../test/integration/partner-portal/environment.js');
  const local = Module.createRequire(filename), instance = new Module(filename, module);
  instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const replacements = {
    '../../../backend/node_modules/pg': { Pool: ControlledPool },
    '../f13/central-authority-fixture': { async centralAuthorityFixture() {
      return { pool: {}, async user() { return { id: '30000000-0000-4000-8000-000000000003', membershipId: '40000000-0000-4000-8000-000000000004', request: {} }; },
        data: { async change() {} }, async close() { centralClosed++; } };
    } },
    './provisioningDiagnostic': { createObservedProvisioner(options, observe) {
      capturedOptions = options.connection.options;
      const connection = { ...options.connection };
      if (withoutStartupOption) delete connection.options;
      return createObservedProvisioner({ ...options, connection }, observe, { Pool: ControlledPool,
        migration: { ...migration, createTenantMigrationRunner(input) {
          return migration.createTenantMigrationRunner({ ...input, async validateDatabase(client) {
            await validateDatabaseContract(client); contractsPassed++; throw afterContract;
          } });
        } }
      });
    } }
  };
  instance.require = name => Object.hasOwn(replacements, name) ? replacements[name] : local(name);
  instance._compile(fs.readFileSync(filename, 'utf8'), filename);
  let error;
  try {
    await instance.exports.createEnvironment({ adminUrl: 'postgresql://partner_gate_admin:SYNTHETIC_CANARY@127.0.0.1:55591/postgres',
      runId: 'a'.repeat(32), onSetupDiagnostic: value => updates.push(value) });
  } catch (caught) { error = caught; }
  assert.equal(pools.length, 2);
  assert.ok(pools.every(pool => pool.ends === 1 && pool.acquisitions > 0 && pool.releases === pool.acquisitions));
  assert.equal(centralClosed, 1);
  assert.equal(statements.at(-2).sql, 'ROLLBACK');
  assert.match(statements.at(-1).sql, /pg_advisory_unlock_all/);
  return { error, afterContract, contractsPassed, observations, capturedOptions, updates, pools };
}

test('control: ALTER DATABASE changes the default but does not fix an already-open simulated session', async () => {
  const result = await exercise({ withoutStartupOption: true });
  assert.ok(isTenantMigrationFailure(result.error));
  assert.equal(result.error.internalCode, 'DATABASE_CONFIGURATION_MISMATCH');
  assert.equal(result.contractsPassed, 0);
  assert.deepEqual(result.observations, [{ timezone: 'Etc/UTC', databaseDefault: 'UTC' }]);
});

test('gate starts tenant sessions in exact UTC before any query and passes the unchanged configuration contract', async () => {
  const result = await exercise();
  assert.equal(result.error, result.afterContract);
  assert.equal(result.capturedOptions, '-c timezone=UTC');
  assert.equal(result.contractsPassed, 1);
  assert.deepEqual(result.observations, [{ timezone: 'UTC', databaseDefault: 'UTC' }]);
});

for (const [field, value] of [['server_encoding', 'LATIN1'], ['database_encoding', 'LATIN1'],
  ['locale_provider', 'c'], ['icu_locale', 'en'], ['collation_version', ''], ['timezone', 'Etc/UTC']]) {
  test(`strict configuration still rejects ${field} drift with startup UTC configured`, async () => {
    const result = await exercise({ settingsOverride: { [field]: value } });
    assert.ok(isTenantMigrationFailure(result.error));
    assert.equal(result.error.internalCode, 'DATABASE_CONFIGURATION_MISMATCH');
    assert.equal(result.contractsPassed, 0);
    assert.equal(result.updates.at(-1).substep, 'MIGRATION');
  });
}
