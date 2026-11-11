function createManualClock(start = 1_900_000_000_000) {
  let value = start;
  return Object.freeze({ now: () => value, advance: milliseconds => { value += milliseconds; return value; } });
}

function createManualScheduler(clock) {
  let sequence = 0;
  const tasks = new Map();
  const api = {
    setTimeout(callback, delay) {
      const id = ++sequence;
      tasks.set(id, { callback, at: clock.now() + delay });
      return id;
    },
    clearTimeout(id) { tasks.delete(id); },
    async advance(milliseconds) {
      clock.advance(milliseconds);
      let due;
      do {
        due = [...tasks.entries()].filter(([, task]) => task.at <= clock.now()).sort((a, b) => a[1].at - b[1].at);
        for (const [id, task] of due) {
          tasks.delete(id);
          await task.callback();
        }
      } while (due.length > 0);
    },
    get size() { return tasks.size; }
  };
  return Object.freeze(api);
}

function createPoolFactory({ connectError = null } = {}) {
  const pools = [];
  const calls = [];
  const factory = async options => {
    calls.push(options);
    const clients = [];
    const pool = {
      ended: false,
      clients,
      async connect() {
        if (connectError) throw connectError;
        const client = {
          releases: [],
          release(error) { this.releases.push(error || null); }
        };
        clients.push(client);
        return client;
      },
      async end() { pool.ended = true; }
    };
    pools.push(pool);
    return pool;
  };
  return { factory, calls, pools };
}

function createCredentialAdapter(material = Object.freeze({ synthetic: true })) {
  const calls = [];
  let disposals = 0;
  return {
    calls,
    get disposals() { return disposals; },
    async resolve(request) {
      calls.push(request);
      return { material, async dispose() { disposals += 1; } };
    }
  };
}

function validSnapshot(overrides = {}) {
  const schema = Object.freeze({
    compatibilityState: 'COMPATIBLE', currentVersion: '1', minimumReadVersion: '1', minimumWriteVersion: '1',
    verifiedCapabilities: Object.freeze({ SYNTHETIC_QUERY: true, schemaFingerprint: 'fingerprint-1' }),
    schemaFingerprint: 'fingerprint-1', revision: 3,
    ...(overrides.schema || {})
  });
  const copy = { organizationId: 'org-1', tenantId: 'tenant-1', deploymentMode: 'DATABASE_PER_ORGANIZATION',
    workload: 'API',
    provisioningStatus: 'READY', connectionVersion: 2, connectionState: 'AVAILABLE', connectionRevision: 4,
    versionState: 'VALIDATED', databaseGenerationId: 'generation-1', databaseRef: 'database-ref-1',
    credentialRef: 'credential-ref-1', regionCode: 'EU_TEST', residencyPolicyVersion: 'policy-1',
    observedSystemIdentifier: 'system-1', bindingDigest: 'digest-1', ...overrides, schema };
  return Object.freeze(copy);
}

function syntheticOperationEntry(queryModule, overrides = {}) {
  return Object.freeze({
    operationCode: 'SYNTHETIC_QUERY',
    ownerModule: 'F42_TEST',
    accessMode: 'READ',
    workload: 'API',
    workloadClass: 'FUNCTIONAL',
    queryModule,
    compatibleSchemaVersions: Object.freeze(['1']),
    requiredCapabilities: Object.freeze(['SYNTHETIC_QUERY']),
    allowedCompatibilityStates: Object.freeze(['COMPATIBLE']),
    readOnlyEligible: false,
    inputSchema: Object.freeze({ validate: () => true }),
    resultSchema: Object.freeze({ validate: () => true }),
    requiredPermission: 'SYNTHETIC_READ',
    limits: Object.freeze({ maxPageSize: 100, maxRows: 100, maxBytes: 65536 }),
    timeoutMs: 100,
    ...overrides
  });
}

function syntheticCatalogConfiguration(queryModule, operations = null) {
  return Object.freeze({
    catalogVersion: 'f42-synthetic-v1',
    operations: Object.freeze(operations || [syntheticOperationEntry(queryModule)])
  });
}

module.exports = {
  createCredentialAdapter, createManualClock, createManualScheduler, createPoolFactory,
  syntheticCatalogConfiguration, syntheticOperationEntry, validSnapshot
};
