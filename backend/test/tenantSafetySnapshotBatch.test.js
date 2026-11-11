'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const {types} = require('pg');
const {tenantSchemaSnapshot, tenantSchemaFingerprint, TENANT_SCHEMAS} = require('../src/security/tenantSchemaFingerprint');
const legacy = require('./support/tenantSchemaLegacyQueries.json');

// Frozen production source is an independent oracle. Execute neither a server
// nor PostgreSQL: these tests prove SQL/decoding/fingerprint contracts only.
const originalFile = require.resolve('../src/security/tenantSchemaFingerprint');
const original = new Module(originalFile, module);
original.filename = originalFile; original.paths = Module._nodeModulePaths(path.dirname(originalFile));
original._compile(fs.readFileSync(path.resolve(__dirname,
  '../../test/integration/dashboard-tenant-cost/fixtures/tenantSchemaFingerprint-before.cjs'), 'utf8'), originalFile);
const baseline = original.exports.tenantSchemaSnapshot;
const normalize = sql => sql.replace(/\s+/g, ' ').trim();
const json = value => types.getTypeParser(114, 'text')(JSON.stringify(value));
const fields = Object.keys(legacy.base);
const all = {scope: true, profile: true, authoring: true, competency: true, metadata: true, imports: true, documents: true};
const habitual = {...all, documents: false};
const range = (start, length) => Array.from({length}, (_, index) => start + index);
const roleNamesLiteral = String.raw`{owner,PUBLIC,"role,with comma","quote\"role","back\\slash"}`;

function fixture(options = {}, workerEnabled = true) {
  const state = {revision: 1, workerEnabled, empty: false, failIndex: null, error: null};
  const commands = [], observed = [];
  const catalog = Object.fromEntries(fields.map(field => [field, []]));
  for (const [flag, schema_name, table_name] of [
    ['scope', 'organizational_scope', 'scope'], ['profile', 'organization_profile', 'catalog_release'],
    ['authoring', 'organization_profile', 'profile_draft'], ['competency', 'organization_profile', 'competency_assertion_version'],
    ['imports', 'opportunity_catalog', 'import_job'], ['documents', 'document_storage', 'multipart_upload']
  ]) if (options[flag]) catalog.tables.push({schema_name, table_name, relation_kind: 'r', owner_name: 'owner'});
  if (options.metadata) catalog.functions.push({schema_name: 'c4g_system', function_name: 'runtime_metadata_v1'});
  function rows(index) {
    if (index === 21) return [{value: state.workerEnabled}];
    if (state.empty) return [];
    if (index === 7) return [{migrator_owns: true, runtime_owns: false, schema_usage: true, schema_create: false,
      public_schema: false, runtime_taxonomy_grant_count: '9223372036854775807', runtime_unexpected_grant: false,
      public_table_grant: false}];
    if (index === 1) return [{table_name: 'scope', policy_name: 'organization', permissive: true, command: '*',
      roles: types.getTypeParser(1003, 'text')(roleNamesLiteral), using_expression: '(organization_id = current_organization())', check_expression: null}];
    return [{evidence: index, revision: state.revision, label: 'Ação "segura"\nsegunda linha', missing: null,
      enabled: false, roles: ['owner', 'PUBLIC']}, {evidence: index, revision: state.revision, label: '', missing: null, enabled: true, roles: []}];
  }
  const scalarCount = normalize(legacy.security[7]).replace(')) AS runtime_taxonomy_grant_count', '))::text AS runtime_taxonomy_grant_count');
  const roleNames = normalize(legacy.security[1]).replace("ORDER BY COALESCE(r.rolname,'PUBLIC')) AS roles", "ORDER BY COALESCE(r.rolname,'PUBLIC'))::text AS roles");
  function identify(sql) {
    const value = normalize(sql);
    return legacy.security.findIndex((query, index) => value === normalize(query)
      || (index === 7 && value === scalarCount) || (index === 1 && value === roleNames));
  }
  const client = {async query(sql, values) {
    if (sql.includes('json_agg(catalog_row)')) {
      commands.push({kind: 'base', sql});
      const expectedSchemas = values[0].includes('f12_service_receipts') ? TENANT_SCHEMAS
        : TENANT_SCHEMAS.filter(name => name !== 'f12_service_receipts');
      assert.deepEqual(values, [expectedSchemas]);
      return {rows: [structuredClone(catalog)]};
    }
    assert.equal(values, undefined, 'security collection needs no new caller inputs');
    if (sql.includes('json_agg(security_row)')) {
      assert.doesNotMatch(sql, /jsonb_agg|;/, 'JSON key order and single-statement boundary are retained');
      const parts = [...sql.matchAll(/FROM \(\s*(SELECT[\s\S]*?)\) AS security_row\) AS "([^"]+)"/g)];
      assert.ok(parts.length > 1, 'a batch contains the complete adjacent group');
      const indexes = parts.map(part => identify(part[1]));
      assert.ok(indexes.every(index => index >= 0), 'each SELECT must match its frozen predecessor');
      assert.equal(new Set(parts.map(part => part[2])).size, parts.length, 'aliases cannot silently overwrite observations');
      commands.push({kind: 'batch', sql, indexes}); observed.push(...indexes);
      if (indexes.includes(state.failIndex)) throw state.error;
      if (Object.hasOwn(state, 'malformed')) return state.malformed(parts.map(part => part[2]));
      const row = Object.fromEntries(parts.map((part, offset) => {
        const index = indexes[offset], evidence = rows(index);
        // pg decodes an int8 column as a string, but JSON would parse an int8
        // number with loss of precision. Simulate that conversion explicitly.
        if (index === 7 && !normalize(part[1]).includes('))::text AS runtime_taxonomy_grant_count')) {
          for (const item of evidence) item.runtime_taxonomy_grant_count = Number(item.runtime_taxonomy_grant_count);
        }
        // OID 1003 (name[]) has no pg array decoder: its normal result is the
        // PostgreSQL array literal string. row_to_json would change its type.
        if (index === 1 && !normalize(part[1]).includes("ORDER BY COALESCE(r.rolname,'PUBLIC'))::text AS roles")) {
          for (const item of evidence) item.roles = types.getTypeParser(1009, 'text')(item.roles);
        }
        return [part[2], json(evidence)];
      }));
      return {rows: [row]};
    }
    const index = identify(sql); assert.notEqual(index, -1, 'unexpected security statement');
    commands.push({kind: index === 21 ? 'probe' : 'individual', sql, indexes: [index]}); observed.push(index);
    if (index === state.failIndex) throw state.error;
    return {rows: structuredClone(rows(index))};
  }};
  return {client, state, catalog, commands, observed};
}

