'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createProductionCatalogs } = require('../src/authorization/catalogs');
const { createF12TenantOperations, DEFINITIONS } = require('../src/opportunities/tenantOperations');
const { createTenantLeaseExecutor } = require('../src/security/tenantLeaseExecutor');
const { createF12TenantLeaseAdapters } = require('../src/opportunities/tenantLeaseAdapters');
const { createF12LocalComposition } = require('../src/opportunities/localComposition');
const { productionRegistry } = require('../src/async/productionRegistry');
const { createManualClock, createManualScheduler, validSnapshot } = require('./support/tenantRuntimeDoubles');
const { snapshotEligible } = require('../src/security/tenantResolver');
const { manifest: tenantManifest, receiptManifest } = require('../src/security/tenantMigrationManifest');

function handlers(override = {}) {
  return Object.fromEntries(DEFINITIONS.map(definition => [definition.operationCode,
    override[definition.operationCode] || (async ({ input }) => ({ ok: true, input }))]));
}

test('F12 workers admit only verified tenant 033 with matching workload and required capabilities',()=>{
 const version='033_organizational_opportunity_interests';
 const entry=tenantManifest.find(item=>item.version===version);
 const authorization=createProductionCatalogs({catalogVersion:'f12'}).operationCatalog;
 const composed=createF12TenantOperations({handlers:handlers(),authorizationOperationCatalog:authorization});
 const capabilities=Object.freeze(Object.fromEntries(entry.capabilities.map(name=>[name,true])));
 const regionPolicy={allows:()=>true};
 for(const code of ['OPPORTUNITY_DUPLICATE_SCAN_JOB','OPPORTUNITY_CATALOG_RECONCILE_JOB']){
  const operation=composed.catalog.resolveAdapter(composed.adapters[code]);
  const verified=validSnapshot({workload:'WORKER',schema:{currentVersion:version,verifiedCapabilities:capabilities,schemaFingerprint:entry.schemaFingerprint}});
  assert.equal(snapshotEligible(verified,verified.organizationId,operation,regionPolicy),true);
  assert.equal(snapshotEligible(validSnapshot({workload:'API',schema:verified.schema}),verified.organizationId,operation,regionPolicy),false);
  assert.equal(snapshotEligible(validSnapshot({workload:'WORKER',schema:{...verified.schema,currentVersion:'999_unknown'}}),verified.organizationId,operation,regionPolicy),false);
  const missing={...capabilities};delete missing.F9_EXECUTION_LINEAGE;
  assert.equal(snapshotEligible(validSnapshot({workload:'WORKER',schema:{...verified.schema,verifiedCapabilities:Object.freeze(missing)}}),verified.organizationId,operation,regionPolicy),false);
  assert.equal(snapshotEligible(verified,'other-organization',operation,regionPolicy),false);
 }
});

test('receipt-enabled workers require the exact registered 034 fingerprint and receipt capability', () => {
  const entry = receiptManifest.at(-1);
  const authorizationOperationCatalog = createProductionCatalogs({ catalogVersion: 'f12' }).operationCatalog;
  const operations = createF12TenantOperations({ handlers: handlers(), authorizationOperationCatalog, serviceReceiptsEnabled: true });
  const schema = { currentVersion: entry.version, schemaFingerprint: entry.schemaFingerprint,
    verifiedCapabilities: Object.fromEntries(entry.capabilities.map(name => [name, true])) };
  const regionPolicy = { allows: () => true };
  for (const code of ['OPPORTUNITY_DUPLICATE_SCAN_JOB', 'OPPORTUNITY_CATALOG_RECONCILE_JOB']) {
    const operation = operations.catalog.resolveAdapter(operations.adapters[code]);
    const eligible = overrides => {
      const snapshot = validSnapshot({ workload: 'WORKER', schema: { ...schema, ...overrides } });
      return snapshotEligible(snapshot, snapshot.organizationId, operation, regionPolicy);
    };
    assert.equal(eligible({}), true);
    assert.equal(eligible({ currentVersion: receiptManifest.at(-2).version }), false);
    assert.equal(eligible({ schemaFingerprint: 'different' }), false);
    assert.equal(eligible({ verifiedCapabilities: { ...schema.verifiedCapabilities, F12_SERVICE_RECEIPTS: false } }), false);
  }
});

