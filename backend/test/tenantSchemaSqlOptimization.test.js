'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {runInThisContext} = require('node:vm');
const legacy = require('./support/tenantSchemaLegacyQueries.json');

// These doubles test SQL shape and the real decoder/normalizer, not PostgreSQL
// semantics or performance. The isolated gate must establish physical parity.
const normalize = sql => sql.replace(/\s+/g, ' ').trim();
const fields = Object.keys(legacy.base);
function fixture(constraints = []) {
  const filename = path.resolve(__dirname, '../src/security/tenantSchemaFingerprint.js');
  const localRequire = createRequire(filename), target = {exports: {}};
  runInThisContext('(function(exports, require, module, __filename, __dirname) {\n' + fs.readFileSync(filename, 'utf8') + '\n})', {filename})(
    target.exports, localRequire, target, filename, path.dirname(filename));
  const catalog = Object.fromEntries(fields.map(field => [field, field === 'constraints' ? structuredClone(constraints) : []]));
  const calls = [], state = {catalog};
  const client = {async query(sql, values) {
    calls.push({sql, values});
    if (state.error) throw state.error;
    return Object.hasOwn(state, 'response') ? state.response : {rows: [structuredClone(state.catalog)]};
  }};
  return {schema: target.exports, state, calls, client};
}
async function query() {
  const f = fixture();
  await f.schema.tenantSchemaSnapshot(f.client);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].values, [f.schema.TENANT_SCHEMAS]);
  return normalize(f.calls[0].sql);
}
const fastPath = "WHEN con.contype='n' AND NOT con.condeferrable AND NOT con.condeferred " +
  'AND array_ndims(con.conkey)=1 AND array_lower(con.conkey,1)=1 AND array_length(con.conkey,1)=1 ' +
  "AND nn.attnum>0 AND NOT nn.attisdropped THEN 'NOT NULL '||pg_catalog.quote_ident(nn.attname) ";
const lookup = " LEFT JOIN pg_catalog.pg_attribute nn ON con.contype='n' AND nn.attrelid = con.conrelid AND nn.attnum = con.conkey[1]";
function expectedConstraints() {
  return normalize(legacy.base.constraints)
    .replace(' ELSE pg_catalog.pg_get_constraintdef', ' ' + fastPath + 'ELSE pg_catalog.pg_get_constraintdef')
    .replace(' WHERE n.nspname', lookup + ' WHERE n.nspname');
}

test('tenant NOT NULL fast path exactly preserves the original projection except its guarded branch and lookup', async () => {
  const sql = await query();
  assert(sql.includes('FROM (' + expectedConstraints() + ') AS catalog_row) AS "constraints"'),
    'only the guarded canonical NOT NULL branch and indexed attribute lookup may change');
  assert.equal((sql.match(/pg_get_constraintdef\(/g) || []).length, 1);
  assert.match(sql, /COALESCE\(\(to_jsonb\(con\)->>'conenforced'\)::boolean,false\)=false/);
  assert.doesNotMatch(sql, /\bcon\.conenforced\b/, 'PG17 has no conenforced column');
});

test('all six other catalog projections, order, JSON types and schema arguments are unchanged', async () => {
  const sql = await query();
  for (const field of fields.filter(field => field !== 'constraints')) {
    assert(sql.includes('FROM (' + normalize(legacy.base[field]) + ') AS catalog_row) AS "' + field + '"'), field);
  }
  assert.equal((sql.match(/\bjson_agg\(/g) || []).length, 7);
  assert.doesNotMatch(sql, /jsonb_agg|;|\b(?:DISTINCT|GROUP BY|LIMIT|OFFSET)\b/);
});

test('tenant fast path guards and fallback are identical to the proved Central implementation', async () => {
  const sql = await query();
  const central = normalize(fs.readFileSync(path.resolve(__dirname, '../src/security/centralSchemaManifest.js'), 'utf8'));
  const guard = /CASE WHEN con\.contype='n'[\s\S]+? END AS definition/;
  assert.equal(sql.match(guard)?.[0], central.match(guard)?.[0]);
  assert(sql.includes(lookup));
});

test('canonical NOT NULL rows preserve serialized snapshot and fingerprint while other constraints retain order', async () => {
  const row = (constraint_type, definition, constraint_name) => ({schema_name: 'c4g_system', table_name: 'tenant_identity', constraint_name, constraint_type, definition});
  const retained = [row('c', 'CHECK (active)', 'active_check'), row('p', 'PRIMARY KEY (id)', 'identity_pkey'),
    row('f', 'FOREIGN KEY (org) REFERENCES organizations(id) NOT VALID', 'org_fk'), row('u', 'UNIQUE (name)', 'name_unique'),
    row('x', 'EXCLUDE USING gist (range WITH &&)', 'ranges_exclusion')];
  const f = fixture([retained[0], row('n', 'NOT NULL id', 'id_not_null'), ...retained.slice(1)]);
  const expected = {...f.state.catalog, constraints: retained};
  const actual = await f.schema.tenantSchemaSnapshot(f.client);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  assert.equal(f.schema.tenantSchemaFingerprint(actual), f.schema.tenantSchemaFingerprint(expected));
  assert.equal(Object.isFrozen(actual), true);
});

for (const definition of ['NOT NULL "MixedCase"', 'NOT NULL "select"', 'NOT NULL "with space"', 'NOT NULL "a""b"',
  'NOT NULL a\u00e7\u00e3o', 'NOT NULL id DEFERRABLE', 'NOT NULL id INITIALLY DEFERRED', 'NOT NULL id NOT VALID',
  'NOT NULL id NO INHERIT', 'NOT NULL id NOT ENFORCED', 'UNSUPPORTED_NOT_NULL', null]) {
  test('noncanonical tenant NOT NULL remains a refusal: ' + definition, async () => {
    const f = fixture([{schema_name: 'c4g_system', table_name: 'tenant_identity', constraint_name: 'nn', constraint_type: 'n', definition}]);
    await assert.rejects(() => f.schema.tenantSchemaSnapshot(f.client), {message: 'UNSUPPORTED_NOT_NULL_CONSTRAINT'});
    assert.equal(f.calls.length, 1);
  });
}

test('fresh calls observe constraint drift independently and never reuse another tenant snapshot', async () => {
  const a = fixture(), b = fixture();
  const before = await a.schema.tenantSchemaSnapshot(a.client);
  a.state.catalog.constraints.push({schema_name: 'c4g_system', table_name: 'tenant_identity', constraint_name: 'changed', constraint_type: 'c', definition: 'CHECK (false)'});
  const [after, other] = await Promise.all([a.schema.tenantSchemaSnapshot(a.client), b.schema.tenantSchemaSnapshot(b.client)]);
  assert.notEqual(a.schema.tenantSchemaFingerprint(before), a.schema.tenantSchemaFingerprint(after));
  assert.equal(a.schema.tenantSchemaFingerprint(before), b.schema.tenantSchemaFingerprint(other));
  assert.equal(a.calls.length, 2); assert.equal(b.calls.length, 1);
});

test('malformed catalog responses and SQL errors remain failures', async () => {
  for (const response of [null, {rows: []}, {rows: [null]}, {rows: [{constraints: []}]}]) {
    const f = fixture(); f.state.response = response;
    await assert.rejects(() => f.schema.tenantSchemaSnapshot(f.client), {code: 'TENANT_SCHEMA_SNAPSHOT_INVALID'});
  }
  const f = fixture(), error = new Error('synthetic catalog refusal'); f.state.error = error;
  await assert.rejects(() => f.schema.tenantSchemaSnapshot(f.client), actual => actual === error);
});
