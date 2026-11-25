'use strict';
// Explicit, additive rollout for the generic Central 053 variant. Never sends email.
const assert = require('node:assert/strict');
const schema = require('../../src/security/centralSchemaManifest');
const authority = require('../../src/security/authoritySecurityManifest');
const { preflightCentral } = require('../../src/security/centralMigrationPreflight');
const { load } = require('../../src/platformOnboarding/memberEmailSecurityPackage');
const admission = require('../../src/security/memberEmailAdmission');
const VERSION = '053_opportunity_complement';
const QUERY_CODE = '413612ce1ae6f48815025fb9fc5e7855359ecfc145a9245596d8cab0c4370d23';
const tables = ['global_user', 'auth_identity_ref', 'organization', 'organization_membership',
  'platform_member_operation', 'platform_member_invitation', 'authority_f5_state', 'c4g_schema_migration'];
const definition = async client => (await client.query("SELECT pg_get_functiondef('authority_api.execute(text,text[],text)'::regprocedure) AS value")).rows[0].value;
async function records(client) {
  const result = {};
  for (const table of tables) {
    result[table] = (await client.query(`SELECT count(*)::text AS count,
      md5(coalesce(string_agg(value,E'\\n' ORDER BY value),'')) AS digest
      FROM (SELECT to_jsonb(t)::text AS value FROM public.${table} t) rows`)).rows[0];
  }
  return result;
}
function normalizeDefinition(value, from, to) {
  if (typeof value === 'string') return value === from ? to : value;
  if (Array.isArray(value)) return value.map(v => normalizeDefinition(v, from, to));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeDefinition(v, from, to)]));
  return value;
}
async function rollout(pool, { mode, expectedDatabase }) {
  if (!['check', 'rehearse', 'apply'].includes(mode)) throw Error('MEMBER_EMAIL_MODE_REQUIRED');
  const initial = await preflightCentral(pool);
  if (initial.currentVersion !== VERSION) throw Error('MEMBER_EMAIL_VERSION_REQUIRED');
  const client = await pool.connect();
  let begun = false;
  try {
    await client.query(mode === 'check' ? 'BEGIN READ ONLY' : 'BEGIN');
    begun = true;
    await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'");
    if ((await client.query('SELECT current_database() AS name')).rows[0].name !== expectedDatabase) throw Error('MEMBER_EMAIL_TARGET_MISMATCH');
    if (mode !== 'check') {
      await client.query('SELECT pg_advisory_xact_lock(42420002)');
      await client.query('SELECT pg_advisory_xact_lock(43001306,1)');
    }
    const current = (await client.query('SELECT version FROM public.c4g_schema_migration ORDER BY version DESC LIMIT 1')).rows[0].version;
    if (current !== VERSION) throw Error('MEMBER_EMAIL_VERSION_CHANGED');
    const beforeFingerprint = await schema.assertCentralSchema(client, VERSION);
    const original = await definition(client);
    const installed = original.includes(QUERY_CODE);
    // Only the exact generic 053 baseline and its rehearsed email variant are accepted.
    const generic = schema.EXPECTED_CENTRAL_SCHEMA_SHA256_BY_VERSION[VERSION];
    if (beforeFingerprint !== generic && !admission.admits(VERSION, 'schema', beforeFingerprint)) throw Error('MEMBER_EMAIL_VARIANT_REFUSED');
    const before = await records(client);
    if (!installed && mode !== 'check') {
      const snapshot = await schema.centralSchemaSnapshot(client, { compactAuthority: true });
      await client.query(load().sql);
      const changed = await definition(client);
      const afterSnapshot = await schema.centralSchemaSnapshot(client, { compactAuthority: true });
      assert.notEqual(changed, original);
      assert.deepEqual(normalizeDefinition(afterSnapshot, changed, original), snapshot);
    }
    const afterFingerprint = await schema.assertCentralSchema(client, VERSION);
    await authority.assertAuthoritySecurity(client, VERSION);
    await require('../../src/security/catalogReaderSchema').assertCatalogReaderSchema(client);
    assert.deepEqual(await records(client), before, 'existing records must remain identical');
    const patched = (await definition(client)).includes(QUERY_CODE);
    if (mode !== 'check' && !patched) throw Error('MEMBER_EMAIL_PATCH_NOT_PRESENT');
    await client.query(mode === 'apply' ? 'COMMIT' : 'ROLLBACK');
    begun = false;
    return { mode, version: VERSION, alreadyInstalled: installed, installed: mode === 'apply' ? patched : installed,
      rehearsalPassed: mode === 'rehearse', recordsPreserved: true, fingerprint: afterFingerprint,
      counts: Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.count])) };
  } finally {
    if (begun) await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}
async function main() {
  const [flag, ...extra] = process.argv.slice(2);
  if (extra.length || !['--check', '--rehearse', '--apply'].includes(flag)) throw Error('MEMBER_EMAIL_MODE_REQUIRED');
  if (process.env.PUBLIC_APP_URL !== 'https://app-teste.c4g.ai') throw Error('MEMBER_EMAIL_STAGING_REQUIRED');
  const options = require('../../src/config/databaseConfig').databasePoolOptions(process.env, 'CENTRAL_DATABASE_URL', 'CENTRAL_DB');
  const url = new URL(process.env.CENTRAL_DATABASE_URL);
  if (decodeURIComponent(url.pathname) !== '/c4g_central_staging') throw Error('MEMBER_EMAIL_STAGING_DATABASE_REQUIRED');
  const { Pool } = require('pg');
  const pool = new Pool({ ...options, max: 1, connectionTimeoutMillis: 5000 });
  try { console.log(JSON.stringify(await rollout(pool, { mode: flag.slice(2), expectedDatabase: 'c4g_central_staging' }))); }
  finally { await pool.end(); }
}
if (require.main === module) main().catch(error => {
  const code = /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message || '') ? error.message : 'MEMBER_EMAIL_ROLLOUT_FAILED';
  console.error(JSON.stringify({ error: code, sqlState: /^[0-9A-Z]{5}$/.test(error.code || '') ? error.code : undefined }));
  process.exitCode = 1;
});
module.exports = { rollout, normalizeDefinition };
