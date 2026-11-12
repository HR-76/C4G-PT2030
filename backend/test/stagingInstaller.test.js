'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parseArguments, requirePerson, stagingTarget, databaseUrl, apiPrivateEnvironment, carriedSettings, CARRIED_KEYS } = require('../scripts/staging/environment');
const { main } = require('../scripts/staging/install');

const ready = Object.freeze({
  phase: 'READY', permitSecret: 'p'.repeat(64), sessionSecret: 's'.repeat(96), authorityPassword: 'a'.repeat(64),
  credentials: { tenantId: 't', credentialRef: 'staging-api-x', connectionVersion: 1, host: 'c4g-postgres', port: 5432,
    database: 'c4g_tenant_staging', login: 'c4g_staging_api', password: 'w'.repeat(64), ssl: true }
});

test('arguments: known flags and values only', () => {
  assert.deepEqual(parseArguments(['--subject', 'x', '--org-admin'], { values: ['--subject'], flags: ['--org-admin'] }), { subject: 'x', 'org-admin': true });
  for (const argv of [['--other'], ['--subject'], ['--subject', '--org-admin'], ['loose']]) {
    assert.throws(() => parseArguments(argv, { values: ['--subject'], flags: ['--org-admin'] }), { code: 'STAGING_ARGUMENT_INVALID' });
  }
});

test('person: Keycloak subject, name and e-mail are validated', () => {
  const good = { subject: '1CB952A5-4284-4325-BFE3-20F9DC6FB5AA', name: ' Utilizador Teste ', email: 'a@c4g.invalid' };
  assert.deepEqual(requirePerson(good), { subject: '1cb952a5-4284-4325-bfe3-20f9dc6fb5aa', name: 'Utilizador Teste', email: 'a@c4g.invalid' });
  assert.throws(() => requirePerson({ ...good, subject: 'not-a-uuid' }), { code: 'STAGING_SUBJECT_INVALID' });
  assert.throws(() => requirePerson({ ...good, name: 'x' }), { code: 'STAGING_NAME_INVALID' });
  assert.throws(() => requirePerson({ ...good, email: 'no-at-sign' }), { code: 'STAGING_EMAIL_INVALID' });
});

test('target: the tenant is reached by its network name over TLS, in the EU region', () => {
  const target = stagingTarget({ apiHost: 'c4g-postgres' });
  assert.equal(target.credentialHost, 'c4g-postgres');
  assert.equal(target.credentialSsl, true);
  assert.equal(target.regionCode, 'EU');
  assert.notEqual(target.apiLogin, 'c4g_local_api');
  for (const host of ['', 'Bad Host', '-x', undefined]) assert.throws(() => stagingTarget({ apiHost: host }), { code: 'STAGING_API_HOST_INVALID' });
});

test('database URLs verify the server certificate and encode credentials', () => {
  const url = new URL(databaseUrl({ login: 'u', password: 'p@ss/word', host: 'c4g-postgres', port: 5432, database: 'd' }));
  assert.equal(url.searchParams.get('sslmode'), 'verify-full');
  assert.equal(decodeURIComponent(url.password), 'p@ss/word');
  assert.equal(url.hostname, 'c4g-postgres');
  assert.equal(url.pathname, '/d');
});

test('private environment: generated values only, and only after a complete installation', () => {
  assert.throws(() => apiPrivateEnvironment({ ...ready, phase: 'INSTALLING' }, { host: 'h', centralDatabase: 'c', administratorPassword: 'x' }), { code: 'STAGING_INSTALLATION_NOT_READY' });
  assert.throws(() => apiPrivateEnvironment(ready, { host: 'h', centralDatabase: 'c' }), { code: 'STAGING_INSTALLATION_NOT_READY' });
  const text = apiPrivateEnvironment(ready, { host: 'c4g-postgres', centralDatabase: 'c4g_central_staging', administratorPassword: 'adm', carried: { AUTH_MODE: 'oidc' } });
  const lines = Object.fromEntries(text.trim().split('\n').map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  assert.deepEqual(Object.keys(lines).sort(), ['AUTHORITY_COMMIT_PERMIT_SECRET', 'AUTHORITY_DATABASE_URL', 'AUTH_MODE', 'CENTRAL_DATABASE_URL',
    'NODE_ENV', 'OPPORTUNITY_ALLOWED_RESIDENCY_JSON', 'OPPORTUNITY_API_CREDENTIALS_JSON', 'SESSION_SECRET']);
  assert.equal(lines.NODE_ENV, 'production');
  assert.match(lines.AUTHORITY_DATABASE_URL, /^postgresql:\/\/c4g_authority_runtime:/);
  assert.match(lines.CENTRAL_DATABASE_URL, /sslmode=verify-full$/);
  assert.deepEqual(JSON.parse(lines.OPPORTUNITY_API_CREDENTIALS_JSON), [ready.credentials]);
  assert.deepEqual(JSON.parse(lines.OPPORTUNITY_ALLOWED_RESIDENCY_JSON), [{ regionCode: 'EU', policyVersion: 'staging-v1' }]);
  assert.ok(!text.includes('undefined'));
});

test('carry-over copies only the listed non-secret settings', () => {
  const carried = carriedSettings('AUTH_MODE=oidc\r\nSESSION_SECRET=secret\nCENTRAL_DATABASE_URL=postgresql://u:p@h/d\nOIDC_REDIRECT_URI=https://x/cb?a=1\n# note\nAUTH_POLICY_VERSION=c4g-user-mfa-v1\n=bad');
  assert.deepEqual(carried, { AUTH_MODE: 'oidc', OIDC_REDIRECT_URI: 'https://x/cb?a=1', AUTH_POLICY_VERSION: 'c4g-user-mfa-v1' });
  assert.ok(CARRIED_KEYS.every(key => !/SECRET|PASSWORD|DATABASE|CREDENTIALS|PERMIT/.test(key.replace('POST_LOGOUT', ''))));
});

test('commands fail closed before touching any database', async () => {
  await assert.rejects(() => main(['bogus'], {}), { code: 'STAGING_COMMAND_INVALID' });
  await assert.rejects(() => main(['install'], {}), { code: 'STAGING_POSTGRES_PASSWORD_REQUIRED' });
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-staging-'));
  try {
    const env = { POSTGRES_PASSWORD: 'x', C4G_STAGING_STATE: path.join(folder, 'install.json') };
    await assert.rejects(() => main(['person', '--subject', '1cb952a5-4284-4325-bfe3-20f9dc6fb5aa', '--name', 'Nome Teste', '--email', 'a@c4g.invalid'], env), { code: 'STAGING_INSTALLATION_NOT_READY' });
    await assert.rejects(() => main(['person', '--bogus'], env), { code: 'STAGING_ARGUMENT_INVALID' });
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

// Regression: a fresh installation failed its own Central preflight (CATALOG_SECURITY_DRIFT) because the installer
// granted USAGE on opportunity_catalog to c4g_f12_admin, which no pinned fingerprint includes.
test('the schema installer does not change grants that the pinned Central fingerprints cover', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/localPlatform/schema.js'), 'utf8');
  assert.doesNotMatch(source, /GRANT\s+USAGE\s+ON\s+SCHEMA\s+opportunity_catalog\s+TO\s+c4g_f12_admin/i);
});
