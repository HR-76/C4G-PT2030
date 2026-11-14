'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parseArguments, requirePerson, requireProfile, projectionOperationId, stagingTarget, databaseUrl, apiPrivateEnvironment, carriedSettings,
  CARRIED_KEYS, PROFILES, AUTH_POLICY_VERSION, COLLECTION_APPROVALS, collectionEnvironment } = require('../scripts/staging/environment');
const { STAGING_APPROVALS } = require('../src/fundingTenders/programmes');
const { RECOGNIZED_ASSURANCE_POLICIES } = require('../src/security/authConfig');
const { grantsForProfile } = require('../src/organizationDirectory/accessProfiles');
const { main, CENTRAL_STEPS, TENANT_STEPS } = require('../scripts/staging/install');

const ready = Object.freeze({
  phase: 'READY', staging: { catalogPassword: 'c'.repeat(64), centralApiPassword: 'i'.repeat(64), centralWorkerPassword: 'k'.repeat(64) }, permitSecret: 'p'.repeat(64), sessionSecret: 's'.repeat(96), authorityPassword: 'a'.repeat(64),
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
  assert.throws(() => apiPrivateEnvironment({ ...ready, staging: { catalogPassword: 'c'.repeat(64), centralWorkerPassword: 'k'.repeat(64) } }, { host: 'h', centralDatabase: 'c' }), { code: 'STAGING_INSTALLATION_NOT_READY' });
  assert.throws(() => apiPrivateEnvironment({ ...ready, staging: {} }, { host: 'h', centralDatabase: 'c', administratorPassword: 'x' }), { code: 'STAGING_INSTALLATION_NOT_READY' });
  const text = apiPrivateEnvironment(ready, { host: 'c4g-postgres', centralDatabase: 'c4g_central_staging', administratorPassword: 'adm', carried: { AUTH_MODE: 'oidc', AUTH_POLICY_VERSION: 'c4g-assurance-v1' } });
  const lines = Object.fromEntries(text.trim().split('\n').map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  assert.deepEqual(Object.keys(lines).sort(), ['AUTHORITY_COMMIT_PERMIT_SECRET', 'AUTHORITY_DATABASE_URL', 'AUTH_ASSURANCE_POLICY_JSON', 'AUTH_MODE',
    'AUTH_POLICY_VERSION', 'C4G_STAGING_CENTRAL_RUNTIME_LOGINS', 'CATALOG_DATABASE_URL', 'CENTRAL_DATABASE_URL', 'FUNDING_TENDERS_RUNTIME', 'FUNDING_TENDERS_SOURCE', 'NODE_ENV',
    'OPPORTUNITY_ALLOWED_RESIDENCY_JSON', 'OPPORTUNITY_API_CREDENTIALS_JSON', 'PRIVILEGED_LOGIN_ASSURANCE_CATEGORY', 'SESSION_SECRET']);
  // MFA stays each person's choice: a policy carried over from an older release never overrides it.
  const policy = RECOGNIZED_ASSURANCE_POLICIES[AUTH_POLICY_VERSION];
  assert.equal(AUTH_POLICY_VERSION, 'c4g-user-mfa-v1');
  assert.equal(lines.AUTH_POLICY_VERSION, 'c4g-user-mfa-v1');
  assert.deepEqual(JSON.parse(lines.AUTH_ASSURANCE_POLICY_JSON), policy.policy);
  assert.equal(policy.policy[policy.privilegedCategory].mfa, false);
  assert.equal(lines.PRIVILEGED_LOGIN_ASSURANCE_CATEGORY, policy.privilegedCategory);
  assert.equal(lines.FUNDING_TENDERS_RUNTIME, 'central');
  assert.equal(lines.FUNDING_TENDERS_SOURCE, 'unconfigured');
  const catalog = new URL(lines.CATALOG_DATABASE_URL);
  assert.deepEqual([catalog.username, catalog.hostname, catalog.port, catalog.pathname, catalog.searchParams.get('sslmode')],
    ['c4g_catalog_staging', 'c4g-postgres', '5432', '/c4g_central_staging', 'verify-full']);
  assert.equal(lines.NODE_ENV, 'production');
  assert.match(lines.AUTHORITY_DATABASE_URL, /^postgresql:\/\/c4g_authority_runtime:/);
  assert.match(lines.CENTRAL_DATABASE_URL, /sslmode=verify-full$/);
  assert.deepEqual(JSON.parse(lines.OPPORTUNITY_API_CREDENTIALS_JSON), [ready.credentials]);
  assert.deepEqual(JSON.parse(lines.OPPORTUNITY_ALLOWED_RESIDENCY_JSON), [{ regionCode: 'EU', policyVersion: 'staging-v1' }]);
  assert.ok(!text.includes('undefined'));
});

test('profiles: one of the application profiles, or the older --org-admin switch', () => {
  assert.deepEqual([...PROFILES], ['ORG_ADMIN', 'FUNDING_MANAGER', 'CONTRIBUTOR', 'VIEWER']);
  assert.equal(requireProfile({}), null);
  assert.equal(requireProfile({ 'org-admin': true }), 'ORG_ADMIN');
  assert.equal(requireProfile({ profile: 'CONTRIBUTOR' }), 'CONTRIBUTOR');
  for (const args of [{ profile: 'ADMIN' }, { profile: 'ORG_ADMIN', 'org-admin': true }, { profile: '' }]) assert.throws(() => requireProfile(args), { code: 'STAGING_PROFILE_INVALID' });
  // Every profile the installer accepts is one the application can grant.
  for (const profileCode of PROFILES) assert.ok(grantsForProfile({ organizationId: 'o', profileCode }).length > 0);
});

test('projection operation id is a stable UUID per membership', () => {
  const id = projectionOperationId('258802ac-504d-4087-9ac9-9136eb9f54c9');
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(id, projectionOperationId('258802ac-504d-4087-9ac9-9136eb9f54c9'));
  assert.notEqual(id, projectionOperationId('258802ac-504d-4087-9ac9-9136eb9f54ca'));
});

test('collection is opt-in: nothing is generated unless a result limit is named, and only the approved ones',()=>{
  assert.deepEqual(collectionEnvironment(undefined), {});
  const base = apiPrivateEnvironment(ready, { host: 'c4g-postgres', centralDatabase: 'c4g_central_staging', administratorPassword: 'adm' });
  assert.match(base, /^FUNDING_TENDERS_SOURCE=unconfigured$/m);
  assert.doesNotMatch(base, /FUNDING_TENDERS_REHEARSAL_APPROVED/);
  for (const limit of ['5', 'all', 'all-sources']) {
    const text = apiPrivateEnvironment(ready, { host: 'c4g-postgres', centralDatabase: 'c4g_central_staging', administratorPassword: 'adm', collection: limit });
    assert.match(text, /^FUNDING_TENDERS_SOURCE=live-staging$/m);
    // Everything is collected only with durable coverage, which chains the pages; the trial run never enables it.
    assert.equal(/^FUNDING_TENDERS_COVERAGE=durable-v1$/m.test(text), limit !== '5');
    assert.ok(text.includes('FUNDING_TENDERS_REHEARSAL_APPROVED=' + COLLECTION_APPROVALS[limit]));
    assert.ok(Object.hasOwn(STAGING_APPROVALS, COLLECTION_APPROVALS[limit]), 'the installer only names approvals the code recognises');
  }
  assert.deepEqual(Object.keys(COLLECTION_APPROVALS).sort(), ['5', 'all', 'all-sources']);
  assert.doesNotMatch(base, /FUNDING_TENDERS_COVERAGE/);
  for (const bad of ['0', '7', '100', '1000', '', 'ALL', 'toString', '__proto__']) assert.throws(() => collectionEnvironment(bad), { code: 'STAGING_COLLECTION_INVALID' });
});

test('carry-over copies only the listed non-secret settings', () => {
  const carried = carriedSettings('AUTH_MODE=oidc\r\nSESSION_SECRET=secret\nCENTRAL_DATABASE_URL=postgresql://u:p@h/d\nOIDC_REDIRECT_URI=https://x/cb?a=1\n# note\nAUTH_POLICY_VERSION=c4g-assurance-v1\n=bad');
  assert.deepEqual(carried, { AUTH_MODE: 'oidc', OIDC_REDIRECT_URI: 'https://x/cb?a=1' });
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

test('upgrade: steps follow the registered chains, in order, up to the latest versions', () => {
  const central = require('../src/security/centralMigrationManifest');
  const tenant = require('../src/security/tenantMigrationManifest');
  const centralVersions = CENTRAL_STEPS.map(([to]) => to);
  assert.deepEqual(centralVersions, [...centralVersions].sort());
  assert.equal(centralVersions.at(-1), central.centralRuntimeReadManifest.at(-1).version);
  assert.ok(centralVersions.every(version => central.centralRuntimeReadManifest.some(entry => entry.version === version)));
  const tenantVersions = TENANT_STEPS.map(([to]) => to);
  assert.deepEqual(tenantVersions, [...tenantVersions].sort());
  assert.equal(tenantVersions.at(-1), tenant.chatRetentionManifest.at(-1).version);
  assert.ok(tenantVersions.every(version => tenant.chatRetentionManifest.some(entry => entry.version === version)));
  // Every step calls an operation that exists in the migrators it relies on.
  const recorder = calls => new Proxy({}, { get: (_, name) => (...args) => { calls.push(name); return args[0]; } });
  const centralOperations = Object.keys(require('../scripts/runCentralMigrations'));
  const tenantOperations = Object.keys(require('../src/security/tenantMigrationRunner'));
  for (const [, apply] of CENTRAL_STEPS) { const calls = []; apply(recorder(calls), {}); assert.ok(calls.length === 1 && centralOperations.includes(calls[0]), calls.join()); }
  for (const [, create] of TENANT_STEPS) { const calls = []; create(recorder(calls), {}); assert.ok(calls.length === 1 && tenantOperations.includes(calls[0]), calls.join()); }
});

test('upgrade: refuses unknown flags and an installation that is not ready, before any database work', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-staging-'));
  try {
    const env = { POSTGRES_PASSWORD: 'x', C4G_STAGING_STATE: path.join(folder, 'install.json') };
    await assert.rejects(() => main(['upgrade', '--bogus'], env), { code: 'STAGING_ARGUMENT_INVALID' });
    await assert.rejects(() => main(['upgrade', '--apply'], env), { code: 'STAGING_INSTALLATION_NOT_READY' });
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

// Regression: a fresh installation failed its own Central preflight (CATALOG_SECURITY_DRIFT) because the installer
// granted USAGE on opportunity_catalog to c4g_f12_admin, which no pinned fingerprint includes.
test('the schema installer does not change grants that the pinned Central fingerprints cover', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/localPlatform/schema.js'), 'utf8');
  assert.doesNotMatch(source, /GRANT\s+USAGE\s+ON\s+SCHEMA\s+opportunity_catalog\s+TO\s+c4g_f12_admin/i);
});