for (const [name, options, count, observed] of [
  ['empty schema', {}, 1, []], ['scope', {scope: true}, 2, range(0, 4)],
  ['profile', {profile: true}, 2, range(4, 4)], ['authoring', {authoring: true}, 3, range(4, 8)],
  ['competency', {competency: true}, 3, [...range(4, 4), ...range(12, 4)]],
  ['metadata', {metadata: true}, 2, range(16, 3)], ['imports', {imports: true}, 2, range(19, 2)],
  ['document worker', {documents: true}, 3, range(21, 3)],
  ['habitual branches', habitual, 7, range(0, 21)], ['all branches', all, 9, range(0, 24)]
]) test(`tenant safety batch preserves legacy bytes and fingerprint with fewer commands: ${name}`, async () => {
  const expectedFixture = fixture(options), actualFixture = fixture(options);
  const expected = await baseline(expectedFixture.client), actual = await tenantSchemaSnapshot(actualFixture.client);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  assert.equal(tenantSchemaFingerprint(actual), tenantSchemaFingerprint(expected));
  assert.deepEqual(actualFixture.observed, observed);
  assert.equal(actualFixture.commands.length, count);
  assert.equal(Object.isFrozen(actual), true);
  assert.ok(actualFixture.commands.filter(command => command.kind !== 'base').every(command => command.kind === 'batch' || command.kind === 'probe'));
});

test('disabled document worker keeps its separate probe and never queries its ACL or roles', async () => {
  const f = fixture(all, false), b = fixture(all, false);
  const actual = await tenantSchemaSnapshot(f.client), expected = await baseline(b.client);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  assert.equal(Object.hasOwn(actual, 'documentWorkerSecurity'), false);
  assert.deepEqual(f.observed, range(0, 22)); assert.equal(f.commands.length, 8);
});

test('security JSON preserves empty arrays and undefined privilege objects exactly', async () => {
  const f = fixture(all), b = fixture(all); f.state.empty = b.state.empty = true;
  const actual = await tenantSchemaSnapshot(f.client), expected = await baseline(b.client);
  assert.deepEqual(actual, expected); assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  assert.equal(actual.organizationalScopeSecurity.privileges, undefined);
  assert.equal(actual.organizationProfileSecurity.privileges, undefined);
  assert.equal(f.commands.length, 9);
});

test('profile grant count remains a lossless pg int8 string through JSON decoding', async () => {
  const f = fixture({profile: true}), actual = await tenantSchemaSnapshot(f.client);
  assert.equal(actual.organizationProfileSecurity.privileges.runtime_taxonomy_grant_count, '9223372036854775807');
  const batch = f.commands.find(command => command.kind === 'batch');
  assert.ok(batch, 'the profile branch must be batched');
  assert.match(normalize(batch.sql), /\)\)::text AS runtime_taxonomy_grant_count/);
});

