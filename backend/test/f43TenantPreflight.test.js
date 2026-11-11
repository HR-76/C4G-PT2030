const assert = require('node:assert/strict');
const test = require('node:test');
const {
  preflightTenant, validateDatabaseContract
} = require('../src/security/tenantMigrationPreflight');
const { isTenantMigrationFailure } = require('../src/security/tenantMigrationErrors');

function databaseClient(overrides = {}) {
  return {
    async query(sql) {
      if (String(sql).includes("server_version_num")) {
        return { rows: [{ server_version_num: overrides.serverVersion || '170009' }] };
      }
      if (String(sql).includes('FROM pg_catalog.pg_database')) {
        return { rows: [{
          server_encoding: 'UTF8', database_encoding: 'UTF8', timezone: 'UTC',
          locale_provider: 'i', icu_locale: 'und', collation_version: '153.120',
          ...(overrides.settings || {})
        }] };
      }
      if (String(sql).includes('FROM pg_catalog.pg_extension')) {
        return { rows: overrides.extensions || [] };
      }
      throw new Error('unexpected query');
    }
  };
}

test('database contract requires PostgreSQL 17/18, UTF-8, UTC, deterministic ICU und and no user extension', async () => {
  await assert.doesNotReject(() => validateDatabaseContract(databaseClient()));
  assert.equal((await validateDatabaseContract(databaseClient({serverVersion:'180003'}))).postgresMajor,18);
  const cases = [
    [databaseClient({ serverVersion: '160009' }), 'POSTGRES_VERSION_MISMATCH'],
    [databaseClient({ serverVersion: '190000' }), 'POSTGRES_VERSION_MISMATCH'],
    [databaseClient({ settings: { server_encoding: 'LATIN1' } }), 'DATABASE_CONFIGURATION_MISMATCH'],
    [databaseClient({ settings: { timezone: 'Europe/Lisbon' } }), 'DATABASE_CONFIGURATION_MISMATCH'],
    [databaseClient({ settings: { locale_provider: 'c' } }), 'DATABASE_CONFIGURATION_MISMATCH'],
    [databaseClient({ settings: { icu_locale: 'pt-PT' } }), 'DATABASE_CONFIGURATION_MISMATCH'],
    [databaseClient({ settings: { collation_version: '' } }), 'DATABASE_CONFIGURATION_MISMATCH'],
    [databaseClient({ extensions: [{ extname: 'pg_trgm' }] }), 'EXTENSION_ALLOWLIST_MISMATCH']
  ];
  for (const [client, code] of cases) {
    await assert.rejects(() => validateDatabaseContract(client), error => error.internalCode === code);
  }
});
test('preflight starts read-only with an injected statement timeout and sanitizes provider failures', async () => {
  const canary = 'postgresql://user:secret@private-host/private-db';
  const queries = [];
  let releases = 0;
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql === 'BEGIN TRANSACTION READ ONLY' || sql === 'ROLLBACK') return { rows: [] };
      if (String(sql).includes('set_config')) return { rows: [] };
      throw new Error(canary);
    },
    release() { releases += 1; }
  };
  await assert.rejects(() => preflightTenant({ async connect() { return client; } }, {
    tenantId: '43000000-0000-4000-8000-000000000001',
    databaseGenerationId: '43000000-0000-4000-8000-000000000002'
  }, undefined, { timeoutMs: 25 }), error => {
    assert.equal(error.internalCode, 'TENANT_PREFLIGHT_FAILED');
    assert.doesNotMatch(JSON.stringify(error), /secret|private-host|private-db/);
    return true;
  });
  assert.equal(queries[0], 'BEGIN TRANSACTION READ ONLY');
  assert.equal(queries[1], "SELECT set_config('statement_timeout', $1, true)");
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert.equal(releases, 1);
});

test('preflight refuses absent deadlines and malformed physical identity before connecting', async () => {
  let connects = 0;
  const pool = { async connect() { connects += 1; } };
  await assert.rejects(() => preflightTenant(pool, {}, undefined, { timeoutMs: 10 }), TypeError);
  await assert.rejects(() => preflightTenant(pool, {
    tenantId: 'tenant', databaseGenerationId: 'generation'
  }), TypeError);
  assert.equal(connects, 0);
});

test('preflight sanitizes and preserves rollback and client cleanup failures', async () => {
  const canary = 'postgresql://cleanup-secret@private/tenant';
  const client = {
    async query(sql) {
      if (sql === 'BEGIN TRANSACTION READ ONLY') return { rows: [] };
      if (String(sql).includes('set_config')) throw new Error(canary);
      if (sql === 'ROLLBACK') throw new Error(canary);
      return { rows: [] };
    },
    release() { throw new Error(canary); }
  };
  await assert.rejects(() => preflightTenant({ async connect() { return client; } }, {
    tenantId: '43000000-0000-4000-8000-000000000001',
    databaseGenerationId: '43000000-0000-4000-8000-000000000002'
  }, undefined, { timeoutMs: 25 }), error => {
    assert.equal(isTenantMigrationFailure(error), true);
    assert.equal(error.name, 'TenantMigrationAggregateError');
    assert.deepEqual(error.errors.map(item => item.internalCode), [
      'TENANT_PREFLIGHT_FAILED',
      'TENANT_PREFLIGHT_ROLLBACK_FAILED',
      'TENANT_PREFLIGHT_CLIENT_CLEANUP_FAILED'
    ]);
    assert.doesNotMatch(JSON.stringify(error), /cleanup-secret|private|tenant/);
    return true;
  });
});
