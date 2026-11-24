'use strict';
// Privileged admission worker for an API started by src/server.js (staging). IPC only: it holds the PostgreSQL
// administration login, the Keycloak technical client and the journal key, and never returns them to the HTTP process.
// Contract: context/features/staging-entity-admission.md (phase 2). The local installer keeps its own worker.
const fs = require('node:fs');
const path = require('node:path');

const KEYS = ['issuer', 'clientId', 'clientSecret', 'adminOrigin', 'certificate', 'ownershipKey', 'journalKey', 'postgres', 'centralDatabase',
  'authority', 'permitSecret', 'policyVersion', 'dataResidencyCode', 'regionCode', 'residencyPolicyVersion', 'tenantRoles', 'tenantUpgrade'];
// Named sets of registered tenant steps. They live with the environment's installer, which is the only other code that
// applies them, so the worker and the `upgrade` command can never drift apart.
const TENANT_UPGRADE_PROFILES = Object.freeze({ 'staging-registered-v1': () => require('../../scripts/staging/tenantSteps') });
const ONBOARDED_TARGET_SQL = `SELECT g.database_ref, g.tenant_id, g.database_generation_id, s.compatibility_state
  FROM public.tenant_database_generation g LEFT JOIN public.tenant_schema_state s ON s.tenant_id = g.tenant_id
  WHERE g.tenant_id = $1 AND g.retired_at IS NULL`;

// Brings one database created by admission to the profile's current schema, through the same steps and checks as the
// installer. `resync` repairs the one state a crash can leave behind (database ahead of what Central records), so that
// provisioning can be retried; `apply` runs whatever steps the database still lacks. Both are safe to repeat.
function createTenantUpgrade({ profile, installationId, central, createPool, administration, dependencies = {} }) {
  const steps = dependencies.steps || TENANT_UPGRADE_PROFILES[profile]();
  const preflight = dependencies.preflightTenant || require('../security/tenantMigrationPreflight').preflightTenant;
  const sync = dependencies.syncCentralObservation || require('../../scripts/localPlatform/centralObservation').syncCentralObservation;
  async function target(organizationId) {
    const rows = (await central.query(ONBOARDED_TARGET_SQL, [organizationId])).rows;
    // Only a database this provisioner created, and only when Central names exactly one.
    if (rows.length !== 1 || !/^c4g_onb_[a-f0-9]{32}$/.test(rows[0].database_ref || '')) return null;
    return { database: rows[0].database_ref, state: rows[0].compatibility_state, identity: { tenantId: rows[0].tenant_id, databaseGenerationId: rows[0].database_generation_id } };
  }
  async function withTenant(found, work) {
    const pool = createPool({ ...administration, database: found.database, max: 2, options: '-c timezone=UTC' });
    try { return await work(pool); } finally { await pool.end(); }
  }
  const scope = tenantId => steps.onboardedObservationScope(installationId, tenantId);
  return Object.freeze({
    async resync(organizationId) {
      const found = await target(organizationId);
      // Nothing to repair before the first publication: Central has no compatible schema state for the tenant yet.
      if (!found || found.state !== 'COMPATIBLE') return { resynced: false };
      return withTenant(found, async pool => {
        const observation = await preflight(pool, found.identity, undefined, { timeoutMs: 15000 });
        const synced = await sync({ central, observation, tenantId: found.identity.tenantId, installationId, apply: true, idempotencyScope: scope(found.identity.tenantId) });
        return { resynced: synced.status === 'PUBLISHED' };
      });
    },
    async apply(organizationId) {
      const found = await target(organizationId);
      if (!found) throw invalid('TENANT_UPGRADE_TARGET_MISSING');
      return withTenant(found, async pool => {
        const head = (await pool.query(steps.TENANT_HEAD_SQL)).rows[0]?.version;
        if (typeof head !== 'string' || !head) throw invalid('TENANT_UPGRADE_HEAD_MISSING');
        return steps.applyTenantSteps({ steps: steps.pendingTenantSteps(head), central, tenant: pool, identity: found.identity, installationId,
          observationScope: scope(found.identity.tenantId) });
      });
    }
  });
}
const BINDING = ['operationId', 'organizationId', 'globalUserId', 'membershipId'];
const PASS_MS = 3000;
// After a failed step the same admission is not tried again at once: every attempt alters roles in the database cluster.
const RETRY_AFTER_FAILURE_MS = 60000;
const ROLE = /^[a-z][a-z0-9_]{0,62}$/;
const READY_WITHIN_MS = 15000;

