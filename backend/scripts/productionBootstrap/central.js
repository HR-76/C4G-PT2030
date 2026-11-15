'use strict';
const { nativePool } = require('../localPlatform/installerAuthority');
const { identifier, literal } = require('./config');
const { ownership, verifyPassword } = require('./cluster');
const { LOGINS } = require('../installProductionCentral');
const profile = require('../../src/security/productionCentralProfile');
const ROLES = { ...profile.ROLES, catalog: 'c4g_catalog_reader' };
const { platformAccountLifecycleManifest, migrationSql } = require('../../src/security/centralMigrationManifest');
const { preflightCentral } = require('../../src/security/centralMigrationPreflight');

async function installCentral({ centralPool, config, afterMigrationSql = null }) {
  const native = nativePool(centralPool), client = await native.connect();
  try {
    await client.query('BEGIN');
    if (!(await client.query("SELECT to_regclass('public.c4g_database_identity') AS marker")).rows[0].marker) {
      const objects = await client.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' LIMIT 1");
      if (objects.rowCount) throw Error('PRODUCTION_CENTRAL_NOT_EMPTY');
      for (const role of ['c4g_central_owner', 'c4g_central_runtime', 'c4g_tenant_owner', 'c4g_tenant_migrator', 'c4g_tenant_runtime', 'c4g_import_worker_runtime']) {
        if ((await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) throw Error('PRODUCTION_BOOTSTRAP_ROLE_CONFLICT');
        await client.query(`CREATE ROLE ${identifier(role)} NOLOGIN ${role.startsWith('c4g_central_') ? 'INHERIT' : 'NOINHERIT'} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      }
      await client.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
      await client.query(`ALTER DATABASE ${identifier(config.target.centralDatabase)} SET timezone TO 'UTC'`);
      await client.query(`REVOKE ALL ON DATABASE ${identifier(config.target.centralDatabase)} FROM PUBLIC`);
      // 057 fingerprints the owner of this built-in because it grants a narrow
      // EXECUTE capability. Historical gates initialized PG as c4g_f12_admin.
      // Normalize only this fresh Central database to the pinned NOLOGIN owner;
      // do not require the host's PostgreSQL administrator to have that name.
      await client.query('ALTER FUNCTION pg_catalog.pg_control_system() OWNER TO c4g_f12_admin');
      await client.query('CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL)');
      await client.query("INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  await require('../runCentralMigrations').applyCentralMigrationsWithManifest(native, platformAccountLifecycleManifest, migrationSql, { afterSql: afterMigrationSql });
  return preflightCentral(centralPool);
}

async function provisionCentralProfiles({ centralPool, config, credentials }) {
  const client = await centralPool.connect(), marker = ownership(config), database = identifier(config.target.centralDatabase);
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL password_encryption='scram-sha-256'");
    for (const [key, login] of Object.entries({ ...LOGINS, authority: 'c4g_authority_runtime' })) {
      const row = (await client.query("SELECT r.rolpassword,shobj_description(r.oid,'pg_authid') AS marker FROM pg_authid r WHERE rolname=$1", [login])).rows[0];
      const expected = marker + ':' + key;
      if (!row) {
        if (key === 'authority') throw Error('PRODUCTION_AUTHORITY_ROLE_MISSING');
        await client.query(`CREATE ROLE ${identifier(login)} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${literal(credentials.central[key])}`);
        await client.query(`GRANT ${identifier(ROLES[key])} TO ${identifier(login)} WITH INHERIT FALSE, SET TRUE, ADMIN FALSE`);
        await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${identifier(login)}`);
        await client.query(`COMMENT ON ROLE ${identifier(login)} IS ${literal(expected)}`);
      } else if (key === 'authority' && row.marker === null && row.rolpassword === null) {
        await client.query(`ALTER ROLE c4g_authority_runtime PASSWORD ${literal(credentials.central.authority)}`);
        await client.query(`GRANT CONNECT ON DATABASE ${database} TO c4g_authority_runtime`);
        await client.query(`COMMENT ON ROLE c4g_authority_runtime IS ${literal(expected)}`);
      } else if (row.marker !== expected) throw Error('PRODUCTION_LOGIN_OWNERSHIP_MISMATCH');
      await verifyPassword(client, login, credentials.central[key]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function validateCentralProfiles({ config, credentials, Pool }) {
  for (const [key, login] of Object.entries({ ...LOGINS, authority: 'c4g_authority_runtime' })) {
    const raw = new Pool({ host: config.target.host, port: config.target.port, ssl: config.target.ssl,
      database: config.target.centralDatabase, user: login, password: credentials.central[key], max: 1, connectionTimeoutMillis: 10000 });
    try {
      const client = await raw.connect();
      try {
        if (key === 'authority') await require('../../src/security/authoritySecurityManifest').assertAuthorityAdmission(client);
        else {
          await profile.validateLogin(client, ROLES[key]);
          if (key === 'catalog') {
            const admission = await require('../../src/security/catalogReaderSchema').createReaderSchemaAdmission(client);
            await require('../../src/security/catalogReaderSecurity').assertReaderSession(client, admission);
          }
        }
        const excess = (await client.query(`SELECT datname FROM pg_database WHERE datname<>$1 AND datallowconn
          AND has_database_privilege(session_user,oid,'CONNECT')`, [config.target.centralDatabase])).rows;
        if (excess.length) throw Error('PRODUCTION_CROSS_DATABASE_ACCESS');
      } finally { client.release(); }
    } finally { await raw.end(); }
  }
  return { ...LOGINS, authority: 'c4g_authority_runtime' };
}
module.exports = { installCentral, provisionCentralProfiles, validateCentralProfiles };
