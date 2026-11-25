'use strict';
const ROLES = Object.freeze({ read: 'c4g_prod_read_role', commands: 'c4g_prod_commands_role', authoring: 'c4g_prod_authoring_role', logs: 'c4g_prod_logs_role', retention: 'c4g_prod_retention_role' });
const VARIABLES = Object.freeze({ read: 'CENTRAL_DATABASE_URL', commands: 'CENTRAL_COMMANDS_DATABASE_URL', authoring: 'CENTRAL_AUTHORING_DATABASE_URL', logs: 'CENTRAL_LOGS_DATABASE_URL' });
function configuration(env) {
  if (!env.CENTRAL_RUNTIME_PROFILE) return null;
  if (env.CENTRAL_RUNTIME_PROFILE !== 'production-v1') throw Error('CENTRAL_RUNTIME_PROFILE_INVALID');
  if ((env.FUNDING_TENDERS_SOURCE && env.FUNDING_TENDERS_SOURCE !== 'unconfigured') || env.DOCUMENTS_RUNTIME === 'f11-r2'
    || env.OPPORTUNITY_IMPORTS_RUNTIME === 'f12-xlsx' || env.C4G_STAGING_CENTRAL_RUNTIME_LOGINS
    || env.OPPORTUNITY_ACTIVATION_RUNTIME && env.OPPORTUNITY_ACTIVATION_RUNTIME !== 'disabled') throw Error('PRODUCTION_CAPABILITY_NOT_ADMITTED');
  const result = {};
  for (const [key, name] of Object.entries(VARIABLES)) {
    if (typeof env[name] !== 'string' || !env[name]) throw Error('PRODUCTION_DATABASE_REQUIRED');
    result[key] = env[name];
  }
  if (new Set(Object.values(result)).size !== Object.keys(result).length) throw Error('PRODUCTION_CREDENTIALS_MUST_BE_SEPARATE');
  const targets=Object.values(result).map(value=>new URL(value));
  for(const name of ['AUTHORITY_DATABASE_URL','CATALOG_DATABASE_URL']) {
    if(!env[name])throw Error('PRODUCTION_DATABASE_REQUIRED');
    targets.push(new URL(env[name]));
  }
  if(targets.at(-2).username!=='c4g_authority_runtime')throw Error('PRODUCTION_AUTHORITY_LOGIN_REQUIRED');
  if(new Set(targets.map(url=>url.username)).size!==targets.length||new Set(targets.map(url=>url.host+url.pathname)).size!==1)throw Error('PRODUCTION_DATABASE_BINDING_INVALID');
  return Object.freeze(result);
}
async function validateLogin(client, role) {
  const row = (await client.query(`SELECT r.rolname, session_user=current_user AS reset,
    r.rolcanlogin AND r.rolconfig IS NULL AND (r.rolvaliduntil IS NULL OR r.rolvaliduntil>clock_timestamp()) AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit) AS limited,
    (SELECT count(*)=1 AND bool_and(p.rolname=$1 AND NOT a.admin_option AND NOT a.inherit_option AND a.set_option)
     FROM pg_auth_members a JOIN pg_roles p ON p.oid=a.roleid WHERE a.member=r.oid) AS membership,
    NOT has_database_privilege(r.oid,current_database(),'CREATE,TEMP') AS database_limited,
    NOT EXISTS(SELECT 1 FROM pg_class WHERE relowner=r.oid) AND NOT EXISTS(SELECT 1 FROM pg_proc WHERE proowner=r.oid)
     AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=r.oid) AS not_owner,
    NOT EXISTS(SELECT 1 FROM pg_class c,LATERAL aclexplode(c.relacl) a WHERE a.grantee=r.oid)
     AND NOT EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE a.grantee=r.oid)
     AND NOT EXISTS(SELECT 1 FROM pg_namespace n,LATERAL aclexplode(n.nspacl) a WHERE a.grantee=r.oid)
     AND NOT EXISTS(SELECT 1 FROM pg_attribute t,LATERAL aclexplode(t.attacl) a WHERE a.grantee=r.oid) AS no_direct_grants
    FROM pg_roles r WHERE r.rolname=session_user`, [role])).rows[0];
  if (!row || !['reset','limited','membership','database_limited','not_owner','no_direct_grants'].every(key => row[key] === true)) throw Error('PRODUCTION_LOGIN_PRIVILEGE_DRIFT');
  const security=require('./productionCentralSecurity');
  if(security.digest(await security.snapshot(client))!==require('./productionCentralMigrationPackage').entry.productionSecurityFingerprint)throw Error('PRODUCTION_CAPABILITY_SECURITY_DRIFT');
}
// No SQL routing: callers receive one fixed capability. Explicit transactions keep their locks/atomicity.
function createRolePool(raw, capability, { validate = validateLogin } = {}) {
  const role = ROLES[capability];
  if (!role) throw Error('PRODUCTION_CAPABILITY_INVALID');
  async function connect() {
    const client = await raw.connect();
    try { await validate(client, role); } catch (error) { client.release(error); throw error; }
    let open = false, released = false;
    async function query(sql, values) {
      if (released) throw Error('PRODUCTION_CONNECTION_RELEASED');
      const text = typeof sql === 'string' ? sql : sql?.text;
      if (typeof text !== 'string') throw Error('PRODUCTION_QUERY_REQUIRED');
      if (/^\s*(?:SET\s+(?:LOCAL\s+)?ROLE|RESET\s+ROLE)\b/i.test(text)) {
        // Existing writers explicitly select their capability; never permit a different role.
        if (text.trim() === `SET LOCAL ROLE ${role}` && open) return { rows: [], rowCount: 0 };
        throw Error('PRODUCTION_ROLE_CHANGE_DENIED');
      }
      if (/^\s*BEGIN\b/i.test(text)) {
        if (open) throw Error('PRODUCTION_NESTED_TRANSACTION');
        const result = await client.query(sql, values); open = true;
        await client.query(`SET LOCAL ROLE ${role}`);
        return result;
      }
      if (/^\s*(COMMIT|ROLLBACK)\s*;?\s*$/i.test(text)) {
        const result = await client.query(sql, values); open = false; return result;
      }
      if (open) return client.query(sql, values);
      await query('BEGIN');
      try { const result = await client.query(sql, values); await query('COMMIT'); return result; }
      catch (error) { await query('ROLLBACK').catch(() => {}); throw error; }
    }
    return { productionCapability: capability, productionRole: role, query,
      async release(error) {
        if (released) return;
        released = true;
        if (open) { try { await client.query('ROLLBACK'); } catch (failure) { error ||= failure; } }
        client.release(error);
      } };
  }
  return { productionCapability: capability, productionRole: role, connect,
    async query(sql, values) { const client = await connect(); try { return await client.query(sql, values); } finally { await client.release(); } },
    get totalCount() { return raw.totalCount; }, get idleCount() { return raw.idleCount; }, get waitingCount() { return raw.waitingCount; },
    options: raw.options, end: () => raw.end() };
}
function loadPools({ env, ownResource, Pool }) {
  const config = configuration(env);
  if (!config) return null;
  const result = {};
  for (const capability of Object.keys(config)) {
    const raw = new Pool({ ...require('../config/databaseConfig').databasePoolOptions(env,VARIABLES[capability],'CENTRAL_DB'), max: capability === 'read' ? 8 : 2, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000, statement_timeout: 20000, idle_in_transaction_session_timeout: 30000 });
    ownResource(raw, () => raw.end());
    result[capability] = createRolePool(raw, capability);
  }
  return Object.freeze(result);
}
module.exports = { ROLES, VARIABLES, configuration, validateLogin, createRolePool, loadPools };
