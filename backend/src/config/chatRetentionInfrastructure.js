'use strict';
// Production wiring of the daily chat retention executor. Same trust model as the document worker: an explicit
// per-organization credential list, tenant binding verified against the Central directory, a limited WORKER login
// whose role chain is checked exactly, and a schema gate. The login reaches the purge function only through the
// dedicated c4g_chat_retention_runtime role granted to the WORKER aggregator (see the runbook).
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { guardPool, runtimePoolTimeouts } = require('./poolResilience');
const { MIN_RETENTION_DAYS } = require('../applications/chatRetention');
const { CHAT_RETENTION_SCHEMA_VERSION, ACCOUNT_IDENTITY_ERASURE_SCHEMA_VERSION } = require('../security/tenantMigrationManifest');

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
  // With the admission journal configured the explicit list may be absent or empty: the journal then supplies the entities
  // (an installation whose only other tenant has no WORKER binding in Central). The merged list is never empty; see below.
  const admission = env.CHAT_RETENTION_ADMISSION_JOURNAL_DIRECTORY !== undefined || env.CHAT_RETENTION_ADMISSION_JOURNAL_KEY !== undefined;
  if (admission && env.CHAT_RETENTION_CREDENTIALS_JSON === undefined) return Object.freeze([]);
  let values;
  try { values = JSON.parse(env.CHAT_RETENTION_CREDENTIALS_JSON); } catch { throw fail('CHAT_RETENTION_CONFIGURATION_INVALID'); }
  const valid = Array.isArray(values) && (values.length > 0 || admission) && values.length <= 100 && values.every(value => value && value.workload === 'WORKER'
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

const MAX_ORGANIZATIONS = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Entities created by admission (context/features/staging-entity-admission.md). Their WORKER logins only exist in the
// admission worker's encrypted journal, so this command reads that journal itself, with the key given to it in private
// configuration; nothing is asked of the worker and no login crosses its IPC boundary. Optional: both variables or neither.
// The journal does not record the database generation: openTenant takes the one Central registers and the database must agree.
async function admissionCredentials(env) {
  const directory = env.CHAT_RETENTION_ADMISSION_JOURNAL_DIRECTORY, key = env.CHAT_RETENTION_ADMISSION_JOURNAL_KEY;
  if (directory === undefined && key === undefined) return [];
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || !/^[a-f0-9]{64}$/.test(key || '')) throw fail('CHAT_RETENTION_CONFIGURATION_INVALID');
  try {
    const journal = require('../platformOnboarding/encryptedJournal').createEncryptedJournal({ directory, key });
    const ids = (await fs.readdir(directory)).filter(name => name.endsWith('.enc')).map(name => name.slice(0, -4)).sort();
    const values = [];
    for (const id of ids) {
      const { binding, worker } = await journal.get(id);
      const valid = UUID.test(id) && binding?.organizationId === id && worker && typeof worker.tenantId === 'string' && Number.isSafeInteger(worker.connectionVersion)
        && typeof worker.credentialRef === 'string' && typeof worker.host === 'string' && Number.isSafeInteger(worker.port) && typeof worker.database === 'string'
        && typeof worker.login === 'string' && typeof worker.password === 'string' && typeof worker.ssl === 'boolean';
      if (!valid) throw fail('CHAT_RETENTION_CONFIGURATION_INVALID');
      values.push(Object.freeze({ workload: 'WORKER', organizationId: id, tenantId: worker.tenantId, connectionVersion: worker.connectionVersion, credentialRef: worker.credentialRef,
        databaseGenerationId: null, host: worker.host, port: worker.port, database: worker.database, login: worker.login, password: worker.password, ssl: worker.ssl, admission: true }));
    }
    return values;
  } catch {
    // A wrong key, a missing folder and a malformed entry all stop the run before anything is opened; codes only.
    throw fail('CHAT_RETENTION_CONFIGURATION_INVALID');
  }
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
  const credentials = [...config.credentials, ...await admissionCredentials(env)];
  if (credentials.length === 0 || credentials.length > MAX_ORGANIZATIONS || new Set(credentials.map(value => value.organizationId)).size !== credentials.length) throw fail('CHAT_RETENTION_CONFIGURATION_INVALID');
  const authorityPool = guardPool(new ports.Pool({ connectionString: env.AUTHORITY_DATABASE_URL, max: 2 }), 'chat-retention-authority');
  const directory = ports.createDirectory({ pool: authorityPool, permitSecret: env.AUTHORITY_COMMIT_PERMIT_SECRET, organizations: credentials.map(value => value.organizationId) });
  const byOrganization = new Map(credentials.map(value => [value.organizationId, value]));

  async function openTenant({ organizationId }) {
    const listed = byOrganization.get(organizationId);
    if (!listed) throw fail('CHAT_RETENTION_TENANT_UNKNOWN');
    const snapshot = await directory.resolveSnapshotByOrganization(organizationId, 'WORKER');
    if (listed.admission && typeof snapshot?.databaseGenerationId !== 'string') throw fail('CHAT_RETENTION_TENANT_BINDING_REQUIRED');
    const credential = listed.admission ? { ...listed, databaseGenerationId: snapshot.databaseGenerationId } : listed;
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
        if (![CHAT_RETENTION_SCHEMA_VERSION,ACCOUNT_IDENTITY_ERASURE_SCHEMA_VERSION].includes(observed.currentVersion) || !observed.capabilities.includes(CAPABILITY)) throw fail('CHAT_RETENTION_SCHEMA_INCOMPATIBLE');
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
    listTenants: async () => credentials.map(value => ({ organizationId: value.organizationId })),
    openTenant,
    close: () => authorityPool.end()
  });
}

module.exports = { CAPABILITY, OTHER_WORKER_ROLES, ROLE, createChatRetentionInfrastructure, loadChatRetentionConfiguration };
