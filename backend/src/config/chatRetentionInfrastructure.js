'use strict';
// Production wiring of the daily chat retention executor. Same trust model as the document worker: an explicit
// per-organization credential list, tenant binding verified against the Central directory, a limited WORKER login
// whose role chain is checked exactly, and a schema gate. The login reaches the purge function only through the
// dedicated c4g_chat_retention_runtime role granted to the WORKER aggregator (see the runbook).
const { Pool } = require('pg');
const { guardPool, runtimePoolTimeouts } = require('./poolResilience');
const { MIN_RETENTION_DAYS } = require('../applications/chatRetention');
const { CHAT_RETENTION_SCHEMA_VERSION } = require('../security/tenantMigrationManifest');

const ROLE = 'c4g_chat_retention_runtime';
const CAPABILITY = 'APPLICATION_CHAT_RETENTION';
// Roles other WORKER duties may have on the shared aggregator; tolerated, never required.
const OTHER_WORKER_ROLES = Object.freeze(['c4g_document_worker_runtime', 'c4g_document_runtime', 'c4g_f4_metadata_executor', 'c4g_import_worker_runtime']);
const fail = code => Object.assign(new Error(code), { code });

// Same server-side backstops as the other tenant pools (statement and idle-in-transaction timeouts).
const tenantPoolOptions = (value, env) => ({ host: value.host, port: value.port, database: value.database, user: value.login, password: value.password,
  ssl: value.ssl ? { rejectUnauthorized: true } : false, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, ...runtimePoolTimeouts(env, 'CHAT_RETENTION_DB') });

function integer(env, name, fallback, min, max) {
  if (env[name] === undefined) return fallback;
  const value = Number(env[name]);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw fail('CHAT_RETENTION_CONFIGURATION_INVALID');
  return value;
}

function credentialList(env) {
  let values;
  try { values = JSON.parse(env.CHAT_RETENTION_CREDENTIALS_JSON); } catch { throw fail('CHAT_RETENTION_CONFIGURATION_INVALID'); }
  const valid = Array.isArray(values) && values.length > 0 && values.length <= 100 && values.every(value => value && value.workload === 'WORKER'
    && typeof value.organizationId === 'string' && typeof value.tenantId === 'string' && Number.isSafeInteger(value.connectionVersion)
    && typeof value.credentialRef === 'string' && typeof value.databaseGenerationId === 'string' && typeof value.host === 'string'
    && Number.isSafeInteger(value.port) && typeof value.database === 'string' && typeof value.login === 'string'
    && typeof value.password === 'string' && typeof value.ssl === 'boolean');
  if (!valid) throw fail('CHAT_RETENTION_CONFIGURATION_INVALID');
  const organizations = new Set();
  const tuples = new Set();
  return Object.freeze(values.map(value => {
    const tuple = `${value.tenantId}:${value.connectionVersion}:${value.credentialRef}`;
    if (organizations.has(value.organizationId) || tuples.has(tuple)) throw fail('CHAT_RETENTION_CONFIGURATION_INVALID');
    organizations.add(value.organizationId);
    tuples.add(tuple);
    return Object.freeze({ ...value });
  }));
}

function loadChatRetentionConfiguration(env = process.env) {
  if (typeof env.AUTHORITY_DATABASE_URL !== 'string' || !env.AUTHORITY_DATABASE_URL
      || typeof env.AUTHORITY_COMMIT_PERMIT_SECRET !== 'string' || Buffer.byteLength(env.AUTHORITY_COMMIT_PERMIT_SECRET) < 32) throw fail('CHAT_RETENTION_CONFIGURATION_INVALID');
  try { require('../security/secretFormat').requireProductionSecret(env, 'AUTHORITY_COMMIT_PERMIT_SECRET'); } catch { throw fail('CHAT_RETENTION_CONFIGURATION_INVALID'); }
  return Object.freeze({
    credentials: credentialList(env),
    retentionDays: integer(env, 'CHAT_RETENTION_DAYS', MIN_RETENTION_DAYS, MIN_RETENTION_DAYS, 3650),
    batchSize: integer(env, 'CHAT_RETENTION_BATCH_SIZE', 50, 1, 500),
    maxBatches: integer(env, 'CHAT_RETENTION_MAX_BATCHES', 200, 1, 10000)
  });
}