test('approved F12 tenant catalog exposes exactly ten bridged immutable operations', () => {
  const authorization = createProductionCatalogs({ catalogVersion: 'f12' }).operationCatalog;
  const composed = createF12TenantOperations({ handlers: handlers(), authorizationOperationCatalog: authorization });
  assert.equal(composed.version, 'f12-tenant-operations-v2');
  assert.equal(composed.catalog.size, 10);
  assert.deepEqual(Object.keys(composed.adapters), DEFINITIONS.map(item => item.operationCode));
  for (const definition of DEFINITIONS) {
    const adapter = composed.adapters[definition.operationCode];
    const contract = composed.catalog.resolveAdapter(adapter);
    assert.equal(contract.queryModule, composed.modules[definition.operationCode]);
    assert.deepEqual(contract.compatibleSchemaVersions, definition.operationCode.endsWith('_JOB')
      ? ['005_f9_execution_lineage','006_f13_p1_organizational_scope','007_f13_profile_catalogs_and_policies','008_f13_profile_authoring_and_assertions','009_f13_competencies_and_experience','010_f13_financial_capacity','011_f13_operational_capacity','012_f13_territories_and_populations','014_f4_runtime_metadata_access','015_f12_opportunity_xlsx_import','016_f13_editorial_baseline_publication','017_opportunity_evidenced_criteria','018_f13_pq1_publication','019_f13_pq1_activation','020_f14_pq1_decisions','021_application_first_slice','022_application_team_tasks','033_organizational_opportunity_interests']
      : ['004_f12_opportunity_catalog','005_f9_execution_lineage','006_f13_p1_organizational_scope','007_f13_profile_catalogs_and_policies','008_f13_profile_authoring_and_assertions','009_f13_competencies_and_experience','010_f13_financial_capacity','011_f13_operational_capacity','012_f13_territories_and_populations','014_f4_runtime_metadata_access','015_f12_opportunity_xlsx_import','016_f13_editorial_baseline_publication','017_opportunity_evidenced_criteria','018_f13_pq1_publication','019_f13_pq1_activation','020_f14_pq1_decisions','021_application_first_slice','022_application_team_tasks']);
    assert.deepEqual(contract.allowedCompatibilityStates, ['COMPATIBLE']);
    assert.equal(contract.readOnlyEligible, false);
    assert.equal(contract.timeoutMs, 5000);
    assert.equal(authorization.resolve(contract.requiredPermission).effect, contract.accessMode);
  }
  assert.throws(() => createF12TenantOperations({ handlers: { ...handlers(), EXTRA: async () => {} },
    authorizationOperationCatalog: authorization }), /open/);
});

function snapshot(state = 'COMPATIBLE') {
  return validSnapshot({ schema: {
    compatibilityState: state, currentVersion: '004_f12_opportunity_catalog',
    minimumReadVersion: '004_f12_opportunity_catalog', minimumWriteVersion: '004_f12_opportunity_catalog',
    verifiedCapabilities: Object.freeze({ TENANT_CONTROL_BASELINE: true, F9_ASYNC_EXECUTION: true,
      F7_AUDIT_LEDGER: true, F11_PRIVATE_DOCUMENT_STORAGE: true, F12_PRIVATE_CATALOG_READ: true,
      F12_PRIVATE_CATALOG_WRITE: true, F12_DEDUPLICATION: true, schemaFingerprint: 'f' }),
    schemaFingerprint: 'f', revision: 9
  } });
}

async function executeContract(operationCode, queryImplementation, { state = 'COMPATIBLE', fence = 1 } = {}) {
  const authorization = createProductionCatalogs({ catalogVersion: 'f12' }).operationCatalog;
  const composed = createF12TenantOperations({ handlers: handlers({ [operationCode]: queryImplementation }),
    authorizationOperationCatalog: authorization });
  const operation = composed.catalog.resolveAdapter(composed.adapters[operationCode]);
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  const queries = [];
  const client = { async query(sql, values) { queries.push([sql, values]); return { rows: [] }; } };
  const current = snapshot(state);
  const executor = createTenantLeaseExecutor({ clock, scheduler,
    membershipRepository: { async revalidateContext(value) { return value; } },
    directoryRepository: { async resolveSnapshotByOrganization() { return current; } },
    poolManager: { getFence: () => fence } });
  const handle = executor.issue({ allocation: { client, deadline: clock.now() + 10000, fence: 1, async release() {} },
    snapshot: current, organizationContext: { organizationId: 'org-1', membershipId: 'm', membershipVersion: 1 },
    operation, correlationId: 'matrix-correlation' });
  return { promise: handle.execute({ synthetic: true }), queries };
}

test('COMPATIBLE reads and writes use explicit transactions, bounded statement timeout and commit last', async () => {
  for (const [code, begin] of [
    ['OPPORTUNITY_PRIVATE_GET', 'BEGIN TRANSACTION READ ONLY'],
    ['OPPORTUNITY_PRIVATE_UPDATE', 'BEGIN TRANSACTION READ WRITE']
  ]) {
    const state = await executeContract(code, async ({ client }) => {
      await client.query('SELECT 1');
      return { ok: true };
    });
    assert.deepEqual(await state.promise, { ok: true });
    assert.equal(state.queries[0][0], begin);
    assert.match(state.queries[1][0], /^SET LOCAL statement_timeout/);
    assert.equal(state.queries.at(-1)[0], 'COMMIT');
  }
});

test('transaction facade rejects nested boundaries and stale fences roll back', async () => {
  const nested = await executeContract('OPPORTUNITY_PRIVATE_UPDATE', ({ client }) => client.query('COMMIT'));
  await assert.rejects(nested.promise, error => error.internalCode === 'TRANSACTION_BOUNDARY_VIOLATION');
  assert.equal(nested.queries.at(-1)[0], 'ROLLBACK');
  const stale = await executeContract('OPPORTUNITY_PRIVATE_UPDATE', async () => ({ ok: true }), { fence: 2 });
  await assert.rejects(stale.promise, error => error.internalCode === 'TRANSITION_CONFLICT');
  assert.equal(stale.queries.length, 0);
});

