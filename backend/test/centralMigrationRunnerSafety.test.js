'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyCentralMigrationsWithManifest, manifest, migrationSql
} = require('../scripts/runCentralMigrations');
const { allKnownMigrations, checksumSql } = require('../src/security/centralMigrationManifest');

// The runner wraps every pending migration in ONE transaction. Migration SQL must therefore never
// control transactions, the migration lock must not wait forever, a migration must leave the session
// role as it found it, and a connection whose ROLLBACK failed must not return to the pool.
const sourceLf = 'CREATE TABLE synthetic_runner_test(id integer);\n';
const entries = manifest.filter(entry => !entry.requiresPreflightVersion).slice(0, 3);
const loader = version => ({
  entry: manifest.find(item => item.version === version),
  sql: sourceLf, checksum: checksumSql(sourceLf), acceptedChecksums: [checksumSql(sourceLf)]
});

function fakePool({ lockAcquired = true, plain = () => true, rollbackFails = false } = {}) {
  const statements = [];
  const released = [];
  let migrations = 0;
  const client = {
    async query(sql, parameters) {
      const text = sql.replace(/\s+/g, ' ').trim();
      statements.push([text, parameters]);
      if (text === 'ROLLBACK' && rollbackFails) throw new Error('connection reset');
      if (text.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: lockAcquired }] };
      if (text.includes('to_regclass')) return { rows: [{ marker_exists: true }] };
      if (text.includes('SELECT EXISTS') && text.includes('c4g_database_identity')) return { rows: [{ matches: true }] };
      if (text.includes('current_user = session_user')) return { rows: [{ plain: plain(migrations) }] };
      if (text.includes('FROM public.c4g_schema_migration')) return { rows: [] };
      if (text === sourceLf.trim()) migrations += 1;
      return { rows: [] };
    },
    release(error) { released.push(error ?? null); }
  };
  return { pool: { connect: async () => client }, statements, released };
}
const texts = statements => statements.map(([text]) => text);

test('the migration lock never waits forever and a busy lock is a clear refusal', async () => {
  const { pool, statements, released } = fakePool({ lockAcquired: false });
  await assert.rejects(() => applyCentralMigrationsWithManifest(pool, entries, loader), { code: 'MIGRATION_IN_PROGRESS' });
  const sql = texts(statements);
  assert.equal(sql[0], 'BEGIN');
  assert.match(sql[1], /set_config\('lock_timeout'/);
  assert.deepEqual(statements[1][1], ['30000ms']);
  assert.match(sql[2], /pg_try_advisory_xact_lock/);
  assert.equal(sql.includes(sourceLf.trim()), false, 'no migration SQL may run without the lock');
  assert.equal(sql.at(-1), 'ROLLBACK');
  assert.deepEqual(released, [null], 'a clean connection returns to the pool');
});

test('a migration that leaves a different current role is refused and rolled back', async () => {
  const { pool, statements } = fakePool({ plain: executed => executed < 2 });
  await assert.rejects(() => applyCentralMigrationsWithManifest(pool, entries, loader), { code: 'MIGRATION_ROLE_NOT_RESET' });
  const sql = texts(statements);
  assert.equal(sql.filter(text => text === sourceLf.trim()).length, 2, 'stops at the offending migration');
  assert.equal(sql.filter(text => text.startsWith('INSERT INTO public.c4g_schema_migration')).length, 1,
    'the offending migration is never recorded in the ledger');
  assert.equal(sql.at(-1), 'ROLLBACK');
  assert.equal(sql.includes('COMMIT'), false);
});

test('a failed ROLLBACK destroys the connection and keeps the original error', async () => {
  const { pool, released } = fakePool({ lockAcquired: false, rollbackFails: true });
  await assert.rejects(() => applyCentralMigrationsWithManifest(pool, entries, loader), { code: 'MIGRATION_IN_PROGRESS' });
  assert.equal(released.length, 1);
  assert.ok(released[0] instanceof Error, 'a broken connection must be destroyed, not pooled');
});

test('a successful run commits once, verifies the role after every migration and releases cleanly', async () => {
  const { pool, statements, released } = fakePool();
  const applied = await applyCentralMigrationsWithManifest(pool, entries, loader);
  assert.deepEqual(applied, entries.map(entry => entry.version));
  const sql = texts(statements);
  assert.equal(sql.filter(text => text === 'COMMIT').length, 1);
  assert.equal(sql.filter(text => text.includes('current_user = session_user')).length, entries.length);
  assert.deepEqual(released, [null]);
});

test('central migration SQL must not control transactions', () => {
  const entry = manifest.find(item => !item.irreversible) ?? manifest[1];
  for (const body of ['BEGIN;\nCREATE TABLE t(id int);\nCOMMIT;\n', 'CREATE TABLE t(id int);\nSAVEPOINT s;\n',
    'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;\nSELECT 1;\n', 'SELECT 1;\nROLLBACK;\n']) {
    assert.throws(() => migrationSql(entry.version, 'up', () => body), /transaction control belongs to the runner/i, body);
  }
});

test('every registered central migration passes the transaction-control check', () => {
  for (const entry of allKnownMigrations) {
    assert.doesNotThrow(() => migrationSql(entry.version, 'up'), `${entry.version} up`);
    if (!entry.irreversible) assert.doesNotThrow(() => migrationSql(entry.version, 'down'), `${entry.version} down`);
  }
});
