'use strict';
const { pbkdf2Sync, createHmac, createHash, timingSafeEqual } = require('node:crypto');
const { configDigest, identifier, literal } = require('./config');
const ownerName = config => 'c4g_prod_install_' + config.installationId.replaceAll('-', '');
const ownership = config => 'C4G_PRODUCTION_BOOTSTRAP_V1:' + configDigest(config);

// Compare the private input to the stored verifier on replay, including servers whose
// pg_hba would otherwise accept a connection without authenticating its password.
function verifyScramPassword(password, verifier) {
  if (typeof password !== 'string' || typeof verifier !== 'string') return false;
  const match = /^SCRAM-SHA-256\$(\d+):([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/.exec(verifier);
  if (!match || Number(match[1]) < 4096 || Number(match[1]) > 1000000) return false;
  const salted = pbkdf2Sync(password.normalize('NFKC'), Buffer.from(match[2], 'base64'), Number(match[1]), 32, 'sha256');
  const stored = createHash('sha256').update(createHmac('sha256', salted).update('Client Key').digest()).digest();
  const server = createHmac('sha256', salted).update('Server Key').digest();
  const expectedStored = Buffer.from(match[3], 'base64'), expectedServer = Buffer.from(match[4], 'base64');
  return expectedStored.length === stored.length && expectedServer.length === server.length
    && timingSafeEqual(stored, expectedStored) && timingSafeEqual(server, expectedServer);
}

async function inspectTarget(pool, config) {
  const target = config.target, options = pool.options;
  if (options?.host !== target.host || Number(options?.port) !== target.port || options?.database !== 'postgres') throw Error('PRODUCTION_CONNECTION_TARGET_MISMATCH');
  const identity = (await pool.query(`SELECT (pg_control_system()).system_identifier::text AS system_identifier,
    current_database() AS database, current_setting('server_version_num') AS version,
    (SELECT rolsuper FROM pg_roles WHERE rolname=session_user) AS admin`)).rows[0];
  if (identity?.system_identifier !== target.expectedSystemIdentifier) throw Error('PRODUCTION_SYSTEM_IDENTIFIER_MISMATCH');
  if (!identity.admin || identity.database !== 'postgres' || ![17, 18].includes(Math.floor(Number(identity.version) / 10000))) throw Error('PRODUCTION_INSTALLER_ADMIN_REQUIRED');
  const owner = ownerName(config), expected = ownership(config);
  const databases = (await pool.query(`SELECT datname,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE NOT datistemplate ORDER BY datname`)).rows;
  if (databases.some(row => !['postgres', target.centralDatabase, target.tenantDatabase].includes(row.datname))) throw Error('PRODUCTION_DEDICATED_INSTANCE_REQUIRED');
  const role = (await pool.query(`SELECT r.*,shobj_description(r.oid,'pg_authid') AS marker,
    (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) AS edges
    FROM pg_roles r WHERE rolname=$1`, [owner])).rows[0];
  if (role && (role.marker !== expected || role.rolcanlogin || role.rolinherit || role.rolsuper || role.rolbypassrls
    || role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.edges !== 0)) throw Error('PRODUCTION_INSTALLATION_OWNERSHIP_MISMATCH');
  if (databases.some(row => row.datname !== 'postgres' && (!role || row.owner !== owner))) throw Error('PRODUCTION_DATABASE_OWNERSHIP_MISMATCH');
  if (!role) {
    const foreign = await pool.query("SELECT 1 FROM pg_roles WHERE rolname NOT LIKE 'pg\\_%' ESCAPE '\\' AND rolname<>session_user LIMIT 1");
    if (foreign.rowCount) throw Error('PRODUCTION_FOREIGN_ROLES_PRESENT');
  }
  const objects = await pool.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' LIMIT 1`);
  if (objects.rowCount) throw Error('PRODUCTION_ADMIN_DATABASE_NOT_EMPTY');
  return { resume: Boolean(role), databases: databases.filter(row => row.datname !== 'postgres').map(row => row.datname) };
}

async function ensureDatabases(pool, config, credentials) {
  const owner = ownerName(config), marker = ownership(config), client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL password_encryption='scram-sha-256'");
    if (!(await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [owner])).rowCount) {
      // A SCRAM verifier in pg_authid binds the permit key on replay without a
      // public secret digest or another application schema. This role never logs in.
      await client.query(`CREATE ROLE ${identifier(owner)} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${literal(credentials.permitSecret)}`);
      await client.query(`COMMENT ON ROLE ${identifier(owner)} IS ${literal(marker)}`);
      await client.query('CREATE ROLE c4g_f12_admin NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
      await client.query(`COMMENT ON ROLE c4g_f12_admin IS ${literal(marker + ':technical-owner')}`);
      await client.query('REVOKE ALL ON DATABASE postgres,template0,template1 FROM PUBLIC');
    }
    await verifyPassword(client, owner, credentials.permitSecret);
    const technical = (await client.query(`SELECT r.*,shobj_description(r.oid,'pg_authid') AS marker,
      (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) AS edges,
      (SELECT rolpassword IS NULL FROM pg_authid WHERE oid=r.oid) AS no_password
      FROM pg_roles r WHERE rolname='c4g_f12_admin'`)).rows[0];
    if (!technical || technical.marker !== marker + ':technical-owner' || technical.rolcanlogin || technical.rolinherit || technical.rolbypassrls
      || technical.rolcreatedb || technical.rolcreaterole || technical.rolreplication || technical.edges !== 0 || !technical.no_password
      || technical.rolconfig !== null || technical.rolvaliduntil !== null) throw Error('PRODUCTION_INSTALLER_ROLE_UNSAFE');
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  // Ownership is committed before CREATE DATABASE. A process loss between these
  // statements can be resumed without adopting an unrelated database.
  for (const database of [config.target.centralDatabase, config.target.tenantDatabase]) {
    const existing = (await pool.query('SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1', [database])).rows[0];
    if (existing && existing.owner !== owner) throw Error('PRODUCTION_DATABASE_OWNERSHIP_MISMATCH');
    if (!existing) {
      await pool.query(`CREATE DATABASE ${identifier(database)} OWNER ${identifier(owner)} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
      await pool.query(`ALTER DATABASE ${identifier(database)} SET timezone TO 'UTC'`);
      await pool.query(`REVOKE ALL ON DATABASE ${identifier(database)} FROM PUBLIC`);
    }
  }
}

async function verifyPassword(pool, login, password) {
  const verifier = (await pool.query('SELECT rolpassword FROM pg_authid WHERE rolname=$1', [login])).rows[0]?.rolpassword;
  if (!verifyScramPassword(password, verifier)) throw Error('PRODUCTION_CREDENTIAL_MISMATCH');
}
module.exports = { ownerName, ownership, verifyScramPassword, verifyPassword, inspectTarget, ensureDatabases };
