'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {types} = require('pg');
const {TENANT_SCHEMAS, tenantSchemaSnapshot, tenantSchemaFingerprint} = require('../src/security/tenantSchemaFingerprint');
const legacy = require('./support/tenantSchemaLegacyQueries.json');

// Queries frozen before the change. These doubles prove the command/byte
// contract; they do not execute SQL or measure PostgreSQL latency.
const normalize = sql => sql.replace(/\s+/g, ' ').trim();
const fields = Object.keys(legacy.base);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const emptyCatalog = () => Object.fromEntries(fields.map(field => [field, []]));
const range = (start, count) => Array.from({length: count}, (_, index) => start + index);

function catalog({scope = false, profile = false, authoring = false, competency = false,
  metadata = false, imports = false, documents = false} = {}) {
  const tables = [{schema_name: 'c4g_system', table_name: 'tenant_identity', relation_kind: 'r', owner_name: 'c4g_owner'}];
  for (const [enabled, schema_name, table_name] of [
    [scope, 'organizational_scope', 'scope'], [profile, 'organization_profile', 'catalog_release'],
    [authoring, 'organization_profile', 'profile_draft'], [competency, 'organization_profile', 'competency_assertion_version'],
    [imports, 'opportunity_catalog', 'import_job'], [documents, 'document_storage', 'multipart_upload']
  ]) if (enabled) tables.push({schema_name, table_name, relation_kind: 'r', owner_name: 'c4g_owner'});
  return {
    schemas: [{schema_name: 'c4g_system', owner_name: 'c4g_owner'}], tables,
    columns: [{schema_name: 'c4g_system', table_name: 'tenant_identity', ordinal: 1, column_name: 'name',
      data_type: 'text', not_null: true, identity_kind: '', generated_kind: '', default_expression: "'ação'::text"}],
    constraints: [{schema_name: 'c4g_system', table_name: 'tenant_identity', constraint_name: 'tenant_identity_pkey', constraint_type: 'p', definition: 'PRIMARY KEY (name)'}],
    indexes: [{schema_name: 'c4g_system', table_name: 'tenant_identity', index_name: 'tenant_identity_pkey', definition: 'CREATE UNIQUE INDEX tenant_identity_pkey ON c4g_system.tenant_identity USING btree (name)'}],
    triggers: [{schema_name: 'c4g_system', table_name: 'tenant_identity', trigger_name: 'identity_guard', enabled: 'O', definition: 'synthetic trigger'}],
    functions: [{schema_name: 'c4g_system', function_name: metadata ? 'runtime_metadata_v1' : 'identity_guard', identity_arguments: 'tenant uuid',
      owner_name: 'c4g_owner', language: 'plpgsql', definition: 'synthetic function\nwith ação', volatility: 'v', is_strict: false,
      security_definer: true, parallel_safety: 'u', configuration: 'search_path=pg_catalog, c4g_system'}]
  };
}