const defaults = () => ({
  Pool,
  createDirectory: ({ pool, permitSecret, organizations }) => require('../security/tenantDirectoryReader').createTenantDirectoryReader({
    coordinator: require('../security/authorityCoordinator').createAuthorityCoordinator({ pool, permitSecret }), organizations, workload: 'WORKER' }),
  observeMetadata: (client, input) => require('../security/tenantRuntimeMetadata').observeTenantRuntimeMetadata(client, input),
  validateRoleChain: (client, input) => require('../security/localTenantIdentityProvisioner').validateLocalTenantRoleChain(client, input),
  bindingDigest: credential => require('../security/localTenantCredentialAdapter').bindingDigest(credential)
});

async function createChatRetentionInfrastructure({ env = process.env, deps = {} } = {}) {
  const config = loadChatRetentionConfiguration(env);
  const ports = { ...defaults(), ...deps };
  const authorityPool = guardPool(new ports.Pool({ connectionString: env.AUTHORITY_DATABASE_URL, max: 2 }), 'chat-retention-authority');
  const directory = ports.createDirectory({ pool: authorityPool, permitSecret: env.AUTHORITY_COMMIT_PERMIT_SECRET, organizations: config.credentials.map(value => value.organizationId) });
  const byOrganization = new Map(config.credentials.map(value => [value.organizationId, value]));

  async function openTenant({ organizationId }) {
    const credential = byOrganization.get(organizationId);
    if (!credential) throw fail('CHAT_RETENTION_TENANT_UNKNOWN');
    const snapshot = await directory.resolveSnapshotByOrganization(organizationId, 'WORKER');
    if (!snapshot || snapshot.tenantId !== credential.tenantId || snapshot.connectionVersion !== credential.connectionVersion
        || snapshot.credentialRef !== credential.credentialRef || snapshot.databaseGenerationId !== credential.databaseGenerationId
        || snapshot.bindingDigest !== ports.bindingDigest(credential)) throw fail('CHAT_RETENTION_TENANT_BINDING_REQUIRED');
    const pool = guardPool(new ports.Pool(tenantPoolOptions(credential, env)), 'chat-retention-tenant');
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN TRANSACTION READ ONLY');
        const login = (await client.query(`SELECT session_user, current_user, r.rolcanlogin, r.rolinherit, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole, r.rolreplication
          FROM pg_roles r WHERE r.rolname = session_user`)).rows[0];
        if (!login || login.current_user !== login.session_user || !login.rolcanlogin || login.rolinherit || login.rolsuper || login.rolbypassrls
            || login.rolcreatedb || login.rolcreaterole || login.rolreplication) throw fail('CHAT_RETENTION_LIMITED_LOGIN_REQUIRED');
        await ports.validateRoleChain(client, { login: login.session_user, workload: 'WORKER', functionalRoles: [ROLE], optionalFunctionalRoles: [...OTHER_WORKER_ROLES] });
        const observed = await ports.observeMetadata(client, { tenantId: credential.tenantId, databaseGenerationId: credential.databaseGenerationId });
        if (observed.currentVersion !== CHAT_RETENTION_SCHEMA_VERSION || !observed.capabilities.includes(CAPABILITY)) throw fail('CHAT_RETENTION_SCHEMA_INCOMPATIBLE');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    } catch (error) {
      await pool.end().catch(() => {});
      throw error;
    }
    return { pool, close: () => pool.end() };
  }

  return Object.freeze({
    retentionDays: config.retentionDays,
    batchSize: config.batchSize,
    maxBatches: config.maxBatches,
    listTenants: async () => config.credentials.map(value => ({ organizationId: value.organizationId })),
    openTenant,
    close: () => authorityPool.end()
  });
}

module.exports = { CAPABILITY, OTHER_WORKER_ROLES, ROLE, createChatRetentionInfrastructure, loadChatRetentionConfiguration };
