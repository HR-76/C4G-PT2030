'use strict';

// Context: context/features/staging-central-runtime-login.md. The API and the worker never connect to the Central
// database as the PostgreSQL administrator.
const test = require('node:test');
const assert = require('node:assert/strict');
const { apiPrivateEnvironment, workerCentralEnvironment, CENTRAL_API_LOGIN, CENTRAL_WORKER_LOGIN } = require('../scripts/staging/environment');

const ready = Object.freeze({
  phase: 'READY', staging: { catalogPassword: 'c'.repeat(64), centralApiPassword: 'i'.repeat(64), centralWorkerPassword: 'k'.repeat(64) },
  permitSecret: 'p'.repeat(64), sessionSecret: 's'.repeat(96), authorityPassword: 'a'.repeat(64),
  credentials: { tenantId: 't', credentialRef: 'staging-api-x', connectionVersion: 1, host: 'c4g-postgres', port: 5432,
    database: 'c4g_tenant_staging', login: 'c4g_staging_api', password: 'w'.repeat(64), ssl: true }
});
const where = { host: 'c4g-postgres', centralDatabase: 'c4g_central_staging' };

function loginOf(url) {
  return decodeURIComponent(new URL(url).username);
}

test('the API Central URL uses its runtime login and never the PostgreSQL administrator', () => {
  const lines = Object.fromEntries(apiPrivateEnvironment(ready, where).trim().split('\n').map(line => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  }));
  assert.equal(loginOf(lines.CENTRAL_DATABASE_URL), CENTRAL_API_LOGIN);
  assert.notEqual(loginOf(lines.CENTRAL_DATABASE_URL), 'postgres');
  assert.equal(new URL(lines.CENTRAL_DATABASE_URL).password, 'i'.repeat(64));
});

test('the worker file carries only its own runtime login', () => {
  const text = workerCentralEnvironment(ready, where);
  assert.match(text, /^CENTRAL_DATABASE_URL=/);
  const [urlLine, flagLine] = text.trim().split('\n');
  assert.equal(flagLine, 'C4G_STAGING_CENTRAL_RUNTIME_LOGINS=admitted-v1');
  const url = urlLine.slice('CENTRAL_DATABASE_URL='.length);
  assert.equal(loginOf(url), CENTRAL_WORKER_LOGIN);
  assert.notEqual(CENTRAL_WORKER_LOGIN, CENTRAL_API_LOGIN);
  assert.equal(new URL(url).password, 'k'.repeat(64));
  assert.match(url, /sslmode=verify-full$/);
});

test('both runtime files refuse a state without their login password', () => {
  const withoutApi = { ...ready, staging: { catalogPassword: 'c'.repeat(64), centralWorkerPassword: 'k'.repeat(64) } };
  const withoutWorker = { ...ready, staging: { catalogPassword: 'c'.repeat(64), centralApiPassword: 'i'.repeat(64) } };
  assert.throws(() => apiPrivateEnvironment(withoutApi, where), { code: 'STAGING_INSTALLATION_NOT_READY' });
  assert.throws(() => workerCentralEnvironment(withoutWorker, where), { code: 'STAGING_INSTALLATION_NOT_READY' });
  assert.throws(() => workerCentralEnvironment({ ...ready, phase: 'INSTALLING' }, where), { code: 'STAGING_INSTALLATION_NOT_READY' });
});

test('the two runtime logins are distinct and fixed names', () => {
  assert.equal(CENTRAL_API_LOGIN, 'c4g_central_staging_api');
  assert.equal(CENTRAL_WORKER_LOGIN, 'c4g_central_staging_worker');
});
