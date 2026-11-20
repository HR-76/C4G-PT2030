'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { prepare, parseArguments } = require('../scripts/prepareProductionIdentity');
const { install } = require('../scripts/installProductionPlatform');
const { parseArguments: installerArguments } = require('../scripts/productionBootstrap/config');
const { runtimeConfigDigest } = require('../scripts/productionBootstrap/runtimeConfiguration');
const { fixture } = require('../../test/integration/production-bootstrap/runtime-inputs.cjs');

const root = path.resolve(__dirname, '../..');
const scratchParent = path.join(root, '.tmp');
function scratch(t) {
  fs.mkdirSync(scratchParent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(scratchParent, 'production-identity-unit-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), scratchParent);
    assert.match(path.basename(directory), /^production-identity-unit-/);
    assert.equal(fs.lstatSync(directory).isSymbolicLink(), false);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
function config() {
  const id = digit => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
  return { version: 1, installationId: id('1'),
    target: { host: 'production-postgres.invalid', port: 5432, expectedSystemIdentifier: '1234567890123456789',
      centralDatabase: 'production_central', tenantDatabase: 'production_tenant', ssl: { rejectUnauthorized: true } },
    organization: { id: id('2'), name: 'Synthetic entity', legalName: 'Synthetic entity', slug: 'synthetic',
      type: 'OTHER', currency: 'EUR', dataResidencyCode: 'EU' },
    tenant: { id: id('3'), generationId: id('4'), apiLogin: 'production_tenant_api', credentialRef: 'production-api',
      regionCode: 'EU', residencyPolicyVersion: 'production-eu-v1' },
    administrator: { globalUserId: id('5'), membershipId: null, issuer: 'https://login.example.invalid/realms/production',
      subject: 'synthetic-subject', name: 'Synthetic administrator', email: 'admin@example.invalid', organizationProfile: null } };
}
function credentials() {
  return { central: Object.fromEntries(['read', 'commands', 'authoring', 'logs', 'retention', 'catalog', 'authority']
    .map(key => [key, randomBytes(32).toString('hex')])), tenantApi: randomBytes(32).toString('hex'), permitSecret: randomBytes(32).toString('hex') };
}
function observer(input) {
  const queries = [];
  const pool = { options: { ...input.target, database: 'postgres' }, async query(sql) {
    queries.push(sql); assert.match(sql, /^SELECT\b/);
    if (sql.includes('pg_control_system')) return { rows: [{ system_identifier: input.target.expectedSystemIdentifier,
      database: 'postgres', version: '170006', admin: true }], rowCount: 1 };
    if (sql.includes('SELECT datname,')) return { rows: [{ datname: 'postgres', owner: 'synthetic_installer' }], rowCount: 1 };
    if (sql.includes('shobj_description') || sql.includes('SELECT 1 FROM pg_roles') || sql.includes('SELECT 1 FROM pg_class')) return { rows: [], rowCount: 0 };
    assert.fail('Unexpected target inspection');
  }, async connect() { assert.fail('Validation must not acquire a mutation connection'); } };
  return { pool, queries };
}
const unreadableSecret = () => new Proxy({}, { get() { assert.fail('Plan inspected credentials'); }, ownKeys() { assert.fail('Plan inspected credentials'); } });

test('identity can be planned before the realm, entity or first administrator exists', t => {
  const directory = scratch(t), outputDir = path.join(directory, 'not-created');
  const { runtimeConfig } = fixture(config());
  const result = prepare({ runtimeConfig, runtimeCredentials: unreadableSecret(), outputDir });
  assert.deepEqual(result, { prepared: false, runtimeConfigurationDigest: runtimeConfigDigest(runtimeConfig),
    files: ['keycloak-production.json', 'c4g-activation.properties'], providerContacted: false });
  assert.equal(fs.existsSync(outputDir), false);
  assert.deepEqual(parseArguments(['--runtime-config', 'runtime.json', '--output-dir', 'private']),
    { write: false, runtimeConfig: 'runtime.json', outputDir: 'private' });
});

test('identity CLI default plan ignores the supplied secret path and emits only a public receipt', t => {
  const directory = scratch(t), runtimePath = path.join(directory, 'runtime.json'), outputDir = path.join(directory, 'not-created');
  const { runtimeConfig } = fixture(config());
  fs.writeFileSync(runtimePath, JSON.stringify(runtimeConfig));
  const result = spawnSync(process.execPath, [path.join(root, 'backend/scripts/prepareProductionIdentity.js'),
    '--runtime-config', runtimePath, '--runtime-credentials', path.join(directory, 'nonexistent-private.json'), '--output-dir', outputDir],
  { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.prepared, false); assert.equal(receipt.providerContacted, false);
  assert.equal(Object.hasOwn(receipt, 'installationId'), false);
  assert.equal(fs.existsSync(outputDir), false);
});

test('identity preparation still binds an optional known bootstrap configuration', () => {
  const bootstrapConfig = config(), { runtimeConfig } = fixture(bootstrapConfig);
  assert.equal(prepare({ bootstrapConfig, runtimeConfig }).installationId, bootstrapConfig.installationId);
  const changed = structuredClone(runtimeConfig); changed.identity.issuer = 'https://login.example.invalid/realms/other';
  assert.throws(() => prepare({ bootstrapConfig, runtimeConfig: changed }), /PRODUCTION_RUNTIME_CONFIG_INVALID/);
  bootstrapConfig.target.ssl = false;
  assert.throws(() => prepare({ bootstrapConfig, runtimeConfig }), /PRODUCTION_BOOTSTRAP_CONFIG_INVALID/);
});

test('identity write explicitly creates only the private realm and bridge files and never returns secrets', t => {
  const directory = scratch(t), outputDir = path.join(directory, 'private');
  const input = fixture(config());
  const result = prepare({ ...input, outputDir, write: true });
  assert.deepEqual(fs.readdirSync(outputDir).sort(), ['c4g-activation.properties', 'keycloak-production.json']);
  const realmFile = path.join(outputDir, 'keycloak-production.json');
  const first = fs.readFileSync(realmFile, 'utf8'), realm = JSON.parse(first);
  assert.equal(realm.smtpServer.password, input.runtimeCredentials.smtpPassword);
  assert.match(fs.readFileSync(path.join(outputDir, 'c4g-activation.properties'), 'utf8'), new RegExp('secret=' + input.runtimeCredentials.memberBridgeSecret));
  assert.equal(result.prepared, true); assert.equal(result.providerContacted, false);
  for (const value of Object.values(input.runtimeCredentials)) assert.equal(JSON.stringify(result).includes(value), false);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(outputDir).mode & 0o777, 0o700);
    for (const name of result.files) assert.equal(fs.statSync(path.join(outputDir, name)).mode & 0o777, 0o600);
  }
  assert.deepEqual(prepare({ ...input, outputDir, write: true }), result);
  assert.equal(fs.readFileSync(realmFile, 'utf8'), first);
  const changed = { ...input.runtimeCredentials, smtpPassword: randomBytes(32).toString('hex') };
  assert.throws(() => prepare({ ...input, runtimeCredentials: changed, outputDir, write: true }), /PRODUCTION_OUTPUT_CONFLICT/);
  assert.equal(fs.readFileSync(realmFile, 'utf8'), first);
});

test('identity preparation rejects malformed input before creating any private output', t => {
  const directory = scratch(t), outputDir = path.join(directory, 'not-created'), input = fixture(config());
  assert.throws(() => prepare({ ...input, outputDir, write: 'true' }), /PRODUCTION_IDENTITY_ARGUMENT_INVALID/);
  assert.throws(() => prepare({ runtimeConfig: input.runtimeConfig, outputDir, write: true }), /PRODUCTION_RUNTIME_CREDENTIALS_INVALID/);
  const changed = structuredClone(input.runtimeConfig); changed.app.oidcClientId = '../escaped';
  assert.throws(() => prepare({ ...input, runtimeConfig: changed, outputDir, write: true }), /PRODUCTION_RUNTIME_CONFIG_INVALID/);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('identity write refuses a linked output ancestor and a linked artifact', t => {
  const directory = scratch(t), ancestor = path.join(directory, 'ancestor'); fs.mkdirSync(ancestor);
  const outputDir = path.join(ancestor, 'private'), input = fixture(config()), inspect = fs.lstatSync;
  // Model the filesystem observation: Windows junction creation may require privileges.
  const link = t.mock.method(fs, 'lstatSync', (file, ...args) => {
    const stat = inspect(file, ...args);
    if (path.resolve(file) === ancestor) stat.isSymbolicLink = () => true;
    return stat;
  });
  assert.throws(() => prepare({ ...input, outputDir, write: true }), /PRODUCTION_OUTPUT_DIRECTORY_UNSAFE/);
  assert.equal(fs.existsSync(outputDir), false); link.mock.restore();
  prepare({ ...input, outputDir, write: true });
  const file = path.join(outputDir, 'keycloak-production.json'), before = fs.readFileSync(file, 'utf8');
  const fileLink = t.mock.method(fs, 'lstatSync', (candidate, ...args) => {
    const stat = inspect(candidate, ...args);
    if (path.resolve(candidate) === file) stat.isSymbolicLink = () => true;
    return stat;
  });
  assert.throws(() => prepare({ ...input, outputDir, write: true }), /PRODUCTION_OUTPUT_CONFLICT/);
  assert.equal(fs.readFileSync(file, 'utf8'), before); fileLink.mock.restore();
});

test('identity CLI rejects unknown, repeated, remote and incomplete flags', () => {
  const valid = ['--runtime-config', 'runtime.json', '--output-dir', 'private'];
  for (const argv of [[], ['--runtime-config', 'runtime.json'], [...valid, '--write'], [...valid, '--deploy'],
    [...valid, '--runtime-config', 'other.json'], [...valid, '--write', '--write', '--runtime-credentials', 'secret.json'],
    ['--runtime-config', 'https://private.invalid/config', '--output-dir', 'private'], [...valid, '--runtime-credentials', '--write']]) {
    assert.throws(() => parseArguments(argv), /PRODUCTION_IDENTITY_ARGUMENT_INVALID/);
  }
  assert.equal(parseArguments([...valid, '--write', '--runtime-credentials', 'secret.json']).write, true);
});

test('installer runtime plan reads only the admitted target and public configuration', async () => {
  const input = config(), { runtimeConfig } = fixture(input), { pool, queries } = observer(input);
  const receipt = await install({ adminPool: pool, config: input, runtimeConfig,
    credentials: unreadableSecret(), runtimeCredentials: unreadableSecret(),
    fetchImpl() { assert.fail('Plan contacted identity'); }, onRuntimeArtifacts() { assert.fail('Plan exported secrets'); } });
  assert.equal(receipt.apply, false); assert.equal(receipt.runtimeConfigurationDigest, runtimeConfigDigest(runtimeConfig));
  assert.equal(queries.length, 5); assert.equal(Object.hasOwn(receipt, 'runtimeCredentials'), false);
});

test('installer refuses detached or malformed runtime configuration before target access', async () => {
  const input = config(), runtime = fixture(input), { pool, queries } = observer(input);
  await assert.rejects(install({ adminPool: pool, config: input, runtimeCredentials: runtime.runtimeCredentials }), /PRODUCTION_RUNTIME_CONFIGURATION_REQUIRED/);
  const changed = structuredClone(runtime.runtimeConfig); changed.identity.issuer = 'https://login.example.invalid/realms/other';
  await assert.rejects(install({ adminPool: pool, config: input, runtimeConfig: changed }), /PRODUCTION_RUNTIME_CONFIG_INVALID/);
  await assert.rejects(install({ adminPool: pool, config: input, ...runtime, apply: 'true' }), /PRODUCTION_APPLY_INVALID/);
  assert.equal(queries.length, 0);
});

test('installer cannot silently interpret a supplied falsey runtime configuration as disabled', async () => {
  const input = config(), { pool, queries } = observer(input);
  for (const runtimeConfig of [false, 0, '']) {
    await assert.rejects(install({ adminPool: pool, config: input, runtimeConfig }), /PRODUCTION_RUNTIME_CONFIG_INVALID/);
  }
  assert.equal(queries.length, 0);
});

test('installer refuses omitted runtime settings on a runtime-owned installation in both plan and apply', async () => {
  for (const apply of [false, true]) {
    const input = config(), { pool } = observer(input), inspect = pool.query;
    let runtimeInspected = false;
    pool.query = async (sql, values) => {
      if (sql.includes('pg_roles') && (sql.includes('c4g_prod_runtime_configuration') || values?.includes('c4g_prod_runtime_configuration'))) {
        assert.match(sql, /^SELECT\b/); runtimeInspected = true;
        return { rows: [{ '?column?': 1 }], rowCount: 1 };
      }
      return inspect(sql, values);
    };
    await assert.rejects(install({ adminPool: pool, config: input, apply, credentials: credentials(),
      fetchImpl() { assert.fail('Missing runtime settings contacted identity'); },
      onPhase() { assert.fail('Missing runtime settings advanced a mutation phase'); },
      onRuntimeArtifacts() { assert.fail('Missing runtime settings exported artifacts'); } }), /PRODUCTION_RUNTIME_CONFIGURATION_REQUIRED/);
    assert.equal(runtimeInspected, true);
  }
});

test('installer CLI rejects a present JSON null runtime configuration before reading connection settings', t => {
  const directory = scratch(t), configPath = path.join(directory, 'bootstrap.json'), runtimePath = path.join(directory, 'runtime.json');
  fs.writeFileSync(configPath, JSON.stringify(config())); fs.writeFileSync(runtimePath, 'null');
  const env = { ...process.env }; delete env.PRODUCTION_INSTALL_DATABASE_URL;
  const result = spawnSync(process.execPath, [path.join(root, 'backend/scripts/installProductionPlatform.js'),
    '--config', configPath, '--runtime-config', runtimePath, '--output-dir', path.join(directory, 'not-created')],
  { cwd: root, env, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'PRODUCTION_RUNTIME_CONFIG_INVALID');
  assert.equal(fs.existsSync(path.join(directory, 'not-created')), false);
});

test('installer validates runtime credentials and rejects cross-process secret reuse before identity or mutation', async () => {
  const input = config(), runtime = fixture(input), { pool } = observer(input), secrets = credentials();
  const options = { adminPool: pool, config: input, credentials: secrets, runtimeConfig: runtime.runtimeConfig, apply: true,
    fetchImpl() { assert.fail('Invalid runtime credentials contacted identity'); }, onRuntimeArtifacts() { assert.fail('Invalid runtime exported secrets'); } };
  await assert.rejects(install(options), /PRODUCTION_RUNTIME_CREDENTIALS_INVALID/);
  for (const reused of [secrets.central.commands, secrets.tenantApi, secrets.permitSecret]) {
    await assert.rejects(install({ ...options, runtimeCredentials: { ...runtime.runtimeCredentials, smtpPassword: reused } }), /PRODUCTION_RUNTIME_SECRETS_MUST_BE_SEPARATE/);
  }
});

test('installer verifies the first administrator through the admitted private identity origin', async () => {
  const input = config(), runtime = fixture(input), { pool } = observer(input), requests = [];
  let released = false;
  pool.connect = async () => ({ async query(sql) {
    assert.match(sql, /^SELECT pg_try_advisory_lock/); return { rows: [{ acquired: false }] };
  }, release() { released = true; } });
  await assert.rejects(install({ adminPool: pool, config: input, credentials: credentials(), ...runtime,
    apply: true, identityToken: 'synthetic-private-token', async fetchImpl(url, options) {
      requests.push({ url, method: options.method, redirect: options.redirect });
      return { ok: true, async json() { return { id: input.administrator.subject, email: input.administrator.email,
        enabled: true, emailVerified: true, requiredActions: [] }; } };
    } }), /PRODUCTION_INSTALLER_ALREADY_RUNNING/);
  assert.deepEqual(requests, [{ url: 'http://c4g-production-keycloak:8080/admin/realms/production/users/synthetic-subject', method: 'GET', redirect: 'error' }]);
  assert.equal(released, true);
});

test('installer runtime CLI requires paired private inputs only for explicit apply', () => {
  const base = ['--config', 'bootstrap.json', '--output-dir', 'private'];
  assert.equal(installerArguments([...base, '--runtime-config', 'runtime.json']).apply, false);
  for (const argv of [[...base, '--runtime-credentials', 'secret.json'],
    [...base, '--apply', '--credentials', 'db.json', '--runtime-config', 'runtime.json']]) {
    assert.throws(() => installerArguments(argv), /PRODUCTION_BOOTSTRAP_ARGUMENTS_INVALID/);
  }
  const parsed = installerArguments([...base, '--apply', '--credentials', 'db.json', '--runtime-config', 'runtime.json', '--runtime-credentials', 'runtime-private.json']);
  assert.equal(parsed.apply, true); assert.equal(parsed.runtimeCredentials, 'runtime-private.json');
});
