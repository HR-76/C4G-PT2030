'use strict';
const crypto = require('node:crypto');
const { measurePhase } = require('../observability/requestPhaseTiming');

// Reuse of a successful schema verification between HTTP requests, gated by a
// signature of everything that verification reads
// (context/decisions/2026-11-20-schema-admission-catalog-signature.md).
// Off unless SCHEMA_ADMISSION_REUSE=signature. Nothing here decides access: an
// equal signature only skips repeating a verification that already succeeded
// against the same catalog state.

// Every DDL, GRANT/REVOKE or ALTER writes a new version of at least one row of
// these catalogs, with a transaction id no earlier row carries.
const CATALOGS = Object.freeze([
  'pg_namespace', 'pg_class', 'pg_attribute', 'pg_attrdef', 'pg_constraint', 'pg_index', 'pg_trigger', 'pg_policy',
  'pg_proc', 'pg_type', 'pg_enum', 'pg_language', 'pg_extension', 'pg_sequence', 'pg_inherits', 'pg_rewrite',
  'pg_partitioned_table', 'pg_event_trigger', 'pg_aggregate', 'pg_cast', 'pg_default_acl', 'pg_auth_members',
  'pg_db_role_setting', 'pg_database', 'pg_tablespace'
]);
// Data the Central preflight reads: the migration ledger and the identity marker.
const CENTRAL_DATA = Object.freeze(['public.c4g_schema_migration', 'public.c4g_database_identity']);
const RELATION = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

const rowVersions = relation => `(SELECT md5(COALESCE(string_agg(ctid::text||':'||xmin::text, ',' ORDER BY ctid), '')) FROM ${relation})`;

// One statement, one round trip. Relation names are constants of this module.
function signatureSql(dataRelations = []) {
  if (!dataRelations.every(name => RELATION.test(name))) throw new TypeError('Signature relation is invalid.');
  return `SELECT md5(concat_ws('|',
    ${[...CATALOGS.map(name => `pg_catalog.${name}`), ...dataRelations].map(rowVersions).join(',\n    ')},
    (SELECT md5(COALESCE(string_agg(r::text, ',' ORDER BY r.oid), '')) FROM pg_catalog.pg_roles r),
    current_setting('server_version_num'), current_setting('server_encoding'),
    current_database()::text, session_user::text, current_user::text)) AS signature`;
}
const CENTRAL_SQL = signatureSql(CENTRAL_DATA), TENANT_SQL = signatureSql();

function signatureOf(result) {
  const value = result?.rows?.length === 1 ? result.rows[0].signature : null;
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) throw new Error('SCHEMA_SIGNATURE_INVALID');
  return value;
}

// Central: outside any transaction, on the authority connection being admitted.
async function centralSignature(client) {
  return signatureOf(await client.query(CENTRAL_SQL));
}

// Tenant: inside the request's transaction. A savepoint keeps a failed
// signature from aborting that transaction; `readMetadata` is the existing
// role-switched read of c4g_system.runtime_metadata_v1 and is part of the
// signature because the verification depends on its marker, ledger and flags.
async function tenantSignature(client, readMetadata) {
  await client.query('SAVEPOINT c4g_schema_signature');
  try {
    const catalog = signatureOf(await client.query(TENANT_SQL));
    const metadata = await readMetadata();
    await client.query('RELEASE SAVEPOINT c4g_schema_signature');
    return crypto.createHash('sha256').update(catalog).update('\n').update(JSON.stringify(metadata ?? null)).digest('hex');
  } catch (error) {
    // Also undoes a role switch left by the metadata read.
    await client.query('ROLLBACK TO SAVEPOINT c4g_schema_signature');
    await client.query('RELEASE SAVEPOINT c4g_schema_signature');
    throw error;
  }
}

function createSignatureReuse({ now = () => Date.now(), maxAgeMs = 300000, limit = 128 } = {}) {
  const verified = new Map(), unavailable = new Set();
  // `signature` and `verify` are closed over one connection. Only a completed,
  // successful verification whose signature did not move while it ran is kept.
  async function admit(key, { signature, verify, phase }) {
    if (unavailable.has(key)) return verify();
    let before;
    try { before = await measurePhase(phase, signature); }
    catch {
      // Never fail a request for the optimisation; stop asking this database.
      if (unavailable.size < limit) unavailable.add(key);
      verified.delete(key);
      return verify();
    }
    const held = verified.get(key);
    if (held && held.signature === before && now() - held.at < maxAgeMs) return held.value;
    verified.delete(key);
    const value = await verify();
    let after;
    try { after = await measurePhase(phase, signature); } catch { return value; }
    if (after === before) {
      verified.set(key, { signature: after, value, at: now() });
      while (verified.size > limit) verified.delete(verified.keys().next().value);
    }
    return value;
  }
  return Object.freeze({ admit });
}

let active = null;
function configureSchemaAdmissionReuse(env = process.env) {
  const mode = env.SCHEMA_ADMISSION_REUSE;
  if (mode === undefined || mode === '' || mode === 'off') active = null;
  else if (mode === 'signature') active = createSignatureReuse();
  else throw new TypeError('SCHEMA_ADMISSION_REUSE must be "signature" or "off".');
  return active !== null;
}
function setSchemaAdmissionReuse(reuse) { const previous = active; active = reuse || null; return previous; }

// Called from inside admitWithinRequest's verification: with reuse off, or
// outside an HTTP request, this is the full verification and nothing else.
function admitBySignature(key, options) {
  if (!active || !require('./requestAdmissionScope').withinRequest()) return options.verify();
  return active.admit(key, options);
}

module.exports = { CATALOGS, CENTRAL_DATA, signatureSql, centralSignature, tenantSignature,
  createSignatureReuse, configureSchemaAdmissionReuse, setSchemaAdmissionReuse, admitBySignature };
