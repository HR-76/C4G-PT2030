'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../src/security/authoritySecurityManifest.js'), 'utf8');
const authority = require('../src/security/authoritySecurityManifest');
const sql = authority.SQL.replace(/\s+/g, ' ').trim();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Structural cost regression only. PostgreSQL A/B byte parity and adversarial
// ACL cases are a separate isolated integration proof, not simulated here.
function cte(name) {
  const match = sql.match(new RegExp('(?:WITH |, )' + name + ' AS(?: MATERIALIZED)? \\('));
  assert.ok(match, 'missing selected/catalog CTE: ' + name);
  const start = match.index + match[0].length;
  let depth = 1;
  for (let index = start; index < sql.length; index++) {
    if (sql[index] === '(') depth++;
    if (sql[index] === ')' && --depth === 0) return sql.slice(start, index);
  }
  assert.fail('unterminated CTE: ' + name);
}


test('authority SQL materializes shared protected-object sets and has no correlated ACL rescan', () => {
  for (const name of ['authority_roles', 'schema_acl', 'relation_acl', 'column_acl', 'function_acl',
    'protected_schemas', 'protected_relations', 'protected_functions']) {
    assert.match(sql, new RegExp(name + ' AS MATERIALIZED \\('));
    cte(name);
  }
  assert.doesNotMatch(sql, /EXISTS\(SELECT 1 FROM aclexplode/);
  assert.doesNotMatch(sql, /pg_get_userbyid\([^)]*\) LIKE 'c4g_authority_%'/);
});

test('each explicit catalog ACL is expanded once and all recipients survive protected-object selection', () => {
  for (const [name, expression] of [['schema_acl', 'n.nspacl'], ['relation_acl', 'c.relacl'], ['column_acl', 't.attacl'], ['function_acl', 'p.proacl']]) {
    assert.equal(sql.split('aclexplode(' + expression + ')').length - 1, 1, expression);
    const selection = cte(name);
    assert.ok(selection.includes('aclexplode(' + expression + ')'));
    assert.doesNotMatch(selection, /authority_roles|grantee\s*=|grantee\s+IN|DISTINCT|GROUP BY/);
  }
  for (const name of ['schema_privileges', 'relation_privileges', 'function_privileges']) {
    const projection = cte(name);
    assert.match(projection, /UNION ALL/);
    assert.doesNotMatch(projection, /authority_roles|grantee\s*=|grantee\s+IN|SELECT DISTINCT/);
  }
});