test('scope policy roles retain the exact pg name[] literal string, including escapes', async () => {
  const f = fixture({scope: true}), b = fixture({scope: true});
  const expected = await baseline(b.client), actual = await tenantSchemaSnapshot(f.client);
  const decoded = types.getTypeParser(1003, 'text')(roleNamesLiteral);
  assert.equal(typeof decoded, 'string', 'pg name[] preserves the textual array representation');
  assert.equal(expected.organizationalScopeSecurity.policies[0].roles, decoded);
  assert.equal(actual.organizationalScopeSecurity.policies[0].roles, decoded);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  assert.equal(tenantSchemaFingerprint(actual), tenantSchemaFingerprint(expected));
  assert.match(normalize(f.commands.find(command => command.kind === 'batch').sql),
    /ORDER BY COALESCE\(r\.rolname,'PUBLIC'\)\)::text AS roles/);
});

test('all eighteen checkpoints remain fresh and observe changed security evidence without reuse', async () => {
  const f = fixture(habitual), b = fixture(habitual), fingerprints = new Set();
  for (let index = 0; index < 18; index++) {
    f.state.revision = b.state.revision = index + 1;
    const actual = await tenantSchemaSnapshot(f.client), expected = await baseline(b.client);
    assert.equal(JSON.stringify(actual), JSON.stringify(expected));
    fingerprints.add(tenantSchemaFingerprint(actual));
  }
  assert.equal(fingerprints.size, 18);
  assert.equal(f.commands.filter(command => command.kind === 'base').length, 18);
  assert.equal(f.commands.length, 126, '18 independent snapshots each execute seven commands');
  assert.equal(b.commands.length, 396, 'frozen baseline retains 18 x 22 commands');
});

test('concurrent tenant snapshots never share arrays or security evidence', async () => {
  const a = fixture(habitual), b = fixture(habitual); b.state.revision = 80;
  const [left, right] = await Promise.all([tenantSchemaSnapshot(a.client), tenantSchemaSnapshot(b.client)]);
  assert.notEqual(tenantSchemaFingerprint(left), tenantSchemaFingerprint(right));
  assert.notEqual(left.organizationProfileSecurity.roles, right.organizationProfileSecurity.roles);
  assert.equal(left.organizationProfileSecurity.roles[0].revision, 1);
  assert.equal(right.organizationProfileSecurity.roles[0].revision, 80);
  assert.equal(a.commands.length, 7); assert.equal(b.commands.length, 7);
});

test('branch presence and document-worker enablement are observed anew on the same client', async () => {
  const f = fixture({documents: true}, false);
  const before = await tenantSchemaSnapshot(f.client);
  assert.equal(Object.hasOwn(before, 'organizationalScopeSecurity'), false);
  assert.equal(Object.hasOwn(before, 'documentWorkerSecurity'), false);
  f.catalog.tables.push({schema_name: 'organizational_scope', table_name: 'scope', relation_kind: 'r', owner_name: 'owner'});
  f.state.workerEnabled = true;
  const enabled = await tenantSchemaSnapshot(f.client);
  assert.ok(enabled.organizationalScopeSecurity); assert.ok(enabled.documentWorkerSecurity);
  f.catalog.tables.pop(); f.state.workerEnabled = false;
  const after = await tenantSchemaSnapshot(f.client);
  assert.equal(JSON.stringify(after), JSON.stringify(before));
  assert.deepEqual(f.observed, [21, ...range(0, 4), 21, 22, 23, 21]);
  assert.equal(f.commands.length, 8);
});

test('malformed security batches fail closed before any later security group', async () => {
  const malformed = [() => null, () => ({}), () => ({rows: []}), () => ({rows: [null]}),
    names => ({rows: [Object.fromEntries(names.map(name => [name, []])), {}]}),
    names => ({rows: [Object.fromEntries(names.map((name, index) => [name, index ? [] : null]))]}),
    names => ({rows: [Object.fromEntries(names.map((name, index) => [name, index ? [] : {}]))]}),
    names => ({rows: [Object.fromEntries(names.slice(1).map(name => [name, []]))]})];
  for (const value of malformed) {
    const f = fixture(all); f.state.malformed = value;
    await assert.rejects(tenantSchemaSnapshot(f.client), {code: 'TENANT_SCHEMA_SNAPSHOT_INVALID'});
    assert.equal(f.commands.length, 2); assert.deepEqual(f.observed, range(0, 4));
  }
});

test('failed security statement keeps its original error and cannot return partial evidence', async () => {
  const f = fixture(all), failure = Object.assign(Error('SYNTHETIC_SECURITY_FAILURE'), {code: '57014'});
  f.state.failIndex = 2; f.state.error = failure;
  await assert.rejects(tenantSchemaSnapshot(f.client), error => error === failure);
  assert.equal(f.commands.length, 2); assert.deepEqual(f.observed, range(0, 4));
});
