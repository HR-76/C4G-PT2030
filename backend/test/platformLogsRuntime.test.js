'use strict';
// Regression: the API started by server.js never created the log collector, so GET /api/admin/directory/logs
// answered 503 (LOGS_UNAVAILABLE) outside the local profile. PLATFORM_LOGS_RUNTIME=central turns it on.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { configuredPlatformLogs, assertLogsSchema } = require('../src/platformDirectory/logs');
const { createProductionComposition } = require('../src/productionComposition');

test('the collector is created only when the runtime selects it', async () => {
  const queries = [];
  const pool = { query: async query => { queries.push(query); return { rows: [] }; } };
  assert.deepEqual(configuredPlatformLogs({ env: {}, pool }), { logs: null, owned: false });
  assert.deepEqual(configuredPlatformLogs({ env: { PLATFORM_LOGS_RUNTIME: 'disabled' }, pool }), { logs: null, owned: false });
  const { logs, owned } = configuredPlatformLogs({ env: { PLATFORM_LOGS_RUNTIME: 'central' }, pool });
  assert.equal(owned, true);
  logs.audit('authentication.login_succeeded', { globalUserId: '11111111-1111-4111-8111-111111111111' });
  await logs.flush();
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].values, ['LOGIN', '11111111-1111-4111-8111-111111111111', null]);
  assert.deepEqual(logs.status(), { failedEvents: 0 });
});

test('a collector supplied by the caller is kept and not owned', () => {
  const provided = Object.freeze({});
  assert.deepEqual(configuredPlatformLogs({ env: { PLATFORM_LOGS_RUNTIME: 'central' }, pool: {}, provided }), { logs: provided, owned: false });
  assert.deepEqual(configuredPlatformLogs({ env: {}, pool: {}, provided }), { logs: provided, owned: false });
});

test('the selector is closed', () => {
  for (const value of ['Central', 'true', 'on', ' central'])
    assert.throws(() => configuredPlatformLogs({ env: { PLATFORM_LOGS_RUNTIME: value }, pool: {} }), /Platform logs runtime/);
});

test('a failed insert is counted and reported without throwing', async () => {
  let reported = 0;
  const pool = { query: async () => { throw new Error('down'); } };
  const { logs } = configuredPlatformLogs({ env: { PLATFORM_LOGS_RUNTIME: 'central' }, pool, onFailure: () => { reported += 1; } });
  logs.audit('authentication.login_succeeded', {});
  await logs.flush();
  assert.deepEqual(logs.status(), { failedEvents: 1 });
  assert.equal(reported, 1);
});

test('start-up requires the log table', async () => {
  await assertLogsSchema({ query: async () => ({ rows: [{ present: true }] }) });
  await assert.rejects(assertLogsSchema({ query: async () => ({ rows: [{ present: false }] }) }), /LOGS_SCHEMA_REQUIRED/);
});

test('the production composition validates the selector and wires the configured collector', () => {
  const env = {
    AUTH_MODE: 'oidc', NODE_ENV: 'production', PUBLIC_APP_URL: 'https://app.example.test',
    OIDC_ISSUER: 'https://id.example.test/realms/c4g', OIDC_REDIRECT_URI: 'https://app.example.test/api/auth/oidc/callback',
    OIDC_CLIENT_ID: 'client', SESSION_SECRET: require('node:crypto').randomBytes(32).toString('hex'),
    AUTHORITY_COMMIT_PERMIT_SECRET: require('node:crypto').randomBytes(32).toString('hex'),
    SESSION_IDLE_MS: '1800000', SESSION_ABSOLUTE_MS: '28800000', OIDC_TRANSACTION_MS: '600000',
    AUTH_POLICY_VERSION: 'c4g-assurance-v1',
    AUTH_ASSURANCE_POLICY_JSON: JSON.stringify({ 'recent-mfa': { mfa: true, maxAgeSeconds: 300, acceptedAcr: ['c4g-loa2'], acceptedAmr: ['otp'], amrMode: 'all' } }),
    PLATFORM_LOGS_RUNTIME: 'invalid'
  };
  assert.throws(() => createProductionComposition({ dependencies: { express() {}, cors() {}, centralPool: {}, authorityPool: {}, routes: {} }, env }),
    /Platform logs runtime/);
  const source = fs.readFileSync(path.resolve(__dirname, '../src/productionComposition.js'), 'utf8');
  assert.match(source, /configuredPlatformLogs\(/);
  // Every consumer reads the resolved collector, never the raw dependency.
  assert.equal((source.match(/dependencies\.platformLogs/g) || []).length, 1);
});

test('the staging API environment turns the logs on', () => {
  const { apiPrivateEnvironment } = require('../scripts/staging/environment');
  const state = { phase: 'READY', credentials: {}, staging: { catalogPassword: 'c' }, permitSecret: 'p', sessionSecret: 's', authorityPassword: 'a' };
  const text = apiPrivateEnvironment(state, { host: 'c4g-postgres', centralDatabase: 'c4g_central_staging', administratorPassword: 'adm' });
  assert.match(text, /^PLATFORM_LOGS_RUNTIME=central$/m);
});
