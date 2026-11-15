'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig, validateCredentials, configDigest, identifier, literal, parseArguments } = require('../scripts/productionBootstrap/config');

function configuration() {
  return {
    version: 1, installationId: '11111111-1111-4111-8111-111111111111',
    target: { host: 'postgres-production.internal', port: 5432, expectedSystemIdentifier: '1234567890123456789',
      centralDatabase: 'production_central', tenantDatabase: 'production_tenant', ssl: { rejectUnauthorized: true } },
    organization: { id: '22222222-2222-4222-8222-222222222222', name: 'Synthetic organization',
      legalName: 'Synthetic organization test', slug: 'synthetic-organization', type: 'OTHER', currency: 'EUR', dataResidencyCode: 'EU' },
    tenant: { id: '33333333-3333-4333-8333-333333333333', generationId: '44444444-4444-4444-8444-444444444444',
      apiLogin: 'prod_tenant_api', credentialRef: 'production-tenant-api', regionCode: 'EU', residencyPolicyVersion: 'production-eu-v1' },
    administrator: { globalUserId: '55555555-5555-4555-8555-555555555555', membershipId: '66666666-6666-4666-8666-666666666666',
      issuer: 'https://login.c4g.ai/realms/c4g', subject: 'synthetic-subject', name: 'Synthetic administrator',
      email: 'admin@example.invalid', organizationProfile: 'ORG_ADMIN' }
  };
}
function credentials() {
  return { central: Object.fromEntries(['read', 'commands', 'authoring', 'logs', 'retention', 'catalog', 'authority']
    .map(name => [name, `${name}-synthetic-private-password-${'x'.repeat(32)}`])),
  tenantApi: 'tenant-synthetic-private-password-' + 'x'.repeat(32), permitSecret: 'a1'.repeat(32) };
}
const invalidConfig = { code: 'PRODUCTION_BOOTSTRAP_CONFIG_INVALID' };
const invalidCredentials = { code: 'PRODUCTION_BOOTSTRAP_CREDENTIALS_INVALID' };
const mutate = (path, value) => raw => {
  const parts = path.split('.');
  const last = parts.pop();
  parts.reduce((node, key) => node[key], raw)[last] = value;
};

test('production bootstrap config is closed, immutable and accepts explicit global-only administration', () => {
  const raw = configuration(), result = validateConfig(raw);
  assert.deepEqual(result, raw);
  assert.notEqual(result, raw);
  assert.equal(Object.isFrozen(result.target.ssl), true);
  raw.organization.name = 'Changed';
  assert.equal(result.organization.name, 'Synthetic organization');
  const globalOnly = configuration();
  globalOnly.administrator.organizationProfile = null;
  globalOnly.administrator.membershipId = null;
  assert.equal(validateConfig(globalOnly).administrator.membershipId, null);
});

test('production config rejects missing, unknown, unsafe or contradictory target fields without input disclosure', () => {
  const mutations = [
    mutate('version', 2), mutate('installationId', 'not-a-uuid'), mutate('unknown', 'secret-canary'),
    mutate('target.unknown', true), mutate('target.ssl.rejectUnauthorized', false), mutate('target.ssl.key', 'secret-canary'),
    mutate('target.ssl', false), mutate('target.host', 'postgres://secret-canary@host'), mutate('target.host', 'staging.internal'),
    mutate('target.host', 'production.staging.internal'), mutate('target.port', '5432'), mutate('target.port', 0), mutate('target.port', 65536),
    mutate('target.expectedSystemIdentifier', ''), mutate('target.expectedSystemIdentifier', '0123'),
    mutate('target.expectedSystemIdentifier', '18446744073709551616'), mutate('target.centralDatabase', 'staging_central'),
    mutate('target.centralDatabase', 'postgres'), mutate('target.tenantDatabase', 'production_central'),
    mutate('target.tenantDatabase', 'production_tenant;DROP DATABASE postgres'), mutate('tenant.apiLogin', 'c4g_authority_runtime'),
    mutate('tenant.apiLogin', 'pg_database_owner'), mutate('tenant.apiLogin', 'postgres'), mutate('tenant.apiLogin', 'prod_staging_api'),
    mutate('tenant.regionCode', 'LOCAL'), mutate('tenant.credentialRef', ''), mutate('tenant.credentialRef', 'https://secret-canary'),
    mutate('tenant.credentialRef', 'production:tenant'), mutate('tenant.credentialRef', 'production/tenant'), mutate('tenant.credentialRef', 'a'.repeat(257)),
    mutate('tenant.generationId', 'bad'), mutate('tenant.residencyPolicyVersion', ''),
    mutate('organization.slug', 'Invalid slug'), mutate('organization.type', 'other'), mutate('organization.type', 'UNREGISTERED_TYPE'), mutate('organization.currency', 'eur'),
    mutate('organization.dataResidencyCode', 'EU-WEST'), mutate('organization.name', ''),
    mutate('administrator.email', 'invalid'), mutate('administrator.organizationProfile', 'ADMIN'),
    mutate('administrator.organizationProfile', null), mutate('administrator.membershipId', null),
    mutate('administrator.subject', 'private\ncanary'), mutate('administrator.password', 'secret-canary')
  ];
  for (const change of mutations) {
    const value = configuration(); change(value);
    assert.throws(() => validateConfig(value), error => error.code === invalidConfig.code && !error.message.includes('canary'));
  }
  const missing = configuration(); delete missing.administrator.membershipId;
  assert.throws(() => validateConfig(missing), invalidConfig);
  for (const raw of [null, [], 'secret-canary', Object.assign(Object.create({ inherited: true }), configuration())]) {
    assert.throws(() => validateConfig(raw), invalidConfig);
  }
});

