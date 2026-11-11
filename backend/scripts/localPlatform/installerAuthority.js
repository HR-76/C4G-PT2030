'use strict';

// c4g_f12_admin is the pinned owner of the installers' migrations (see migration 028). Its
// SUPERUSER attribute is raised only while an installer runs. This helper owns that window:
//  - a session advisory lock, held on a dedicated connection, marks a live installer; it vanishes
//    with the process, so "role elevated and lock free" means a previous run crashed and is repaired;
//  - the role is demoted on success, failure, SIGINT and SIGTERM, and the result is verified;
//  - installer sessions run as the role through nativePool and are never returned to the pool.
const ROLE = 'c4g_f12_admin';
const ELEVATE_SQL = `ALTER ROLE ${ROLE} SUPERUSER`;
const DEMOTE_SQL = `ALTER ROLE ${ROLE} NOSUPERUSER NOCREATEROLE NOCREATEDB NOLOGIN`;
const LOCK_KEYS = Object.freeze([43001400, 1]);
const INSPECT_SQL = `SELECT true AS exists, r.rolcanlogin AS can_login, r.rolsuper AS superuser,
  (SELECT count(*)::int FROM pg_auth_members m WHERE m.roleid = r.oid) AS members
  FROM pg_roles r WHERE r.rolname = '${ROLE}'`;

function failure(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

async function inspectRole(client) {
  const { rows } = await client.query(INSPECT_SQL);
  return rows[0] ?? { exists: false, can_login: false, superuser: false, members: 0 };
}

function nativePool(pool) {
  return {
    async connect() {
      const client = await pool.connect();
      try {
        await client.query(`SET SESSION AUTHORIZATION ${ROLE}`);
      } catch (error) {
        client.release(error);
        throw error;
      }
      return {
        query: (...args) => client.query(...args),
        // An authorized session must never go back to the pool.
        release: error => client.release(error || new Error('INSTALLER_DISPOSED'))
      };
    }
  };
}

// work({ native, demote }) -> result. `demote()` ends the elevated window early and is idempotent.
async function withInstallerAuthority(pool, { signals = process, exit = process.exit, onRepair = () => {}, create = false } = {}, work) {
  const guard = await pool.connect();
  let elevated = false;
  let workError;
  const listeners = [];

  async function runDemote() {
    try { await guard.query(DEMOTE_SQL); } catch { await pool.query(DEMOTE_SQL); }
    const after = await inspectRole(guard);
    if (after.superuser) throw failure('INSTALLER_ROLE_STILL_ELEVATED');
  }
  async function demote() {
    if (!elevated) return;
    await runDemote();
    elevated = false;
  }

  try {
    const { rows: [{ ok }] } = await guard.query('SELECT pg_try_advisory_lock($1, $2) AS ok', LOCK_KEYS);
    if (!ok) throw failure('INSTALLER_ALREADY_RUNNING');
    if (create) {
      await guard.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${ROLE}')
        THEN CREATE ROLE ${ROLE} NOLOGIN NOINHERIT; END IF; END $$`);
    }
    const role = await inspectRole(guard);
    if (!role.exists) throw failure('INSTALLER_ROLE_MISSING');
    if (role.can_login || role.members > 0) throw failure('INSTALLER_ROLE_UNSAFE');
    if (role.superuser) {
      // The lock is ours, so no live installer owns this elevation: a previous run was killed.
      await guard.query(DEMOTE_SQL);
      onRepair();
    }
    await guard.query(ELEVATE_SQL);
    elevated = true;
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const listener = () => { demote().catch(() => {}).finally(() => exit(130)); };
      signals.once(signal, listener);
      listeners.push([signal, listener]);
    }
    return await work({ native: nativePool(pool), demote });
  } catch (error) {
    workError = error;
    throw error;
  } finally {
    for (const [signal, listener] of listeners) signals.removeListener(signal, listener);
    let demotionError;
    try { await demote(); } catch (error) { demotionError = error; }
    guard.release(new Error('INSTALLER_GUARD_DISPOSED')); // closing the session frees the advisory lock
    // eslint-disable-next-line no-unsafe-finally -- a role left SUPERUSER must outrank any other failure
    if (demotionError) throw failure('INSTALLER_ROLE_STILL_ELEVATED', workError ?? demotionError);
  }
}

module.exports = Object.freeze({ ROLE, ELEVATE_SQL, DEMOTE_SQL, inspectRole, nativePool, withInstallerAuthority });
