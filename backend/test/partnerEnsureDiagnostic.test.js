'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const { tenantMigrationFailure } = require('../src/security/tenantMigrationErrors');
const { safeEvidence } = require('../../test/integration/partner-portal/gate');
const { createObservedProvisioner } = require('../../test/integration/partner-portal/provisioningDiagnostic');

const input = { operationId: '10000000-0000-4000-8000-000000000001', organizationId: '20000000-0000-4000-8000-000000000002',
  globalUserId: '30000000-0000-4000-8000-000000000003', membershipId: '40000000-0000-4000-8000-000000000004',
  input: { adminName: 'NAME_CANARY', adminEmail: 'EMAIL_CANARY' } };
const sourcePath = path.resolve(__dirname, '../src/platformOnboarding/postgresProvisioner.js');

function fixture(failAt = null, primary = new Error('PRIVATE_CANARY'), cleanupFailure = null) {
  const trace = [], updates = []; let reservation;
  const check = stage => { trace.push(stage); if (failAt === stage) throw primary; };
  const query = async (kind, sql, values) => {
    trace.push([kind, sql, values]);
    if (kind === 'admin') {
      if (sql.includes('pg_advisory_unlock_all')) { check('unlock'); return { rows: [] }; }
      if (sql.includes('pg_advisory_lock(')) check('lock');
      if (sql.includes('shobj_description')) {
        check('roles');
        if (failAt === 'ownership-check') return { rows: [{ marker: 'OTHER_CANARY' }] };
      }
      if (sql.includes('CREATE DATABASE')) check('database');
      return { rows: [] };
    }
    if (kind === 'central') {
      check('publication');
      if (sql.includes('organization_provisioning')) return { rows: [{ tenant_id: input.organizationId, status: 'READY' }] };
      if (sql.includes('organization_connection_version')) return { rows: [{ version_state: 'VALIDATED' }] };
      if (sql.includes('tenant_schema_state')) return { rows: [{ compatibility_state: 'COMPATIBLE' }] };
      if (sql.includes('organization_connection')) return { rows: [{ operational_state: 'AVAILABLE' }] };
      return { rows: [{}] };
    }
    if (sql.startsWith('SELECT current_database()')) {
      check('login'); return { rows: [{ name: reservation.database, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false }] };
    }
    if (sql.startsWith('REVOKE')) check('configuration');
    return { rows: [] };
  };
  const adminClient = { query: (...args) => query('admin', ...args), release() { check('release'); } };
  const options = {
    adminPool: { async connect() { check('acquire'); return adminClient; } }, centralPool: { query: (...args) => query('central', ...args) },
    connection: { host: '127.0.0.1', port: 55591, user: 'synthetic_admin', password: 'PASSWORD_CANARY' }, ownershipKey: 'OWNERSHIP_CANARY',
    journal: { async reserve(_id, _input, create) { check('reservation'); reservation ||= create(); return reservation; } }
  };
  class Pool {
    constructor(config) { this.config = config; trace.push(['pool', config]); }
    query(...args) { return query('tenant', ...args); }
    async end() { check('pool-end'); if (cleanupFailure) throw cleanupFailure; }
  }
  const migration = { createTenantMigrationRunner() { return Object.freeze({ async migrate() { check('migration'); } }); } };
  const identity = { async createLocalTenantIdentityProvisioner() { check('identity-create'); return Object.freeze({ async reconcile() { check('identity-reconcile'); } }); } };
  const preflight = { async preflightTenant() { check('preflight'); return { currentVersion: 1, schemaFingerprint: 'synthetic', capabilities: [], systemIdentifier: '1' }; } };
  const publication = {
    '../security/tenantDirectoryRepository': { createTenantDirectoryRepository() { return Object.freeze({ async resolveSnapshotByOrganization() {
      check('publication-method');
      return { databaseGenerationId: reservation.generationId, databaseRef: reservation.database, schema: { schemaFingerprint: 'synthetic' } };
    } }); } },
    '../security/tenantWorkloadDirectoryRepository': { createTenantWorkloadDirectoryRepository() { return { async resolvePublished() { return { lifecycleStatus: 'AVAILABLE' }; } }; } }
  };
  function load(replacements = {}) {
    const local = Module.createRequire(sourcePath), instance = new Module(sourcePath, module);
    instance.filename = sourcePath; instance.paths = Module._nodeModulePaths(path.dirname(sourcePath));
    const defaults = {
      pg: { Pool }, 'node:crypto': { ...crypto, randomUUID: () => '50000000-0000-4000-8000-000000000005', randomBytes: n => Buffer.alloc(n, 1) },
      '../security/tenantMigrationRunner': migration, '../security/localTenantIdentityProvisioner': identity,
      '../security/tenantMigrationPreflight': preflight,
      '../audit/partitionMaintenance': { async ensureAuditPartitionsWithPool() { check('audit-partitions'); } },
      ...publication
    };
    instance.require = name => Object.hasOwn(replacements, name) ? replacements[name] : Object.hasOwn(defaults, name) ? defaults[name] : local(name);
    instance._compile(fs.readFileSync(sourcePath, 'utf8'), sourcePath); return instance.exports;
  }
  const dependencies = { Pool, migration, identity, preflight, load, publication };
  return { trace, updates, options, dependencies,
    observed: () => createObservedProvisioner(options, value => updates.push(value), dependencies),
    baseline: () => load().createPostgresProvisioner(options) };
}

