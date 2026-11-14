'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {runInThisContext} = require('node:vm');

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const versions = ['029_catalog_reader', '032_single_organization_membership'];

// Isolated manifests make the expected hashes reproducible without changing the
// process-wide module cache or accepting a mocked fingerprint comparison.
function fixture({authorityFingerprint, preAuthority = false} = {}) {
  const security = {roles: [{rolname: 'synthetic_authority', rolsuper: false}], memberships: [], schema: [], objects: [], columns: [], functions: []};
  const sequence = [{seqstart: '1', seqincrement: '1', seqmin: '1', seqmax: '1000', seqcache: '1', seqcycle: false}];
  const catalog = {relations: [], columns: [], roles: [], memberships: [], schema: []};
  const schemaFor = table => ({tables: [{table_name: table}], columns: [], constraints: [], indexes: [], authoritySequence: sequence, authoritySecurity: security});
  const entries = versions.map((version, index) => Object.freeze({version, schemaFingerprint: hash(schemaFor(index ? 'current' : 'previous')),
    ...(preAuthority ? {} : {authoritySecurityFingerprint: authorityFingerprint || hash(security)}), catalogSecurityFingerprint: hash(catalog)}));
  const intermediateEntries = ['030_application_responsibles', '031_tenant_directory_resolution', '033_funding_coverage','034_funding_temporal_refresh','035_funding_source_resolution'].map(version => Object.freeze({
    ...entries[0], version, schemaFingerprint: hash(schemaFor(version))
  }));
  const baselineManifest = Object.freeze([entries[0], ...intermediateEntries, entries[1]]);
  const registeredManifest = Object.freeze([...baselineManifest, Object.freeze({...entries[0], version:'042_opportunity_eu_source_control_v2',schemaFingerprint:hash(schemaFor('registered-package'))})]);
  const knownManifest = Object.freeze([...registeredManifest,
    Object.freeze({...entries[0], version:'043_opportunity_eu_writer_v2',schemaFingerprint:hash(schemaFor('eu-writer-package'))}),
    Object.freeze({...entries[0], version:'044_opportunity_eu_expired_reconciliation',schemaFingerprint:hash(schemaFor('eu-reconciliation-package'))}),
    Object.freeze({...entries[0], version:'045_opportunity_eu_legacy_prearchive',schemaFingerprint:hash(schemaFor('eu-prearchive-package'))}),
    Object.freeze({...entries[0], version:'048_catalog_read_service_v1',schemaFingerprint:hash(schemaFor('catalog-read-package'))}),
    Object.freeze({...entries[0], version:'049_pt2030_document_upload',schemaFingerprint:hash(schemaFor('central-import-package'))}),
    Object.freeze({...entries[0], version:'050_billing_private_documents',schemaFingerprint:hash(schemaFor('billing-pdf-package'))}),
    Object.freeze({...entries[0], version:'051_email_templates',schemaFingerprint:hash(schemaFor('email-template-package'))}),
    Object.freeze({...entries[0], version:'052_central_runtime_read',schemaFingerprint:hash(schemaFor('central-runtime-read-package'))})]);
  const dependencies = new Map([['./centralMigrationManifest', {manifest:baselineManifest,registeredManifest,knownManifest}]]);
  function load(name) {
    const filename = path.resolve(__dirname, '../src/security', name + '.js');
    const localRequire = createRequire(filename), module = {exports: {}};
    const execute = runInThisContext('(function(exports, require, module, __filename, __dirname) {\n' + readFileSync(filename, 'utf8') + '\n})', {filename});
    execute(module.exports, id => dependencies.has(id) ? dependencies.get(id) : localRequire(id), module, filename, path.dirname(filename));
    return module.exports;
  }
  const authority = load('authoritySecurityManifest');
  dependencies.set('./authoritySecurityManifest', authority);
  const schema = load('centralSchemaManifest');
  dependencies.set('./centralSchemaManifest', schema);
  const state = {table: 'current', security, catalogRoles: [], login: 'c4g_authority_runtime', currentUser: 'c4g_authority_runtime', locked: false, onLock: null};
  const queries = [], catalogReads = [], securityReads = [], releases = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql === authority.COMPACT_SQL) { securityReads.push({locked: state.locked, snapshot: state.security}); return {rows: [{snapshot: state.security, definitions: {}}]}; }
      if (sql === authority.SQL) { securityReads.push({locked: state.locked, snapshot: state.security}); return {rows: [{snapshot: state.security}]}; }
      if (sql === 'SELECT session_user,current_user') return {rows: [{session_user: state.login, current_user: state.currentUser}]};
      if (sql === 'SELECT pg_advisory_xact_lock(43001306,1)') { state.locked = true; state.onLock?.(); return {rows: []}; }
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) { if (sql !== 'BEGIN') state.locked = false; return {rows: []}; }
      if (sql.startsWith('SELECT set_config(')) return {rows: []};
      if (sql.includes("product_code='C4G' AND database_role='CENTRAL'")) return {rows: [{valid: true}]};
      if (sql.startsWith('SELECT CASE WHEN EXISTS(SELECT 1 FROM pg_namespace')) return {rows: [{snapshot:null}]};
      if (sql.includes('json_agg(')) {
        catalogReads.push({locked: state.locked, table: state.table});
        return {rows: [{tables: [{table_name: state.table}], columns: [], constraints: [], indexes: [],
          triggers: [], triggerFunctions: [], authoritySequence: sequence}]};
      }
      if (sql.includes('FROM pg_sequence')) return {rows: sequence};
      if (sql.includes('FROM pg_catalog.pg_class')) {
        catalogReads.push({locked: state.locked, table: state.table});
        return {rows: [{table_name: state.table}]};
      }
      if (/FROM pg_catalog\.(pg_attribute|pg_constraint|pg_indexes|pg_trigger|pg_proc)/.test(sql)) return {rows: []};
      if (sql.startsWith('SELECT 1 FROM pg_namespace n,LATERAL')) return {rows: []};
      if (sql.startsWith('SELECT rolname,rolcanlogin,rolsuper,rolbypassrls')) return {rows: state.catalogRoles};
      if (/FROM pg_class|FROM pg_attribute|FROM pg_auth_members|FROM pg_namespace/.test(sql)) return {rows: []};
      throw new Error('Unexpected fixture query: ' + sql);
    },
    release(error) { releases.push(error); }
  };
  let preflights = 0;
  dependencies.set('./centralMigrationPreflight', {async preflightCentral(pool) {
    preflights++;
    const connected = await pool.connect();
    await schema.assertCentralSchema(connected, versions[1]);
    connected.release();
    return Object.freeze({currentVersion: versions[1]});
  }});
  return {authority, schema, state, client, queries, catalogReads, securityReads, releases, entries, security, load, preflights: () => preflights};
}