function invalid(code) {
  return Object.assign(new TypeError(code), { code });
}

// Refuses anything it does not recognise: the file is written once by the staging installer.
function readSettings(file, env) {
  let settings;
  try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw invalid('ADMISSION_CONFIGURATION_INVALID'); }
  const text = value => typeof value === 'string' && value.length > 0;
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!object(settings) || Object.keys(settings).some(key => !KEYS.includes(key))) throw invalid('ADMISSION_CONFIGURATION_INVALID');
  // The worker only serves the identity provider the API itself signs in with (inherited OIDC_ISSUER), always over HTTPS.
  if (!text(settings.issuer) || !settings.issuer.startsWith('https://') || !env.OIDC_ISSUER || settings.issuer !== env.OIDC_ISSUER) throw invalid('ADMISSION_IDENTITY_REQUIRED');
  if (!require('../security/secretFormat').isSecretHex(settings.ownershipKey)) throw invalid('OWNERSHIP_KEY_INVALID');
  if (!/^[a-f0-9]{64}$/.test(settings.journalKey || '')) throw invalid('PROVISIONING_JOURNAL_INVALID');
  const postgres = settings.postgres, authority = settings.authority;
  if (!text(settings.clientId) || !text(settings.clientSecret)
    || (settings.adminOrigin !== undefined && (!text(settings.adminOrigin) || !/^https?:\/\/[^/]+$/.test(settings.adminOrigin)))
    || (settings.certificate !== undefined && (!text(settings.certificate) || !path.isAbsolute(settings.certificate)))
    || !object(postgres) || Object.keys(postgres).sort().join(',') !== 'host,password,port,ssl,user' || !text(postgres.host) || !text(postgres.user) || !text(postgres.password)
    || !Number.isSafeInteger(postgres.port) || postgres.port < 1 || postgres.port > 65535 || typeof postgres.ssl !== 'boolean'
    || !/^[a-z][a-z0-9_]{0,62}$/.test(settings.centralDatabase || '')
    || !object(authority) || Object.keys(authority).sort().join(',') !== 'password,user' || !text(authority.user) || !text(authority.password)
    || !text(settings.permitSecret) || Buffer.byteLength(settings.permitSecret) < 32 || !text(settings.dataResidencyCode) || !text(settings.regionCode) || !text(settings.residencyPolicyVersion)
    || !Object.hasOwn(require('../security/authConfig').RECOGNIZED_ASSURANCE_POLICIES, settings.policyVersion || '')) throw invalid('ADMISSION_CONFIGURATION_INVALID');
  // The functional roles the shared aggregators hold in this environment. Never defaulted: the wrong set grants roles to every login.
  const roles = settings.tenantRoles, list = value => Array.isArray(value) && value.length > 0 && value.every(role => typeof role === 'string' && ROLE.test(role)) && new Set(value).size === value.length;
  if (!object(roles) || Object.keys(roles).sort().join(',') !== 'api,worker' || !list(roles.api) || !list(roles.worker)) throw invalid('ADMISSION_TENANT_ROLES_REQUIRED');
  // Optional: bring each new database from the base schema to the environment's current one. Without it a new entity
  // stays on the base schema until the installer's `upgrade` runs.
  const upgrade = settings.tenantUpgrade;
  if (upgrade !== undefined && (!object(upgrade) || Object.keys(upgrade).sort().join(',') !== 'installationId,profile'
    || !Object.hasOwn(TENANT_UPGRADE_PROFILES, upgrade.profile) || !text(upgrade.installationId) || upgrade.installationId.length > 200)) throw invalid('ADMISSION_TENANT_UPGRADE_INVALID');
  return settings;
}

