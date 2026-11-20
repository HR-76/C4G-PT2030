'use strict';
const { createHash } = require('node:crypto');
const { literal } = require('./config');
const ROLE = 'c4g_prod_runtime_configuration';
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function runtimeSecretProof(config, credentials) {
  return createHash('sha256').update(JSON.stringify(canonical({ config, credentials }))).digest('hex');
}
// The verifier is kept in pg_authid, never a public receipt/comment or application
// table. It prevents a bootstrap retry from silently rotating provider/signing keys.
async function bindRuntimeIntent({ pool, installationMarker, publicDigest, material }, dependencies = {}) {
  if (typeof installationMarker !== 'string' || !/^[a-f0-9]{64}$/.test(publicDigest || '') || !/^[a-f0-9]{64}$/.test(material || '')) throw Error('PRODUCTION_RUNTIME_INTENT_INVALID');
  const verifyPassword = dependencies.verifyPassword || require('./cluster').verifyPassword;
  const marker = installationMarker + ':runtime:' + publicDigest;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query(`SELECT r.rolcanlogin,r.rolinherit,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,
      r.rolconfig IS NOT NULL OR r.rolvaliduntil IS NOT NULL AS configured,shobj_description(r.oid,'pg_authid') AS marker,
      (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) AS edges
      FROM pg_roles r WHERE rolname=$1`, [ROLE])).rows[0];
    if (row) {
      const { marker: observed, edges, ...flags } = row;
      if (observed !== marker || edges !== 0 || Object.values(flags).some(Boolean)) throw Error('PRODUCTION_RUNTIME_INTENT_CONFLICT');
    } else {
      await client.query("SET LOCAL password_encryption='scram-sha-256'");
      await client.query(`CREATE ROLE ${ROLE} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${literal(material)}`);
      await client.query(`COMMENT ON ROLE ${ROLE} IS ${literal(marker)}`);
    }
    await verifyPassword(client, ROLE, material);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
}
module.exports = { ROLE, runtimeSecretProof, bindRuntimeIntent };