test('authority snapshot validation is pure, exact and fails closed for absent or unknown evidence', () => {
  const f = fixture();
  assert.strictEqual(f.authority.assertAuthoritySecuritySnapshot(f.security, versions[1]), f.security);
  for (const [snapshot, version] of [[null, versions[1]], [{...f.security, roles: []}, versions[1]], [f.security, 'unregistered']]) {
    assert.throws(() => f.authority.assertAuthoritySecuritySnapshot(snapshot, version), {code: 'AUTHORITY_SECURITY_DRIFT'});
  }
  assert.throws(() => f.authority.assertAuthoritySecuritySnapshot(f.security), {code: 'AUTHORITY_SECURITY_DRIFT'});
  assert.equal(f.queries.length, 0);
});

test('Central schema validates its single authority snapshot and recollects before the next checkpoint', async () => {
  const f = fixture();
  assert.equal(await f.schema.assertCentralSchema(f.client, versions[1]), f.entries[1].schemaFingerprint);
  assert.equal(f.securityReads.length, 1);
  f.state.security = {...f.security, roles: [{rolname: 'synthetic_authority', rolsuper: true}]};
  await assert.rejects(() => f.schema.assertCentralSchema(f.client, versions[1]), /schema drift/i);
  assert.equal(f.securityReads.length, 2);
});

