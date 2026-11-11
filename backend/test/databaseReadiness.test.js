const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const cors = require('cors');
const { createApp } = require('../src/app');
const { createDatabaseReadiness, observeCentralDatabase } = require('../src/security/databaseReadiness');
const { requiredCentralMigrations } = require('../src/security/centralMigrationManifest');
const { HealthRegistry } = require('../src/observability/health');
const { createObservability } = require('../src/observability');

function centralPool({ fail = false, incomplete = false, historicalCrlf = false,
  omitVersion = null, corruptVersion = null, marker = true } = {}) {
  return {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      if (fail) throw new Error('sensitive connection detail');
      if (/FROM pg_catalog\.pg_database/.test(sql)) return { rows: [{
        database_name: 'c4g_central', database_oid: '200', server_address: '10.0.0.11',
        server_port: 5432, system_identifier: 'cluster-central', has_identity_marker: marker
      }] };
      if (/FROM public\.c4g_database_identity/.test(sql)) return { rows: [{ matches: marker }] };
      if (/FROM public\.c4g_schema_migration/.test(sql)) {
        return { rows: incomplete ? [] : requiredCentralMigrations().filter(item => item.version !== omitVersion).map(item => ({
          version: item.version,
          checksum_sha256: item.version === corruptVersion ? 'invalid' : (historicalCrlf ? item.acceptedChecksums.at(-1) : item.checksum),
          irreversible: item.irreversible
        })) };
      }
      if (/to_regclass\(\$6\)/.test(sql)) return { rows: [{
        global_user: true, auth_identity_ref: true, platform_admin_assignment: true,
        application_session_store: true, oidc_transaction: true, application_session: !incomplete
      }] };
      throw new Error('unexpected query');
    }
  };
}

test('readiness validates the marked Central database and its schema', async () => {
  const pool = centralPool();
  const identity = await observeCentralDatabase(pool);
  assert.equal(identity.databaseName, 'c4g_central');
  assert.deepEqual(pool.calls[0].params, ['public.c4g_database_identity']);
  assert.deepEqual(pool.calls[1].params, ['C4G', 'CENTRAL']);
  assert.deepEqual(await createDatabaseReadiness({ centralPool: pool }).check(), {
    ready: true, dependencies: { central: { status: 'healthy' } }
  });
});

test('readiness endpoint fails closed without exposing connection details', async t => {
  const readiness = createDatabaseReadiness({ centralPool: centralPool({ fail: true }) });
  const app = createApp({ express, cors, config: { nodeEnv: 'production' }, pool: {}, routes: {}, databaseReadiness: readiness });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/health/db');
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.deepEqual(body, { status: 'unhealthy', dependencies: { central: { status: 'unhealthy' } } });
  assert.doesNotMatch(JSON.stringify(body), /sensitive connection detail/);
});

test('database diagnostics and readiness share one Central check', async t => {
  const pool = centralPool();
  const app = createApp({ express, cors, config: {}, pool, routes: {},
    databaseReadiness: createDatabaseReadiness({ centralPool: pool }),
    observability: { health: new HealthRegistry() } });
  const server = http.createServer(app);
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const [database, ready, second] = await Promise.all(['/health/db', '/health/ready', '/health/db'].map(path => fetch(base + path)));
  assert.equal(database.status, 200);
  assert.equal(database.headers.get('cache-control'), 'no-store');
  assert.equal((await ready.json()).status, 'READY');
  assert.deepEqual(await second.json(), await database.json());
  assert.equal(pool.calls.filter(call => /FROM pg_catalog\.pg_database/.test(call.sql)).length, 1);
});

test('shared readiness preserves Central and tenant statuses when the tenant is unavailable', async t => {
  let checks = 0;
  const dependencies = { central: { status: 'healthy' }, tenant: { status: 'unhealthy' } };
  const observability = createObservability({ service: 'c4g-api' });
  observability.lifecycle.start();
  const app = createApp({ express, cors, config: {}, pool: {}, routes: {},
    databaseReadiness: { async check() { checks++; return { ready: false, dependencies }; } },
    observability });
  const server = http.createServer(app);
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const [database, ready] = await Promise.all(['/health/db', '/health/ready'].map(path => fetch(base + path)));
  assert.equal(database.status, 503);
  assert.deepEqual(await database.json(), { status: 'unhealthy', dependencies });
  assert.equal(ready.status, 503);
  assert.deepEqual((await ready.json()).reasons, ['DATABASE']);
  assert.equal(checks, 1);
});

test('readiness rejects missing markers and incomplete or divergent migrations', async () => {
  for (const options of [{ marker: false }, { incomplete: true }, { corruptVersion: '021_platform_members' }]) {
    assert.equal((await createDatabaseReadiness({ centralPool: centralPool(options) }).check()).ready, false);
  }
});

test('admission migrations are required only when admission is composed', async () => {
  const pool = centralPool({ omitVersion: '022_entity_admission' });
  assert.equal((await createDatabaseReadiness({ centralPool: pool }).check()).ready, true);
  assert.equal((await createDatabaseReadiness({ centralPool: pool, admissionRequired: true }).check()).ready, false);
});

test('readiness accepts historical CRLF-equivalent checksums', async () => {
  assert.equal((await createDatabaseReadiness({ centralPool: centralPool({ historicalCrlf: true }) }).check()).ready, true);
});