test('OIDC issuer must be the exact HTTPS realm issuer used by verification', () => {
  for (const issuer of ['http://login.c4g.ai/realms/c4g', 'https://user:secret@login.c4g.ai/realms/c4g',
    'https://login.c4g.ai/realms/c4g/', 'https://login.c4g.ai/realms/c4g?secret=canary',
    'https://login.c4g.ai/realms/c4g#canary', 'https://login.c4g.ai/realms/c4g/other', 'https://login.c4g.ai']) {
    const raw = configuration(); raw.administrator.issuer = issuer;
    assert.throws(() => validateConfig(raw), invalidConfig);
  }
});

test('insecure PostgreSQL is restricted to explicit disposable loopback injection', () => {
  const raw = configuration(); raw.target.ssl = false;
  assert.throws(() => validateConfig(raw, { allowInsecureLoopback: true }), invalidConfig);
  for (const host of ['127.0.0.1', '::1', 'localhost']) {
    raw.target.host = host;
    assert.throws(() => validateConfig(raw), invalidConfig);
    assert.equal(validateConfig(raw, { allowInsecureLoopback: true }).target.ssl, false);
  }
  raw.target.host = '127.0.0.1.example.invalid';
  assert.throws(() => validateConfig(raw, { allowInsecureLoopback: true }), invalidConfig);
});

test('credential file requires exactly nine strong independent secrets and never echoes them', () => {
  const raw = credentials(); assert.deepEqual(validateCredentials(raw), raw);
  for (const change of [mutate('tenantApi', 'short-secret-canary'), mutate('central.read', raw.tenantApi),
    mutate('permitSecret', raw.tenantApi), mutate('central.unknown', 'secret-canary'), mutate('adminUrl', 'secret-canary'),
    mutate('central.authority', 'x'.repeat(31)), mutate('central.commands', 'x'.repeat(32) + '\0'),
    mutate('central.commands', 'x'.repeat(32) + 'é'), mutate('central.commands', 'x'.repeat(32) + ' ')]) {
    const value = credentials(); change(value);
    assert.throws(() => validateCredentials(value), error => error.code === invalidCredentials.code && !error.message.includes('canary'));
  }
  const missing = credentials(); delete missing.permitSecret;
  assert.throws(() => validateCredentials(missing), invalidCredentials);
});

test('permit key must satisfy the real production runtime hexadecimal secret contract', () => {
  const { requireProductionSecret } = require('../src/security/secretFormat');
  for (const permitSecret of ['synthetic-private-secret-canary-32', 'a'.repeat(32), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64)]) {
    assert.throws(() => validateCredentials({ ...credentials(), permitSecret }), invalidCredentials);
  }
  for (const permitSecret of ['a1'.repeat(32), 'B2'.repeat(64)]) {
    const validated = validateCredentials({ ...credentials(), permitSecret });
    assert.doesNotThrow(() => requireProductionSecret({ NODE_ENV: 'production', AUTHORITY_COMMIT_PERMIT_SECRET: validated.permitSecret },
      'AUTHORITY_COMMIT_PERMIT_SECRET'));
  }
  const duplicate = credentials(); duplicate.central.authority = duplicate.permitSecret;
  assert.throws(() => validateCredentials(duplicate), invalidCredentials);
});

test('intent digest is stable across key order, changes with intent and refuses secret fields', () => {
  const raw = configuration();
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).reverse().map(key => [key, reorder(value[key])])) : value;
  assert.equal(configDigest(raw), configDigest(reorder(raw)));
  assert.match(configDigest(raw), /^[a-f0-9]{64}$/);
  const changed = configuration(); changed.target.expectedSystemIdentifier = '123';
  assert.notEqual(configDigest(changed), configDigest(raw));
  raw.credentials = credentials();
  assert.throws(() => configDigest(raw), invalidConfig);
});

test('SQL helpers reject identifier injection and safely quote apostrophes and backslashes', () => {
  assert.equal(identifier('production_central'), '"production_central"');
  for (const name of ['bad"role', 'role;DROP', 'a\0b', '', undefined]) assert.throws(() => identifier(name));
  assert.equal(literal("a'b\\c"), "E'a''b\\\\c'");
  for (const value of [null, {}, 'bad\0value']) assert.throws(() => literal(value));
});

test('CLI only accepts explicit paths and apply, with neither secret values nor unsafe implicit defaults', () => {
  assert.deepEqual(parseArguments(['--config', 'config.json', '--output-dir', 'private']),
    { config: 'config.json', credentials: null, outputDir: 'private', apply: false });
  assert.deepEqual(parseArguments(['--apply', '--credentials', 'private.json', '--config', 'config.json', '--output-dir', 'private']),
    { config: 'config.json', credentials: 'private.json', outputDir: 'private', apply: true });
  for (const args of [[], ['--config'], ['--config', '--apply'], ['--config', 'a', '--output-dir', 'b', '--apply'],
    ['--config', 'a', '--config', 'b', '--output-dir', 'c'], ['--config', 'a', '--output-dir', 'b', '--apply', '--apply'],
    ['--config', 'a', '--output-dir', 'b', '--database-url', 'postgres://secret-canary'],
    ['--config=a', '--output-dir=b'], ['--config', 'https://secret-canary', '--output-dir', 'b'],
    ['--config', 'a', '--output-dir', ''], ['--config', 'a', '--output-dir', 'b', 'secret-canary']]) {
    assert.throws(() => parseArguments(args), error => error.code === 'PRODUCTION_BOOTSTRAP_ARGUMENTS_INVALID' && !error.message.includes('canary'));
  }
});
