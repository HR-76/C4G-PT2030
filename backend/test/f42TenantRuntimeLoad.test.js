const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createTenantBindingVerifier } = require('../src/security/tenantBindingVerifier');
const { createTenantCredentialProvider } = require('../src/security/tenantCredentialProvider');
const { createTenantOperationCatalog } = require('../src/security/tenantOperationCatalog');
const { createTenantPoolManager } = require('../src/security/tenantPoolManager');
const { createTenantRuntime } = require('../src/security/tenantRuntime');
const { createCredentialAdapter, createManualClock, createManualScheduler,
  syntheticCatalogConfiguration, validSnapshot } = require('./support/tenantRuntimeDoubles');

test('synthetic concurrent load stays isolated and cleans every runtime resource', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  const pools = [];
  const poolFactory = async ({ tenantId, connectionVersion }) => {
    const pool = { tenantId, connectionVersion, ended: false, async connect() {
      return { tenantId, connectionVersion, binding: { tenantId, databaseGenerationId: `generation-${tenantId}`,
        systemIdentifier: `system-${tenantId}`, bindingDigest: `digest-${tenantId}`, schemaVersion: '1',
        schemaFingerprint: 'fingerprint-1', capabilities: ['SYNTHETIC_QUERY'] },
        async query(sql) {
          if (sql === 'SELECT tenant') return { rows: [{ tenant_id: tenantId }] };
          assert.match(sql, /^(?:BEGIN TRANSACTION READ ONLY|SET LOCAL statement_timeout|COMMIT|ROLLBACK)/);
          return { rows: [] };
        }, release() {} };
    }, async end() { pool.ended = true; } };
    pools.push(pool);
    return pool;
  };
  const manager = createTenantPoolManager({ poolFactory, clock, scheduler, jitter: () => 0,
    policy: { globalLimit: 3, perTenantLimit: 2, operationalReserve: 1,
      globalQueueLimit: 24, perTenantQueueLimit: 12, operationalQueueReserve: 2, acquireTimeoutMs: 100,
      leaseTimeoutMs: 100, idleTimeoutMs: 50, drainTimeoutMs: 20, circuitFailureThreshold: 2,
      circuitResetMs: 50, backoffBaseMs: 5, maxBackoffMs: 20 } });
  const snapshots = new Map([
    ['org-a', validSnapshot({ organizationId: 'org-a', tenantId: 'a', databaseGenerationId: 'generation-a',
      databaseRef: 'database-a', credentialRef: 'credential-a', observedSystemIdentifier: 'system-a', bindingDigest: 'digest-a' })],
    ['org-b', validSnapshot({ organizationId: 'org-b', tenantId: 'b', databaseGenerationId: 'generation-b',
      databaseRef: 'database-b', credentialRef: 'credential-b', observedSystemIdentifier: 'system-b', bindingDigest: 'digest-b' })]
  ]);
  const membershipRepository = { async revalidateContext(context) { return context; } };
  const directoryRepository = { async resolveSnapshotByOrganization(id) { return snapshots.get(id) || null; } };
  const queryModule = Object.freeze({ async execute({ client, input }) {
    const result = await client.query('SELECT tenant');
    assert.equal(result.rows[0].tenant_id, input.expectedTenant);
    return result.rows[0].tenant_id;
  } });
  const operationAdapter = Object.freeze({ operationCode: 'SYNTHETIC_QUERY', queryModule });
  const operationCatalog = createTenantOperationCatalog(syntheticCatalogConfiguration(queryModule));
  const credentialAdapter = createCredentialAdapter();
  const credentialProvider = createTenantCredentialProvider(credentialAdapter);
  const bindingVerifier = createTenantBindingVerifier({ async observe({ client }) { return client.binding; } });
  const runtime = createTenantRuntime({ membershipRepository, directoryRepository, operationCatalog, credentialProvider,
    bindingVerifier, poolManager: manager, regionPolicy: { allows: () => true }, clock, scheduler, maxAttempts: 2 });

  const work = Array.from({ length: 20 }, (_, index) => {
    const suffix = index % 2 === 0 ? 'a' : 'b';
    return runtime.resolve({ organizationContext: { organizationId: `org-${suffix}`, membershipId: `m-${suffix}`,
      membershipVersion: 1 }, operationAdapter, correlationId: `c-${index}` })
      .then(lease => lease.execute({ expectedTenant: suffix }));
  });
  const results = await Promise.all(work);
  assert.equal(results.filter(value => value === 'a').length, 10);
  assert.equal(results.filter(value => value === 'b').length, 10);
  await runtime.close();
  assert.deepEqual(runtime.snapshot(), { active: 0, queued: 0, pools: 0, tenants: 0, circuitsOpen: 0,
    credentialDisposalsPending: 0, credentialCleanupTimeouts: 0, credentialCleanupFailures: 0,
    cleanupFailures: 0 });
  assert.equal(pools.every(pool => pool.ended), true);
  assert.equal(credentialAdapter.disposals, 20);
  assert.equal(scheduler.size, 0);
});

test('F4.2 runtime modules have no production, Legacy, environment or timer coupling', () => {
  const names = ['tenantRuntimeErrors.js', 'tenantOperationCatalog.js', 'tenantCredentialProvider.js',
    'tenantBindingVerifier.js', 'tenantPoolManager.js', 'tenantResolver.js', 'tenantLeaseExecutor.js', 'tenantRuntime.js'];
  for (const name of names) {
    const source = fs.readFileSync(path.join(__dirname, '../src/security', name), 'utf8');
    assert.doesNotMatch(source, /config\/db|DATABASE_URL|CENTRAL_DATABASE_URL|process\.env|(?<!\.)\bsetTimeout\s*\(/);
    assert.doesNotMatch(source, /postgres(?:ql)?:\/\//i);
  }
});
