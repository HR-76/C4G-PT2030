'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { validateConfig, validateCredentials, configDigest, parseArguments } = require('./productionBootstrap/config');
const { inspectTarget, ensureDatabases } = require('./productionBootstrap/cluster');
const { installCentral, provisionCentralProfiles, validateCentralProfiles } = require('./productionBootstrap/central');
const { withInstallerAuthority, inspectRole } = require('./localPlatform/installerAuthority');
const CENTRAL_VERSION = require('../src/security/platformAccountLifecycleMigrationPackage').entry.version;
const TENANT_VERSION = require('../src/security/tenantMigrationManifest').accountIdentityErasureManifest.at(-1).version;

function administrativeConnection(adminPool, config, database) {
  return { host: config.target.host, port: config.target.port, ssl: config.target.ssl, database,
    user: adminPool.options.user, password: adminPool.options.password, max: 3, connectionTimeoutMillis: 10000,
    statement_timeout: 180000, idle_in_transaction_session_timeout: 180000, options: '-c timezone=UTC' };
}

// Insecure loopback is available only to the in-process disposable integration gate;
// it has no CLI flag or environment switch. The CLI always verifies TLS.
async function install({ adminPool, config: input, credentials: privateInput, apply = false, identityToken,
  fetchImpl, allowInsecureLoopback = false, onPhase = async () => {}, afterMigrationSql = null,
  runtimeConfig: runtimeInput = null, runtimeCredentials: runtimePrivateInput = null, onRuntimeArtifacts = async () => {} }) {
  const config = validateConfig(input, { allowInsecureLoopback });
  if (typeof apply !== 'boolean') throw Error('PRODUCTION_APPLY_INVALID');
  if (runtimePrivateInput !== null && runtimeInput === null) throw Error('PRODUCTION_RUNTIME_CONFIGURATION_REQUIRED');
  const runtimeModule = runtimeInput !== null ? require('./productionBootstrap/runtimeConfiguration') : null;
  const runtimeConfig = runtimeModule?.validateRuntimeConfig(runtimeInput, config);
  const observed = await inspectTarget(adminPool, config);
  const requireBoundRuntime = async () => {
    if (!runtimeConfig && (await adminPool.query('SELECT 1 FROM pg_roles WHERE rolname=$1',
      [require('./productionBootstrap/runtimeIntent').ROLE])).rowCount) throw Error('PRODUCTION_RUNTIME_CONFIGURATION_REQUIRED');
  };
  await requireBoundRuntime();
  const plan = { installationId: config.installationId, intentDigest: configDigest(config),
    centralVersion: CENTRAL_VERSION, tenantVersion: TENANT_VERSION, resume: observed.resume,
    databases: [config.target.centralDatabase, config.target.tenantDatabase],
    ...(runtimeConfig ? { runtimeConfigurationDigest: runtimeModule.runtimeConfigDigest(runtimeConfig) } : {}) };
  if (!apply) return { apply: false, ...plan, administratorVerification: 'REQUIRED_ON_APPLY' };
  const credentials = validateCredentials(privateInput);
  const runtimeCredentials = runtimeConfig ? runtimeModule.validateRuntimeCredentials(runtimePrivateInput) : null;
  if (runtimeCredentials) {
    const secrets = [...Object.values(credentials.central), credentials.tenantApi, credentials.permitSecret, ...Object.values(runtimeCredentials)];
    if (new Set(secrets).size !== secrets.length) throw Error('PRODUCTION_RUNTIME_SECRETS_MUST_BE_SEPARATE');
  }
  const identity = require('./productionBootstrap/identity');
  const identityProof = await identity.verifyAdministrator(config, { token: identityToken, fetchImpl, adminOrigin: runtimeConfig?.identity.adminOrigin });
  const guard = await adminPool.connect(), pools = [];
  const own = options => { const pool = new Pool(options); pools.push(pool); return pool; };
  let locked = false;
  try {
    const row = (await guard.query('SELECT pg_try_advisory_lock(43001508,1) AS acquired')).rows[0];
    if (!row?.acquired) throw Error('PRODUCTION_INSTALLER_ALREADY_RUNNING');
    locked = true;
    await inspectTarget(adminPool, config);
    await requireBoundRuntime();
    await ensureDatabases(adminPool, config, credentials);
    if (runtimeConfig) {
      const intent = require('./productionBootstrap/runtimeIntent');
      await intent.bindRuntimeIntent({ pool: adminPool, installationMarker: require('./productionBootstrap/cluster').ownership(config),
        publicDigest: plan.runtimeConfigurationDigest, material: intent.runtimeSecretProof(runtimeConfig, runtimeCredentials) });
    }
    await onPhase('databases-ready');
    const centralPool = own(administrativeConnection(adminPool, config, config.target.centralDatabase));
    const tenantPool = own(administrativeConnection(adminPool, config, config.target.tenantDatabase));
    let tenant;
    await withInstallerAuthority(adminPool, { create: false }, async () => {
      await installCentral({ centralPool, config, afterMigrationSql });
      await onPhase('central-migrated');
      await require('../src/audit/partitionMaintenance').ensureAuditPartitionsWithPool(centralPool);
      await provisionCentralProfiles({ centralPool, config, credentials });
      if (runtimeConfig) await require('./productionBootstrap/billing').provisionBillingProfile({ centralPool, config, password: runtimeCredentials.billingDatabasePassword });
      await onPhase('central-profiles-ready');
      tenant = await require('./productionBootstrap/tenant').installTenant({ adminPool, tenantPool, config, credentials });
      await onPhase('tenant-ready');
    });
    const technical = await inspectRole(adminPool);
    if (technical.can_login || technical.superuser || technical.members) throw Error('PRODUCTION_INSTALLER_ROLE_UNSAFE');
    const logins = await validateCentralProfiles({ config, credentials, Pool });
    if (runtimeConfig) {
      const billing = require('./productionBootstrap/billing');
      await billing.validateBillingProfile({ config, password: runtimeCredentials.billingDatabasePassword, Pool });
      logins.billingMail = billing.BILLING_LOGIN;
    }
    await require('../src/security/centralMigrationPreflight').preflightCentral(centralPool);
    const authorityPool = own({ ...administrativeConnection(adminPool, config, config.target.centralDatabase),
      user: 'c4g_authority_runtime', password: credentials.central.authority });
    await identity.bootstrapIdentity({ centralPool, authorityPool, ...tenant, config, identityProof,
      permitSecret: credentials.permitSecret, onPhase });
    if (runtimeConfig) {
      const coordinator = require('../src/security/authorityCoordinator').createAuthorityCoordinator({ pool: authorityPool, permitSecret: credentials.permitSecret });
      const directory = require('../src/security/tenantDirectoryReader').createTenantDirectoryReader({ coordinator, organizations: [config.organization.id], workload: 'API' });
      const snapshot = await directory.resolveSnapshotByOrganization(config.organization.id, 'API');
      await onRuntimeArtifacts(runtimeModule.buildRuntimeArtifacts({ bootstrapConfig: config, runtimeConfig, runtimeCredentials,
        tenantCredentials: tenant.tenantCredentials, snapshot }));
    }
    await onPhase('identity-ready');
    return { installed: true, installationId: plan.installationId, intentDigest: plan.intentDigest,
      centralVersion: CENTRAL_VERSION, tenantVersion: TENANT_VERSION, organizationId: config.organization.id,
      tenantId: config.tenant.id, administratorId: config.administrator.globalUserId,
      organizationProfile: config.administrator.organizationProfile, mfa: 'OPTIONAL', logins: { ...logins, tenantApi: config.tenant.apiLogin },
      ...(runtimeConfig ? { runtimeConfigurationDigest: plan.runtimeConfigurationDigest } : {}) };
  } finally {
    await Promise.allSettled(pools.map(pool => pool.end()));
    // Discarding this session releases the cluster-wide installation lock even after failure.
    guard.release(locked ? new Error('PRODUCTION_INSTALLER_GUARD_DISPOSED') : undefined);
  }
}