const realDependencies = Object.freeze({
  createPool: options => new (require('pg').Pool)(options),
  createCoordinator: options => require('../security/authorityCoordinator').createAuthorityCoordinator(options),
  createDirectory: pool => require('../security/tenantDirectoryRepository').createTenantDirectoryRepository(pool),
  createJournal: options => require('../platformOnboarding/encryptedJournal').createEncryptedJournal(options),
  createProvisioner: options => require('../platformOnboarding/postgresProvisioner').createPostgresProvisioner(options),
  createRegistry: options => require('./credentialRegistry').createCredentialRegistry(options),
  createIdentity: options => require('../platformOnboarding/keycloakAdapter').createKeycloakAdapter(options),
  createCompletion: options => require('./completionService').createCompletionService(options),
  createCompletionWorker: service => require('./completionWorker').createCompletionWorker(service),
  createMemberProjection: options => require('../platformOnboarding/memberProjection').createMemberProjection(options),
  createEmail: options => require('../platformOnboarding/activationEmail').createActivationEmail(options),
  createTenantUpgrade: options => createTenantUpgrade(options),
  // A published login must reach only its own database, without elevated attributes, and match the Central binding.
  async probe({ createPool, material, snapshot, workload }) {
    const pool = createPool({ host: material.host, port: material.port, database: material.database, user: material.login, password: material.password,
      ssl: material.ssl ? { rejectUnauthorized: true } : false, max: 1 });
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const role = (await client.query('SELECT current_database() name,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=session_user')).rows[0];
      if (role.name !== snapshot.databaseRef || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolbypassrls) throw invalid('CREDENTIAL_BINDING_INVALID');
      const verifier = require('../security/tenantBindingVerifier').createTenantBindingVerifier({ async observe() {
        const observed = await require('../security/tenantRuntimeMetadata').observeTenantRuntimeMetadata(client, snapshot);
        return { ...observed, schemaVersion: observed.currentVersion, bindingDigest: require('../security/localTenantCredentialAdapter').bindingDigest({ ...material, workload }) };
      } });
      await verifier.verify({ client, snapshot, requiredCapabilities: [], correlationId: snapshot.organizationId });
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); await pool.end(); }
  }
});

