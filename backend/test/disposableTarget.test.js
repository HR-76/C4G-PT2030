'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertDisposableTarget } = require('./support/disposableTarget');

// Integration tests that TRUNCATE or DROP must only ever run against a disposable database:
// loopback host, not the default PostgreSQL ports, and a database named <gate>_synthetic_<name>.
const url = (host, port, database) => `postgresql://user:secret@${host}:${port}/${database}`;

test('accepts loopback targets on non-default ports with a synthetic database name', () => {
  for (const target of [url('127.0.0.1', 55432, 'f12_synthetic_f9'), url('localhost', 5594, 'f12_synthetic_central'),
    url('[::1]', 6000, 'f9_synthetic_tenant_1')]) {
    assert.doesNotThrow(() => assertDisposableTarget(target), target);
  }
});

test('refuses a missing, malformed or non-postgres URL', () => {
  for (const bad of [undefined, '', 'not a url', 'mysql://127.0.0.1:55432/f12_synthetic_f9']) {
    assert.throws(() => assertDisposableTarget(bad), { code: 'DISPOSABLE_TARGET_REQUIRED' }, String(bad));
  }
});

test('refuses the default PostgreSQL ports and a missing port', () => {
  for (const port of [5432, 5433]) {
    assert.throws(() => assertDisposableTarget(url('127.0.0.1', port, 'f12_synthetic_f9')), { code: 'DISPOSABLE_TARGET_REQUIRED' });
  }
  assert.throws(() => assertDisposableTarget('postgresql://user:secret@127.0.0.1/f12_synthetic_f9'), { code: 'DISPOSABLE_TARGET_REQUIRED' });
});

test('refuses remote hosts even when the name and port look disposable', () => {
  for (const host of ['db.example.com', '10.0.0.5', 'ep-cool-123.neon.tech']) {
    assert.throws(() => assertDisposableTarget(url(host, 55432, 'f12_synthetic_f9')), { code: 'DISPOSABLE_TARGET_REQUIRED' }, host);
  }
});

test('refuses habitual or production-looking database names', () => {
  for (const database of ['postgres', 'c4g_central_dev', 'c4g_tenant_dev', 'synthetic', 'prod_synthetic', 'f9_synthetic_', 'f9_synthetic_x;drop', '']) {
    assert.throws(() => assertDisposableTarget(url('127.0.0.1', 55432, database)), { code: 'DISPOSABLE_TARGET_REQUIRED' }, database);
  }
});

test('the refusal never echoes the URL or its credentials', () => {
  try { assertDisposableTarget(url('127.0.0.1', 5432, 'c4g_central_dev')); assert.fail('not refused'); } catch (error) {
    assert.equal(/secret|c4g_central_dev|user/.test(error.message), false, error.message);
  }
});

test('the F9 PostgreSQL integration test validates its target before touching the database', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'f9PostgresIntegration.test.js'), 'utf8');
  const guard = source.indexOf('assertDisposableTarget(url)');
  const firstQuery = source.search(/pool\.query\(|new Pool\(/);
  assert.ok(guard > 0, 'guard call missing');
  assert.ok(source.includes("require('./support/disposableTarget')"));
  assert.ok(guard < firstQuery, 'the guard must run before any connection');
});

test('an expected database prefix or exact name narrows the accepted targets', () => {
  assert.doesNotThrow(() => assertDisposableTarget(url('127.0.0.1', 55432, 'f7_synthetic_central'), { prefix: 'f7_synthetic_' }));
  assert.throws(() => assertDisposableTarget(url('127.0.0.1', 55432, 'f11_synthetic_tenant'), { prefix: 'f7_synthetic_' }), { code: 'DISPOSABLE_TARGET_REQUIRED' });
  assert.doesNotThrow(() => assertDisposableTarget(url('127.0.0.1', 55432, 'f7_synthetic_restore'), { exact: 'f7_synthetic_restore' }));
  assert.throws(() => assertDisposableTarget(url('127.0.0.1', 55432, 'f7_synthetic_other'), { exact: 'f7_synthetic_restore' }), { code: 'DISPOSABLE_TARGET_REQUIRED' });
});

// The F7/F11 gates run the audit/document rollback (DROP SCHEMA) and the restore check reads evidence.
// They must refuse a remote host even when the port and the database name look disposable.
for (const [script, options] of [
  ['gateF7Migrations.js', "prefix: 'f7_synthetic_'"],
  ['gateF11Migration.js', "prefix: 'f11_synthetic_'"],
  ['verifyF7Restore.js', "exact: 'f7_synthetic_restore'"]
]) {
  test(`${script} validates a loopback disposable target before opening a connection`, () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../scripts', script), 'utf8');
    assert.ok(/require\('\.\.\/test\/support\/disposableTarget'\)/.test(source), 'helper not imported');
    const guard = source.indexOf('assertDisposableTarget(');
    assert.ok(guard > 0, 'guard call missing');
    assert.ok(source.replace(/\s+/g, '').includes(options.replace(/\s+/g, '')), `expected ${options}`);
    assert.ok(guard < source.search(/new Pool\(/), 'the guard must run before any connection');
  });
}