test('all F12 operations refuse READ_ONLY before module execution', async () => {
  for (const definition of DEFINITIONS) {
    let calls = 0;
    const state = await executeContract(definition.operationCode, async () => { calls += 1; }, { state: 'READ_ONLY' });
    await assert.rejects(state.promise, error => error.code === 'TENANT_READ_ONLY');
    assert.equal(calls, 0);
  }
});

test('F5 decision is fixed and accepted before F4 resolution; callers cannot select operation or module', async () => {
  const authorizationCatalog = createProductionCatalogs({ catalogVersion: 'f12' }).operationCatalog;
  const operations = createF12TenantOperations({ handlers: handlers(), authorizationOperationCatalog: authorizationCatalog });
  const calls = [];
  const authorization = { async authorize(request) {
    calls.push(['authorize', request.operationCode]);
    return { allowed: true, operation: authorizationCatalog.resolve(request.operationCode) };
  } };
  const resolver = { async resolve(request) {
    calls.push(['resolve', request.operationAdapter.operationCode]);
    return { async execute(invocation) { calls.push(['execute', invocation.payload.value]); return { ok: true }; } };
  } };
  const adapters = createF12TenantLeaseAdapters({ authorization, resolver, operations });
  const input = { actor: { type: 'HUMAN' }, resourceId: 'resource', assuranceEvidence: null,
    correlationId: 'correlation', organizationContext: {}, payload: { value: 1 } };
  assert.deepEqual(await adapters.update(input), { ok: true });
  assert.deepEqual(calls, [
    ['authorize', 'OPPORTUNITY_PRIVATE_UPDATE'], ['resolve', 'OPPORTUNITY_PRIVATE_UPDATE'], ['execute', 1]
  ]);
  await assert.rejects(() => adapters.update({ ...input, operationCode: 'OPPORTUNITY_READ' }), /input is invalid/);
});

test('local F12 composition owns the ten modules and two job handlers without activating production', () => {
  const authorizationOperationCatalog = createProductionCatalogs({ catalogVersion: 'f12' }).operationCatalog;
  const repository = {
    authority: 'ORGANIZATION',
    withTransactionClient: async (_client, work) => work(),
    create: async () => ({}), get: async () => ({}), list: async () => ({}), update: async () => ({}),
    changeLifecycle: async () => ({}), recordCandidate: async () => ({}), bindDocument: async () => ({}),
    scanDuplicateBatch: async () => ({}), recomputeCurrentQuality: async () => ({}),
    requiresDuplicateRescan: async () => false,
  };
  const composition = createF12LocalComposition({
    authorization: { authorize: async () => ({ allowed: false }) },
    authorizationOperationCatalog,
    tenantRuntime: { resolve: async () => { throw new Error('not executed'); } },
    tenantRepository: repository,
    jobContextPort: { resolveOrganizationContext: async () => { throw new Error('not executed'); } },
    continuationPort: { enqueue: async () => true },
  });
  assert.equal(composition.operations.catalog.size, 10);
  assert.deepEqual(composition.jobs.types, ['opportunity.duplicate.scan', 'opportunity.catalog.reconcile']);
  assert.deepEqual(productionRegistry.types, []);
  assert.ok(Object.isFrozen(composition));
  assert.ok(Object.isFrozen(composition.operations.modules));
});

test('local F12 composition exposes the authorized replay service against its own job registry', () => {
  const authorizationOperationCatalog = createProductionCatalogs({ catalogVersion: 'f12' }).operationCatalog;
  const repository = { authority: 'ORGANIZATION', withTransactionClient: async (_client, work) => work(),
    create: async () => ({}), get: async () => ({}), list: async () => ({}), update: async () => ({}),
    changeLifecycle: async () => ({}), recordCandidate: async () => ({}), bindDocument: async () => ({}),
    scanDuplicateBatch: async () => ({}), recomputeCurrentQuality: async () => ({}), requiresDuplicateRescan: async () => false };
  const authorization = { authorize: async () => ({ allowed: false }) };
  const composition = createF12LocalComposition({ authorization, authorizationOperationCatalog,
    tenantRuntime: { resolve: async () => { throw new Error('not executed'); } }, tenantRepository: repository,
    jobContextPort: { resolveOrganizationContext: async () => { throw new Error('not executed'); } },
    continuationPort: { enqueue: async () => true }, replay: {
      repository: { create: async () => ({}), load: async () => null }, centralTransaction: async work => work({}),
      tenantLocator: { resolve: async () => null }, tenantReplayPort: { run: async () => {}, exists: async () => false },
      observabilityFactory: () => null,
    } });
  assert.ok(composition.replayService);
  assert.equal(typeof composition.replayService.request, 'function');
  assert.deepEqual(composition.jobs.types, ['opportunity.duplicate.scan', 'opportunity.catalog.reconcile']);
});
