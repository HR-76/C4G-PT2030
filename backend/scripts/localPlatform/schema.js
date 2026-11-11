'use strict';
const { Pool } = require('pg');
const { randomUUID, randomBytes } = require('node:crypto');
const { assertTarget, connection, identifier } = require('./config');
const { applyCentralMigrations } = require('../runCentralMigrations');
const { preflightCentral } = require('../../src/security/centralMigrationPreflight');
const { preflightTenant, validateDatabaseContract } = require('../../src/security/tenantMigrationPreflight');
const { createTenantMigrationRunner } = require('../../src/security/tenantMigrationRunner');
const { createLocalTenantIdentityProvisioner } = require('../../src/security/localTenantIdentityProvisioner');
const { bindingDigest } = require('../../src/security/localTenantCredentialAdapter');

function initialState(config) {
  assertTarget(config);
  return { formatVersion: 1, installationId: randomUUID(), organizationId: randomUUID(), tenantId: randomUUID(),
    generationId: randomUUID(), adminId: randomUUID(), managerId: randomUUID(), membershipId: randomUUID(),
    target: { host: config.host, port: config.port, centralDatabase: config.centralDatabase, tenantDatabase: config.tenantDatabase },
    authorityPassword: randomBytes(32).toString('hex'), tenantPassword: randomBytes(32).toString('hex'),
    workerPassword: randomBytes(32).toString('hex'), sessionSecret: randomBytes(48).toString('hex'),
    permitSecret: randomBytes(32).toString('hex'), phase: 'PREPARED' };
}
async function inspect(pool) {
  return (await pool.query(`SELECT current_database() AS database,
    current_setting('server_version_num') AS version, d.datlocprovider AS provider, d.datlocale AS locale,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN('r','p','v','m','S','f')) AS objects
    FROM pg_database d WHERE d.datname=current_database()`)).rows[0];
}
async function installSchemas(config, state, persist = () => {}) {
  assertTarget(config);
  if (state.formatVersion !== 1 || !['PREPARED', 'INSTALLING', 'SCHEMAS_READY', 'READY'].includes(state.phase)) {
    throw Error('LOCAL_INSTALLATION_STATE_INVALID');
  }
  for (const key of ['authorityPassword', 'tenantPassword', 'workerPassword']) {
    if (!/^[a-f0-9]{64}$/.test(state[key] || '')) throw Error('LOCAL_INSTALLATION_STATE_INVALID');
  }
  if (JSON.stringify(state.target) !== JSON.stringify({ host: config.host, port: config.port,
    centralDatabase: config.centralDatabase, tenantDatabase: config.tenantDatabase })) throw Error('LOCAL_INSTALLATION_TARGET_MISMATCH');
  const central = new Pool(connection(config, config.centralDatabase));
  const tenant = new Pool(connection(config, config.tenantDatabase));
  let elevated = false;
  try {
    const centralInfo = await inspect(central), tenantInfo = await inspect(tenant);
    // Locale cannot be altered in place. Never drop/recreate an existing database.
    await validateDatabaseContract(tenant);
    if (state.phase === 'PREPARED') {
      if (centralInfo.objects || tenantInfo.objects) throw Error('LOCAL_EMPTY_DATABASES_REQUIRED');
      const existing = await central.query(`SELECT rolname FROM pg_roles WHERE rolname LIKE 'c4g_%' AND rolname<>session_user`);
      if (existing.rowCount) throw Error('LOCAL_EXISTING_ROLES_REQUIRE_REVIEW');
      state.phase = 'INSTALLING'; await persist(state);
    }
    const superuser = (await central.query('SELECT rolsuper FROM pg_roles WHERE rolname=session_user')).rows[0]?.rolsuper;
    if (!superuser) throw Error('LOCAL_INSTALLER_REQUIRES_DATABASE_ADMIN');
    // Current manifests pin this technical owner name. It never accepts logins.
    // Elevated installation authority is removed even when a migration fails.
    await central.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='c4g_f12_admin')
      THEN CREATE ROLE c4g_f12_admin NOLOGIN NOINHERIT; END IF; END $$`);
    const owner = (await central.query(`SELECT rolcanlogin,
      EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=r.oid) AS members
      FROM pg_roles r WHERE rolname='c4g_f12_admin'`)).rows[0];
    if (owner.rolcanlogin || owner.members) throw Error('LOCAL_SCHEMA_OWNER_UNSAFE');
    await central.query('ALTER ROLE c4g_f12_admin SUPERUSER'); elevated = true;
    for (const role of ['c4g_central_owner','c4g_central_runtime','c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime']) {
      await central.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}')
        THEN CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$`);
    }
    await central.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='c4g_import_worker_runtime')
      THEN CREATE ROLE c4g_import_worker_runtime NOLOGIN NOINHERIT; END IF; END $$`);
    await central.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
    for (const db of [config.centralDatabase, config.tenantDatabase]) await central.query(`ALTER DATABASE ${identifier(db)} SET timezone TO 'UTC'`);
    const nativePool = pool => ({ async connect() {
      const client = await pool.connect();
      try { await client.query('SET SESSION AUTHORIZATION c4g_f12_admin'); }
      catch (error) { client.release(error); throw error; }
      return { query: (...args) => client.query(...args), release(error) { client.release(error || new Error('INSTALLER_CONNECTION_DISPOSED')); } };
    } });
    const cc = await nativePool(central).connect();
    try {
      if (!(await cc.query("SELECT to_regclass('public.c4g_database_identity') AS marker")).rows[0].marker) {
        await cc.query('BEGIN');
        await cc.query('CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL)');
        await cc.query("INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')"); await cc.query('COMMIT');
      }
    } finally { cc.release(); }
    await applyCentralMigrations(nativePool(central));
    const database = identifier(config.tenantDatabase);
    await tenant.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await tenant.query(`REVOKE CONNECT,TEMP ON DATABASE ${database} FROM PUBLIC`);
    await tenant.query(`GRANT CONNECT,CREATE ON DATABASE ${database} TO c4g_tenant_owner`);
    await tenant.query(`GRANT CONNECT ON DATABASE ${database} TO c4g_tenant_migrator,c4g_tenant_runtime`);
    await tenant.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${database} SET search_path TO pg_catalog,c4g_app`);
    await createTenantMigrationRunner({ pool: nativePool(tenant), observationPublisher: { async publish() {} },
      timeoutMs: 30000, scheduler: { setTimeout, clearTimeout } }).migrate({ tenantId: state.tenantId,
      databaseGenerationId: state.generationId, expectedRevision: 1,
      correlationId: state.installationId, idempotencyKey: state.installationId });
    await central.query(`ALTER ROLE c4g_authority_runtime PASSWORD '${state.authorityPassword}'`);
    const provisioner = await createLocalTenantIdentityProvisioner(tenant);
    await provisioner.reconcile({ apiLogin: 'c4g_local_api', workerLogin: 'c4g_local_worker',
      apiPassword: state.tenantPassword, workerPassword: state.workerPassword,
      apiRoles: ['c4g_opportunity_tenant_runtime'], workerRoles: ['c4g_import_worker_runtime'] });
    await tenant.query(`GRANT CONNECT ON DATABASE ${database} TO c4g_local_api,c4g_local_worker`);
    await central.query(`REVOKE CONNECT ON DATABASE ${identifier(config.centralDatabase)} FROM PUBLIC`);
    await central.query(`GRANT CONNECT ON DATABASE ${identifier(config.centralDatabase)} TO c4g_authority_runtime`);
    await central.query('GRANT USAGE ON SCHEMA opportunity_catalog TO c4g_f12_admin');
    await preflightCentral(central);
    const evidence = await preflightTenant(tenant, { tenantId: state.tenantId, databaseGenerationId: state.generationId }, undefined, { timeoutMs: 15000 });
    const credentials = { tenantId: state.tenantId, credentialRef: `local-api-${state.installationId}`, connectionVersion: 1,
      host: config.host, port: config.port, database: config.tenantDatabase, login: 'c4g_local_api', password: state.tenantPassword, ssl: false };
    state.credentials = credentials;
    state.snapshot = { organizationId: state.organizationId, tenantId: state.tenantId, workload: 'API',
      deploymentMode: 'DATABASE_PER_ORGANIZATION', provisioningStatus: 'READY', connectionState: 'AVAILABLE',
      connectionVersion: 1, connectionRevision: 1, versionState: 'VALIDATED', databaseGenerationId: state.generationId,
      databaseRef: config.tenantDatabase, credentialRef: credentials.credentialRef,
      bindingDigest: bindingDigest({ ...credentials, workload: 'API' }), observedSystemIdentifier: evidence.systemIdentifier,
      regionCode: 'LOCAL', residencyPolicyVersion: 'local-development-v1', fence: 0,
      schema: { compatibilityState: 'COMPATIBLE', currentVersion: evidence.currentVersion,
        schemaFingerprint: evidence.schemaFingerprint, revision: 1,
        verifiedCapabilities: Object.fromEntries(evidence.capabilities.map(code => [code, true])) } };
    state.phase = 'SCHEMAS_READY'; await persist(state);
    return state;
  } finally {
    try { if (elevated) await central.query('ALTER ROLE c4g_f12_admin NOSUPERUSER NOCREATEROLE NOCREATEDB NOLOGIN'); }
    finally { await central.end(); await tenant.end(); }
  }
}
module.exports = { initialState, inspect, installSchemas };