function fixture(initial = catalog(), {documentWorker = true} = {}) {
  const state = {catalog: structuredClone(initial), revision: 1, documentWorker};
  const commands = [], securityCalls = [];
  const securityRows = index => index === 21 ? [{value: state.documentWorker}] : [{
    evidence: index, revision: state.revision, enabled: true, missing: null, roles: ['c4g_owner', 'PUBLIC'], count: '9223372036854775807'
  }];
  const client = {async query(sql, values) {
    const normalized = normalize(sql);
    const original = fields.find(field => normalized === normalize(legacy.base[field]));
    if (original || sql.includes('json_agg(catalog_row)')) {
      commands.push({sql, values});
      assert.deepEqual(values, [TENANT_SCHEMAS]);
      if (state.error) throw state.error;
      if (original) return {rows: structuredClone(state.catalog[original])};
      assert.equal((sql.match(/\bjson_agg\(/g) || []).length, 7);
      assert.doesNotMatch(sql, /jsonb_agg|;/);
      for (const field of fields) {
        // Only the constraints projection has an authorized SQL change. Rebuild
        // its exact expected SELECT from the frozen oracle; all other SQL stays exact.
        const expected = field === 'constraints' ? normalize(legacy.base[field])
          .replace(' ELSE pg_catalog.pg_get_constraintdef',
            " WHEN con.contype='n' AND NOT con.condeferrable AND NOT con.condeferred" +
            ' AND array_ndims(con.conkey)=1 AND array_lower(con.conkey,1)=1 AND array_length(con.conkey,1)=1' +
            " AND nn.attnum>0 AND NOT nn.attisdropped THEN 'NOT NULL '||pg_catalog.quote_ident(nn.attname) ELSE pg_catalog.pg_get_constraintdef")
          .replace(' WHERE n.nspname',
            " LEFT JOIN pg_catalog.pg_attribute nn ON con.contype='n' AND nn.attrelid = con.conrelid AND nn.attnum = con.conkey[1] WHERE n.nspname")
          : normalize(legacy.base[field]);
        assert.ok(normalized.includes('FROM (' + expected + ') AS catalog_row)'), field + ' approved SELECT changed');
        assert.ok(sql.includes('AS "' + field + '"'), field + ' alias missing');
      }
      if (Object.hasOwn(state, 'aggregateResult')) return state.aggregateResult;
      return {rows: [Object.fromEntries(fields.map(field => [field,
        types.getTypeParser(114, 'text')(JSON.stringify(state.catalog[field]))]))]};
    }
    if (sql.includes('json_agg(security_row)')) {
      assert.equal(values, undefined);
      const parts = [...sql.matchAll(/FROM \((SELECT[\s\S]*?)\) AS security_row\) AS "([^"]+)"/g)];
      const indexes = parts.map(part => legacy.security.findIndex((query, index) => {
        let expected = normalize(query);
        if (index === 1) expected = expected.replace("ORDER BY COALESCE(r.rolname,'PUBLIC')) AS roles", "ORDER BY COALESCE(r.rolname,'PUBLIC'))::text AS roles");
        if (index === 7) expected = expected.replace(')) AS runtime_taxonomy_grant_count', '))::text AS runtime_taxonomy_grant_count');
        return normalize(part[1]) === expected;
      }));
      assert.ok(parts.length > 1 && indexes.every(index => index >= 0), 'security batch preserves its original SELECTs');
      securityCalls.push(...indexes);
      if (state.securityError) throw state.securityError;
      return {rows: [Object.fromEntries(parts.map((part, index) => [part[2],
        types.getTypeParser(114, 'text')(JSON.stringify(securityRows(indexes[index])))]))]};
    }
    const index = legacy.security.findIndex(query => normalize(query) === normalized);
    assert.notEqual(index, -1, 'security SQL remains exactly as before');
    assert.equal(values, undefined);
    securityCalls.push(index);
    if (state.securityError) throw state.securityError;
    return {rows: securityRows(index)};
  }};
  return {state, commands, securityCalls, securityRows, client};
}

function expectedSnapshot(f, options = {}) {
  const output = structuredClone(f.state.catalog), rows = f.securityRows;
  const {scope, profile, authoring, competency, metadata, imports, documents} = options;
  if (metadata) output.runtimeMetadataSecurity = {roles: rows(16), members: rows(17), acl: rows(18)};
  if (imports) output.importWorkerSecurity = {roles: rows(19), acl: rows(20)};
  if (documents && f.state.documentWorker) output.documentWorkerSecurity = {roles: rows(22), acl: rows(23)};
  if (scope) output.organizationalScopeSecurity = {relations: rows(0), policies: rows(1), roles: rows(2), privileges: rows(3)[0]};
  if (profile || authoring || competency) {
    output.organizationProfileSecurity = {relations: rows(4), policies: rows(5), roles: rows(6), privileges: rows(7)[0]};
    if (authoring) Object.assign(output.organizationProfileSecurity, {authoringAcl: rows(8), authoringColumnAcl: rows(9), authoringSchemaAcl: rows(10), authoringFunctionAcl: rows(11)});
    if (competency) Object.assign(output.organizationProfileSecurity, {competencyDocumentAcl: rows(12), competencyDocumentColumnAcl: rows(13), competencyDocumentSchemaAcl: rows(14), competencyDocumentFunctionAcl: rows(15)});
  }
  return output;
}

const all = {scope: true, profile: true, authoring: true, competency: true, metadata: true, imports: true, documents: true};
for (const [name, options, expectedCalls] of [
  ['base schema', {}, []], ['organizational scope', {scope: true}, range(0, 4)],
  ['taxonomy', {profile: true}, range(4, 4)], ['authoring', {authoring: true}, range(4, 8)],
  ['competency', {competency: true}, [...range(4, 4), ...range(12, 4)]],
  ['metadata executor', {metadata: true}, range(16, 3)], ['import worker', {imports: true}, range(19, 2)],
  ['document worker', {documents: true}, range(21, 3)], ['all security branches', all, range(0, 24)]
]) test('tenant catalog preserves exact serialized bytes, fingerprint and security queries: ' + name, async () => {
  const f = fixture(catalog(options)), expected = expectedSnapshot(f, options);
  const actual = await tenantSchemaSnapshot(f.client);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  assert.equal(tenantSchemaFingerprint(actual), hash(expected));
  assert.equal(Object.isFrozen(actual), true);
  assert.deepEqual(f.securityCalls, expectedCalls);
});

