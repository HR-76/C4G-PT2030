'use strict';
const assert = require('node:assert/strict');
const manifest = require('../../src/security/centralMigrationManifest');

// Exercise the public runtime boundary. The database verifier is an explicit
// double; these tests prove version selection and fail-closed propagation, not
// PostgreSQL ACLs or fingerprint collection (covered by the isolated gates).
async function assertImportAvailability(t, version) {
  const { createCentralImportUploadRuntime } = require('../../src/portugal2030/uploadRuntime');
  const schema = require('../../src/security/centralSchemaManifest');
  let schemaChecks = 0, dependencyChecks = 0, rejectSchema = false;
  t.mock.method(schema, 'assertCentralSchemaForVersions', async (_client, versions) => {
    schemaChecks++;
    assert.ok(versions.includes(version), `upload runtime does not admit ${version}`);
    for (const denied of ['048_catalog_read_service_v1', '036_f12_service_authority', '999_unknown']) {
      assert.equal(versions.includes(denied), false, `upload must reject ${denied}`);
    }
    if (rejectSchema) throw Error('Synthetic schema/security drift');
    return { version };
  });
  const client = { release() {}, async query(sql) {
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(sql) || sql.endsWith('LIMIT 0')) return { rows: [] };
    if (sql.includes('to_regclass') || sql.includes('has_table_privilege')) return { rows: [{ ready: true }] };
    throw Error('Unexpected availability query');
  } };
  const health = async () => { dependencyChecks++; return { ready: true }; };
  const runtime = createCentralImportUploadRuntime({ pool: { async connect() { return client; } },
    store: { health }, scanner: { health } });
  assert.equal((await runtime.availability()).available, true);
  assert.equal(schemaChecks, 1, 'availability must consult schema/security admission');
  assert.equal(dependencyChecks, 2);
  rejectSchema = true;
  assert.deepEqual(await runtime.availability(), { available: false, code: 'CENTRAL_IMPORT_DEPENDENCY_UNAVAILABLE' });
  assert.equal(schemaChecks, 2, 'later availability revalidates instead of caching success');
  assert.equal(dependencyChecks, 2, 'invalid schema must stop before storage/scanner probes');
}

function assertCatalogLedger(entries) {
  const { assertLedgerRows } = require('../../src/opportunities/catalogRead/ledgerContract');
  const rows = entries.map(entry => ({ version: entry.version, irreversible: entry.irreversible,
    checksum_sha256: manifest.migrationSql(entry.version, 'up').checksum }));
  assert.doesNotThrow(() => assertLedgerRows(rows));
  const latest = rows.at(-1), predecessor = rows.at(-2);
  for (const invalid of [
    rows.filter(row => row !== predecessor),
    [...rows, latest],
    [...rows, { ...latest, version: '999_unknown' }],
    rows.map(row => row === latest ? { ...row, checksum_sha256: '0'.repeat(64) } : row),
    rows.map(row => row === latest ? { ...row, irreversible: !row.irreversible } : row)
  ]) assert.throws(() => assertLedgerRows(invalid), /CATALOG_READ_LEDGER_DRIFT/);
}

async function assertOpportunityPreflight(entries) {
  const { opportunityPreflight } = require('../../src/opportunities/preflight');
  const tables = [...new Set(entries.flatMap(entry =>
    [...manifest.migrationSql(entry.version, 'up').sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? opportunity_catalog\.([a-z_][a-z0-9_]*)/gi)]
      .map(match => match[1])))].sort();
  const queryPool = (version, observedTables) => ({ async query(sql) {
    if (sql === 'SHOW server_version_num') return { rows: [{ server_version_num: '180006' }] };
    if (sql.includes('FROM public.c4g_schema_migration')) return { rows: [{ version }] };
    if (sql.includes('AS table_name')) return { rows: observedTables.map(table_name => ({ table_name })) };
    if (sql.includes('FROM pg_catalog.pg_roles')) return { rows: Array.from({ length: 3 }, () => ({
      rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false })) };
    if (sql.includes('pg_get_constraintdef')) return { rows: [{ definition: 'OPPORTUNITY_CREATED OPPORTUNITY_RECONCILIATION_REQUIRED' }] };
    throw Error('Unexpected opportunity preflight query');
  } });
  const version = entries.at(-1).version;
  assert.equal((await opportunityPreflight(queryPool(version, tables), 'central')).ready, true);
  for (const observed of [tables.slice(1), [...tables, 'unexpected_table'].sort()]) {
    await assert.rejects(opportunityPreflight(queryPool(version, observed), 'central'), /OPPORTUNITY_SCHEMA_DRIFT/);
  }
  await assert.rejects(opportunityPreflight(queryPool('999_unknown', tables), 'central'), /OPPORTUNITY_SCHEMA_DRIFT/);
}

module.exports = { assertImportAvailability, assertCatalogLedger, assertOpportunityPreflight };