// Builds the worker from validated settings. `directory` holds the two encrypted journals and must be writable and persistent.
function buildWorker({ settings, directory, dependencies = {}, fetchImpl = fetch, now = () => Date.now(), env = process.env }) {
  if (!path.isAbsolute(directory)) throw invalid('ADMISSION_CONFIGURATION_INVALID');
  const d = { ...realDependencies, ...dependencies };
  const base = { host: settings.postgres.host, port: settings.postgres.port, ssl: settings.postgres.ssl ? { rejectUnauthorized: true } : false };
  const administration = { ...base, user: settings.postgres.user, password: settings.postgres.password };
  const central = d.createPool({ ...administration, database: settings.centralDatabase });
  const admin = d.createPool({ ...administration, database: 'postgres' });
  const authority = d.createPool({ ...base, database: settings.centralDatabase, user: settings.authority.user, password: settings.authority.password });
  const coordinator = d.createCoordinator({ pool: authority, permitSecret: settings.permitSecret });
  const tenantDirectory = d.createDirectory(central);
  const journal = name => d.createJournal({ directory: path.join(directory, name), key: settings.journalKey });
  const provisioner = d.createProvisioner({ adminPool: admin, centralPool: central, connection: { ...administration, database: 'postgres' }, journal: journal('provisioning'),
    ownershipKey: settings.ownershipKey, regionCode: settings.regionCode, residencyPolicyVersion: settings.residencyPolicyVersion,
    apiRoles: settings.tenantRoles.api, workerRoles: settings.tenantRoles.worker });
  const registry = d.createRegistry({ journal: journal('credentials'), directory: tenantDirectory,
    probe: (material, snapshot, workload) => d.probe({ createPool: d.createPool, material, snapshot, workload }) });

  let token, until = 0;
  const identity = d.createIdentity({ issuer: settings.issuer, ownershipKey: settings.ownershipKey, purpose: 'ADMISSION', usernameMode: 'email',
    adminOrigin: settings.adminOrigin || null, async accessToken() {
      if (token && now() < until) return token;
      const response = await fetchImpl(settings.issuer + '/protocol/openid-connect/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: settings.clientId, client_secret: settings.clientSecret }) });
      if (!response.ok) throw invalid('KEYCLOAK_UNAVAILABLE');
      const data = await response.json();
      token = data.access_token; until = now() + Math.max(1, data.expires_in - 20) * 1000;
      return token;
    } });

  const upgrade = settings.tenantUpgrade
    ? d.createTenantUpgrade({ ...settings.tenantUpgrade, central, createPool: d.createPool, administration }) : null;
  // The completion service hides why a step failed. The step and a code (never a message, which may carry identifiers) are
  // kept for `health`, so that a stuck admission can be diagnosed without entering the container.
  let lastFailure = null, retryAfter = 0;
  const step = (name, work) => async value => {
    try { return await work(value); } catch (error) {
      const code = [error?.code, error?.message].find(text => typeof text === 'string' && /^[A-Z0-9_]{3,80}$/.test(text)) || 'UNCLASSIFIED';
      lastFailure = { step: name, code, at: new Date(now()).toISOString() }; retryAfter = now() + RETRY_AFTER_FAILURE_MS;
      throw error;
    }
  };
  const policy = require('../security/authConfig').RECOGNIZED_ASSURANCE_POLICIES[settings.policyVersion];
  const completion = d.createCompletion({ coordinator, issuer: settings.issuer, policyVersion: settings.policyVersion,
    assuranceRequirements: policy.policy[policy.privilegedCategory], mfaPolicyCode: 'USER_OPTIONAL', dataResidencyCode: settings.dataResidencyCode,
    tenant: { ensure: step('TENANT', async value => {
      // The provisioner publishes the database on the base schema and checks that Central agrees with it, so a database
      // left ahead of Central by an interrupted upgrade is reconciled first. The pending steps run after publication.
      if (upgrade) await upgrade.resync(value.organizationId);
      const result = await provisioner.ensure(value);
      if (upgrade) await upgrade.apply(value.organizationId);
      return result;
    }) }, projection: { ensure: step('PROJECTION', value => provisioner.project(value)) },
    publishCredentials: step('CREDENTIALS', async value => registry.publish(Object.fromEntries(BINDING.map(key => [key, value[key]])),
      await provisioner.apiCredentials(value), await provisioner.workerCredentials(value))) });
  const completionWorker = d.createCompletionWorker(completion);

  let stopping = false, inFlight = null, lastPass = 0;
  function tick() {
    if (stopping || inFlight) return inFlight;
    // Waiting out a failure still counts as a live loop.
    if (now() < retryAfter) { lastPass = now(); return null; }
    inFlight = completionWorker.runOnce().then(results => { lastPass = now(); if (Array.isArray(results) && results.length && results.every(result => result.confirmed)) lastFailure = null; })
      .catch(() => {}).finally(() => { inFlight = null; });
    return inFlight;
  }
  // The invitation email uses the provider settings this process inherits; the provider key never reaches the HTTP process.
  const email = d.createEmail({ key: settings.ownershipKey, apiKey: env.RESEND_API_KEY, from: env.ACTIVATION_EMAIL_FROM,
    origin: env.ACTIVATION_PUBLIC_URL, purpose: 'ADMISSION' });
  // Only these names cross the IPC boundary. `resolve` returns the API login of one tenant; nothing returns administration material.
  const methods = Object.freeze({
    // Sends one invitation link to its recipient and answers only the provider's verdict.
    invitationEmail: async value => ({ status: (await email.send(value))?.status || 'UNCONFIRMED' }),
    identity: value => identity.ensure(value),
    passwordReady: value => identity.passwordReady(value.subject),
    resolve: value => registry.resolve(value),
    health: async () => ({ ready: now() - lastPass < READY_WITHIN_MS, lastFailure }),
    async memberProjection(value) {
      const snapshot = await tenantDirectory.resolveSnapshotByOrganization(value.organizationId, 'API');
      const credentials = await registry.resolve({ ...snapshot, workload: 'API' });
      return d.createMemberProjection({ bindings: [{ organizationId: value.organizationId, snapshot, credentials }],
        allowedResidency: [{ regionCode: settings.regionCode, policyVersion: settings.residencyPolicyVersion }] }).ensure(value);
    }
  });
  async function close() {
    stopping = true;
    await inFlight;
    await Promise.all([authority.end(), central.end(), admin.end()]);
  }
  return Object.freeze({ methods, tick, close });
}

function run(file, env = process.env) {
  const settings = readSettings(file, env);
  if (settings.certificate) {
    const tls = require('node:tls');
    tls.setDefaultCACertificates([...tls.getCACertificates('default'), fs.readFileSync(settings.certificate, 'utf8')]);
  }
  const worker = buildWorker({ settings, directory: path.dirname(path.resolve(file)) });
  worker.tick();
  const timer = setInterval(() => { worker.tick(); }, PASS_MS);
  process.on('message', async message => {
    try {
      if (!Object.hasOwn(worker.methods, message.method)) throw invalid('WORKER_METHOD_DENIED');
      process.send?.({ id: message.id, result: await worker.methods[message.method](message.value) });
    } catch (error) { process.send?.({ id: message.id, error: /^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'ONBOARDING_STEP_UNCONFIRMED' }); }
  });
  process.on('disconnect', async () => { clearInterval(timer); await worker.close().catch(() => {}); process.exit(0); });
  process.send?.({ ready: true });
}

if (require.main === module) {
  try { run(process.argv[2]); } catch { process.exit(1); }
}

module.exports = { readSettings, buildWorker, createTenantUpgrade, run };