function runtimeArtifacts(config, credentials, receipt) {
  const logins = { ...require('./installProductionCentral').LOGINS, authority: 'c4g_authority_runtime' };
  const variables = { read: 'CENTRAL_DATABASE_URL', commands: 'CENTRAL_COMMANDS_DATABASE_URL', authoring: 'CENTRAL_AUTHORING_DATABASE_URL',
    logs: 'CENTRAL_LOGS_DATABASE_URL', catalog: 'CATALOG_DATABASE_URL', authority: 'AUTHORITY_DATABASE_URL', retention: 'CENTRAL_EMAIL_RETENTION_DATABASE_URL' };
  const lines = ['CENTRAL_RUNTIME_PROFILE=production-v1', 'PROFILE_EDITORIAL_RUNTIME=f13-editorial', 'PQ1_ACTIVATION_RUNTIME=f13-f14-pq1'];
  const retentionLines = ['NODE_ENV=production', 'CENTRAL_RUNTIME_PROFILE=production-v1'];
  for (const [key, login] of Object.entries(logins)) {
    const url = new URL('postgresql://localhost');
    url.hostname = config.target.host.includes(':') ? `[${config.target.host}]` : config.target.host;
    url.port = String(config.target.port); url.pathname = '/' + config.target.centralDatabase;
    url.username = encodeURIComponent(login); url.password = encodeURIComponent(credentials.central[key]); url.searchParams.set('sslmode', 'verify-full');
    (key === 'retention' ? retentionLines : lines).push(variables[key] + '=' + url.href);
  }
  lines.push('AUTHORITY_COMMIT_PERMIT_SECRET=' + credentials.permitSecret);
  if (config.target.ssl?.ca) {
    lines.push('NODE_EXTRA_CA_CERTS=/certs/ca.pem');
    retentionLines.push('NODE_EXTRA_CA_CERTS=/certs/ca.pem');
  }
  const tenant = { tenantId: config.tenant.id, credentialRef: config.tenant.credentialRef, connectionVersion: 1,
    host: config.target.host, port: config.target.port, database: config.target.tenantDatabase,
    login: config.tenant.apiLogin, password: credentials.tenantApi, ssl: Boolean(config.target.ssl) };
  return { 'central-runtime.env': lines.join('\n') + '\n', 'retention-runtime.env': retentionLines.join('\n') + '\n',
    ...(config.target.ssl?.ca ? { 'postgres-ca.pem': config.target.ssl.ca } : {}), 'tenant-api-credentials.json': JSON.stringify([tenant], null, 2) + '\n',
    'allowed-residency.json': JSON.stringify([{ regionCode: config.tenant.regionCode, policyVersion: config.tenant.residencyPolicyVersion }], null, 2) + '\n',
    'bootstrap-receipt.json': JSON.stringify(receipt, null, 2) + '\n' };
}
function writeArtifacts(directory, artifacts) {
  for (let current = path.resolve(directory);;) {
    try {
      const entry = fs.lstatSync(current);
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw Error('PRODUCTION_OUTPUT_DIRECTORY_UNSAFE');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink()) throw Error('PRODUCTION_OUTPUT_DIRECTORY_UNSAFE');
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
  for (const [name, body] of Object.entries(artifacts)) {
    if (!/^[a-z][a-z0-9.-]*$/.test(name) || typeof body !== 'string') throw Error('PRODUCTION_OUTPUT_ARTIFACT_INVALID');
    const file = path.join(directory, name);
    if (fs.existsSync(file)) {
      if (fs.lstatSync(file).isSymbolicLink() || fs.readFileSync(file, 'utf8') !== body) throw Error('PRODUCTION_OUTPUT_CONFLICT');
      if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
    } else fs.writeFileSync(file, body, { flag: 'wx', mode: 0o600 });
  }
}
async function main() {
  const args = parseArguments(process.argv.slice(2));
  const config = validateConfig(JSON.parse(fs.readFileSync(args.config, 'utf8')));
  const credentials = args.apply ? validateCredentials(JSON.parse(fs.readFileSync(args.credentials, 'utf8'))) : undefined;
  const runtimeConfig = args.runtimeConfig ? require('./productionBootstrap/runtimeConfiguration').validateRuntimeConfig(
    JSON.parse(fs.readFileSync(args.runtimeConfig, 'utf8')), config) : null;
  const runtimeCredentials = args.apply && args.runtimeCredentials ? JSON.parse(fs.readFileSync(args.runtimeCredentials, 'utf8')) : null;
  let url;
  try { url = new URL(process.env.PRODUCTION_INSTALL_DATABASE_URL); } catch { throw Error('PRODUCTION_ADMIN_CONNECTION_REQUIRED'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname.replace(/^\[|\]$/g, '') !== config.target.host
    || Number(url.port || 5432) !== config.target.port || url.pathname !== '/postgres' || !url.username || !url.password)
    throw Error('PRODUCTION_CONNECTION_TARGET_MISMATCH');
  const adminPool = new Pool({ host: config.target.host, port: config.target.port, database: 'postgres', ssl: config.target.ssl,
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), max: 4, connectionTimeoutMillis: 10000 });
  try {
    let preparedRuntime = {};
    const receipt = await install({ adminPool, config, credentials, apply: args.apply, identityToken: process.env.PRODUCTION_BOOTSTRAP_KEYCLOAK_TOKEN,
      runtimeConfig, runtimeCredentials, onRuntimeArtifacts: artifacts => { preparedRuntime = artifacts; } });
    if (args.apply) writeArtifacts(path.resolve(args.outputDir), { ...runtimeArtifacts(config, credentials, receipt), ...preparedRuntime });
    process.stdout.write(JSON.stringify(receipt) + '\n');
  } finally { await adminPool.end(); }
}
if (require.main === module) main().catch(error => {
  // PostgreSQL errors may contain SQL or private connection details; only closed codes leave the CLI.
  const code = /^(?:PRODUCTION|INSTALLER)_[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'PRODUCTION_BOOTSTRAP_FAILED';
  process.stderr.write(code + '\n'); process.exitCode = 1;
});
module.exports = { install, runtimeArtifacts, writeArtifacts, administrativeConnection };
