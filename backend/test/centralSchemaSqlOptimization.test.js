'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {createRequire} = require('node:module');
const path = require('node:path');
const {runInThisContext} = require('node:vm');
const legacyQueries = require('./support/centralSchemaLegacyQueries.json');

const normalize = sql => sql.replace(/\s+/g, ' ').trim();
const fields = Object.keys(legacyQueries);

function fixture(constraints = []) {
  const filename = path.resolve(__dirname, '../src/security/centralSchemaManifest.js');
  const localRequire = createRequire(filename), module = {exports: {}};
  const calls = [], followups = [];
  const entry = {version: 'synthetic', schemaFingerprint: 'a'.repeat(64)};
  const dependencies = {
    './centralMigrationManifest': {manifest: [entry], knownManifest: [entry]},
    './catalogReaderSecurity': {async catalogReaderSnapshot() { followups.push('reader'); return null; }}
  };
  runInThisContext('(function(exports, require, module, __filename, __dirname) {\n' + readFileSync(filename, 'utf8') + '\n})', {filename})(
    module.exports, id => Object.hasOwn(dependencies, id) ? dependencies[id] : localRequire(id), module, filename, path.dirname(filename));
  const catalog = Object.fromEntries(fields.map(field => [field, field === 'constraints' ? constraints : []]));
  return {schema: module.exports, calls, followups, client: {async query(sql) {
    calls.push(sql);
    return {rows: [structuredClone(catalog)]};
  }}};
}

async function constraintsSql() {
  const f = fixture();
  await f.schema.centralSchemaSnapshot(f.client);
  assert.equal(f.calls.length, 1);
  const sql = normalize(f.calls[0]);
  const match = sql.match(/FROM \((SELECT CASE WHEN n\.nspname='public'[^]*? AS constraint_type,[^]*?)\) AS catalog_row\) AS "constraints"/);
  assert.ok(match, 'ordered constraints collection is present');
  // Start at its last scalar subquery, rather than the preceding collections.
  return match[1].slice(match[1].lastIndexOf('SELECT CASE WHEN'));
}

test('canonical NOT NULL avoids generic constraint deparsing, with indexed column lookup and fallback', async () => {
  const sql = await constraintsSql();
  assert.match(sql, /WHEN con\.contype='n' AND NOT con\.condeferrable AND NOT con\.condeferred/);
  assert.match(sql, /array_ndims\(con\.conkey\)=1 AND array_lower\(con\.conkey,1\)=1 AND array_length\(con\.conkey,1\)=1/);
  assert.match(sql, /AND nn\.attnum>0 AND NOT nn\.attisdropped THEN 'NOT NULL '\|\|pg_catalog\.quote_ident\(nn\.attname\) ELSE pg_catalog\.pg_get_constraintdef\(con\.oid, true\) END AS definition/);
  assert.match(sql, /LEFT JOIN pg_catalog\.pg_attribute nn ON con\.contype='n' AND nn\.attrelid = con\.conrelid AND nn\.attnum = con\.conkey\[1\]/);
  assert.equal((sql.match(/pg_get_constraintdef\(/g) || []).length, 1);
});

test('constraint projection preserves original guards, schema coverage and order without dropping rows', async () => {
  const sql = await constraintsSql();
  const original = normalize(legacyQueries.constraints);
  const projectionEnd = original.indexOf(' ELSE pg_catalog.pg_get_constraintdef');
  assert.ok(sql.startsWith(original.slice(0, projectionEnd)), 'original selected fields and unsupported NOT NULL guards are unchanged');
  const originalFrom = original.slice(original.indexOf(' FROM pg_catalog.pg_constraint'));
  const actualFrom = sql.slice(sql.indexOf(' FROM pg_catalog.pg_constraint')).replace(
    / LEFT JOIN pg_catalog\.pg_attribute nn ON con\.contype='n' AND nn\.attrelid = con\.conrelid AND nn\.attnum = con\.conkey\[1\]/, '');
  assert.equal(actualFrom, originalFrom);
  assert.doesNotMatch(sql, /\b(?:DISTINCT|GROUP BY|LIMIT|OFFSET)\b/);
  // The conenforced catalog column does not exist on PG17: access stays JSON-based.
  assert.match(sql, /COALESCE\(\(to_jsonb\(con\)->>'conenforced'\)::boolean,false\)=false/);
  assert.doesNotMatch(sql, /\bcon\.conenforced\b/);
});

test('all other ordered catalog SELECTs remain byte-equivalent after whitespace normalization', async () => {
  const f = fixture();
  await f.schema.centralSchemaSnapshot(f.client);
  for (const field of fields.filter(field => field !== 'constraints')) {
    assert.ok(normalize(f.calls[0]).includes('FROM (' + normalize(legacyQueries[field]) + ') AS catalog_row)'), field);
  }
  assert.equal((f.calls[0].match(/\bjson_agg\(/g) || []).length, 7);
  assert.doesNotMatch(f.calls[0], /jsonb_agg|::jsonb|;/);
});

test('canonical NOT NULL normalization keeps every other constraint in its received order', async () => {
  const row = (constraint_type, definition, constraint_name) => ({table_name: 'memberships', constraint_name, constraint_type, definition});
  const constraints = [row('c', 'CHECK (active)', 'a_check'), row('n', 'NOT NULL id', 'id_not_null'), row('p', 'PRIMARY KEY (id)', 'pkey'), row('f', 'FOREIGN KEY (org_id) REFERENCES organizations(id)', 'org_fk')];
  const f = fixture(constraints);
  const snapshot = await f.schema.centralSchemaSnapshot(f.client);
  assert.equal(JSON.stringify(snapshot.constraints), JSON.stringify([constraints[0], constraints[2], constraints[3]]));
  await f.schema.centralSchemaSnapshot(f.client);
  assert.equal(f.calls.length, 2, 'each checkpoint still performs a fresh collection');
  assert.deepEqual(f.followups, ['reader', 'reader']);
});

for (const definition of ['NOT NULL "MixedCase"', 'NOT NULL "select"', 'NOT NULL "with space"', 'NOT NULL "a""b"', 'NOT NULL ação', 'NOT NULL id DEFERRABLE', 'NOT NULL id INITIALLY DEFERRED', 'UNSUPPORTED_NOT_NULL', null]) {
  test('NOT NULL remains fail-closed for a noncanonical definition: ' + definition, async () => {
    const f = fixture([{table_name: 'memberships', constraint_name: 'synthetic_nn', constraint_type: 'n', definition}]);
    await assert.rejects(() => f.schema.centralSchemaSnapshot(f.client), {message: 'UNSUPPORTED_NOT_NULL_CONSTRAINT'});
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.followups, [], 'no subsequent security query after invalid catalog evidence');
  });
}
