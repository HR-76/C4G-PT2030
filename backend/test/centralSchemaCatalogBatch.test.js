'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {readFileSync} = require('node:fs');
const {createRequire} = require('node:module');
const path = require('node:path');
const {runInThisContext} = require('node:vm');
const {types} = require('pg');
const legacyQueries = require('./support/centralSchemaLegacyQueries.json');

// Frozen before batching: these are the seven SELECTs previously sent separately.
// This double checks their preservation, not SQL execution or PostgreSQL latency.
// The NOT NULL projection optimization has its own structural regressions.
const normalize = sql => sql.replace(/\s+/g, ' ').trim();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const version = 'synthetic_catalog_contract';
const fields = Object.keys(legacyQueries);
const emptyCatalog = () => Object.fromEntries(fields.map(field => [field, []]));
const security = {roles: [{rolname: 'synthetic_authority', rolsuper: false}], objects: []};
const reader = {roles: [], parents: [], tables: [], columns: [], database: []};

function fullCatalog() {
  return {
    tables: [{table_name: 'audit.events'}, {table_name: 'memberships'}, {table_name: 'opportunity_catalog.records'}],
    columns: [
      {table_name: 'audit.events', ordinal: 1, column_name: 'id', data_type: 'bigint', not_null: true, identity_kind: 'a', generated_kind: '', default_expression: ''},
      {table_name: 'memberships', ordinal: 3, column_name: 'label', data_type: 'text', not_null: false, identity_kind: '', generated_kind: '', default_expression: "'ação'::text"}
    ],
    constraints: [{table_name: 'memberships', constraint_name: 'memberships_pkey', constraint_type: 'p', definition: 'PRIMARY KEY (id)'}],
    indexes: [{table_name: 'memberships', index_name: 'memberships_pkey', definition: 'CREATE UNIQUE INDEX memberships_pkey ON public.memberships USING btree (id)'}],
    triggers: [{table_name: 'memberships', trigger_name: 'authority_change', definition: 'CREATE TRIGGER authority_change AFTER UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION authority_changed()'}],
    triggerFunctions: [
      {function_schema: 'async_exec', function_name: 'epoch_changed', identity_arguments: '', language: 'plpgsql', definition: 'synthetic function with newline\nand Unicode ação', volatility: 'v', is_strict: false, security_definer: true, parallel_safety: 'u', configuration: 'search_path=pg_catalog, public'},
      {function_schema: 'public', function_name: 'authority_changed', identity_arguments: '', language: 'plpgsql', definition: 'synthetic function', volatility: 'v', is_strict: true, security_definer: false, parallel_safety: 's', configuration: ''}
    ],
    authoritySequence: [{seqstart: '1', seqincrement: '1', seqmin: '1', seqmax: '9223372036854775807', seqcache: '1', seqcycle: false}]
  };
}

// Legacy output contract, including insertion order and omitted optional keys.
function expectedSnapshot(catalog, catalogReader = null) {
  const snapshot = {tables: catalog.tables, columns: catalog.columns, constraints: catalog.constraints, indexes: catalog.indexes};
  if (catalog.authoritySequence.length) {
    snapshot.authoritySequence = catalog.authoritySequence;
    snapshot.authoritySecurity = security;
  }
  if (catalog.triggers.length) snapshot.triggers = catalog.triggers;
  if (catalog.triggerFunctions.length) snapshot.triggerFunctions = catalog.triggerFunctions;
  if (catalogReader) snapshot.catalogReader = catalogReader;
  return snapshot;
}

