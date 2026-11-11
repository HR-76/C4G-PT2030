const assert = require('node:assert/strict');
const test = require('node:test');
const { createTenantLeaseExecutor, sameSnapshot } = require('../src/security/tenantLeaseExecutor');
const { createProductionTenantOperationCatalog, createTenantOperationCatalog } = require('../src/security/tenantOperationCatalog');
const { createTenantResolver } = require('../src/security/tenantResolver');
const { createManualClock, createManualScheduler, syntheticCatalogConfiguration,
  syntheticOperationEntry, validSnapshot } = require('./support/tenantRuntimeDoubles');

function readOnlySnapshot(overrides = {}) {
  return validSnapshot({ schema: {
    compatibilityState: 'READ_ONLY', currentVersion: '000_tenant_control_baseline',
    minimumReadVersion: '000_tenant_control_baseline', minimumWriteVersion: '000_tenant_control_baseline',
    verifiedCapabilities: Object.freeze({ SYNTHETIC_QUERY: true, schemaFingerprint: 'fingerprint-1' }),
    schemaFingerprint: 'fingerprint-1', revision: 3,
    ...(overrides.schema || {})
  }, ...overrides });
}

function readOnlyOperation(queryModule, overrides = {}) {
  return syntheticOperationEntry(queryModule, {
    compatibleSchemaVersions: Object.freeze(['000_tenant_control_baseline']),
    allowedCompatibilityStates: Object.freeze(['COMPATIBLE', 'READ_ONLY']),
    readOnlyEligible: true,
    timeoutMs: 50,
    ...overrides
  });
}

function issue({ queryModule, client, operationOverrides = {}, current = readOnlySnapshot() }) {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  const operation = readOnlyOperation(queryModule, operationOverrides);
  const releases = [];
  const executor = createTenantLeaseExecutor({ clock, scheduler,
    membershipRepository: { async revalidateContext(value) { return value; } },
    directoryRepository: { async resolveSnapshotByOrganization() { return current; } },
    poolManager: { getFence: () => 1 } });
  const handle = executor.issue({ allocation: { client, deadline: clock.now() + 100, fence: 1,
    async release(options) { releases.push(options); } }, snapshot: readOnlySnapshot(),
  organizationContext: { organizationId: 'org-1', membershipId: 'm', membershipVersion: 1 },
  operation, correlationId: 'synthetic-correlation' });
  return { handle, releases, scheduler };
}

test('production READ_ONLY catalog is empty and refuses before any acquisition dependency', async () => {
  const calls = [];
  const clock = createManualClock();
  const resolver = createTenantResolver({ clock, scheduler: createManualScheduler(clock), maxAttempts: 1,
    membershipRepository: { async revalidateContext() { calls.push('membership'); } },
    directoryRepository: { async resolveSnapshotByOrganization() { calls.push('directory'); } },
    operationCatalog: createProductionTenantOperationCatalog(),
    credentialProvider: { async resolve() { calls.push('credential'); } }, bindingVerifier: {},
    poolManager: { async acquire() { calls.push('pool'); } }, leaseExecutor: {}, regionPolicy: { allows: () => true } });
  const module = Object.freeze({ async execute() {} });
  await assert.rejects(resolver.resolve({
    organizationContext: { organizationId: 'org-1', membershipId: 'm', membershipVersion: 1 },
    operationAdapter: Object.freeze({ operationCode: 'SYNTHETIC_QUERY', queryModule: module }),
    correlationId: 'c'
  }), error => error.internalCode === 'OPERATION_NOT_REGISTERED');
  assert.deepEqual(calls, []);
});
test('synthetic READ_ONLY execution begins before module SQL and commits after validated result', async () => {
  const queries = [];
  const client = { async query(sql) { queries.push(sql); return { rows: [{ ok: true }] }; } };
  const queryModule = Object.freeze({ async execute({ client: active }) {
    assert.notEqual(active, client);
    assert.deepEqual(Object.keys(active), ['query']);
    return active.query('SELECT 1 AS ok');
  } });
  const { handle, releases } = issue({ queryModule, client });
  const result = await handle.execute({ pageSize: 1 });
  assert.deepEqual(result.rows, [{ ok: true }]);
  assert.deepEqual(queries, [
    'BEGIN TRANSACTION READ ONLY',
    "SET LOCAL statement_timeout TO '50ms'",
    'SELECT 1 AS ok',
    'COMMIT'
  ]);
  assert.deepEqual(releases, [{ discard: false, cause: null }]);
});

test('synthetic READ_ONLY failures roll back, sanitize driver errors and discard the client', async () => {
  for (const forbidden of ['INSERT INTO x VALUES (1)', 'CREATE TABLE x(id int)', 'SELECT 1 FOR UPDATE']) {
    const queries = [];
    const client = { async query(sql) {
      queries.push(sql);
      if (sql === forbidden) throw new Error('postgresql://secret@private/tenant');
      return { rows: [] };
    } };
    const queryModule = Object.freeze({ async execute({ client: active }) { return active.query(forbidden); } });
    const { handle, releases } = issue({ queryModule, client });
    await assert.rejects(handle.execute({}), error => {
      assert.equal(error.internalCode, 'TENANT_QUERY_FAILED');
      assert.doesNotMatch(JSON.stringify(error), /secret|private|tenant/);
      return true;
    });
    assert.deepEqual(queries, [
      'BEGIN TRANSACTION READ ONLY',
      "SET LOCAL statement_timeout TO '50ms'",
      forbidden,
      'ROLLBACK'
    ]);
    assert.equal(releases[0].discard, true);
  }
});

test('READ_ONLY catalog validation, input/result limits and version fencing fail closed', async () => {
  const module = Object.freeze({ async execute() { return [{ value: 1 }, { value: 2 }]; } });
  const operation = readOnlyOperation(module, {
    inputSchema: Object.freeze({ validate: input => input && input.allowed === true }),
    limits: Object.freeze({ maxPageSize: 1, maxRows: 1, maxBytes: 1024 })
  });
  const catalog = createTenantOperationCatalog(syntheticCatalogConfiguration(module, [operation]));
  const resolved = catalog.resolveAdapter(Object.freeze({ operationCode: 'SYNTHETIC_QUERY', queryModule: module }));
  assert.equal(resolved.queryModule, module);
  assert.deepEqual(resolved.compatibleSchemaVersions, ['000_tenant_control_baseline']);
  const client = { async query() { return { rows: [] }; } };
  const invalid = issue({ queryModule: module, client, operationOverrides: {
    inputSchema: operation.inputSchema, limits: operation.limits
  } });
  await assert.rejects(invalid.handle.execute({ allowed: false }), error => error.internalCode === 'INPUT_CONTRACT_MISMATCH');
  assert.equal(sameSnapshot(readOnlySnapshot(), readOnlySnapshot({ schema: { currentVersion: '999_changed' } })), false);
});
