const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createProductionTenantOperationCatalog, createTenantOperationCatalog
} = require('../src/security/tenantOperationCatalog');
const {
  syntheticCatalogConfiguration, syntheticOperationEntry
} = require('./support/tenantRuntimeDoubles');

const moduleA = Object.freeze({ async execute() { return 'a'; } });

test('operation catalog resolves only the exact frozen registered adapter', () => {
  const catalog = createTenantOperationCatalog(syntheticCatalogConfiguration(moduleA));
  const adapter = Object.freeze({ operationCode: 'SYNTHETIC_QUERY', queryModule: moduleA });
  const resolved = catalog.resolveAdapter(adapter);
  assert.equal(resolved.queryModule, moduleA);
  assert.equal(resolved.catalogVersion, 'f42-synthetic-v1');
  assert.equal(catalog.resolveAdapter(Object.freeze({ operationCode: 'UNKNOWN', queryModule: moduleA })), null);
  assert.throws(() => catalog.resolveAdapter({ operationCode: 'SYNTHETIC_QUERY', queryModule: moduleA }), /frozen/);
});
test('operation catalog validates the complete future contract atomically', () => {
  const entry = syntheticOperationEntry(moduleA);
  assert.throws(() => createTenantOperationCatalog(Object.freeze({
    catalogVersion: 'f42-synthetic-v1', operations: Object.freeze([entry, entry])
  })), /duplicated/);
  assert.throws(() => createTenantOperationCatalog(Object.freeze({
    catalogVersion: 'f42-synthetic-v1', operations: Object.freeze([Object.freeze({ ...entry, extra: true })])
  })), /shape/);
  assert.throws(() => createTenantOperationCatalog(Object.freeze({
    catalogVersion: 'f42-synthetic-v1', operations: Object.freeze([
      Object.freeze({ ...entry, compatibleSchemaVersions: Object.freeze([]) })
    ])
  })), /compatibility/);
  assert.throws(() => createTenantOperationCatalog(Object.freeze({
    catalogVersion: 'f42-synthetic-v1', operations: Object.freeze([
      Object.freeze({ ...entry, allowedCompatibilityStates: Object.freeze(['READ_ONLY']), readOnlyEligible: true,
        accessMode: 'WRITE' })
    ])
  })), /compatibility/);
  assert.throws(() => createTenantOperationCatalog({ catalogVersion: 'mutable', operations: [] }), /configuration/);
});

test('the production catalog is versioned, frozen and admits no operation', () => {
  const catalog = createProductionTenantOperationCatalog();
  assert.equal(catalog.catalogVersion, 'tenant-read-only-bootstrap-v1');
  assert.equal(catalog.size, 0);
  assert.equal(catalog.resolveAdapter(Object.freeze({ operationCode: 'SYNTHETIC_QUERY', queryModule: moduleA })), null);
  assert.equal(Object.isFrozen(catalog), true);
});