test('empty schema retains all seven empty fields and no optional security keys', async () => {
  const f = fixture(emptyCatalog());
  assert.deepEqual(await tenantSchemaSnapshot(f.client), emptyCatalog());
  assert.deepEqual(f.securityCalls, []);
});

test('document worker disabled retains its probe and omits the optional property', async () => {
  const options = {documents: true}, f = fixture(catalog(options), {documentWorker: false});
  assert.equal(JSON.stringify(await tenantSchemaSnapshot(f.client)), JSON.stringify(expectedSnapshot(f, options)));
  assert.deepEqual(f.securityCalls, [21]);
});

test('each fresh tenant snapshot sends one base command instead of seven', async () => {
  const f = fixture(catalog(all));
  await tenantSchemaSnapshot(f.client);
  assert.equal(f.commands.length, 1);
  await tenantSchemaSnapshot(f.client);
  assert.equal(f.commands.length, 2);
  assert.deepEqual(f.securityCalls, [...range(0, 24), ...range(0, 24)]);
});

for (const field of fields) test('new snapshot observes catalog drift in ' + field, async () => {
  const f = fixture(), before = await tenantSchemaSnapshot(f.client);
  f.state.catalog[field][0][Object.keys(f.state.catalog[field][0])[0]] += '_changed';
  const after = await tenantSchemaSnapshot(f.client);
  assert.notEqual(tenantSchemaFingerprint(after), tenantSchemaFingerprint(before));
  assert.equal(JSON.stringify(after), JSON.stringify(expectedSnapshot(f)));
});

test('security evidence is collected again after the catalog on every snapshot', async () => {
  const f = fixture(catalog(all)), before = await tenantSchemaSnapshot(f.client);
  f.state.revision++;
  const after = await tenantSchemaSnapshot(f.client);
  assert.notEqual(tenantSchemaFingerprint(after), tenantSchemaFingerprint(before));
  assert.equal(JSON.stringify(after), JSON.stringify(expectedSnapshot(f, all)));
  assert.deepEqual(f.securityCalls, [...range(0, 24), ...range(0, 24)]);
});

test('PG18 canonical NOT NULL preserves PG17 bytes and fingerprint', async () => {
  const f = fixture(), expected = expectedSnapshot(f);
  f.state.catalog.constraints.unshift({schema_name: 'c4g_system', table_name: 'tenant_identity', constraint_name: 'tenant_name_not_null', constraint_type: 'n', definition: 'NOT NULL name'});
  const actual = await tenantSchemaSnapshot(f.client);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  assert.equal(tenantSchemaFingerprint(actual), hash(expected));
});

for (const definition of ['UNSUPPORTED_NOT_NULL', 'NOT NULL name NOT VALID', 'NOT NULL name NO INHERIT', 'NOT NULL name NOT ENFORCED']) {
  test('noncanonical NOT NULL fails closed: ' + definition, async () => {
    const f = fixture();
    f.state.catalog.constraints.push({schema_name: 'c4g_system', table_name: 'tenant_identity', constraint_name: 'tenant_name_not_null', constraint_type: 'n', definition});
    await assert.rejects(() => tenantSchemaSnapshot(f.client), {message: 'UNSUPPORTED_NOT_NULL_CONSTRAINT'});
  });
}

test('aggregate requires exactly one row and all seven arrays before security reads', async () => {
  const malformed = [null, {}, {rows: []}, {rows: [catalog(all), catalog(all)]}, {rows: [null]}, {rows: [[]]}];
  for (const field of fields) for (const value of [undefined, null, {}, '[]']) malformed.push({rows: [{...catalog(all), [field]: value}]});
  for (const aggregateResult of malformed) {
    const f = fixture(catalog(all)); f.state.aggregateResult = aggregateResult;
    await assert.rejects(() => tenantSchemaSnapshot(f.client), {code: 'TENANT_SCHEMA_SNAPSHOT_INVALID'});
    assert.deepEqual(f.securityCalls, []);
  }
});

test('catalog errors preserve identity and prevent security reads', async () => {
  const f = fixture(catalog(all)), error = Object.assign(new Error('synthetic failure'), {code: '57014'});
  f.state.error = error;
  await assert.rejects(() => tenantSchemaSnapshot(f.client), observed => observed === error);
  assert.equal(f.commands.length, 1);
  assert.deepEqual(f.securityCalls, []);
});

test('security errors preserve identity and prevent returning a partial snapshot', async () => {
  const f = fixture(catalog(all)), error = Object.assign(new Error('synthetic security failure'), {code: '57014'});
  f.state.securityError = error;
  await assert.rejects(() => tenantSchemaSnapshot(f.client), observed => observed === error);
  assert.deepEqual(f.securityCalls, [0, 1, 2, 3]);
});