test('a matching aggregate schema hash cannot bypass the separate authority fingerprint', async () => {
  const f = fixture({authorityFingerprint: hash({different: 'authority contract'})});
  await assert.rejects(() => f.schema.assertCentralSchema(f.client, versions[1]), {code: 'AUTHORITY_SECURITY_DRIFT'});
  assert.equal(f.securityReads.length, 1);
});

test('schema snapshot reuse still checks independent catalog ACL evidence at every checkpoint', async () => {
  const f = fixture();
  await f.schema.assertCentralSchema(f.client, versions[1]);
  f.state.catalogRoles = [{rolname: 'synthetic_catalog', rolsuper: true}];
  await assert.rejects(() => f.schema.assertCentralSchema(f.client, versions[1]), /CATALOG_SECURITY_DRIFT/);
  assert.equal(f.securityReads.length, 2);
});

test('authority admission uses the validated preflight snapshot without another query and never caches it', async () => {
  const f = fixture();
  assert.equal((await f.authority.assertAuthorityAdmission(f.client)).currentVersion, versions[1]);
  assert.equal(f.securityReads.length, 1);
  assert.equal(f.preflights(), 1);
  f.state.security = {...f.security, memberships: [{parent: 'unexpected', member: 'synthetic_authority'}]};
  await assert.rejects(() => f.authority.assertAuthorityAdmission(f.client), /schema drift/i);
  assert.equal(f.securityReads.length, 2);
  assert.equal(f.preflights(), 2);
});

test('authority admission rejects changed login identity before collecting schema evidence', async () => {
  const f = fixture();
  f.state.currentUser = 'synthetic_elevated_role';
  await assert.rejects(() => f.authority.assertAuthorityAdmission(f.client), {code: 'AUTHORITY_LOGIN_REQUIRED'});
  assert.equal(f.preflights(), 0);
  assert.equal(f.securityReads.length, 0);
});

test('authority admission rejects a declared schema without an authority security contract', async () => {
  const f = fixture({preAuthority: true});
  await assert.rejects(() => f.authority.assertAuthorityAdmission(f.client), {code: 'AUTHORITY_SECURITY_DRIFT'});
});

test('coordinator recollects the schema for each admission and refuses changed metadata before lock or work', async () => {
  const f = fixture();
  const {createAuthorityCoordinator} = f.load('authorityCoordinator');
  const coordinator = createAuthorityCoordinator({pool: {connect: async () => f.client, query: (...args) => f.client.query(...args)},
    permitSecret: 'synthetic-test-only-authority-dedup-secret'});
  let invoked = 0;
  assert.equal(await coordinator.withAuthority(() => ++invoked), 1);
  assert.deepEqual(f.catalogReads, [{locked: false, table: 'current'}]);
  assert.deepEqual(f.securityReads.map(read => read.locked), [false, true]);
  const nextDecision = f.queries.length;
  f.state.table = 'unexpected_schema_change';
  await assert.rejects(() => coordinator.withAuthority(() => ++invoked), /schema drift/i);
  assert.equal(invoked, 1);
  assert.equal(f.preflights(), 2);
  assert.deepEqual(f.catalogReads, [{locked: false, table: 'current'}, {locked: false, table: 'unexpected_schema_change'}]);
  assert.deepEqual(f.securityReads.map(read => read.locked), [false, true, false]);
  assert.equal(f.queries.slice(nextDecision).some(sql => sql === 'BEGIN' || sql.includes('pg_advisory_xact_lock')), false);
  assert.equal(f.releases.length, 2);
  assert.match(f.releases[1].message, /schema drift/i);
});

