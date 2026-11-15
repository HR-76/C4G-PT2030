'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { install, runtimeArtifacts, writeArtifacts, administrativeConnection } = require('../scripts/installProductionPlatform');
const { configDigest } = require('../scripts/productionBootstrap/config');

function config() {
  return { version: 1, installationId: '11111111-1111-4111-8111-111111111111',
    target: { host: 'production-postgres.invalid', port: 5432, expectedSystemIdentifier: '1234567890123456789',
      centralDatabase: 'prod_central', tenantDatabase: 'prod_tenant', ssl: { rejectUnauthorized: true } },
    organization: { id: '22222222-2222-4222-8222-222222222222', name: 'Synthetic entity', legalName: 'Synthetic entity',
      slug: 'synthetic', type: 'OTHER', currency: 'EUR', dataResidencyCode: 'EU' },
    tenant: { id: '33333333-3333-4333-8333-333333333333', generationId: '44444444-4444-4444-8444-444444444444',
      apiLogin: 'prod_tenant_api', credentialRef: 'production-tenant-api', regionCode: 'EU', residencyPolicyVersion: 'production-eu-v1' },
    administrator: { globalUserId: '55555555-5555-4555-8555-555555555555', membershipId: null,
      issuer: 'https://login.c4g.ai/realms/synthetic', subject: 'synthetic-subject', name: 'Synthetic administrator',
      email: 'admin@example.invalid', organizationProfile: null } };
}
function credentials() {
  const punctuation = ":!#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
  return { central: Object.fromEntries(['read', 'commands', 'authoring', 'logs', 'retention', 'catalog', 'authority']
    .map(key => [key, `synthetic-${key}-private-canary-${punctuation}`])),
  tenantApi: 'synthetic-tenant-private-canary-' + punctuation, permitSecret: 'e7'.repeat(32) };
}
function observer(input, { driftOnSecondObservation = false } = {}) {
  const statements = []; let observations = 0;
  const pool = { options: { host: input.target.host, port: input.target.port, database: 'postgres',
    user: 'synthetic_installer', password: 'private-admin-canary', ssl: input.target.ssl },
  async query(sql) {
    statements.push(sql); assert.match(sql, /^SELECT\b/);
    if (sql.includes('pg_control_system')) return { rows: [{ system_identifier: ++observations > 1 && driftOnSecondObservation
      ? '987' : input.target.expectedSystemIdentifier, database: 'postgres', version: '180006', admin: true }], rowCount: 1 };
    if (sql.includes('SELECT datname,')) return { rows: [{ datname: 'postgres', owner: 'synthetic_installer' }], rowCount: 1 };
    if (sql.includes('shobj_description') || sql.includes('SELECT 1 FROM pg_roles') || sql.includes('SELECT 1 FROM pg_class')) return { rows: [], rowCount: 0 };
    assert.fail('Unexpected inspection query');
  }, async connect() { assert.fail('Plan must not acquire a mutation connection'); } };
  return { pool, statements };
}
function verifiedUser(input) {
  return async () => ({ ok: true, async json() { return { id: input.administrator.subject, email: input.administrator.email,
    enabled: true, emailVerified: true, requiredActions: [] }; } });
}
function environment(source) {
  return Object.fromEntries(source.trimEnd().split('\n').map(line => {
    const equals = line.indexOf('='); return [line.slice(0, equals), line.slice(equals + 1)];
  }));
}
function observedDirectoryLink(t, directory) {
  // Windows sandbox can forbid junction creation. Model the filesystem observation
  // instead of skipping the security assertion or requiring machine privileges.
  const inspect = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (file, ...options) => {
    const stat = inspect(file, ...options);
    if (path.resolve(file) === path.resolve(directory)) stat.isSymbolicLink = () => true;
    return stat;
  });
}
const scratchParent = path.resolve(__dirname, '../../.tmp');
function scratch(t) {
  fs.mkdirSync(scratchParent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(scratchParent, 'production-bootstrap-unit-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), scratchParent);
    assert.match(path.basename(resolved), /^production-bootstrap-unit-/);
    assert.equal(fs.lstatSync(resolved).isSymbolicLink(), false);
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return directory;
}

test('default production installer plan only reads the target and never reads credentials or calls Keycloak', async () => {
  const input = config(), { pool, statements } = observer(input);
  const secret = new Proxy({}, { get() { assert.fail('Plan must not inspect secrets'); }, ownKeys() { assert.fail('Plan must not inspect secrets'); } });
  const receipt = await install({ adminPool: pool, config: input, credentials: secret,
    fetchImpl() { assert.fail('Plan must not call Keycloak'); }, onPhase() { assert.fail('Plan must not advance phases'); } });
  assert.deepEqual(receipt, { apply: false, installationId: input.installationId, intentDigest: configDigest(input),
    centralVersion: '058_platform_account_lifecycle', tenantVersion: '041_account_identity_erasure', resume: false,
    databases: ['prod_central', 'prod_tenant'], administratorVerification: 'REQUIRED_ON_APPLY' });
  assert.equal(statements.length, 5);
  assert.equal(JSON.stringify(receipt).includes('private-admin-canary'), false);
});

test('invalid apply or missing credentials cannot acquire the installation lock', async () => {
  const input = config(), { pool, statements } = observer(input);
  await assert.rejects(install({ adminPool: pool, config: input, apply: 'true' }), /PRODUCTION_APPLY_INVALID/);
  assert.equal(statements.length, 0);
  await assert.rejects(install({ adminPool: pool, config: input, apply: true,
    fetchImpl() { assert.fail('Missing credentials must fail before Keycloak'); } }), /PRODUCTION_BOOTSTRAP_CREDENTIALS_INVALID/);
  assert.equal(statements.length, 5);
});

test('unverified first administrator fails before lock or database writes', async () => {
  const input = config(), { pool, statements } = observer(input), requests = [];
  await assert.rejects(install({ adminPool: pool, config: input, credentials: credentials(), apply: true,
    identityToken: 'synthetic-private-token', async fetchImpl(url, options) {
      requests.push({ url, method: options.method, redirect: options.redirect });
      return { ok: true, async json() { return { id: input.administrator.subject, email: input.administrator.email,
        enabled: false, emailVerified: true, requiredActions: [] }; } };
    } }), /PRODUCTION_ADMINISTRATOR_UNVERIFIED/);
  assert.deepEqual(requests, [{ url: 'https://login.c4g.ai/admin/realms/synthetic/users/synthetic-subject', method: 'GET', redirect: 'error' }]);
  assert.equal(statements.length, 5);
});

test('busy installer lock is released without database mutations', async () => {
  const input = config(), { pool, statements } = observer(input); let released = false;
  pool.connect = async () => ({ async query(sql) { assert.match(sql, /^SELECT pg_try_advisory_lock/); return { rows: [{ acquired: false }] }; },
    release() { released = true; } });
  await assert.rejects(install({ adminPool: pool, config: input, credentials: credentials(), apply: true,
    identityToken: 'synthetic-private-token', fetchImpl: verifiedUser(input) }), /PRODUCTION_INSTALLER_ALREADY_RUNNING/);
  assert.equal(released, true); assert.equal(statements.length, 5);
});

test('target identity is rechecked under the lock and failure discards the guard before writes', async () => {
  const input = config(), { pool, statements } = observer(input, { driftOnSecondObservation: true }); let releaseError;
  pool.connect = async () => ({ async query(sql) { assert.match(sql, /^SELECT pg_try_advisory_lock/); return { rows: [{ acquired: true }] }; },
    release(error) { releaseError = error; } });
  await assert.rejects(install({ adminPool: pool, config: input, credentials: credentials(), apply: true,
    identityToken: 'synthetic-private-token', fetchImpl: verifiedUser(input) }), /PRODUCTION_SYSTEM_IDENTIFIER_MISMATCH/);
  assert.equal(releaseError?.message, 'PRODUCTION_INSTALLER_GUARD_DISPOSED');
  assert.equal(statements.length, 6);
});

test('runtime artifacts bind separate limited logins and safely encode punctuation in each database URL', () => {
  const input = config(), secrets = credentials(), receipt = { installed: true, installationId: input.installationId };
  const artifacts = runtimeArtifacts(input, secrets, receipt);
  const env = environment(artifacts['central-runtime.env']), retentionEnv = environment(artifacts['retention-runtime.env']);
  assert.equal(env.CENTRAL_RUNTIME_PROFILE, 'production-v1');
  const variables = { read: 'CENTRAL_DATABASE_URL', commands: 'CENTRAL_COMMANDS_DATABASE_URL', authoring: 'CENTRAL_AUTHORING_DATABASE_URL',
    logs: 'CENTRAL_LOGS_DATABASE_URL', retention: 'CENTRAL_EMAIL_RETENTION_DATABASE_URL', catalog: 'CATALOG_DATABASE_URL', authority: 'AUTHORITY_DATABASE_URL' };
  const logins = new Set();
  for (const [key, variable] of Object.entries(variables)) {
    const url = new URL((key === 'retention' ? retentionEnv : env)[variable]); logins.add(url.username);
    assert.equal(decodeURIComponent(url.password), secrets.central[key]);
    assert.equal(url.hostname, input.target.host); assert.equal(url.port, '5432'); assert.equal(url.pathname, '/prod_central');
    assert.equal(url.searchParams.get('sslmode'), 'verify-full'); assert.equal(url.hash, '');
  }
  assert.equal(logins.size, 7);
  assert.equal(Object.hasOwn(env, 'CENTRAL_EMAIL_RETENTION_DATABASE_URL'), false);
  assert.deepEqual(Object.keys(retentionEnv).sort(), ['CENTRAL_EMAIL_RETENTION_DATABASE_URL', 'CENTRAL_RUNTIME_PROFILE', 'NODE_ENV']);
  assert.equal(env.AUTHORITY_COMMIT_PERMIT_SECRET, secrets.permitSecret);
  assert.deepEqual(JSON.parse(artifacts['tenant-api-credentials.json']), [{ tenantId: input.tenant.id,
    credentialRef: input.tenant.credentialRef, connectionVersion: 1, host: input.target.host, port: 5432,
    database: 'prod_tenant', login: 'prod_tenant_api', password: secrets.tenantApi, ssl: true }]);
  assert.deepEqual(JSON.parse(artifacts['allowed-residency.json']), [{ regionCode: 'EU', policyVersion: 'production-eu-v1' }]);
  assert.deepEqual(JSON.parse(artifacts['bootstrap-receipt.json']), receipt);
  assert.equal(artifacts['bootstrap-receipt.json'].includes('private-canary'), false);
  assert.equal(JSON.stringify(artifacts).includes('private-admin-canary'), false);
  input.target.ssl = false;
  assert.equal(JSON.parse(runtimeArtifacts(input, secrets, receipt)['tenant-api-credentials.json'])[0].ssl, false);
});

test('custom CA is preserved in a separate artifact and bound to both runtime fragments', () => {
  const input = config(), ca = '-----BEGIN CERTIFICATE-----\nSYNTHETIC_TEST_ONLY\n-----END CERTIFICATE-----\n';
  input.target.ssl.ca = ca;
  const artifacts = runtimeArtifacts(input, credentials(), { installed: true });
  assert.equal(artifacts['postgres-ca.pem'], ca);
  assert.equal(environment(artifacts['central-runtime.env']).NODE_EXTRA_CA_CERTS, '/certs/ca.pem');
  assert.equal(environment(artifacts['retention-runtime.env']).NODE_EXTRA_CA_CERTS, '/certs/ca.pem');
});

test('administrative child pools use the admitted TLS target and omit URL options', () => {
  const input = config(), { pool } = observer(input);
  pool.options.ssl = false; pool.options.host = 'untrusted.invalid'; pool.options.options = '-c role=postgres';
  const options = administrativeConnection(pool, input, input.target.centralDatabase);
  assert.deepEqual(options.ssl, { rejectUnauthorized: true }); assert.equal(options.host, input.target.host);
  assert.equal(options.database, input.target.centralDatabase); assert.equal(options.user, 'synthetic_installer');
  assert.equal(options.options, '-c timezone=UTC');
});

test('private artifacts are replayable byte-for-byte but never overwrite conflicting existing data', t => {
  const directory = path.join(scratch(t), 'private'), artifacts = { 'receipt.json': '{"ok":true}\n', 'secret.env': 'PRIVATE=synthetic\n' };
  writeArtifacts(directory, artifacts); writeArtifacts(directory, artifacts);
  for (const [name, body] of Object.entries(artifacts)) assert.equal(fs.readFileSync(path.join(directory, name), 'utf8'), body);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(directory).mode & 0o077, 0);
    assert.equal(fs.statSync(path.join(directory, 'secret.env')).mode & 0o077, 0);
  }
  assert.throws(() => writeArtifacts(directory, { 'secret.env': 'PRIVATE=changed\n' }), /PRODUCTION_OUTPUT_CONFLICT/);
  assert.equal(fs.readFileSync(path.join(directory, 'secret.env'), 'utf8'), artifacts['secret.env']);
});

test('artifact output refuses directory links without following them', t => {
  const link = path.join(scratch(t), 'linked');
  fs.mkdirSync(link); observedDirectoryLink(t, link);
  assert.throws(() => writeArtifacts(link, { 'secret.env': 'PRIVATE=synthetic\n' }), /PRODUCTION_OUTPUT_DIRECTORY_UNSAFE/);
  assert.equal(fs.existsSync(path.join(link, 'secret.env')), false);
});

test('artifact output refuses a directory link in an ancestor before creating output files', t => {
  const link = path.join(scratch(t), 'linked');
  fs.mkdirSync(link); observedDirectoryLink(t, link);
  assert.throws(() => writeArtifacts(path.join(link, 'private'), { 'secret.env': 'PRIVATE=synthetic\n' }), /PRODUCTION_OUTPUT_DIRECTORY_UNSAFE/);
  assert.equal(fs.existsSync(path.join(link, 'private', 'secret.env')), false);
});