for (const [failure, substep] of [
  ['reservation', 'RESERVATION'], ['acquire', 'ADMIN_ACQUIRE'], ['lock', 'ADMIN_LOCK'], ['roles', 'ROLE_SETUP'],
  ['database', 'DATABASE_SETUP'], ['configuration', 'TENANT_CONFIGURATION'], ['migration', 'MIGRATION'],
  ['identity-create', 'IDENTITY_CREATE'], ['identity-reconcile', 'IDENTITY_RECONCILE'], ['preflight', 'PREFLIGHT'],
  ['login', 'LOGIN_VERIFICATION'], ['publication', 'DIRECTORY_PUBLICATION'], ['publication-method', 'DIRECTORY_PUBLICATION']
]) test(`ensure failure at ${failure} retains its safe substep through cleanup`, async () => {
  const primary = tenantMigrationFailure('TENANT_MIGRATION_FAILED'), f = fixture(failure, primary);
  await assert.rejects(f.observed().ensure(input), error => error === primary);
  assert.equal(f.updates.at(-1).substep, substep);
  assert.equal(f.updates.at(-1).substepStatus, 'FAILED');
  assert.equal(f.updates.at(-1).substepFailure.errorCode, 'TENANT_MIGRATION_FAILED');
  assert.doesNotMatch(JSON.stringify(safeEvidence(f.updates)), /CANARY|postgresql:|20000000|SELECT |GRANT /);
});

test('observing a complete ensure preserves exact operations, arguments, result and cleanup', async () => {
  const a = fixture(), b = fixture();
  assert.deepEqual(await b.observed().ensure(input), await a.baseline().ensure(input));
  assert.deepEqual(b.trace, a.trace);
  assert.ok(b.updates.some(row => row.substep === 'MIGRATION'));
  assert.equal(b.updates.at(-1).substepStatus, 'COMPLETED');
  assert.doesNotMatch(JSON.stringify(safeEvidence(b.updates)), /CANARY|SELECT |GRANT /);
});

test('original cleanup replacement behavior is unchanged but first migration failure remains diagnosed', async () => {
  const primary = tenantMigrationFailure('TENANT_LEDGER_MISMATCH'), secondary = Object.assign(new Error('CLEANUP_CANARY'), { code: 'ECONNRESET' });
  const f = fixture('migration', primary, secondary);
  await assert.rejects(f.observed().ensure(input), error => error === secondary);
  assert.equal(f.updates.at(-1).substep, 'MIGRATION');
  assert.equal(f.updates.at(-1).substepFailure.errorCode, 'TENANT_LEDGER_MISMATCH');
});

test('a synchronous ownership refusal is attributed before rollback and unlock run', async () => {
  const f = fixture('ownership-check');
  await assert.rejects(f.observed().ensure(input), { code: 'PROVISIONING_OWNERSHIP_CONFLICT' });
  assert.equal(f.updates.at(-1).substep, 'ROLE_SETUP');
  assert.equal(f.updates.at(-1).substepFailure.errorCode, 'PROVISIONING_OWNERSHIP_CONFLICT');
  assert.ok(f.trace.some(row => Array.isArray(row) && row[1] === 'ROLLBACK'));
  assert.doesNotMatch(JSON.stringify(f.updates), /CANARY/);
});

test('synchronous release failures are attributed to release without changing their thrown identity', async () => {
  const primary = Object.assign(new Error('RELEASE_CANARY'), { code: 'ECONNRESET' }), f = fixture('release', primary);
  await assert.rejects(f.observed().ensure(input), error => error === primary);
  assert.equal(f.updates.at(-1).substep, 'ADMIN_RELEASE');
  assert.equal(f.updates.at(-1).substepFailure.errorCode, 'ECONNRESET');
  assert.doesNotMatch(JSON.stringify(f.updates), /CANARY/);
});

test('invalid input is diagnosed before acquisition and a later request resets the failed substep', async () => {
  const f = fixture(), p = f.observed();
  await assert.rejects(p.ensure({ ...input, organizationId: 'INVALID_CANARY' }), { code: 'ONBOARDING_INPUT_INVALID' });
  assert.equal(f.updates.at(-1).substep, 'INPUT_BINDING');
  assert.equal(f.trace.length, 0);
  await p.ensure(input);
  assert.equal(f.updates.at(-1).substepStatus, 'COMPLETED');
});

test('project and credentials are not instrumented and observer exceptions do not change ensure', async () => {
  const f = fixture(), p = createObservedProvisioner(f.options, () => { throw new Error('OBSERVER_CANARY'); }, f.dependencies);
  assert.deepEqual(await p.ensure(input), inputWithoutDetails());
  function inputWithoutDetails() { const { input: unused, ...result } = input; return result; }
  const other = fixture(), observed = other.observed();
  await observed.apiCredentials(input);
  assert.equal(other.updates.length, 0);
});