test('coordinator collects fresh authority ACLs after the lock and refuses drift before invoking work', async () => {
  const f = fixture();
  const {createAuthorityCoordinator} = f.load('authorityCoordinator');
  const coordinator = createAuthorityCoordinator({pool: {connect: async () => f.client, query: (...args) => f.client.query(...args)},
    permitSecret: 'synthetic-test-only-authority-dedup-secret'});
  let invoked = 0;
  assert.equal(await coordinator.withAuthority(() => ++invoked), 1);
  assert.deepEqual(f.catalogReads, [{locked: false, table: 'current'}]);
  assert.deepEqual(f.securityReads.map(read => read.locked), [false, true]);
  f.state.onLock = () => { f.state.security = {...f.security, objects: [{grantee: 'PUBLIC', privilege_type: 'UPDATE'}]}; };
  await assert.rejects(() => coordinator.withAuthority(() => ++invoked), {code: 'AUTHORITY_SECURITY_DRIFT'});
  assert.equal(invoked, 1);
  assert.equal(f.preflights(), 2);
  assert.deepEqual(f.catalogReads, [{locked: false, table: 'current'}, {locked: false, table: 'current'}]);
  assert.deepEqual(f.securityReads.map(read => read.locked), [false, true, false, true]);
  assert.equal(f.queries.at(-1), 'ROLLBACK');
  assert.equal(f.releases.length, 2);
  assert.equal(f.releases[1].code, 'AUTHORITY_SECURITY_DRIFT');
});

test('the reader version checkpoint uses one snapshot, admits previous versions and preserves the exact allowlist', async () => {
  const f = fixture();
  f.state.table = 'previous';
  const previous = await f.schema.assertCentralSchemaForVersions(f.client, versions);
  assert.deepEqual(previous, {version: versions[0], fingerprint: f.entries[0].schemaFingerprint});
  assert(Object.isFrozen(previous));
  assert.equal(f.securityReads.length, 1);
  f.state.table = 'current';
  assert.equal((await f.schema.assertCentralSchemaForVersions(f.client, versions)).version, versions[1]);
  assert.equal(f.securityReads.length, 2);
  await assert.rejects(() => f.schema.assertCentralSchemaForVersions(f.client, [versions[0]]), {code: 'CENTRAL_SCHEMA_VERSION_NOT_ADMITTED'});
  assert.equal(f.securityReads.length, 3);
});

test('version checkpoints reject empty, unknown and mixed unknown allowlists before collecting evidence', async () => {
  const f = fixture();
  for (const allowed of [undefined, [], ['unregistered'], [versions[0], 'unregistered']]) {
    await assert.rejects(() => f.schema.assertCentralSchemaForVersions(f.client, allowed), {code: 'CENTRAL_SCHEMA_VERSION_NOT_ADMITTED'});
  }
  assert.equal(f.queries.length, 0);
});

test('the reader adapter returns the exact admitted revision and maps a version mismatch to its reader error', async () => {
  const f = fixture(), reader = f.load('catalogReaderSchema');
  f.state.table = 'previous';
  assert.equal(await reader.assertCatalogReaderSchema(f.client), versions[0]);
  assert.equal(f.securityReads.length, 1);
  f.state.table = 'current';
  assert.equal(await reader.assertCatalogReaderSchema(f.client), versions[1]);
  assert.equal(f.securityReads.length, 2);
  f.state.table = 'schema-not-in-reader-allowlist';
  await assert.rejects(() => reader.assertCatalogReaderSchema(f.client), {message: 'CATALOG_READER_SCHEMA_DRIFT'});
  assert.equal(f.securityReads.length, 3);
});

test('the reader adapter preserves authority, catalog ACL and unrelated database failures', async () => {
  const authorityFailure = fixture({authorityFingerprint: hash({different: 'authority contract'})});
  await assert.rejects(() => authorityFailure.load('catalogReaderSchema').assertCatalogReaderSchema(authorityFailure.client), {code: 'AUTHORITY_SECURITY_DRIFT'});
  const catalogFailure = fixture();
  catalogFailure.state.catalogRoles = [{rolname: 'synthetic_catalog', rolsuper: true}];
  await assert.rejects(() => catalogFailure.load('catalogReaderSchema').assertCatalogReaderSchema(catalogFailure.client), {message: 'CATALOG_SECURITY_DRIFT'});
  const unrelatedFailure = fixture(), sentinel = Object.assign(new Error('synthetic database failure'), {code: 'XX000'});
  unrelatedFailure.client.query = async () => { throw sentinel; };
  await assert.rejects(() => unrelatedFailure.load('catalogReaderSchema').assertCatalogReaderSchema(unrelatedFailure.client), error => error === sentinel);
});