test('NULL ACL fallback applies only to selected objects and empty ACL remains empty', () => {
  for (const [name, selected, acl] of [['schema_privileges', 'protected_schemas', 'n.nspacl'],
    ['relation_privileges', 'protected_relations', 'c.relacl'], ['function_privileges', 'protected_functions', 'p.proacl']]) {
    const projection = cte(name);
    assert.ok(projection.includes(selected));
    assert.ok(projection.includes(acl + ' IS NULL'));
    assert.match(projection, /aclexplode\(acldefault\(/);
    assert.doesNotMatch(projection, /array_length|cardinality|COALESCE\([^)]*acl/);
  }
  assert.match(cte('relation_privileges'), /CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END/);
});

test('foreign protected schemas, relation owners/grants and column grants remain in the selection', () => {
  const schemas = cte('protected_schemas'), relations = cte('protected_relations'), functions = cte('protected_functions');
  assert.match(schemas, /n.nspname IN\('authority_api','public'\)/);
  assert.match(schemas, /n.nspowner IN \(SELECT oid FROM authority_roles\)/);
  assert.match(schemas, /schema_acl/);
  assert.match(relations, /c.relowner IN \(SELECT oid FROM authority_roles\)/);
  assert.match(relations, /relation_acl/);
  assert.match(relations, /column_acl/);
  // Columns of protected views/foreign tables were covered by the original SQL.
  assert.doesNotMatch(relations, /relkind\s+IN|relkind\s*=/);
  assert.match(functions, /p.proowner IN \(SELECT oid FROM authority_roles\)/);
  assert.match(functions, /function_acl/);
  for (const name of ['c4g_database_identity', 'c4g_schema_migration', 'global_user', 'organization', 'organization_membership',
    'application_session', 'application_session_store', 'oidc_transaction']) assert.ok(relations.includes("'" + name + "'"));
});

test('snapshot projections retain role attributes, ordering, PUBLIC recipients and null/empty distinctions', () => {
  assert.match(sql, /rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconnlimit, rolvaliduntil::text,rolconfig/);
  assert.match(sql, /a.admin_option,a.inherit_option,a.set_option/);
  assert.match(sql, /r.rolname LIKE 'c4g_authority_%' OR m.rolname LIKE 'c4g_authority_%' OR r.rolname='c4g_central_runtime' OR m.rolname='c4g_central_runtime'/);
  for (const key of ['roles', 'schema', 'objects', 'functions']) assert.ok(sql.includes("'" + key + "',(SELECT jsonb_agg("));
  for (const key of ['memberships', 'columns']) assert.ok(sql.includes("'" + key + "',(SELECT COALESCE(jsonb_agg("));
  for (const ordering of ['rolname', 'parent,member', 'schema_name,grantee,privilege_type', 'schema_name,object_name,grantee,privilege_type',
    'schema_name,object_name,column_name,grantee,privilege_type', 'schema_name,function_name,signature,grantee,privilege_type']) assert.ok(sql.includes('ORDER BY ' + ordering));
  assert.equal(sql.split("COALESCE(r.rolname,'PUBLIC')").length - 1, 4);
  assert.match(sql, /pg_get_function_identity_arguments\(p.oid\) signature/);
  assert.match(sql, /pg_get_functiondef\(p.oid\) definition,p.prosecdef security_definer/);
});

function isolated(snapshot) {
  const revision = '043_opportunity_eu_writer_v2', module = { exports: {} };
  const manifest = { manifest: [{ version: revision }], knownManifest: [{ version: revision, authoritySecurityFingerprint: digest(snapshot) }] };
  vm.runInNewContext(source, { module, exports: module.exports, require(name) {
    if (name === 'node:crypto') return require(name);
    if (name === './memberEmailAdmission') return require('../src/security/memberEmailAdmission');
    if (name === './centralMigrationManifest') return manifest;
    if (name === './catalogMetadataTransport') return require('../src/security/catalogMetadataTransport');
    // These cases run outside an HTTP request, where nothing is ever reused.
    if (name === './requestAdmissionScope') return require('../src/security/requestAdmissionScope');
    throw new Error('Unexpected dependency: ' + name);
  } }, { filename: 'authoritySecurityManifest.js' });
  return { api: module.exports, revision };
}
const snapshot = () => ({ roles: [{ rolname: 'c4g_authority_runtime', rolcanlogin: true, rolsuper: false }], memberships: [],
  schema: [{ schema_name: 'authority_api', owner: 'c4g_authority_owner', grantee: 'PUBLIC', privilege_type: 'USAGE', is_grantable: false }],
  objects: [{ schema_name: 'foreign_schema', object_name: 'protected_table', relkind: 'r', owner: 'c4g_authority_owner', grantee: 'third_party', privilege_type: 'SELECT', is_grantable: false }],
  columns: [], functions: null });

test('snapshot collector executes one fresh query per call and preserves returned JSON exactly', async () => {
  const first = snapshot(), second = { ...snapshot(), columns: [{ grantee: 'PUBLIC', privilege_type: 'SELECT', column_name: 'secret' }] };
  const answers = [first, second], calls = [];
  const client = { async query(text) { calls.push(text); return { rows: [{ snapshot: answers.shift() }] }; } };
  assert.equal(await authority.authoritySecuritySnapshot(client), first);
  assert.equal(await authority.authoritySecuritySnapshot(client), second);
  assert.deepEqual(calls, [authority.SQL, authority.SQL]);
  assert.equal(JSON.stringify(first), JSON.stringify({ ...first }));
  assert.equal(first.functions, null); assert.deepEqual(first.columns, []);
});

for (const [label, mutate] of [
  ['role attributes', value => { value.roles[0].rolsuper = true; }],
  ['membership', value => { value.memberships.push({ parent: 'c4g_authority_owner', member: 'third_party', admin_option: false }); }],
  ['schema PUBLIC privilege', value => { value.schema[0].is_grantable = true; }],
  ['foreign relation owner', value => { value.objects[0].owner = 'third_party'; }],
  ['third-party relation ACL', value => { value.objects[0].privilege_type = 'UPDATE'; }],
  ['column ACL', value => { value.columns.push({ grantee: 'PUBLIC', column_name: 'secret', privilege_type: 'SELECT' }); }],
  ['functions null versus empty', value => { value.functions = []; }],
]) test('same connection refuses fresh drift in ' + label, async () => {
  const baseline = snapshot(), f = isolated(baseline), altered = structuredClone(baseline); mutate(altered);
  let calls = 0;
  const client = { async query(text) { assert.equal(text, f.api.COMPACT_SQL); const value=calls++ ? altered : baseline;
    return { rows: [{ snapshot:value,definitions:value.functions===null?null:{} }] }; } };
  assert.equal(await f.api.assertAuthoritySecurity(client, f.revision), baseline);
  await assert.rejects(() => f.api.assertAuthoritySecurity(client, f.revision), { code: 'AUTHORITY_SECURITY_DRIFT' });
  assert.equal(calls, 2);
});

test('snapshot errors and missing rows fail without fallback or cached success', async () => {
  const error = Object.assign(new Error('catalog unavailable'), { code: 'CATALOG_UNAVAILABLE' });
  await assert.rejects(() => authority.authoritySecuritySnapshot({ async query() { throw error; } }), value => value === error);
  const f = isolated(snapshot());
  assert.equal(await f.api.authoritySecuritySnapshot({ async query() { return { rows: [] }; } }), null);
  await assert.rejects(() => f.api.assertAuthoritySecurity({ async query() { return { rows: [] }; } }, f.revision), /AUTHORITY_SECURITY_SNAPSHOT_INVALID/);
});