function fixture(initial = fullCatalog(), catalogReader = reader) {
  const expected = structuredClone(expectedSnapshot(initial, catalogReader));
  const state = {catalog: structuredClone(initial)};
  const calls = [], followups = [];
  const filename = path.resolve(__dirname, '../src/security/centralSchemaManifest.js');
  const localRequire = createRequire(filename), module = {exports: {}};
  const dependencies = {
    './centralMigrationManifest': {manifest: [{version, schemaFingerprint: hash(expected)}], registeredManifest: [{version, schemaFingerprint: hash(expected)}], knownManifest: [{version, schemaFingerprint: hash(expected)}]},
    './authoritySecurityManifest': {async authoritySecuritySnapshot() { followups.push('authority'); return structuredClone(security); }},
    './catalogReaderSecurity': {async catalogReaderSnapshot() { followups.push('reader'); return structuredClone(catalogReader); }}
  };
  runInThisContext('(function(exports, require, module, __filename, __dirname) {\n' + readFileSync(filename, 'utf8') + '\n})', {filename})(
    module.exports, id => Object.hasOwn(dependencies, id) ? dependencies[id] : localRequire(id), module, filename, path.dirname(filename));
  const client = {async query(sql) {
    calls.push(sql);
    if (state.error) throw state.error;
    const original = fields.find(field => normalize(sql) === normalize(legacyQueries[field]));
    if (original) return {rows: structuredClone(state.catalog[original])};
    assert.match(sql, /^\s*SELECT\b/);
    assert.equal((sql.match(/\bjson_agg\(/g) || []).length, 7);
    assert.doesNotMatch(sql, /jsonb_agg|::jsonb|;/);
    // Apart from the separately tested NOT NULL projection/lookup, each exact
    // original SELECT remains inside its ordered scalar subquery.
    const originalShape = normalize(sql)
      .replace(/ WHEN con\.contype='n' AND NOT con\.condeferrable AND NOT con\.condeferred AND array_ndims\(con\.conkey\)=1 AND array_lower\(con\.conkey,1\)=1 AND array_length\(con\.conkey,1\)=1 AND nn\.attnum>0 AND NOT nn\.attisdropped THEN 'NOT NULL '\|\|pg_catalog\.quote_ident\(nn\.attname\)/, '')
      .replace(/ LEFT JOIN pg_catalog\.pg_attribute nn ON con\.contype='n' AND nn\.attrelid = con\.conrelid AND nn\.attnum = con\.conkey\[1\]/, '');
    for (const field of fields) {
      assert.ok(originalShape.includes('FROM (' + normalize(legacyQueries[field]) + ') AS catalog_row)'), field + ' SELECT changed');
      assert.ok(sql.includes('AS "' + field + '"'), field + ' result alias missing');
    }
    if (Object.hasOwn(state, 'aggregateResult')) return state.aggregateResult;
    // Use the driver's JSON decoder, preserving property order and scalar types.
    const row = Object.fromEntries(fields.map(field => [field, types.getTypeParser(114, 'text')(JSON.stringify(state.catalog[field]))]));
    return {rows: [row]};
  }};
  return {schema: module.exports, client, state, calls, followups, expected};
}

for (const [name, catalog, catalogReader] of [
  ['empty pre-authority schema', emptyCatalog(), null],
  ['complete schema and reader', fullCatalog(), reader],
  ['complete schema without reader', fullCatalog(), null],
  ['triggers without authority sequence', {...fullCatalog(), authoritySequence: []}, reader]
]) {
  test('catalog batching preserves serialized bytes and fingerprint: ' + name, async () => {
    const f = fixture(catalog, catalogReader);
    const actual = await f.schema.centralSchemaSnapshot(f.client);
    assert.equal(JSON.stringify(actual), JSON.stringify(f.expected));
    assert.equal(f.schema.schemaFingerprint(actual), hash(f.expected));
    assert.deepEqual(f.followups, catalog.authoritySequence.length ? ['authority', 'reader'] : ['reader']);
  });
}

test('one catalog command per fresh snapshot replaces seven, with security followups separate', async () => {
  const f = fixture();
  await f.schema.assertCentralSchema(f.client, version);
  assert.equal(f.calls.length, 1);
  await f.schema.assertCentralSchema(f.client, version);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.followups, ['authority', 'reader', 'authority', 'reader']);
});

for (const field of fields) {
  test('fresh snapshot rejects schema drift in ' + field, async () => {
    const f = fixture();
    await f.schema.assertCentralSchema(f.client, version);
    const key = Object.keys(f.state.catalog[field][0])[0];
    f.state.catalog[field][0][key] += '_changed';
    await assert.rejects(() => f.schema.assertCentralSchema(f.client, version), /Central schema drift/);
    await assert.rejects(() => f.schema.assertCentralSchemaForVersions(f.client, [version]), {code: 'CENTRAL_SCHEMA_VERSION_NOT_ADMITTED'});
    assert.deepEqual(f.followups, ['authority', 'reader', 'authority', 'reader', 'authority', 'reader']);
  });
}

test('PG18 canonical NOT NULL retains the PG17 serialized snapshot and manifest fingerprint', async () => {
  const f = fixture();
  f.state.catalog.constraints.unshift({table_name: 'memberships', constraint_name: 'memberships_id_not_null', constraint_type: 'n', definition: 'NOT NULL id'});
  const actual = await f.schema.centralSchemaSnapshot(f.client);
  assert.equal(JSON.stringify(actual), JSON.stringify(f.expected));
  assert.equal(await f.schema.assertCentralSchema(f.client, version), hash(f.expected));
});

for (const definition of ['UNSUPPORTED_NOT_NULL', 'NOT NULL id NOT VALID', 'NOT NULL id NO INHERIT', 'NOT NULL id NOT ENFORCED']) {
  test('snapshot fails closed for PG18 noncanonical constraint: ' + definition, async () => {
    const f = fixture();
    f.state.catalog.constraints.push({table_name: 'memberships', constraint_name: 'memberships_id_not_null', constraint_type: 'n', definition});
    await assert.rejects(() => f.schema.assertCentralSchema(f.client, version), {message: 'UNSUPPORTED_NOT_NULL_CONSTRAINT'});
    assert.deepEqual(f.followups, []);
  });
}

test('catalog errors retain their identity and prevent followup security queries', async () => {
  const f = fixture(), error = Object.assign(new Error('synthetic failure'), {code: '57014'});
  f.state.error = error;
  await assert.rejects(() => f.schema.centralSchemaSnapshot(f.client), observed => observed === error);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.followups, []);
});

test('aggregate requires exactly one row and seven arrays, without substituting empty evidence', async () => {
  const malformed = [null, {}, {rows: []}, {rows: [fullCatalog(), fullCatalog()]}, {rows: [null]}, {rows: [[]]}];
  for (const field of fields) {
    for (const value of [undefined, null, {}, '[]']) malformed.push({rows: [{...fullCatalog(), [field]: value}]});
  }
  for (const aggregateResult of malformed) {
    const f = fixture();
    f.state.aggregateResult = aggregateResult;
    await assert.rejects(() => f.schema.centralSchemaSnapshot(f.client), {code: 'CENTRAL_SCHEMA_SNAPSHOT_INVALID'});
    assert.deepEqual(f.followups, []);
  }
});
